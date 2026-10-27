import { validateToolCall, type AssistantMessage, type Context, type Static, type TSchema, type Tool } from "@earendil-works/pi-ai"
import type { Llm } from "./llm"

/**
 * jaskmoney's agent loop, small on purpose: the model may call the tools it
 * is given (read-only views of the app's data), then must answer by calling
 * `finish`, whose arguments are the typed result. Nothing a tool does
 * changes data; whatever the result proposes, the app checks and the user
 * accepts.
 */
export interface AgentTool<P extends TSchema = TSchema> {
  name: string
  description: string
  parameters: P
  run: (args: Static<P>) => unknown | Promise<unknown>
}

/** A tool with its own argument type, as runAgent's list takes it. */
export function agentTool<P extends TSchema>(tool: AgentTool<P>): AgentTool {
  return tool as unknown as AgentTool
}

export interface AgentUsage { input: number; output: number; cost: number }

export interface AgentRun<T> {
  /** The finish tool's arguments, or null (see `error`). */
  result: T | null
  error?: string
  turns: number
  usage: AgentUsage
  /** Each tool call, in order, for logs and tests. */
  calls: { name: string; args: unknown }[]
}

/** A tool result longer than this is cut (the model is told). */
const RESULT_CHARS = 24_000

export async function runAgent<P extends TSchema>(
  llm: Llm,
  options: {
    system: string
    prompt: string
    tools: AgentTool[]
    finish: { description: string; parameters: P }
    maxTurns?: number
    signal?: AbortSignal
  },
): Promise<AgentRun<Static<P>>> {
  const finishTool: Tool = { name: "finish", description: options.finish.description, parameters: options.finish.parameters }
  const tools: Tool[] = [...options.tools.map(({ name, description, parameters }) => ({ name, description, parameters })), finishTool]
  const context: Context = { systemPrompt: options.system, messages: [{ role: "user", content: options.prompt, timestamp: Date.now() }], tools }
  const usage: AgentUsage = { input: 0, output: 0, cost: 0 }
  const calls: AgentRun<Static<P>>["calls"] = []
  const maxTurns = options.maxTurns ?? 8
  let nudged = false
  for (let turn = 1; turn <= maxTurns; turn++) {
    // The last turn can only answer: a run always ends with a result.
    if (turn === maxTurns && maxTurns > 1) {
      context.tools = [finishTool]
      context.messages.push({ role: "user", content: "This is your last turn: answer now with `finish`, using what you have found.", timestamp: Date.now() })
    }
    const reply: AssistantMessage = await llm.models.complete(llm.model, context, { apiKey: llm.apiKey, signal: options.signal })
    usage.input += reply.usage.input
    usage.output += reply.usage.output
    usage.cost += reply.usage.cost.total
    if (reply.stopReason === "error" || reply.stopReason === "aborted") {
      // A provider's message can echo the request; never the key.
      const message = reply.errorMessage ?? reply.stopReason
      return { result: null, error: llm.apiKey ? message.replaceAll(llm.apiKey, "[redacted]") : message, turns: turn, usage, calls }
    }
    context.messages.push(reply)
    const toolCalls = reply.content.filter((block) => block.type === "toolCall")
    if (!toolCalls.length) {
      if (nudged) return { result: null, error: "the model answered without calling finish", turns: turn, usage, calls }
      nudged = true
      context.messages.push({ role: "user", content: "Answer by calling the `finish` tool.", timestamp: Date.now() })
      continue
    }
    for (const call of toolCalls) {
      calls.push({ name: call.name, args: call.arguments })
      let text: string
      let isError = false
      try {
        const args = validateToolCall(tools, call)
        if (call.name === "finish") return { result: args as Static<P>, turns: turn, usage, calls }
        const tool = options.tools.find((t) => t.name === call.name)
        if (!tool) throw new Error(`no tool ${call.name}`)
        text = JSON.stringify(await tool.run(args))
      } catch (error) {
        isError = true
        text = error instanceof Error ? error.message : String(error)
      }
      if (text.length > RESULT_CHARS) text = `${text.slice(0, RESULT_CHARS)}… (cut at ${RESULT_CHARS} characters: ask for less)`
      context.messages.push({ role: "toolResult", toolCallId: call.id, toolName: call.name, content: [{ type: "text", text }], isError, timestamp: Date.now() })
    }
  }
  return { result: null, error: `no answer after ${maxTurns} turns`, turns: maxTurns, usage, calls }
}
