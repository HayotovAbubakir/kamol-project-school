import { z } from 'zod'
import { Bot } from 'grammy'
import { registerHandlers } from '../bot/handlers.mjs'
import { attendancePush, paymentPush } from '../bot/messages.mjs'
import { calculateFinanceSummary, validateGroupSchedule } from './domain.js'
import { hashInviteCode, verifyTelegramInitData } from './telegram-auth.js'

const TABLES = new Set([
  'profiles', 'teachers', 'groups', 'students', 'telegram_links', 'group_students',
  'payments', 'salary_payments', 'expenses', 'attendance', 'staff_codes',
  'homework', 'homework_submissions', 'monthly_homework_report',
])
const WRITABLE = new Set([...TABLES].filter((table) => table !== 'monthly_homework_report'))
const STAFF = new Set(['owner', 'admin', 'reception'])
const OWNER_ONLY = new Set(['salary_payments', 'expenses', 'staff_codes'])
const PASSWORD_ITERATIONS = 100000
const COLUMNS = {
  profiles: ['id', 'username', 'name', 'role', 'teacher_id', 'student_id', 'telegram_id', 'created_at'],
  teachers: ['id', 'name', 'phone', 'monthly_salary', 'telegram_id', 'created_at'],
  groups: ['id', 'name', 'teacher_id', 'monthly_fee', 'schedule', 'created_at'],
  students: ['id', 'name', 'phone', 'parent_phone', 'monthly_fee', 'joined_at', 'public_code', 'login', 'auth_user_id', 'telegram_id', 'created_at'],
  telegram_links: ['chat_id', 'student_id', 'linked_at'],
  group_students: ['group_id', 'student_id'],
  payments: ['id', 'student_id', 'student_name', 'amount', 'month', 'year', 'paid_at', 'created_at'],
  salary_payments: ['id', 'teacher_id', 'amount', 'paid_at', 'created_at'],
  expenses: ['id', 'title', 'amount', 'category', 'date', 'recorded_by', 'created_at'],
  attendance: ['id', 'student_id', 'group_id', 'date', 'status', 'note', 'marked_by', 'marked_at'],
  staff_codes: ['id', 'code', 'role', 'user_id', 'created_by', 'is_active', 'created_at'],
  homework: ['id', 'group_id', 'teacher_id', 'title', 'description', 'due_at', 'deadline', 'file_url', 'created_at', 'updated_at'],
  homework_submissions: ['id', 'homework_id', 'student_id', 'file_url', 'text_answer', 'content_text', 'status', 'feedback', 'review_note', 'submitted_at', 'reviewed_by', 'reviewed_at', 'created_at'],
  monthly_homework_report: ['student_id', 'student_name', 'month_start', 'total_submissions', 'approved_count', 'rejected_count', 'pending_count'],
}
const encoder = new TextEncoder()
const botInstances = new WeakMap()
const LoginSchema = z.object({
  username: z.string().trim().min(2).max(128),
  password: z.string().min(8).max(128),
})
const FilterSchema = z.object({
  op: z.enum(['eq', 'neq', 'in', 'gte', 'lte']),
  column: z.string().regex(/^[a-z_][a-z0-9_]*$/i),
  value: z.union([
    z.string().max(4096),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(z.union([z.string().max(4096), z.number().finite(), z.boolean(), z.null()])).max(500),
  ]),
}).strict()
const RowSchema = z.record(z.string().regex(/^[a-z_][a-z0-9_]*$/i).max(64), z.unknown())
  .refine((value) => Object.keys(value).length <= 64)
const DatabaseSchema = z.object({
  table: z.string().refine((value) => TABLES.has(value)),
  action: z.enum(['select', 'insert', 'upsert', 'update', 'delete']).optional(),
  filters: z.array(FilterSchema).max(30).optional(),
  values: z.union([RowSchema, z.array(RowSchema).max(100)]).optional(),
  conflict: z.string().max(128).optional(),
  columns: z.string().max(1024).optional(),
  order: z.object({ column: z.string().regex(/^[a-z_][a-z0-9_]*$/i).max(64), ascending: z.boolean().optional() }).strict().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).max(1000000).optional(),
  returning: z.boolean().optional(),
}).strict()

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

export function canAccessTable(profile, table, action) {
  const role = profile?.role
  if (role === 'owner') return true
  if (OWNER_ONLY.has(table)) return false
  if (table === 'monthly_homework_report') return ['admin', 'reception'].includes(role) && action === 'select'
  if (table === 'payments') {
    if (role === 'student') return action === 'select'
    return ['admin', 'reception'].includes(role) && ['select', 'insert', 'upsert'].includes(action)
  }
  if (table === 'profiles') return action === 'select' && ['admin', 'reception', 'teacher', 'student'].includes(role)
  if (['salary_payments', 'expenses', 'staff_codes'].includes(table)) return false
  if (['teachers', 'groups', 'students', 'group_students'].includes(table)) {
    if (['admin', 'reception'].includes(role)) return ['select', 'insert', 'upsert', 'update', 'delete'].includes(action)
    return role === 'teacher' || role === 'student' ? action === 'select' : false
  }
  if (table === 'telegram_links') return ['admin', 'reception'].includes(role) && ['select', 'insert', 'upsert', 'update', 'delete'].includes(action)
  if (table === 'attendance') {
    if (['admin', 'reception'].includes(role)) return ['select', 'insert', 'upsert', 'update', 'delete'].includes(action)
    if (role === 'teacher') return ['select', 'insert', 'upsert', 'update'].includes(action)
    return role === 'student' && action === 'select'
  }
  if (table === 'homework') {
    if (['admin', 'reception'].includes(role)) return ['select', 'insert', 'upsert', 'update', 'delete'].includes(action)
    if (role === 'teacher') return ['select', 'insert', 'upsert', 'update', 'delete'].includes(action)
    return role === 'student' && action === 'select'
  }
  if (table === 'homework_submissions') {
    if (['admin', 'reception'].includes(role)) return ['select', 'insert', 'upsert', 'update', 'delete'].includes(action)
    if (role === 'teacher') return ['select', 'update'].includes(action)
    if (role === 'student') return ['select', 'insert', 'upsert', 'update'].includes(action)
  }
  return false
}

function restrictedColumns(profile, table) {
  if (profile?.role === 'teacher') {
    if (table === 'teachers') return new Set(['monthly_salary'])
    if (table === 'groups') return new Set(['monthly_fee'])
    if (table === 'students') return new Set(['parent_phone', 'monthly_fee', 'public_code', 'login', 'auth_user_id', 'telegram_id'])
  }
  if (profile?.role === 'student') {
    if (table === 'teachers') return new Set(['monthly_salary'])
    if (table === 'groups') return new Set(['monthly_fee'])
    if (table === 'students') return new Set(['parent_phone', 'public_code', 'login', 'auth_user_id', 'telegram_id'])
  }
  return new Set()
}

function fail(message, status = 400) {
  return json({ error: message }, status)
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function fromHex(value) {
  return Uint8Array.from(value.match(/.{2}/g) || [], (part) => Number.parseInt(part, 16))
}

function base64UrlEncodeBytes(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function base64UrlEncode(value) {
  return base64UrlEncodeBytes(encoder.encode(value))
}

function base64UrlDecodeBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (char) => char.charCodeAt(0))
}

function base64UrlDecode(value) {
  return new TextDecoder().decode(base64UrlDecodeBytes(value))
}

async function hmacKey(secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Authentication secret is not configured securely.')
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

async function issueToken(profile, env, tokenType, lifetimeMs, jti = crypto.randomUUID(), authMethod = 'password') {
  const payload = base64UrlEncode(JSON.stringify({
    sub: profile.id,
    ver: profile.session_version,
    typ: tokenType,
    auth_method: authMethod,
    exp: Date.now() + lifetimeMs,
    jti,
  }))
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(env.AUTH_SECRET), encoder.encode(payload))
  return `${payload}.${base64UrlEncodeBytes(new Uint8Array(signature))}`
}

async function issueSession(profile, env, passwordResetRequired = false, authMethod = 'password') {
  const refreshId = crypto.randomUUID()
  const [accessToken, refreshToken] = await Promise.all([
    issueToken(profile, env, 'access', 15 * 60 * 1000, crypto.randomUUID(), authMethod),
    issueToken(profile, env, 'refresh', 30 * 86400000, refreshId, authMethod),
  ])
  const refreshHash = hex(await crypto.subtle.digest('SHA-256', encoder.encode(refreshToken)))
  await env.DB.prepare('INSERT INTO refresh_tokens (token_hash, account_id, expires_at) VALUES (?, ?, ?)')
    .bind(refreshHash, profile.id, Date.now() + 30 * 86400000).run()
  return {
    user: { ...profile, must_reset_password: passwordResetRequired, auth_method: authMethod },
    session: {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: Math.floor((Date.now() + 15 * 60 * 1000) / 1000),
      user: { ...profile, must_reset_password: passwordResetRequired, auth_method: authMethod },
    },
  }
}
async function authenticate(request, env) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token || !env.AUTH_SECRET) return null
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra) return null
  try {
    const rawSignature = base64UrlDecodeBytes(signature)
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(env.AUTH_SECRET), rawSignature, encoder.encode(payload))
    if (!valid) return null
    const claims = JSON.parse(base64UrlDecode(payload))
    if (claims.typ !== 'access' || !claims.sub || claims.exp < Date.now()) return null
    const profile = await env.DB.prepare(`SELECT p.*, a.password_reset_required, a.session_version
      FROM profiles p JOIN accounts a ON a.id = p.id WHERE p.id = ? AND a.session_version = ?`)
      .bind(claims.sub, claims.ver).first()
    return profile ? { ...profile, auth_method: claims.auth_method || 'password' } : null
  } catch {
    return null
  }
}

