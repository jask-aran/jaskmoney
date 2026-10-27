import { readFileSync } from "node:fs"

/** The hottest functions in a .cpuprofile: self time and total (inclusive) time, top N. */
const [path, n = "25"] = process.argv.slice(2)
const profile = JSON.parse(readFileSync(path!, "utf8")) as { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }[]; samples: number[]; timeDeltas: number[] }
const byId = new Map(profile.nodes.map((node) => [node.id, node]))
const parent = new Map<number, number>()
for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id)
const self = new Map<string, number>(), total = new Map<string, number>()
const label = (id: number) => { const f = byId.get(id)!.callFrame; return `${f.functionName || "(anon)"} ${f.url.replace(/.*\/(src|node_modules)\//, "$1/")}:${f.lineNumber + 1}` }
profile.samples.forEach((id, i) => {
  const dt = profile.timeDeltas[i] ?? 0
  self.set(label(id), (self.get(label(id)) ?? 0) + dt)
  const seen = new Set<string>()
  for (let at: number | undefined = id; at != null; at = parent.get(at)) { const l = label(at); if (!seen.has(l)) { seen.add(l); total.set(l, (total.get(l) ?? 0) + dt) } }
})
const all = [...self.values()].reduce((a, b) => a + b, 0)
const show = (m: Map<string, number>, title: string) => console.log(`\n${title}\n` + [...m].sort((a, b) => b[1] - a[1]).slice(0, Number(n)).map(([l, us]) => `${(100 * us / all).toFixed(1).padStart(5)}%  ${l}`).join("\n"))
show(self, "self"); show(total, "total")
