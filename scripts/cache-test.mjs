// Verify disk cache: first call hits network, second returns from cache fast.
import { searchRemote, clearSearchCache } from '../src/main/registrySearch.ts'

await clearSearchCache()
console.log('Cache cleared.')

console.log('\n--- 1st call (network) ---')
let t = Date.now()
let r = await searchRemote('linear', 'mcp')
console.log(`  ${r.entries.length} entries, source=${r.source}, took ${Date.now() - t}ms`)
console.log(`  cache: ${JSON.stringify(r.cache)}`)
console.log(`  sources: ${JSON.stringify(r.sources)}`)

console.log('\n--- 2nd call (should be cache) ---')
t = Date.now()
r = await searchRemote('linear', 'mcp')
console.log(`  ${r.entries.length} entries, source=${r.source}, took ${Date.now() - t}ms`)
console.log(`  cache: ${JSON.stringify(r.cache)}`)

console.log('\n--- 3rd call with bypassCache=true (network again) ---')
t = Date.now()
r = await searchRemote('linear', 'mcp', { bypassCache: true })
console.log(`  ${r.entries.length} entries, source=${r.source}, took ${Date.now() - t}ms`)
console.log(`  cache: ${JSON.stringify(r.cache)}`)

console.log('\n--- skill search (anthropics + openai) ---')
t = Date.now()
r = await searchRemote('', 'skill')
console.log(`  ${r.entries.length} skills, source=${r.source}, took ${Date.now() - t}ms`)
console.log(`  sources: ${JSON.stringify(r.sources)}`)