async function derivePassword(password, salt, iterations = PASSWORD_ITERATIONS) {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > PASSWORD_ITERATIONS) {
    throw new Error('Invalid stored password hash parameters.')
  }
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: fromHex(salt),
    iterations,
    hash: 'SHA-256',
  }, material, 256)
  return hex(bits)
}

async function hashPassword(password) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)))
  return { salt, hash: await derivePassword(password, salt) }
}

async function consumeLoginAttempt(env, request) {
  const address = request.headers.get('CF-Connecting-IP') || 'unknown'
  const identifier = hex(await crypto.subtle.sign(
    'HMAC',
    await hmacKey(env.AUTH_SECRET),
    encoder.encode(`login:${address}`),
  ))
  const now = Date.now()
  const attempt = await env.DB.prepare('SELECT attempts, window_started_at, blocked_until FROM login_attempts WHERE identifier = ?')
    .bind(identifier).first()
  if (attempt?.blocked_until > now) return false
  const resetWindow = !attempt || now - attempt.window_started_at >= 15 * 60 * 1000
  const attempts = resetWindow ? 1 : attempt.attempts + 1
  const blockedUntil = attempts >= 5 ? now + 15 * 60 * 1000 : 0
  await env.DB.prepare(`INSERT INTO login_attempts (identifier, attempts, window_started_at, blocked_until)
    VALUES (?, ?, ?, ?) ON CONFLICT(identifier) DO UPDATE SET attempts = excluded.attempts,
    window_started_at = excluded.window_started_at, blocked_until = excluded.blocked_until`)
    .bind(identifier, attempts, resetWindow ? now : attempt.window_started_at, blockedUntil).run()
  return attempts < 5
}

async function clearLoginAttempts(env, request) {
  const address = request.headers.get('CF-Connecting-IP') || 'unknown'
  const identifier = hex(await crypto.subtle.sign(
    'HMAC',
    await hmacKey(env.AUTH_SECRET),
    encoder.encode(`login:${address}`),
  ))
  await env.DB.prepare('DELETE FROM login_attempts WHERE identifier = ?').bind(identifier).run()
}

function constantTimeEqual(left, right) {
  let difference = left.length ^ right.length
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return difference === 0
}

async function isValidToken(env, token, type) {
  const [payload, signature, extra] = String(token || '').split('.')
  if (!payload || !signature || extra) return null
  try {
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(env.AUTH_SECRET), base64UrlDecodeBytes(signature), encoder.encode(payload))
    if (!valid) return null
    const claims = JSON.parse(base64UrlDecode(payload))
    if (claims.typ !== type || !claims.sub || !claims.jti || claims.exp < Date.now()) return null
    const profile = await env.DB.prepare(`SELECT p.*, a.password_reset_required, a.session_version
      FROM profiles p JOIN accounts a ON a.id = p.id WHERE p.id = ? AND a.session_version = ?`)
      .bind(claims.sub, claims.ver).first()
    if (profile && type === 'refresh') {
      const tokenHash = hex(await crypto.subtle.digest('SHA-256', encoder.encode(token)))
      const result = await env.DB.prepare(`UPDATE refresh_tokens SET used_at = ?
        WHERE token_hash = ? AND account_id = ? AND used_at IS NULL AND expires_at > ?`)
        .bind(Date.now(), tokenHash, profile.id, Date.now()).run()
      if (!result.meta?.changes) return null
    }
    return profile ? { claims, profile } : null
  } catch {
    return null
  }
}

async function refreshSession(request, env) {
  const body = await request.json()
  const parsed = z.object({ refresh_token: z.string().min(1).max(4096) }).safeParse(body)
  if (!parsed.success) return fail('Refresh token noto‘g‘ri.', 400)
  const valid = await isValidToken(env, parsed.data.refresh_token, 'refresh')
  if (!valid) return fail('Session expired.', 401)
  return json(await issueSession(
    valid.profile,
    env,
    Boolean(valid.profile.password_reset_required),
    valid.claims.auth_method || 'password',
  ))
}

async function signFileUrl(env, origin, key) {
  const expires = Date.now() + 60 * 60 * 1000
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(env.AUTH_SECRET), encoder.encode(`r2:${key}:${expires}`))
  return `${origin}/api/files/${key}?exp=${expires}&sig=${base64UrlEncodeBytes(new Uint8Array(signature))}`
}

async function handleFileDownload(request, env) {
  if (!env.FILES || !env.AUTH_SECRET) return fail('File service is not configured.', 503)
  let key
  try {
    key = decodeURIComponent(new URL(request.url).pathname.slice('/api/files/'.length))
  } catch {
    return fail('Invalid file path.')
  }
  if (!key.startsWith('homework/') || key.includes('..')) return fail('Invalid file path.', 400)
  const params = new URL(request.url).searchParams
  const signature = params.get('sig') || ''
  const expires = Number(params.get('exp'))
  if (!Number.isSafeInteger(expires) || expires < Date.now()) return fail('File link expired.', 403)
  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(env.AUTH_SECRET),
      base64UrlDecodeBytes(signature),
      encoder.encode(`r2:${key}:${expires}`),
    )
    if (!valid) return fail('Invalid file signature.', 403)
  } catch {
    return fail('Invalid file signature.', 403)
  }
  const object = await env.FILES.get(key)
  if (!object) return fail('File not found.', 404)
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function validFileBytes(bytes, mimeType) {
  const header = new Uint8Array(bytes.slice(0, 12))
  if (mimeType === 'application/pdf') return new TextDecoder().decode(header.slice(0, 5)) === '%PDF-'
  if (mimeType === 'image/png') return header.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10'
  if (mimeType === 'image/jpeg') return header[0] === 255 && header[1] === 216 && header[2] === 255
  if (mimeType === 'image/webp') return new TextDecoder().decode(header.slice(0, 4)) === 'RIFF'
    && new TextDecoder().decode(header.slice(8, 12)) === 'WEBP'
  return false
}

async function validateGroupScheduleWrite(env, candidate) {
  let schedule = candidate.schedule
  if (typeof schedule === 'string') {
    try {
      schedule = JSON.parse(schedule)
    } catch {
      throw new Error('Jadval formati noto‘g‘ri.')
    }
  }
  const rows = await env.DB.prepare('SELECT id, teacher_id, schedule FROM groups WHERE id != ?')
    .bind(candidate.id || '').all()
  const error = validateGroupSchedule(schedule, rows.results || [], candidate.id, candidate.teacher_id)
  if (error) throw new Error(error)
}

