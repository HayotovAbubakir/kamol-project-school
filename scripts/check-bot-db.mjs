import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
try {
  const raw = await readFile(resolve(root, '.env'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 1) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')
    if (!(key in process.env)) process.env[key] = value
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

const url = String(process.env.CLOUDFLARE_API_URL || '').replace(/\/+$/, '')
const secret = String(process.env.BOT_API_SECRET || '')
if (!url || !secret) throw new Error('CLOUDFLARE_API_URL va BOT_API_SECRET .env faylida bo‘lishi kerak.')

const health = await fetch(`${url}/api/health`)
if (!health.ok) throw new Error(`Cloudflare Worker health check HTTP ${health.status}.`)
const result = await fetch(`${url}/api/db`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': secret },
  body: JSON.stringify({ table: 'students', action: 'select', filters: [], columns: 'id', limit: 1 }),
})
const body = await result.json()
if (!result.ok || body.error) throw new Error(body.error?.message || `Cloudflare D1 check HTTP ${result.status}.`)
console.log(`Cloudflare D1 API OK (students sample: ${body.data?.length || 0})`)
