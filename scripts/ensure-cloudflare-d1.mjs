import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const token = process.env.CLOUDFLARE_API_TOKEN
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
if (!token || !accountId) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required.')

const baseUrl = 'https://api.cloudflare.com/client/v4'
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

async function api(path, init) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...(init?.headers || {}) } })
  const result = await response.json()
  if (!response.ok || !result.success) throw new Error(`Cloudflare API failed (${response.status}): ${result.errors?.[0]?.message || 'request rejected'}`)
  return result.result
}

const existing = await api(`/accounts/${accountId}/d1/database?name=kamol-school-db`, { method: 'GET' })
const database = existing.find((item) => item.name === 'kamol-school-db')
  || await api(`/accounts/${accountId}/d1/database`, {
    method: 'POST',
    body: JSON.stringify({ name: 'kamol-school-db' }),
  })

const buckets = await api(`/accounts/${accountId}/r2/buckets`, { method: 'GET' })
if (!buckets.some((bucket) => bucket.name === 'kamol-files')) {
  await api(`/accounts/${accountId}/r2/buckets`, {
    method: 'POST',
    body: JSON.stringify({ name: 'kamol-files' }),
  })
}

const configPath = resolve(root, 'wrangler.toml')
const config = await readFile(configPath, 'utf8')
if (!config.includes('__CLOUDFLARE_D1_DATABASE_ID__') && !config.includes(database.uuid)) {
  throw new Error('wrangler.toml contains an unexpected D1 database ID.')
}
await writeFile(configPath, config.replace('__CLOUDFLARE_D1_DATABASE_ID__', database.uuid))
console.log(`D1 database ready: ${database.name}`)
console.log('R2 bucket ready: kamol-files')