function createWorkerBotDb(env, origin) {
  class Query {
    constructor(table) {
      this.body = { table, action: 'select', filters: [], columns: '*' }
      this.singleMode = false
    }

    select(columns = '*') {
      this.body.columns = columns
      if (this.body.action !== 'select') this.body.returning = true
      return this
    }

    insert(values) { this.body.action = 'insert'; this.body.values = values; return this }
    upsert(values, options = {}) { this.body.action = 'upsert'; this.body.values = values; this.body.conflict = options.onConflict || ''; return this }
    update(values) { this.body.action = 'update'; this.body.values = values; return this }
    delete() { this.body.action = 'delete'; return this }
    eq(column, value) { return this.addFilter('eq', column, value) }
    neq(column, value) { return this.addFilter('neq', column, value) }
    gte(column, value) { return this.addFilter('gte', column, value) }
    in(column, value) { return this.addFilter('in', column, value) }
    order(column, options = {}) { this.body.order = { column, ascending: options.ascending !== false }; return this }
    limit(count) { this.body.limit = count; return this }
    addFilter(op, column, value) { this.body.filters.push({ op, column, value }); return this }
    single() { this.singleMode = true; return this.execute() }
    maybeSingle() { this.singleMode = true; this.body.maybeSingle = true; return this.execute() }

    async execute() {
      try {
        const data = this.body.action === 'select'
          ? await selectRows(env, null, this.body, true)
          : await mutateRows(env, null, this.body, true)
        if (this.singleMode && Array.isArray(data)) {
          if (!data.length && this.body.maybeSingle) return { data: null, error: null }
          if (data.length !== 1) return { data: null, error: { message: 'Expected one row.' } }
          return { data: data[0], error: null }
        }
        return { data, error: null }
      } catch (error) {
        return { data: null, error: { message: error instanceof Error ? error.message : 'D1 query failed' } }
      }
    }

    then(resolve, reject) { return this.execute().then(resolve, reject) }
  }

  return {
    from(table) { return new Query(table) },
    async getEventsAfter(id) {
      if (id === 'latest') {
        const latest = await env.DB.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM bot_events').first()
        return { id: latest?.id || 0 }
      }
      const after = Math.max(0, Number(id) || 0)
      const rows = await env.DB.prepare('SELECT id, table_name, row_data FROM bot_events WHERE id > ? ORDER BY id LIMIT 100')
        .bind(after).all()
      return (rows.results || []).map((row) => ({ id: row.id, table_name: row.table_name, row: JSON.parse(row.row_data) }))
    },
    async consumeInvite(code, telegramId, staff = false) {
      const response = await fetch(`${origin}/api/bot/invite/consume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': env.BOT_API_SECRET },
        body: JSON.stringify({ code, telegramId, staff }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Ulash kodini ishlatib bo‘lmadi.')
      return result.data
    },
    async getProfileByTelegram(telegramId) {
      const response = await fetch(`${origin}/api/bot/profile?telegram_id=${encodeURIComponent(telegramId)}`, {
        headers: { 'X-Bot-Secret': env.BOT_API_SECRET },
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Profilni aniqlab bo‘lmadi.')
      return result.data
    },
    async getStudentHomework(chatId) {
      const response = await fetch(`${origin}/api/bot/student-homework`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': env.BOT_API_SECRET },
        body: JSON.stringify({ chat_id: Number(chatId) }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Uy vazifalarini yuklab bo‘lmadi.')
      return result.data || []
    },
    async selectHomework(chatId, homeworkId) {
      const response = await fetch(`${origin}/api/bot/select-homework`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': env.BOT_API_SECRET },
        body: JSON.stringify({ chat_id: Number(chatId), homework_id: homeworkId }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Vazifani tanlab bo‘lmadi.')
      return result.data
    },
    async getPendingHomework(chatId) {
      const response = await fetch(`${origin}/api/bot/pending-homework?chat_id=${encodeURIComponent(chatId)}`, {
        headers: { 'X-Bot-Secret': env.BOT_API_SECRET },
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Tanlangan vazifa topilmadi.')
      return result.data
    },
    async submitHomework(values) {
      const response = await fetch(`${origin}/api/bot/submission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': env.BOT_API_SECRET },
        body: JSON.stringify(values),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Topshiriqni yuborib bo‘lmadi.')
      return result.data
    },
    async uploadToR2({ fileStream, fileName, mimeType }) {
      if (!env.FILES) throw new Error('R2 binding is not configured.')
      const bytes = await new Response(fileStream).arrayBuffer()
      if (!bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024 || !validFileBytes(bytes, mimeType)) {
        throw new Error('Invalid Telegram file content.')
      }
      const filename = String(fileName || 'homework-file').replace(/[^a-zA-Z0-9._-]/g, '-')
      const key = `homework/bot/${crypto.randomUUID()}-${filename}`
      await env.FILES.put(key, bytes, { httpMetadata: { contentType: mimeType } })
      return { key, url: await signFileUrl(env, origin, key), bucket: 'kamol-files' }
    },
  }
}

async function getWorkerBot(env, origin) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('Telegram bot is not configured.')
  let bot = botInstances.get(env)
  if (!bot) {
    bot = new Bot(env.TELEGRAM_BOT_TOKEN)
    bot.catch((error) => console.error('Telegram update failed', {
      name: error.error?.name || error.name || 'BotError',
      message: error.error?.message || error.message || '',
    }))
    registerHandlers(
      bot,
      createWorkerBotDb(env, origin),
      env.TELEGRAM_WEBAPP_URL || `${origin}/miniapp.html`,
      env.TELEGRAM_BOT_TOKEN,
    )
    botInstances.set(env, bot)
  }
  // grammY webhook mode requires bot info before handleUpdate; without init()
  // every update throws and Telegram only sees a 500 from this Worker.
  await bot.init()
  return bot
}

async function handleTelegramWebhook(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) return fail('Telegram webhook is not configured.', 503)
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) {
    return fail('Telegram webhook authorization failed.', 401)
  }
  let update
  try {
    update = await request.json()
  } catch {
    return fail('Telegram update payload is invalid.', 400)
  }
  try {
    const bot = await getWorkerBot(env, new URL(request.url).origin)
    await bot.handleUpdate(update)
  } catch (error) {
    console.error('Telegram webhook failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : '',
    })
    return fail('Telegram update failed.', 500)
  }
  return json({ ok: true })
}

async function processBotEvents(env) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('Telegram bot is not configured.')
  const cursor = await env.DB.prepare("SELECT last_event_id FROM bot_event_cursors WHERE name = 'notifications'").first()
  if (!cursor) {
    const latest = await env.DB.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM bot_events').first()
    await env.DB.prepare("INSERT OR IGNORE INTO bot_event_cursors (name, last_event_id) VALUES ('notifications', ?)")
      .bind(latest?.id || 0).run()
    return
  }
  const rows = await env.DB.prepare('SELECT id, table_name, row_data FROM bot_events WHERE id > ? ORDER BY id LIMIT 100')
    .bind(cursor.last_event_id).all()
  if (!rows.results?.length) return
  const bot = await getWorkerBot(env, env.TELEGRAM_WEBAPP_URL ? new URL(env.TELEGRAM_WEBAPP_URL).origin : 'https://localhost')
  for (const event of rows.results) {
    const row = JSON.parse(event.row_data)
    if (row.student_id && ['attendance', 'payments'].includes(event.table_name)) {
      const chats = await env.DB.prepare('SELECT chat_id FROM telegram_links WHERE student_id = ?')
        .bind(row.student_id).all()
      const student = await env.DB.prepare('SELECT name FROM students WHERE id = ?').bind(row.student_id).first()
      let text
      if (event.table_name === 'attendance') {
        const group = await env.DB.prepare('SELECT name FROM groups WHERE id = ?').bind(row.group_id).first()
        text = attendancePush({
          studentName: student?.name || 'O‘quvchi',
          groupName: group?.name || '—',
          status: row.status,
          date: row.date,
          note: row.note,
        })
      } else {
        text = paymentPush({
          studentName: row.student_name || student?.name || 'O‘quvchi',
          amount: row.amount,
          month: row.month,
          year: row.year,
        })
      }
      for (const { chat_id: chatId } of chats.results || []) {
        await bot.api.sendMessage(chatId, text)
      }
    } else if (row.student_id && event.table_name === 'homework_submissions') {
      const homework = await env.DB.prepare('SELECT id, title, teacher_id FROM homework WHERE id = ?')
        .bind(row.homework_id).first()
      const student = await env.DB.prepare('SELECT name FROM students WHERE id = ?').bind(row.student_id).first()
      if (row.status === 'pending') {
        const teachers = await env.DB.prepare('SELECT telegram_id FROM profiles WHERE teacher_id = ? AND telegram_id IS NOT NULL')
          .bind(homework?.teacher_id || '').all()
        for (const { telegram_id: telegramId } of teachers.results || []) {
          await bot.api.sendMessage(telegramId, `Yangi topshiriq yuborildi.\nO‘quvchi: ${student?.name || 'O‘quvchi'}\nVazifa: ${homework?.title || 'Uy vazifasi'}`)
        }
      } else if (['approved', 'rejected'].includes(row.status)) {
        const chats = await env.DB.prepare('SELECT chat_id FROM telegram_links WHERE student_id = ?')
          .bind(row.student_id).all()
        const status = row.status === 'approved' ? 'qabul qilindi' : 'qayta ishlash uchun qaytarildi'
        const comment = row.feedback || row.review_note ? `\nIzoh: ${row.feedback || row.review_note}` : ''
        for (const { chat_id: chatId } of chats.results || []) {
          await bot.api.sendMessage(chatId, `Uy vazifangiz ${status}.\nVazifa: ${homework?.title || 'Uy vazifasi'}${comment}`)
        }
      }
    }
    await env.DB.prepare("UPDATE bot_event_cursors SET last_event_id = ? WHERE name = 'notifications'")
      .bind(event.id).run()
  }
}

function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase().split('@')[0].replace(/[^a-z0-9._-]/g, '')
}

function teacherOwnsGroup(group, teacherId) {
  if (!teacherId) return false
  if (group.teacher_id === teacherId) return true
  try {
    return JSON.parse(group.schedule || '[]').some((slot) => slot.teacherId === teacherId)
  } catch {
    return false
  }
}

async function ownedGroupIds(env, profile) {
  const groups = await env.DB.prepare('SELECT id, teacher_id, schedule FROM groups').all()
  return (groups.results || []).filter((group) => teacherOwnsGroup(group, profile.teacher_id)).map((group) => group.id)
}

async function membershipGroupIds(env, studentId) {
  if (!studentId) return []
  const rows = await env.DB.prepare('SELECT group_id FROM group_students WHERE student_id = ?').bind(studentId).all()
  return (rows.results || []).map((row) => row.group_id)
}

async function canRead(env, profile, table, row) {
  if (STAFF.has(profile.role)) return true
  if (table === 'profiles') return row.id === profile.id
  if (table === 'teachers') return row.id === profile.teacher_id
  if (table === 'payments') return profile.role === 'student' && row.student_id === profile.student_id
  if (table === 'groups') {
    if (profile.role === 'teacher') return teacherOwnsGroup(row, profile.teacher_id)
    return (await membershipGroupIds(env, profile.student_id)).includes(row.id)
  }
  if (table === 'students') {
    if (profile.role === 'student') return row.id === profile.student_id
    const [studentGroups, teacherGroups] = await Promise.all([
      membershipGroupIds(env, row.id),
      ownedGroupIds(env, profile),
    ])
    return studentGroups.some((id) => teacherGroups.includes(id))
  }
  if (table === 'group_students') {
    if (profile.role === 'student') return row.student_id === profile.student_id
    return (await ownedGroupIds(env, profile)).includes(row.group_id)
  }
  if (table === 'attendance') {
    if (profile.role === 'student') return row.student_id === profile.student_id
    if (!(await ownedGroupIds(env, profile)).includes(row.group_id)) return false
    return (await membershipGroupIds(env, row.student_id)).includes(row.group_id)
  }
  if (table === 'homework') {
    if (profile.role === 'student') return (await membershipGroupIds(env, profile.student_id)).includes(row.group_id)
    return row.teacher_id === profile.teacher_id
      || (await ownedGroupIds(env, profile)).includes(row.group_id)
  }
  if (table === 'homework_submissions') {
    if (profile.role === 'student') return row.student_id === profile.student_id
    const homework = await env.DB.prepare('SELECT * FROM homework WHERE id = ?').bind(row.homework_id).first()
    return Boolean(homework && await canRead(env, profile, 'homework', homework))
  }
  return false
}

