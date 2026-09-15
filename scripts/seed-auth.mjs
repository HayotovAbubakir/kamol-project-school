/**
 * Bir martalik: Auth userlar + profiles.
 * Supabase → Project Settings → API → service_role (secret) ni .env ga qo'shing:
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *
 * Keyin: npm run seed:auth
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

function loadEnv() {
  const path = resolve(process.cwd(), '.env')
  const raw = readFileSync(path, 'utf8')
  const env = {}
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return env
}

const env = loadEnv()
const url = env.VITE_SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('Kerak: VITE_SUPABASE_URL va SUPABASE_SERVICE_ROLE_KEY (.env da)')
  console.error('service_role: Supabase → Project Settings → API → service_role')
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const USERS = [
  {
    email: 'owner@kamol.school',
    password: 'owner123',
    username: 'owner',
    name: 'Tizim Egasi',
    role: 'owner',
  },
  {
    email: 'admin@kamol.school',
    password: 'admin123',
    username: 'admin',
    name: 'Administrator',
    role: 'admin',
  },
]

async function ensureUser(u) {
  const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  const existing = listed?.users?.find((x) => x.email === u.email)

  let userId = existing?.id
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: { username: u.username, name: u.name, role: u.role },
    })
    if (error) throw new Error(`${u.email}: ${error.message}`)
    userId = data.user.id
    console.log('Yaratildi:', u.email)
  } else {
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password: u.password,
      email_confirm: true,
      user_metadata: { username: u.username, name: u.name, role: u.role },
    })
    if (error) throw new Error(`${u.email} update: ${error.message}`)
    console.log('Yangilandi:', u.email)
  }

  const { error: profileError } = await admin.from('profiles').upsert({
    id: userId,
    username: u.username,
    name: u.name,
    role: u.role,
  })
  if (profileError) throw new Error(`profile ${u.username}: ${profileError.message}`)
  console.log('Profile OK:', u.username, '→', u.role)
}

for (const u of USERS) {
  await ensureUser(u)
}

console.log('\nTayyor. Login: owner / owner123')
