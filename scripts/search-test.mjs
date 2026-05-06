// Smoke test: hit the live registries via the registrySearch module.
import { searchRemote } from '../src/main/registrySearch.ts'

console.log('\n=== MCP search: "github" ===')
const m = await searchRemote('github', 'mcp')
console.log(`  ${m.entries.length} results`)
for (const e of m.entries.slice(0, 8)) {
  console.log(`  · [${e.source}] ${e.name.padEnd(28)} ${e.canonical ? `→ ${e.canonical.transport}` : '(no canonical)'}`)
}

console.log('\n=== Skill search: "" (all) ===')
const s = await searchRemote('', 'skill')
console.log(`  ${s.entries.length} results`)
for (const e of s.entries.slice(0, 12)) {
  console.log(`  · [${e.source}] ${e.name.padEnd(28)} (${e.publisher})`)
}

console.log('\n=== Skill search: "pdf" ===')
const sp = await searchRemote('pdf', 'skill')
console.log(`  ${sp.entries.length} results`)
for (const e of sp.entries.slice(0, 6)) {
  console.log(`  · [${e.source}] ${e.name}`)
}
