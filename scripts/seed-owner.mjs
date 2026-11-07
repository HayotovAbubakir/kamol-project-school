import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const localSecretsPath = resolve(import.meta.dirname, '..', '.env.owner-seed')
try {
  const contents = await readFile(localSecretsPath, 'utf8')
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^(CLOUDFLARE_API_URL|OWNER_SEED_SECRET)=(.*)$/)
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2]
  }
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

function required(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`Missing ${name}.`)
  return value
}

const apiUrl = required('CLOUDFLARE_API_URL').replace(/\/+$/, '')
const secret = required('OWNER_SEED_SECRET')
const password = required('OWNER_SEED_PASSWORD')
const username = String(process.env.OWNER_USERNAME || 'owner').trim()
const name = String(process.env.OWNER_NAME || 'Kamol School Owner').trim()

if (!apiUrl.startsWith('https://')) throw new Error('CLOUDFLARE_API_URL must be HTTPS.')
if (password.length < 12) throw new Error('OWNER_SEED_PASSWORD must be at least 12 characters.')

const response = await fetch(`${apiUrl}/api/auth/seed-owner`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Owner-Seed-Secret': secret,
  },
  body: JSON.stringify({ username, name, password }),
})
const result = await response.json()
if (!response.ok) throw new Error(`Owner seed failed (${response.status}): ${result.error || 'unknown error'}`)
if (result.seeded) console.log(`Created initial owner account: ${result.username}`)
else console.log('Initial owner already exists; no account was changed.')
