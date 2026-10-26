/** The name an Up row takes locally: Up's own, or when another row (not
 * `existingId`) has it, the name with " (Up)", then " (Up) 2", " (Up) 3"… */
export function resolveUpName(base: string, lookup: (name: string) => number | undefined, existingId: number | undefined): string {
  const conflicts = (name: string) => { const id = lookup(name); return id !== undefined && id !== existingId }
  if (!conflicts(base)) return base
  const qualified = `${base} (Up)`
  let name = qualified
  for (let n = 2; conflicts(name); n++) name = `${qualified} ${n}`
  return name
}
