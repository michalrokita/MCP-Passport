// Standalone scan smoke test — exercises the same adapters via tsx.
import { scanAll } from '../src/main/scanner.ts'

const result = await scanAll()

console.log('\n— TOOLS —')
for (const t of result.tools) {
  console.log(
    `  ${t.installed ? 'X' : '.'} ${t.id.padEnd(18)} (${t.surface}, ${t.family})`,
    t.warnings?.length ? `WARN: ${t.warnings.join('; ')}` : ''
  )
  for (const c of t.configPaths) {
    console.log(`     ${c.exists ? 'ok' : '--'}  ${c.label}: ${c.path}`)
  }
}

console.log(`\n— INVENTORY (${result.items.length} items) —`)
const byKind = {}
for (const it of result.items) {
  ;(byKind[it.kind] ??= []).push(it)
}
for (const [kind, items] of Object.entries(byKind)) {
  console.log(`\n  ${kind.toUpperCase()} (${items.length})`)
  for (const it of items.slice(0, 50)) {
    const tools = [...new Set(it.presences.map((p) => `${p.toolId}/${p.scope}`))]
    console.log(`    - ${it.name.padEnd(28)} → ${tools.join(', ')}`)
    if (it.description) console.log(`        ${it.description.slice(0, 90)}`)
  }
  if (items.length > 50) console.log(`    … (+${items.length - 50} more)`)
}

console.log(`\n— PROJECTS (${result.projects.length}) —`)
for (const p of result.projects.slice(0, 10)) {
  console.log(`  · ${p.label}`)
}
if (result.projects.length > 10) console.log(`  … (+${result.projects.length - 10} more)`)