async function authorizeRow(env, profile, table, row, action) {
  if (!canAccessTable(profile, table, action)) return false
  if (action === 'select') return canRead(env, profile, table, row)
  if (table === 'profiles') {
    if (action === 'update') return profile.id === row.id
    return action === 'delete' && profile.role === 'owner' && row.role === 'admin'
  }
  if (STAFF.has(profile.role)) return true
  if (table === 'attendance' && profile.role === 'teacher') return canRead(env, profile, table, row)
  if (table === 'homework' && profile.role === 'teacher') {
    return row.teacher_id === profile.teacher_id && (await ownedGroupIds(env, profile)).includes(row.group_id)
  }
  if (table === 'homework_submissions' && profile.role === 'teacher') {
    return action === 'update' && canRead(env, profile, table, row)
  }
  if (table === 'homework_submissions' && profile.role === 'student') {
    if (action === 'insert') {
      const homework = await env.DB.prepare('SELECT * FROM homework WHERE id = ?').bind(row.homework_id).first()
      return row.student_id === profile.student_id
        && row.status === 'pending'
        && Boolean(homework && (await membershipGroupIds(env, profile.student_id)).includes(homework.group_id))
    }
    return row.student_id === profile.student_id && ['pending', 'rejected'].includes(row.status)
  }
  return false
}

function parseSelect(columns) {
  const relation = []
  const fields = []
  const regex = /(\w+)\(([^()]*)\)/g
  let match
  let plain = String(columns || '*')
  while ((match = regex.exec(plain))) {
    if (!['groups', 'students', 'profiles', 'teachers'].includes(match[1])) throw new Error('Unsupported related table')
    relation.push({ table: match[1], fields: match[2].split(',').map((field) => field.trim()).filter(Boolean) })
  }
  plain = plain.replace(regex, '')
  for (const field of plain.split(',').map((item) => item.trim()).filter(Boolean)) {
    if (field !== '*' && !/^[a-z_][a-z0-9_]*$/i.test(field)) throw new Error('Invalid select column')
    fields.push(field)
  }
  return { fields: fields.length ? fields : ['*'], relation }
}

async function selectRows(env, profile, body, service) {
  const { table, filters = [], order, limit, columns = '*' } = body
  const { fields, relation } = parseSelect(columns)
  const allowedColumns = new Set(COLUMNS[table] || [])
  const restricted = restrictedColumns(profile, table)
  if (fields.some((field) => field !== '*' && !allowedColumns.has(field))) throw new Error('Invalid select column')
  if (!service && fields.some((field) => restricted.has(field))) throw new Error('Access denied')
  if (filters.some((filter) => !allowedColumns.has(filter.column))) throw new Error('Invalid filter column')
  if (order && !allowedColumns.has(order.column)) throw new Error('Invalid order column')
  for (const link of relation) {
    const relatedColumns = new Set(COLUMNS[link.table] || [])
    const relatedRestricted = restrictedColumns(profile, link.table)
    if (link.fields.some((field) => field !== '*' && !relatedColumns.has(field))) throw new Error('Invalid related select column')
    if (!service && link.fields.some((field) => relatedRestricted.has(field))) throw new Error('Access denied')
  }
  let sql = table === 'monthly_homework_report'
    ? 'SELECT * FROM monthly_homework_report'
    : `SELECT * FROM "${table}"`
  const args = []
  const where = filters.map((filter) => {
    if (!/^[a-z_][a-z0-9_]*$/i.test(filter.column)) throw new Error('Invalid filter column')
    if (filter.op === 'in') {
      if (!Array.isArray(filter.value) || !filter.value.length) return '1 = 0'
      args.push(...filter.value)
      return `"${filter.column}" IN (${filter.value.map(() => '?').join(',')})`
    }
    const operations = { eq: '=', neq: '!=', gte: '>=', lte: '<=' }
    if (!operations[filter.op]) throw new Error('Unsupported filter')
    args.push(filter.value)
    return `"${filter.column}" ${operations[filter.op]} ?`
  })
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`
  if (order) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(order.column)) throw new Error('Invalid order column')
    sql += ` ORDER BY "${order.column}" ${order.ascending ? 'ASC' : 'DESC'}`
  }
  const offset = Math.max(0, Math.min(Number(body.offset) || 0, 1000000))
  const pageSize = Math.max(1, Math.min(Number(limit) || 100, 500))
  const databasePagination = service || STAFF.has(profile?.role)
  if (databasePagination) {
    sql += ' LIMIT ? OFFSET ?'
    args.push(pageSize, offset)
  } else sql += ' LIMIT 10000'
  const result = await env.DB.prepare(sql).bind(...args).all()
  let rows = (result.results || []).map((row) => {
    if (typeof row.schedule === 'string') {
      try { return { ...row, schedule: JSON.parse(row.schedule) } } catch { return row }
    }
    return row
  })
  if (!service) {
    const allowed = []
    for (const row of rows) if (await canRead(env, profile, table, row)) allowed.push(row)
    rows = allowed
  }
  if (!databasePagination) rows = rows.slice(offset, offset + pageSize)
  if (relation.length) {
    const relatedRows = new Map()
    for (const link of relation) {
      const rowId = (row) => link.table === 'groups' ? row.group_id
        : link.table === 'students' ? row.student_id
          : link.table === 'teachers' ? row.teacher_id
            : row.id
      const ids = [...new Set(rows.map(rowId).filter(Boolean))]
      const related = ids.length
        ? await env.DB.prepare(`SELECT * FROM "${link.table}" WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()
        : { results: [] }
      relatedRows.set(link.table, new Map((related.results || []).map((row) => [row.id, row])))
    }
    rows = rows.map((row) => {
      const next = { ...row }
      for (const link of relation) {
        const relationId = link.table === 'groups' ? row.group_id
          : link.table === 'students' ? row.student_id
            : link.table === 'teachers' ? row.teacher_id
              : row.id
        const related = relatedRows.get(link.table)?.get(relationId) || null
        const relatedRestricted = restrictedColumns(profile, link.table)
        const selectedFields = link.fields.includes('*')
          ? Object.keys(related || {}).filter((field) => service || !relatedRestricted.has(field))
          : link.fields
        next[link.table] = related
          ? Object.fromEntries(selectedFields.map((field) => [field, related[field]]))
          : null
      }
      return next
    })
  }
  if (fields[0] !== '*') {
    rows = rows.map((row) => Object.fromEntries(
      fields.filter((field) => field in row)
        .map((field) => [field, row[field]])
        .concat(relation.map(({ table: name }) => [name, row[name]])),
    ))
  }
  if (!service && restricted.size) {
    rows = rows.map((row) => {
      const safe = { ...row }
      for (const column of restricted) delete safe[column]
      return safe
    })
  }
  return rows
}

