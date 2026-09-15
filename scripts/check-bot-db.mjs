import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnv(filePath) {
  if (!existsSync(filePath)) return
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnv(resolve(root, '.env.local'))
loadEnv(resolve(root, '.env'))

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing SUPABASE URL or SERVICE_ROLE_KEY')
  process.exit(1)
}

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

for (const table of ['students', 'telegram_links', 'group_students', 'payments', 'attendance']) {
  const { error, count } = await db.from(table).select('*', { count: 'exact', head: true })
  console.log(`${table}: ${error ? `ERR ${error.code || ''} ${error.message}` : `ok (${count})`}`)
}

const { data, error } = await db
  .from('students')
  .select('name, public_code')
  .not('public_code', 'is', null)
  .limit(5)

if (error) {
  console.log('public_code sample ERR:', error.message)
} else {
  console.log(
    'public_code sample:',
    (data || []).map((s) => `${s.name}=${s.public_code}`).join(' | ') || '(none)',
  )
}
