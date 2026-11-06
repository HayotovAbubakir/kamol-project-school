import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const tables = [
  'profiles',
  'teachers',
  'groups',
  'students',
  'group_students',
  'telegram_links',
  'payments',
  'salary_payments',
  'expenses',
  'attendance',
  'staff_codes',
  'homework',
  'homework_submissions',
]
const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

async function loadEnvFile() {
  try {
    const raw = await readFile(resolve(root, '.env'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const separator = trimmed.indexOf('=')
      if (separator < 1) continue
      const name = trimmed.slice(0, separator).trim()
      const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')
      if (!(name in process.env)) process.env[name] = value
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

function required(name, aliases = []) {
  for (const key of [name, ...aliases]) {
    const value = String(process.env[key] || '').trim()
    if (value) return value
  }
  throw new Error(`Missing ${name}. Set it in the environment before migration.`)
}

async function fetchSupabaseRows(url, key, table) {
  const rows = []
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(`${url}/rest/v1/${table}?select=*`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${offset}-${offset + 999}`,
        'Range-Unit': 'items',
      },
    })
    if (!response.ok) throw new Error(`Supabase export failed for ${table} (${response.status}).`)
    const page = await response.json()
    rows.push(...page)
    if (page.length < 1000) break
  }
  return rows
}

async function importBatch(url, secret, table, rows, bootstrapPassword) {
  const response = await fetch(`${url}/api/migrate/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Migration-Secret': secret,
    },
    body: JSON.stringify({
      table,
      rows,
      ...(table === 'profiles' ? { bootstrap_owner_password: bootstrapPassword } : {}),
    }),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(`Cloudflare import failed for ${table} (${response.status}): ${result.error || 'unknown error'}`)
  return result.imported
}

function inferredMimeType(response, filename) {
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  if (allowedTypes.has(contentType)) return contentType
  const extension = filename.split('.').pop()?.toLowerCase()
  return ({
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  })[extension] || ''
}

async function copyStorageFile(sourceUrl, sourceKey, targetUrl, migrationSecret, fileUrl, cache) {
  let url
  try {
    url = new URL(fileUrl)
  } catch {
    return fileUrl
  }
  if (url.origin !== sourceUrl) return fileUrl
  const match = url.pathname.match(/^\/storage\/v1\/object\/(?:public|authenticated|sign)\/([^/]+)\/(.+)$/)
  if (!match) return fileUrl
  const decodedPath = decodeURIComponent(match[2])
  const sourceObjectKey = `${match[1]}/${decodedPath}`
  if (cache.has(sourceObjectKey)) return cache.get(sourceObjectKey)

  const response = await fetch(`${sourceUrl}/storage/v1/object/authenticated/${encodeURIComponent(match[1])}/${match[2]}`, {
    headers: { apikey: sourceKey, Authorization: `Bearer ${sourceKey}` },
  })
  if (!response.ok) throw new Error(`Supabase Storage download failed (${response.status}) for a referenced file.`)
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > 10 * 1024 * 1024) throw new Error('A referenced homework file exceeds the 10 MB migration limit.')
  const bytes = await response.arrayBuffer()
  if (!bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024) throw new Error('A referenced homework file is empty or exceeds 10 MB.')
  const filename = decodedPath.split('/').pop() || 'homework-file'
  const contentType = inferredMimeType(response, filename)
  if (!allowedTypes.has(contentType)) throw new Error('A referenced homework file is not a supported PDF or image.')
  const digest = createHash('sha256').update(sourceObjectKey).digest('hex').slice(0, 20)
  const objectKey = `homework/migrated/${match[1]}/${digest}-${filename.replace(/[^a-zA-Z0-9._-]/g, '-')}`
  const upload = await fetch(`${targetUrl}/api/migrate/file`, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(bytes.byteLength),
      'X-Migration-Secret': migrationSecret,
      'X-Object-Key': objectKey,
    },
    body: bytes,
  })
  const result = await upload.json()
  if (!upload.ok) throw new Error(`Cloudflare R2 file import failed (${upload.status}): ${result.error || 'unknown error'}`)
  cache.set(sourceObjectKey, result.file_url)
  return result.file_url
}

async function verifyCounts(url, secret, sourceCounts) {
  const response = await fetch(`${url}/api/migrate/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Migration-Secret': secret },
    body: JSON.stringify({ tables }),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(`Cloudflare row-count verification failed (${response.status}).`)
  for (const table of tables) {
    const actual = Number(result.counts?.[table] || 0)
    if (actual !== sourceCounts[table]) {
      throw new Error(`Row-count mismatch for ${table}: source=${sourceCounts[table]}, target=${actual}.`)
    }
  }
  return result.counts
}

await loadEnvFile()
const sourceUrl = required('SUPABASE_URL', ['VITE_SUPABASE_URL']).replace(/\/+$/, '')
const sourceKey = required('SUPABASE_SERVICE_ROLE_KEY')
const targetUrl = required('CLOUDFLARE_API_URL').replace(/\/+$/, '')
const migrationSecret = required('MIGRATION_SECRET')
const bootstrapPassword = required('CLOUDFLARE_OWNER_PASSWORD')
if (bootstrapPassword.length < 12) throw new Error('CLOUDFLARE_OWNER_PASSWORD must be at least 12 characters.')
if (!sourceUrl.startsWith('https://') || !targetUrl.startsWith('https://')) {
  throw new Error('Supabase and Cloudflare API URLs must use HTTPS.')
}

const sourceRows = Object.fromEntries(await Promise.all(
  tables.map(async (table) => [table, await fetchSupabaseRows(sourceUrl, sourceKey, table)]),
))
const fileCache = new Map()
for (const table of ['homework', 'homework_submissions']) {
  for (const row of sourceRows[table]) {
    if (row.file_url) {
      row.file_url = await copyStorageFile(
        sourceUrl,
        sourceKey,
        targetUrl,
        migrationSecret,
        row.file_url,
        fileCache,
      )
    }
  }
}

const sourceCounts = Object.fromEntries(tables.map((table) => [table, sourceRows[table].length]))
for (const table of tables) {
  const rows = sourceRows[table]
  for (let offset = 0; offset < rows.length; offset += 50) {
    await importBatch(targetUrl, migrationSecret, table, rows.slice(offset, offset + 50), bootstrapPassword)
  }
  console.log(`${table}: source ${rows.length} rows`)
}

const targetCounts = await verifyCounts(targetUrl, migrationSecret, sourceCounts)
console.log(JSON.stringify({
  result: 'verified',
  source_counts: sourceCounts,
  target_counts: targetCounts,
  storage_files_copied: fileCache.size,
  password_reset_required: sourceRows.profiles.filter((profile) => profile.role !== 'owner').length,
  source_modified: false,
}, null, 2))