async function mutateRows(env, profile, body, service) {
  const { table, action, filters = [], values, conflict } = body
  if (!WRITABLE.has(table) || !['insert', 'upsert', 'update', 'delete'].includes(action)) throw new Error('Invalid write operation')
  const allowedColumns = new Set(COLUMNS[table] || [])
  if (conflict && conflict.split(',').some((column) => !allowedColumns.has(column.trim()))) throw new Error('Invalid conflict column')
  const records = Array.isArray(values) ? values : values ? [values] : []
  if (action === 'insert' || action === 'upsert') {
    if (!records.length) throw new Error('No rows supplied')
    const outputs = []
    for (const source of records) {
      const row = { ...source }
      if (Object.keys(row).some((column) => !allowedColumns.has(column))) throw new Error('Invalid columns')
      if (!service && table === 'homework_submissions') {
        if (profile.role === 'student') {
          for (const forbidden of ['reviewed_by', 'reviewed_at', 'feedback', 'review_note', 'created_at']) delete row[forbidden]
          row.status = 'pending'
        } else if (profile.role === 'teacher') {
          for (const forbidden of ['student_id', 'homework_id', 'created_at', 'submitted_at', 'file_url', 'content_text', 'text_answer']) delete row[forbidden]
        }
      }
      const idTables = new Set(['profiles', 'teachers', 'groups', 'students', 'payments', 'salary_payments', 'expenses', 'attendance', 'staff_codes', 'homework', 'homework_submissions'])
      if (idTables.has(table) && !row.id) row.id = crypto.randomUUID()
      if (table === 'students' && !row.public_code) row.public_code = `KS-${crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`
      if (table === 'homework' && row.deadline && !row.due_at) row.due_at = row.deadline
      if (table === 'homework' && row.due_at && !row.deadline) row.deadline = row.due_at
      if (table === 'homework_submissions') {
        row.content_text ??= row.text_answer || ''
        row.text_answer ??= row.content_text || ''
        row.feedback ??= row.review_note || ''
        row.review_note ??= row.feedback || ''
      }
      if (table === 'groups') await validateGroupScheduleWrite(env, row)
      if (!service && !(await authorizeRow(env, profile, table, row, 'insert'))) throw new Error('Access denied')
      const columns = Object.keys(row)
      if (!columns.length || columns.some((column) => !/^[a-z_][a-z0-9_]*$/i.test(column))) throw new Error('Invalid columns')
      const sql = `INSERT ${action === 'upsert' ? 'OR IGNORE' : ''} INTO "${table}" (${columns.map((column) => `"${column}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`
      const result = await env.DB.prepare(sql).bind(...columns.map((column) => typeof row[column] === 'object' && row[column] !== null ? JSON.stringify(row[column]) : row[column])).run()
      if (action === 'upsert' && conflict) {
        const conflictColumns = conflict.split(',').map((column) => column.trim())
        const keyValues = conflictColumns.map((column) => row[column])
        const found = await env.DB.prepare(`SELECT * FROM "${table}" WHERE ${conflictColumns.map((column) => `"${column}" = ?`).join(' AND ')}`).bind(...keyValues).first()
        if (found && result.meta?.changes === 0) {
          const updates = columns.filter((column) => !conflictColumns.includes(column) && column !== 'id')
          if (updates.length) {
            await env.DB.prepare(`UPDATE "${table}" SET ${updates.map((column) => `"${column}" = ?`).join(',')} WHERE ${conflictColumns.map((column) => `"${column}" = ?`).join(' AND ')}`)
              .bind(...updates.map((column) => typeof row[column] === 'object' && row[column] !== null ? JSON.stringify(row[column]) : row[column]), ...keyValues).run()
          }
          Object.assign(found, row)
          outputs.push(found)
          continue
        }
      }
      const primary = table === 'group_students'
        ? ['group_id', 'student_id']
        : table === 'telegram_links' ? ['chat_id'] : ['id']
      const found = await env.DB.prepare(`SELECT * FROM "${table}" WHERE ${primary.map((column) => `"${column}" = ?`).join(' AND ')}`)
        .bind(...primary.map((column) => row[column])).first()
      outputs.push(found || row)
    }
    return body.returning ? outputs : null
  }

  const current = await selectRows(env, profile, { table, filters, limit: 10000 }, service)
  const affected = []
  for (const row of current) {
    if (!service && !(await authorizeRow(env, profile, table, row, action))) throw new Error('Access denied')
    if (action === 'delete') {
      if (table === 'profiles') {
        await env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(row.id).run()
      } else {
        const primary = table === 'group_students'
          ? ['group_id', 'student_id']
          : table === 'telegram_links' ? ['chat_id'] : ['id']
        await env.DB.prepare(`DELETE FROM "${table}" WHERE ${primary.map((column) => `"${column}" = ?`).join(' AND ')}`)
          .bind(...primary.map((column) => row[column])).run()
      }
      affected.push(row)
      continue
    }
    const patch = { ...values }
    if (Object.keys(patch).some((column) => !allowedColumns.has(column))) throw new Error('Invalid columns')
    if (!service && table === 'profiles') {
      for (const forbidden of ['role', 'id', 'teacher_id', 'student_id']) delete patch[forbidden]
    }
    if (!service && table === 'homework_submissions') {
      if (profile.role === 'student') {
        for (const forbidden of ['id', 'homework_id', 'student_id', 'reviewed_by', 'reviewed_at', 'feedback', 'review_note', 'created_at', 'submitted_at']) delete patch[forbidden]
        patch.status = 'pending'
      } else if (profile.role === 'teacher') {
        for (const forbidden of ['id', 'homework_id', 'student_id', 'created_at', 'submitted_at', 'file_url', 'content_text', 'text_answer']) delete patch[forbidden]
        patch.reviewed_by = profile.id
        patch.reviewed_at = new Date().toISOString()
      }
    }
    if (!service && table === 'homework' && profile.role === 'teacher') {
      delete patch.group_id
      delete patch.teacher_id
    }
    if (table === 'homework') {
      if (patch.deadline !== undefined) patch.due_at = patch.deadline
      if (patch.due_at !== undefined) patch.deadline = patch.due_at
    }
    if (table === 'homework_submissions') {
      if (patch.content_text !== undefined) patch.text_answer = patch.content_text
      if (patch.feedback !== undefined) patch.review_note = patch.feedback
    }
    if (table === 'groups') await validateGroupScheduleWrite(env, { ...row, ...patch })
    const columns = Object.keys(patch)
    if (!columns.length) continue
    const primary = table === 'group_students'
      ? ['group_id', 'student_id']
      : table === 'telegram_links' ? ['chat_id'] : ['id']
    await env.DB.prepare(`UPDATE "${table}" SET ${columns.map((column) => `"${column}" = ?`).join(',')} WHERE ${primary.map((column) => `"${column}" = ?`).join(' AND ')}`)
      .bind(...columns.map((column) => typeof patch[column] === 'object' && patch[column] !== null ? JSON.stringify(patch[column]) : patch[column]), ...primary.map((column) => row[column])).run()
    affected.push({ ...row, ...patch })
  }
  return body.returning ? affected : null
}

async function authLogin(request, env) {
  const parsed = LoginSchema.safeParse(await request.json())
  if (!parsed.success) return fail('Login yoki parol noto‘g‘ri.', 401)
  if (!env.AUTH_SECRET) return fail('Authentication is not configured.', 503)
  const login = normalizeLogin(parsed.data.username)
  if (login.length < 2) return fail('Login yoki parol noto‘g‘ri.', 401)
  if (!(await consumeLoginAttempt(env, request))) {
    return fail('Juda ko‘p urinish. 15 daqiqadan so‘ng qayta urinib ko‘ring.', 429)
  }
  const row = await env.DB.prepare(`SELECT p.*, a.password_hash, a.password_salt, a.password_iterations,
      a.password_reset_required, a.session_version
    FROM profiles p JOIN accounts a ON a.id = p.id WHERE p.username = ? COLLATE NOCASE`)
    .bind(login).first()
  const salt = row?.password_salt || '00000000000000000000000000000000'
  const iterations = row?.password_iterations || PASSWORD_ITERATIONS
  const hash = await derivePassword(parsed.data.password, salt, iterations)
  if (!row?.password_hash || !constantTimeEqual(hash, row.password_hash)) {
    return fail('Login yoki parol noto‘g‘ri.', 401)
  }
  await clearLoginAttempts(env, request)
  const profile = { ...row }
  delete profile.password_hash
  delete profile.password_salt
  delete profile.password_iterations
  return json(await issueSession(profile, env, Boolean(row.password_reset_required)))
}

