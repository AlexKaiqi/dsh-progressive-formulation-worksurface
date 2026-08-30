import { readFile } from 'node:fs/promises'

const protocol = JSON.parse(await readFile(new URL('../packages/dsh/spec/host-rpc.json', import.meta.url), 'utf8'))
const source = await readFile(new URL('../packages/cli/src/protocol.ts', import.meta.url), 'utf8')
const block = source.match(/WORKSURFACE_RPC_METHODS\s*=\s*\[([\s\S]*?)\]\s*as const/)?.[1] ?? ''
const methods = [...block.matchAll(/'([^']+)'/g)].map(match => match[1])
if (protocol.version !== 8 || JSON.stringify(protocol.methods) !== JSON.stringify(methods) || new Set(methods).size !== methods.length) {
  console.error('WorkSurface Host protocol specification is stale')
  process.exitCode = 1
} else {
  console.log('WorkSurface event protocol specifications are up to date')
}