async function authCreate(request, env, actor) {
  if (!STAFF.has(actor.role)) return fail('Ruxsat yo‘q.', 403)
  const body = await request.json()
  const metadata = body.options?.data || {}
  const parsed = z.object({
    username: z.string().trim().min(2).max(128),
    password: z.string().min(8).max(128),
    role: z.enum(['student', 'teacher', 'reception', 'admin']),
    name: z.string().trim().min(1).max(160),
    teacher_id: z.string().nullable().optional(),
    student_id: z.string().nullable().optional(),
  }).safeParse({
    username: metadata.username || body.username || body.email,
    password: body.password,
    role: metadata.role || body.role || 'student',
    name: metadata.name || body.name || metadata.username || body.username || body.email,
    teacher_id: metadata.teacher_id ?? body.teacher_id,
    student_id: metadata.student_id ?? body.student_id,
  })
  if (!parsed.success) return fail('Login, ism yoki parol noto‘g‘ri.', 400)
  const { password } = parsed.data
  const username = normalizeLogin(parsed.data.username)
  const role = parsed.data.role
  const name = parsed.data.name
  if (role === 'owner' || (role === 'admin' && actor.role !== 'owner')) return fail('Bu rolni yaratish uchun Owner ruxsati kerak.', 403)
  const exists = await env.DB.prepare('SELECT id FROM profiles WHERE username = ? COLLATE NOCASE').bind(username).first()
  if (exists) return fail('Bu login allaqachon band.', 409)

  const id = crypto.randomUUID()
  const { hash, salt } = await hashPassword(password)
  const teacherId = parsed.data.teacher_id || null
  const studentId = parsed.data.student_id || null
  await env.DB.batch([
    env.DB.prepare('INSERT INTO accounts (id, password_hash, password_salt, password_iterations, password_reset_required) VALUES (?, ?, ?, ?, 1)')
      .bind(id, hash, salt, PASSWORD_ITERATIONS),
    env.DB.prepare('INSERT INTO profiles (id, username, name, role, teacher_id, student_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, username, name, role, teacherId, studentId),
    ...(studentId ? [env.DB.prepare('UPDATE students SET login = ?, auth_user_id = ? WHERE id = ?').bind(username, id, studentId)] : []),
  ])
  return json({ user: { id, username, name, role, teacher_id: teacherId, student_id: studentId }, session: {} }, 201)
}

async function telegramLogin(request, env) {
  const parsed = z.object({ initData: z.string().min(1).max(16_384) }).strict().safeParse(await request.json())
  if (!parsed.success || !env.TELEGRAM_BOT_TOKEN || !env.AUTH_SECRET) {
    return fail('Telegram orqali kirish sozlanmagan yoki so‘rov noto‘g‘ri.', 400)
  }
  const verified = await verifyTelegramInitData(parsed.data.initData, env.TELEGRAM_BOT_TOKEN)
  if (!verified) return fail('Telegram sessiyasi yaroqsiz yoki eskirgan. Ilovani Telegram ichidan qayta oching.', 401)

  const telegramId = Number(verified.user.id)
  const matches = await env.DB.prepare(`SELECT DISTINCT p.*, a.password_reset_required, a.session_version
    FROM profiles p
    JOIN accounts a ON a.id = p.id
    LEFT JOIN students s ON s.id = p.student_id
    LEFT JOIN teachers t ON t.id = p.teacher_id
    WHERE p.telegram_id = ? OR (p.role = 'student' AND s.telegram_id = ?)
      OR (p.role = 'teacher' AND t.telegram_id = ?)
    LIMIT 2`).bind(telegramId, telegramId, telegramId).all()
  if (matches.results?.length !== 1) {
    return json({
      error: 'Ushbu Telegram akkaunti tizimga ulanmagan. Qabulxonadan bir martalik ulash havolasini oling.',
      code: 'TELEGRAM_NOT_LINKED',
    }, 403)
  }

  const profile = matches.results[0]
  try {
    const statements = [
      env.DB.prepare('UPDATE profiles SET telegram_id = ? WHERE id = ?').bind(telegramId, profile.id),
    ]
    if (profile.role === 'student' && profile.student_id) {
      statements.push(env.DB.prepare(`INSERT INTO telegram_links (chat_id, student_id, linked_at)
        VALUES (?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET student_id = excluded.student_id, linked_at = excluded.linked_at`)
        .bind(telegramId, profile.student_id, new Date().toISOString()))
    }
    await env.DB.batch(statements)
  } catch {
    return fail('Bu Telegram akkaunti boshqa foydalanuvchiga ulangan. Qabulxonaga murojaat qiling.', 409)
  }
  return json(await issueSession(
    profile,
    env,
    Boolean(profile.password_reset_required),
    'telegram',
  ))
}

async function createTelegramInvite(request, env, actor) {
  if (!STAFF.has(actor.role)) return fail('Ruxsat yo‘q.', 403)
  const parsed = z.object({ profileId: z.string().uuid() }).strict().safeParse(await request.json())
  if (!parsed.success) return fail('Foydalanuvchi tanlanmagan.', 400)
  const target = await env.DB.prepare('SELECT id, username, name, role, telegram_id FROM profiles WHERE id = ?')
    .bind(parsed.data.profileId).first()
  if (!target) return fail('Foydalanuvchi topilmadi.', 404)
  if (actor.role !== 'owner' && !['teacher', 'student'].includes(target.role)) {
    return fail('Bu rol uchun ulash havolasini faqat Owner yaratishi mumkin.', 403)
  }
  if (target.telegram_id) return fail('Foydalanuvchining Telegram akkaunti allaqachon ulangan.', 409)
  if (!env.TELEGRAM_BOT_TOKEN) return fail('Telegram bot sozlanmagan.', 503)
  let botUsername = env.TELEGRAM_BOT_USERNAME
  if (!botUsername) {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`)
    const telegram = await response.json()
    botUsername = telegram.ok && telegram.result?.username
  }
  if (!botUsername) return fail('Bot nomini aniqlab bo‘lmadi. Keyinroq qayta urinib ko‘ring.', 502)

  const code = [...crypto.getRandomValues(new Uint8Array(24))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('')
  const codeHash = await hashInviteCode(code)
  const expiresAt = Date.now() + 15 * 60 * 1000
  await env.DB.batch([
    env.DB.prepare('UPDATE telegram_invites SET used_at = ? WHERE profile_id = ? AND used_at IS NULL')
      .bind(Date.now(), target.id),
    env.DB.prepare('INSERT INTO telegram_invites (code_hash, profile_id, created_by, expires_at) VALUES (?, ?, ?, ?)')
      .bind(codeHash, target.id, actor.id, expiresAt),
  ])
  const staff = ['admin', 'reception', 'owner'].includes(target.role)
  const startPayload = staff ? `login_${code}` : code
  return json({
    username: target.username,
    role: target.role,
    expires_at: expiresAt,
    invite_url: `https://t.me/${botUsername}?start=${startPayload}`,
    command: staff ? `/login ${code}` : `https://t.me/${botUsername}?start=${code}`,
  }, 201)
}

async function consumeTelegramInvite(request, env) {
  const parsed = z.object({
    code: z.string().regex(/^[a-f0-9]{48}$/i),
    telegramId: z.number().int().positive(),
    staff: z.boolean().default(false),
  }).strict().safeParse(await request.json())
  if (!parsed.success) return fail('Ulash kodi noto‘g‘ri.', 400)
  const codeHash = await hashInviteCode(parsed.data.code)
  const invite = await env.DB.prepare(`SELECT i.profile_id, i.expires_at, p.name, p.role, p.student_id
    FROM telegram_invites i JOIN profiles p ON p.id = i.profile_id
    WHERE i.code_hash = ? AND i.used_at IS NULL AND i.expires_at > ?`)
    .bind(codeHash, Date.now()).first()
  if (!invite) return fail('Ulash kodi yaroqsiz yoki muddati tugagan. Qabulxonadan yangisini oling.', 400)
  if (parsed.data.staff !== ['admin', 'reception', 'owner'].includes(invite.role)) {
    return fail('Bu kodni boshqa Telegram buyrug‘i orqali ishlating.', 400)
  }
  try {
    const consumed = await env.DB.prepare(`UPDATE telegram_invites SET used_at = ?
      WHERE code_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING profile_id`)
      .bind(Date.now(), codeHash, Date.now()).first()
    if (!consumed) return fail('Ulash kodi allaqachon ishlatilgan yoki muddati tugagan.', 409)
    await env.DB.prepare('UPDATE profiles SET telegram_id = ? WHERE id = ?')
      .bind(parsed.data.telegramId, invite.profile_id).run()
    if (invite.role === 'student' && invite.student_id) {
      await env.DB.prepare(`INSERT INTO telegram_links (chat_id, student_id, linked_at)
        VALUES (?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET student_id = excluded.student_id, linked_at = excluded.linked_at`)
        .bind(parsed.data.telegramId, invite.student_id, new Date().toISOString()).run()
    }
  } catch {
    return fail('Telegram akkauntni ulab bo‘lmadi. Qabulxonaga murojaat qiling.', 409)
  }
  return json({ data: { name: invite.name, role: invite.role } })
}

async function botStudentHomework(request, env) {
  const parsed = z.object({ chat_id: z.number().int().positive() }).strict().safeParse(await request.json())
  if (!parsed.success) return fail('Noto‘g‘ri so‘rov.', 400)
  const link = await env.DB.prepare('SELECT student_id FROM telegram_links WHERE chat_id = ?')
    .bind(parsed.data.chat_id).first()
  if (!link) return fail('Telegram akkaunt ulanmagan.', 404)
  const rows = await env.DB.prepare(`SELECT h.id, h.title, h.due_at, hs.status
    FROM homework h JOIN group_students gs ON gs.group_id = h.group_id
    LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = gs.student_id
    WHERE gs.student_id = ? AND (hs.status IS NULL OR hs.status = 'rejected')
    ORDER BY h.due_at LIMIT 50`).bind(link.student_id).all()
  return json({ data: rows.results || [] })
}

async function setBotPendingHomework(request, env) {
  const parsed = z.object({
    chat_id: z.number().int().positive(),
    homework_id: z.string().uuid(),
  }).strict().safeParse(await request.json())
  if (!parsed.success) return fail('Vazifa tanlanmadi.', 400)
  const allowed = await env.DB.prepare(`SELECT h.id FROM telegram_links l
    JOIN group_students gs ON gs.student_id = l.student_id
    JOIN homework h ON h.group_id = gs.group_id
    WHERE l.chat_id = ? AND h.id = ?`)
    .bind(parsed.data.chat_id, parsed.data.homework_id).first()
  if (!allowed) return fail('Vazifa topilmadi yoki sizga tegishli emas.', 403)
  await env.DB.prepare(`INSERT INTO bot_pending_homework (chat_id, homework_id, expires_at)
    VALUES (?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET homework_id = excluded.homework_id, expires_at = excluded.expires_at`)
    .bind(parsed.data.chat_id, parsed.data.homework_id, Date.now() + 30 * 60 * 1000).run()
  return json({ data: true })
}

async function handleRpc(request, env, actor, name) {
  const args = await request.json()
  if (name === 'lookup_login_email') {
    if (!STAFF.has(actor.role)) return json({ data: null, error: { message: 'forbidden' } }, 403)
    const username = normalizeLogin(args.p_login)
    const profile = await env.DB.prepare('SELECT username FROM profiles WHERE username = ? COLLATE NOCASE').bind(username).first()
    return json({ data: profile ? `${profile.username}@kamol.school` : null, error: null })
  }
  if (name === 'staff_set_user_password') {
    if (!STAFF.has(actor.role)) return json({ data: null, error: { message: 'forbidden' } }, 403)
    const parsed = z.object({
      new_password: z.string().min(8).max(128),
      target_user: z.string().uuid(),
    }).safeParse(args)
    if (!parsed.success) return json({ data: null, error: { message: 'invalid password or user id' } }, 400)
    const target = await env.DB.prepare('SELECT role FROM profiles WHERE id = ?').bind(parsed.data.target_user).first()
    if (!target || target.role === 'owner' || (target.role === 'admin' && actor.role !== 'owner')) {
      return json({ data: null, error: { message: 'forbidden or user not found' } }, 403)
    }
    const password = parsed.data.new_password
    const { hash, salt } = await hashPassword(password)
    await env.DB.prepare(`UPDATE accounts SET password_hash = ?, password_salt = ?,
      password_iterations = ?, password_reset_required = 1, session_version = session_version + 1
      WHERE id = ?`).bind(hash, salt, PASSWORD_ITERATIONS, parsed.data.target_user).run()
    return json({ data: null, error: null })
  }
  return json({ data: null, error: { message: 'RPC not found' } }, 404)
}

async function handleDatabase(request, env, profile, service) {
  const parsed = DatabaseSchema.safeParse(await request.json())
  if (!parsed.success) return fail('Invalid database request.')
  const body = parsed.data
  if (!TABLES.has(body.table)) return fail('Unknown table.')
  if (profile?.password_reset_required && profile.auth_method !== 'telegram') {
    return fail('Davom etish uchun parolni yangilang.', 403)
  }
  if (body.table === 'staff_codes' && !service && !STAFF.has(profile?.role)) return fail('Access denied.', 403)
  if (body.table === 'telegram_links' && !service && !STAFF.has(profile?.role)) return fail('Access denied.', 403)
  if (!service && !profile) return fail('Login required.', 401)
  const action = body.action || 'select'
  if (!service && !canAccessTable(profile, body.table, action)) return fail('Access denied.', 403)
  try {
    if (!body.action || body.action === 'select') {
      const data = await selectRows(env, profile, body, service)
      return json({ data, error: null })
    }
    const data = await mutateRows(env, profile, body, service)
    return json({ data, error: null })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = /access denied/i.test(message) ? 403 : 400
    return json({ data: null, error: { message } }, status)
  }
}

async function handleBot(request, env, pathname) {
  if (!env.BOT_API_SECRET || request.headers.get('X-Bot-Secret') !== env.BOT_API_SECRET) return fail('Bot authorization failed.', 401)
  if (pathname === '/api/bot/student-code') {
    const { code } = await request.json()
    const student = await env.DB.prepare('SELECT id, name, phone, parent_phone, public_code, monthly_fee FROM students WHERE public_code = ? COLLATE NOCASE').bind(String(code || '').trim()).first()
    return json({ data: student || null })
  }
  if (pathname === '/api/bot/telegram-link') {
    const { chat_id } = await request.json()
    const link = await env.DB.prepare('SELECT * FROM telegram_links WHERE chat_id = ?').bind(Number(chat_id)).first()
    const student = link && await env.DB.prepare('SELECT id, name, phone, parent_phone, public_code, monthly_fee FROM students WHERE id = ?').bind(link.student_id).first()
    return json({ data: link ? { ...link, students: student } : null })
  }
  if (pathname === '/api/bot/profile') {
    const telegramId = Number(new URL(request.url).searchParams.get('telegram_id'))
    const profile = await env.DB.prepare('SELECT name, role FROM profiles WHERE telegram_id = ?')
      .bind(telegramId).first()
    return json({ data: profile || null })
  }
  if (pathname === '/api/bot/link') {
    const { chat_id, student_id } = await request.json()
    await env.DB.prepare('INSERT INTO telegram_links (chat_id, student_id, linked_at) VALUES (?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET student_id = excluded.student_id, linked_at = excluded.linked_at')
      .bind(Number(chat_id), student_id, new Date().toISOString()).run()
    return json({ data: true })
  }
  if (pathname === '/api/bot/unlink') {
    const { chat_id } = await request.json()
    await env.DB.prepare('DELETE FROM telegram_links WHERE chat_id = ?').bind(Number(chat_id)).run()
    return json({ data: true })
  }
  if (pathname === '/api/bot/student-data') {
    const { student_id, days = 14, payments_limit = 50 } = await request.json()
    const groups = await env.DB.prepare('SELECT g.id, g.name, g.monthly_fee FROM groups g JOIN group_students gs ON gs.group_id = g.id WHERE gs.student_id = ?').bind(student_id).all()
    const payments = await env.DB.prepare('SELECT amount, month, year, paid_at FROM payments WHERE student_id = ? ORDER BY paid_at DESC LIMIT ?').bind(student_id, payments_limit).all()
    const since = new Date(Date.now() - Number(days) * 86400000).toISOString().slice(0, 10)
    const attendance = await env.DB.prepare('SELECT a.date, a.status, a.note, a.group_id, g.name AS group_name FROM attendance a LEFT JOIN groups g ON g.id = a.group_id WHERE a.student_id = ? AND a.date >= ? ORDER BY a.date DESC').bind(student_id, since).all()
    return json({ groups: groups.results || [], payments: payments.results || [], attendance: (attendance.results || []).map(({ group_name, ...row }) => ({ ...row, groups: group_name ? { name: group_name } : null })) })
  }
  if (pathname === '/api/bot/homework') {
    const { student_id } = await request.json()
    const rows = await env.DB.prepare('SELECT h.* FROM homework h JOIN group_students gs ON gs.group_id = h.group_id WHERE gs.student_id = ? ORDER BY h.due_at').bind(student_id).all()
    return json({ data: rows.results || [] })
  }
  if (pathname === '/api/bot/student-homework') return botStudentHomework(request, env)
  if (pathname === '/api/bot/pending-homework') {
    const chatId = Number(new URL(request.url).searchParams.get('chat_id'))
    const row = await env.DB.prepare(`SELECT p.homework_id, h.title FROM bot_pending_homework p
      JOIN homework h ON h.id = p.homework_id WHERE p.chat_id = ? AND p.expires_at > ?`)
      .bind(chatId, Date.now()).first()
    return json({ data: row || null })
  }
  if (pathname === '/api/bot/select-homework') return setBotPendingHomework(request, env)
  if (pathname === '/api/bot/invite/consume') return consumeTelegramInvite(request, env)
  if (pathname === '/api/bot/submission') {
    const body = await request.json()
    const { text_answer = '', content_text = '', feedback = '', review_note = '', chat_id, ...data } = body
    const pending = chat_id && await env.DB.prepare(`SELECT p.homework_id, l.student_id
      FROM bot_pending_homework p JOIN telegram_links l ON l.chat_id = p.chat_id
      WHERE p.chat_id = ? AND p.expires_at > ?`).bind(Number(chat_id), Date.now()).first()
    if (!pending || pending.homework_id !== data.homework_id || pending.student_id !== data.student_id) {
      return fail('Tanlangan vazifa topilmadi yoki muddati tugagan.', 403)
    }
    const id = data.id || crypto.randomUUID()
    await env.DB.prepare(`INSERT INTO homework_submissions (id, homework_id, student_id, file_url, text_answer, content_text, status, feedback, review_note, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      ON CONFLICT(homework_id, student_id) DO UPDATE SET file_url=excluded.file_url, text_answer=excluded.text_answer, content_text=excluded.content_text, status='pending', feedback='', review_note='', submitted_at=excluded.submitted_at`)
      .bind(id, data.homework_id, data.student_id, data.file_url || null, text_answer || content_text, content_text || text_answer, feedback, review_note, data.submitted_at || new Date().toISOString()).run()
    await env.DB.prepare('DELETE FROM bot_pending_homework WHERE chat_id = ?').bind(Number(chat_id)).run()
    return json({ data: true })
  }
  if (pathname === '/api/bot/staff-code') {
    const { code } = await request.json()
    const row = await env.DB.prepare('SELECT id, code, role, user_id, is_active FROM staff_codes WHERE code = ? COLLATE NOCASE AND is_active = 1').bind(code).first()
    return json({ data: row || null })
  }
  if (pathname === '/api/bot/link-profile-telegram') {
    const { user_id, telegram_id } = await request.json()
    await env.DB.prepare('UPDATE profiles SET telegram_id = ? WHERE id = ?').bind(telegram_id, user_id).run()
    return json({ data: true })
  }
  if (pathname === '/api/bot/chats') {
    const { student_id } = await request.json()
    const result = student_id
      ? await env.DB.prepare('SELECT chat_id FROM telegram_links WHERE student_id = ?').bind(student_id).all()
      : await env.DB.prepare('SELECT chat_id FROM telegram_links').all()
    return json({ data: result.results || [] })
  }
  if (pathname === '/api/bot/student-name') {
    const { student_id } = await request.json()
    const row = await env.DB.prepare('SELECT name FROM students WHERE id = ?').bind(student_id).first()
    return json({ data: row || null })
  }
  if (pathname === '/api/bot/group-name') {
    const { group_id } = await request.json()
    const row = await env.DB.prepare('SELECT name FROM groups WHERE id = ?').bind(group_id).first()
    return json({ data: row || null })
  }
  if (pathname === '/api/bot/events') {
    if (new URL(request.url).searchParams.get('latest') === '1') {
      const latest = await env.DB.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM bot_events').first()
      return json({ id: latest?.id || 0 })
    }
    const after = Math.max(0, Number(new URL(request.url).searchParams.get('after')) || 0)
    const rows = await env.DB.prepare('SELECT id, table_name, row_data FROM bot_events WHERE id > ? ORDER BY id LIMIT 100')
      .bind(after).all()
    return json((rows.results || []).map((row) => ({ id: row.id, table_name: row.table_name, row: JSON.parse(row.row_data) })))
  }
  if (pathname === '/api/bot/upload' && request.method === 'POST') {
    if (!env.FILES) return fail('R2 binding is not configured.', 503)
    const form = await request.formData()
    const file = form.get('file')
    const filename = String(form.get('filename') || file?.name || 'homework-file').replace(/[^a-zA-Z0-9._-]/g, '-')
    if (!(file instanceof File) || file.size <= 0 || file.size > 10 * 1024 * 1024) return fail('File must be smaller than 10 MB.')
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return fail('Unsupported file type.', 415)
    const bytes = await file.arrayBuffer()
    if (!validFileBytes(bytes, file.type)) return fail('File content does not match its type.', 415)
    const key = `homework/${crypto.randomUUID()}-${filename}`
    await env.FILES.put(key, bytes, { httpMetadata: { contentType: file.type } })
    return json({ key, url: await signFileUrl(env, new URL(request.url).origin, key) })
  }
  return fail('Bot route not found.', 404)
}

async function handleOwnerSeed(request, env) {
  const configuredSecret = env.OWNER_SEED_SECRET
  const suppliedSecret = request.headers.get('X-Owner-Seed-Secret') || ''
  if (!configuredSecret || !constantTimeEqual(suppliedSecret, configuredSecret)) {
    return fail('Owner seed authorization failed.', 401)
  }
  const existing = await env.DB.prepare("SELECT id FROM profiles WHERE role = 'owner' LIMIT 1").first()
  if (existing) return json({ seeded: false, reason: 'Owner already exists.' })
  const parsed = z.object({
    username: z.string().trim().min(2).max(64),
    name: z.string().trim().min(1).max(160),
    password: z.string().min(12).max(128),
  }).safeParse(await request.json())
  if (!parsed.success) return fail('Invalid owner seed input.', 400)
  const username = normalizeLogin(parsed.data.username)
  if (username.length < 2) return fail('Invalid owner username.', 400)
  const exists = await env.DB.prepare('SELECT id FROM profiles WHERE username = ? COLLATE NOCASE').bind(username).first()
  if (exists) return fail('Owner username is already in use.', 409)
  const id = crypto.randomUUID()
  const { hash, salt } = await hashPassword(parsed.data.password)
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO accounts (id, password_hash, password_salt, password_iterations, password_reset_required)
      VALUES (?, ?, ?, ?, 0)`).bind(id, hash, salt, PASSWORD_ITERATIONS),
    env.DB.prepare(`INSERT INTO profiles (id, username, name, role)
      VALUES (?, ?, ?, 'owner')`).bind(id, username, parsed.data.name),
  ])
  return json({ seeded: true, username }, 201)
}

async function handleFinanceSummary(request, env, profile) {
  if (profile?.role !== 'owner') return fail('Access denied.', 403)
  const url = new URL(request.url)
  const from = url.searchParams.get('from') || ''
  const to = url.searchParams.get('to') || ''
  const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
  if (!isDate(from) || !isDate(to) || from > to) return fail('Invalid date range.', 400)
  const [payments, salaries, expenses] = await Promise.all([
    env.DB.prepare('SELECT amount FROM payments WHERE substr(paid_at, 1, 10) BETWEEN ? AND ?').bind(from, to).all(),
    env.DB.prepare('SELECT amount FROM salary_payments WHERE substr(paid_at, 1, 10) BETWEEN ? AND ?').bind(from, to).all(),
    env.DB.prepare('SELECT amount FROM expenses WHERE date BETWEEN ? AND ?').bind(from, to).all(),
  ])
  return json(calculateFinanceSummary({
    payments: payments.results || [],
    salaries: salaries.results || [],
    expenses: expenses.results || [],
  }))
}

async function handleRequest(request, env) {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)
  if (url.pathname === '/api/health') return json({ ok: true, service: 'kamol-cloudflare-api' })
  if (url.pathname === '/api/telegram/webhook' && request.method === 'POST') return handleTelegramWebhook(request, env)
  if (url.pathname === '/api/auth/seed-owner' && request.method === 'POST') return handleOwnerSeed(request, env)
  if (url.pathname.startsWith('/api/bot/')) return handleBot(request, env, url.pathname)
  if (url.pathname.startsWith('/api/files/') && request.method === 'GET') return handleFileDownload(request, env)
  if (url.pathname === '/api/auth/telegram' && request.method === 'POST') return telegramLogin(request, env)
  if (url.pathname === '/api/auth/login' && request.method === 'POST') return authLogin(request, env)
  if (url.pathname === '/api/auth/refresh' && request.method === 'POST') return refreshSession(request, env)

  const service = Boolean(env.BOT_API_SECRET && request.headers.get('X-Bot-Secret') === env.BOT_API_SECRET)
  const profile = await authenticate(request, env)
  if (url.pathname === '/api/auth/me') {
    return profile
      ? json({ user: { ...profile, must_reset_password: Boolean(profile.password_reset_required) } })
      : fail('Session expired.', 401)
  }
  if (url.pathname === '/api/telegram/invites' && request.method === 'POST') {
    if (!profile) return fail('Login required.', 401)
    return createTelegramInvite(request, env, profile)
  }
  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    if (!profile) return fail('Login required.', 401)
    await env.DB.prepare('UPDATE accounts SET session_version = session_version + 1 WHERE id = ?').bind(profile.id).run()
    return json({ ok: true })
  }
  if (url.pathname === '/api/auth/signup' && request.method === 'POST') {
    if (!profile) return fail('Login required.', 401)
    return authCreate(request, env, profile)
  }
  if (url.pathname === '/api/auth/update' && request.method === 'POST') {
    if (!profile) return fail('Login required.', 401)
    const parsed = z.object({ password: z.string().min(8).max(128) }).safeParse(await request.json())
    if (!parsed.success) return fail('Password must be at least 8 characters.')
    const { hash, salt } = await hashPassword(parsed.data.password)
    await env.DB.prepare(`UPDATE accounts SET password_hash = ?, password_salt = ?,
      password_iterations = ?, password_reset_required = 0, session_version = session_version + 1
      WHERE id = ?`).bind(hash, salt, PASSWORD_ITERATIONS, profile.id).run()
    const updated = await env.DB.prepare(`SELECT p.*, a.password_reset_required, a.session_version
      FROM profiles p JOIN accounts a ON a.id = p.id WHERE p.id = ?`).bind(profile.id).first()
    return json(await issueSession(updated, env, false))
  }
  if (profile?.password_reset_required && profile.auth_method !== 'telegram'
    && !['/api/auth/me', '/api/auth/logout', '/api/auth/update'].includes(url.pathname)) {
    return fail('Davom etish uchun parolni yangilang.', 403)
  }
  if (url.pathname === '/api/finance/summary' && request.method === 'GET') {
    return handleFinanceSummary(request, env, profile)
  }
  if (url.pathname.startsWith('/api/rpc/')) {
    if (!profile) return fail('Login required.', 401)
    return handleRpc(request, env, profile, url.pathname.split('/').pop())
  }
  if (url.pathname === '/api/db') return handleDatabase(request, env, profile, service)
  if (url.pathname === '/api/files' && request.method === 'POST') {
    if (!profile) return fail('Login required.', 401)
    if (!env.FILES) return fail('R2 binding is not configured.', 503)
    const form = await request.formData()
    const file = form.get('file')
    const homeworkId = String(form.get('homework_id') || '')
    const groupId = String(form.get('group_id') || '')
    if (!(file instanceof File) || file.size <= 0 || file.size > 10 * 1024 * 1024) return fail('File must be smaller than 10 MB.')
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return fail('Unsupported file type.', 415)
    const bytes = await file.arrayBuffer()
    if (!validFileBytes(bytes, file.type)) return fail('File content does not match its type.', 415)
    if (homeworkId) {
      const homework = await env.DB.prepare('SELECT * FROM homework WHERE id = ?').bind(homeworkId).first()
      if (!homework || !(await canRead(env, profile, 'homework', homework))) return fail('Homework access denied.', 403)
    } else if (profile.role === 'teacher') {
      if (!groupId || !(await ownedGroupIds(env, profile)).includes(groupId)) return fail('Group access denied.', 403)
    } else if (!STAFF.has(profile.role)) {
      return fail('Homework context is required.', 400)
    }
    const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
    const key = `homework/${profile.id}/${crypto.randomUUID()}-${filename}`
    await env.FILES.put(key, bytes, { httpMetadata: { contentType: file.type } })
    return json({ file_url: await signFileUrl(env, url.origin, key) })
  }
  return fail('Not found.', 404)
}

function secureResponse(response, origin) {
  const headers = new Headers(response.headers)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-Frame-Options', 'SAMEORIGIN')
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'")
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Vary', 'Origin')
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export default {
  async fetch(request, env) {
    const requestOrigin = request.headers.get('Origin')
    const configuredOrigin = env.ALLOWED_ORIGIN ? new URL(env.ALLOWED_ORIGIN).origin : new URL(request.url).origin
    if (requestOrigin && requestOrigin !== configuredOrigin) {
      return secureResponse(fail('Origin not allowed.', 403))
    }
    if (request.method === 'OPTIONS') {
      const response = new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Bot-Secret, X-Migration-Secret',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
        'Access-Control-Max-Age': '600',
      } })
      return secureResponse(response, requestOrigin ? configuredOrigin : null)
    }
    if (Number(request.headers.get('Content-Length') || 0) > 12 * 1024 * 1024) {
      return secureResponse(fail('Request body is too large.', 413), requestOrigin ? configuredOrigin : null)
    }
    try {
      const response = await handleRequest(request, env)
      return secureResponse(response, requestOrigin ? configuredOrigin : null)
    } catch (error) {
      console.error('Worker request failed', {
        path: new URL(request.url).pathname,
        error,
      })
      return secureResponse(fail('Internal server error.', 500), requestOrigin ? configuredOrigin : null)
    }
  },
  async scheduled(_controller, env, context) {
    context.waitUntil(processBotEvents(env).catch((error) => {
      console.error('Scheduled Telegram notifications failed', error instanceof Error ? error.name : 'UnknownError')
    }))
  },
}
