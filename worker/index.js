import { z } from 'zod'
import { Bot } from 'grammy'
import { registerHandlers } from '../bot/handlers.mjs'
import { attendancePush, paymentPush } from '../bot/messages.mjs'
import { calculateFinanceSummary, validateGroupSchedule } from './domain.js'
import { hashInviteCode, verifyTelegramInitData } from './telegram-auth.js'
import { canAccessEndpoint, canAccessTable as roleCanAccessTable } from '../shared/role-permissions.js'
import { isValidLogin, loginBaseFromName } from '../shared/account-credentials.js'
import {
  findDateScheduleConflict,
  getEffectiveLesson,
  normalizeScheduleWeekdays,
  timeToMinutes,
} from '../shared/schedule.js'

const TABLES = new Set([
  'profiles', 'teachers', 'groups', 'students', 'telegram_links', 'group_students',
  'payments', 'salary_payments', 'expenses', 'attendance', 'staff_codes',
  'homework', 'homework_submissions', 'monthly_homework_report',
  'payment_audit', 'homework_review_history',
])
const READ_ONLY = new Set(['monthly_homework_report', 'payment_audit', 'homework_review_history'])
const WRITABLE = new Set([...TABLES].filter((table) => !READ_ONLY.has(table)))
const STAFF = new Set(['owner', 'reception'])
const PASSWORD_ITERATIONS = 100000
const COLUMNS = {
  profiles: ['id', 'username', 'name', 'role', 'teacher_id', 'student_id', 'telegram_id', 'phone', 'created_at', 'is_active'],
  teachers: ['id', 'name', 'phone', 'monthly_salary', 'telegram_id', 'created_at'],
  groups: ['id', 'name', 'teacher_id', 'monthly_fee', 'schedule', 'created_at'],
  students: ['id', 'name', 'phone', 'parent_phone', 'monthly_fee', 'joined_at', 'public_code', 'login', 'telegram_id', 'created_at'],
  telegram_links: ['chat_id', 'student_id', 'linked_at'],
  group_students: ['group_id', 'student_id'],
  payments: ['id', 'student_id', 'student_name', 'amount', 'month', 'year', 'paid_at', 'method', 'note', 'voided_at', 'voided_by', 'void_reason', 'updated_at', 'updated_by', 'created_at'],
  salary_payments: ['id', 'teacher_id', 'amount', 'paid_at', 'created_at'],
  expenses: ['id', 'title', 'amount', 'category', 'date', 'recorded_by', 'created_at'],
  attendance: ['id', 'student_id', 'group_id', 'date', 'status', 'note', 'marked_by', 'marked_at'],
  staff_codes: ['id', 'code', 'role', 'user_id', 'created_by', 'is_active', 'created_at'],
  homework: ['id', 'group_id', 'teacher_id', 'title', 'description', 'due_at', 'deadline', 'file_url', 'created_at', 'updated_at'],
  homework_submissions: ['id', 'homework_id', 'student_id', 'attempt_number', 'file_url', 'text_answer', 'content_text', 'video_note_url', 'voice_url', 'status', 'state', 'student_result', 'student_reason', 'teacher_result', 'feedback', 'review_note', 'submitted_at', 'reviewed_by', 'reviewed_at', 'expires_at', 'created_at'],
  monthly_homework_report: ['student_id', 'student_name', 'month_start', 'assigned_count', 'submitted_on_time_count', 'late_count', 'not_done_count', 'bajardi_count', 'bajarmadi_count'],
  payment_audit: ['id', 'payment_id', 'action', 'actor_id', 'actor_name', 'reason', 'old_data', 'new_data', 'created_at'],
  homework_review_history: ['id', 'submission_id', 'homework_id', 'student_id', 'reviewer_id', 'reviewer_name', 'old_status', 'new_status', 'old_comment', 'new_comment', 'created_at'],
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
  maybeSingle: z.boolean().optional(),
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
  return roleCanAccessTable(profile?.role, table, action)
}

function restrictedColumns(profile, table) {
  if (table === 'students') {
    return ['owner', 'reception'].includes(profile?.role)
      ? new Set()
      : new Set(['login', 'auth_user_id', 'password_ciphertext', 'password_iv'])
  }
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
      FROM profiles p JOIN accounts a ON a.id = p.id
      WHERE p.id = ? AND a.session_version = ? AND a.is_active = 1`)
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

async function passwordEncryptionKey(env) {
  const secret = env.STUDENT_PASSWORD_KEY
  if (typeof secret !== 'string' || !secret) throw new Error('Student password encryption is not configured.')
  const bytes = /^[a-f0-9]{64}$/i.test(secret) ? fromHex(secret) : base64UrlDecodeBytes(secret)
  if (bytes.length !== 32) throw new Error('Student password encryption key must be 32 bytes.')
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function encryptStudentPassword(password, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await passwordEncryptionKey(env),
    encoder.encode(password),
  )
  return { password_iv: base64UrlEncodeBytes(iv), password_ciphertext: base64UrlEncodeBytes(new Uint8Array(ciphertext)) }
}

async function decryptStudentPassword(student, env) {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlDecodeBytes(student.password_iv) },
    await passwordEncryptionKey(env),
    base64UrlDecodeBytes(student.password_ciphertext),
  )
  return new TextDecoder().decode(plaintext)
}

async function loginAttemptIdentifiers(env, request, username, telegramId) {
  const address = request.headers.get('CF-Connecting-IP') || 'unknown'
  const identifiers = [`ip:${address}`, `login:${normalizeLogin(username)}`]
  if (telegramId) identifiers.push(`telegram:${telegramId}`)
  const key = await hmacKey(env.AUTH_SECRET)
  return Promise.all(identifiers.map(async (identifier) => hex(await crypto.subtle.sign('HMAC', key, encoder.encode(identifier)))))
}

async function consumeLoginAttempt(env, request, username, telegramId) {
  const identifiers = await loginAttemptIdentifiers(env, request, username, telegramId)
  const now = Date.now()
  const attempts = await Promise.all(identifiers.map((identifier) => env.DB.prepare(
    'SELECT attempts, window_started_at, blocked_until FROM login_attempts WHERE identifier = ?',
  ).bind(identifier).first()))
  if (attempts.some((attempt) => attempt?.blocked_until > now)) return false
  let allowed = true
  for (let index = 0; index < identifiers.length; index += 1) {
    const attempt = attempts[index]
    const resetWindow = !attempt || now - attempt.window_started_at >= 15 * 60 * 1000
    const count = resetWindow ? 1 : attempt.attempts + 1
    const blockedUntil = count >= 5 ? now + 15 * 60 * 1000 : 0
    await env.DB.prepare(`INSERT INTO login_attempts (identifier, attempts, window_started_at, blocked_until)
      VALUES (?, ?, ?, ?) ON CONFLICT(identifier) DO UPDATE SET attempts = excluded.attempts,
      window_started_at = excluded.window_started_at, blocked_until = excluded.blocked_until`)
      .bind(identifiers[index], count, resetWindow ? now : attempt.window_started_at, blockedUntil).run()
    if (count >= 5) allowed = false
  }
  return allowed
}

async function clearLoginAttempts(env, request, username, telegramId) {
  const identifiers = await loginAttemptIdentifiers(env, request, username, telegramId)
  if (identifiers.length) {
    await env.DB.prepare(`DELETE FROM login_attempts WHERE identifier IN (${identifiers.map(() => '?').join(',')})`)
      .bind(...identifiers).run()
  }
}

async function logLoginFailure(env, request, username, telegramId) {
  const identifiers = await loginAttemptIdentifiers(env, request, username, telegramId)
  for (const identifierHash of identifiers) {
    await env.DB.prepare('INSERT INTO auth_failure_events (id, identifier_hash) VALUES (?, ?)')
      .bind(crypto.randomUUID(), identifierHash).run()
  }
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
      FROM profiles p JOIN accounts a ON a.id = p.id
      WHERE p.id = ? AND a.session_version = ? AND a.is_active = 1`)
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

async function handleFileDownload(request, env, profile) {
  if (!env.FILES || !env.AUTH_SECRET) return fail('File service is not configured.', 503)
  let key
  try {
    key = decodeURIComponent(new URL(request.url).pathname.slice('/api/files/'.length))
  } catch {
    return fail('Invalid file path.')
  }
  if (!['homework/', 'questions/'].some((prefix) => key.startsWith(prefix)) || key.includes('..')) return fail('Invalid file path.', 400)
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
  let authorized = false
  const filePath = `/api/files/${key}`
  const [homeworks, submissions] = await Promise.all([
    env.DB.prepare('SELECT * FROM homework WHERE instr(file_url, ?) > 0').bind(filePath).all(),
    env.DB.prepare('SELECT * FROM homework_submissions WHERE instr(file_url, ?) > 0').bind(filePath).all(),
  ])
  const uploadedFile = await env.DB.prepare(`SELECT f.*, s.homework_id, s.student_id
    FROM homework_submission_files f
    JOIN homework_submissions s ON s.id = f.submission_id
    WHERE f.r2_key = ?`).bind(key).first()
  const questionFile = await env.DB.prepare(`SELECT m.file_key, t.student_id, t.tagged_group_id
    FROM question_messages m JOIN question_tickets t ON t.id = m.ticket_id
    WHERE m.file_key = ?`).bind(key).first()
  const refersToKey = (value) => {
    if (!value) return false
    try {
      return decodeURIComponent(new URL(value).pathname.slice('/api/files/'.length)) === key
    } catch {
      return false
    }
  }
  for (const homework of homeworks.results || []) {
    if (!refersToKey(homework.file_url)) continue
    if (canAccessEndpoint(profile.role, 'files:all-homework') || await canRead(env, profile, 'homework', homework)) {
      authorized = true
      break
    }
  }
  if (!authorized) {
    for (const submission of submissions.results || []) {
      if (!refersToKey(submission.file_url)) continue
      if (canAccessEndpoint(profile.role, 'files:all-homework')
        || submission.student_id === profile.student_id
        || await canRead(env, profile, 'homework_submissions', submission)) {
        authorized = true
        break
      }
    }
  }
  if (!authorized && uploadedFile) {
    const submission = {
      homework_id: uploadedFile.homework_id,
      student_id: uploadedFile.student_id,
    }
    if (!authorized && questionFile) {
      authorized = questionFile.student_id === profile.student_id
        || ['owner', 'reception'].includes(profile.role)
        || (profile.role === 'teacher' && questionFile.tagged_group_id
          && (await ownedGroupIds(env, profile)).includes(questionFile.tagged_group_id))
    }
    if (uploadedFile.student_id === profile.student_id
      || canAccessEndpoint(profile.role, 'files:all-homework')
      || await canRead(env, profile, 'homework_submissions', submission)) {
      authorized = true
    }
  }
  if (!authorized) return fail('File access denied.', 403)
  const originalName = String(object.customMetadata?.originalName || 'homework-file')
    .replace(/[\r\n"]/g, '_').slice(0, 180)
  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${originalName.replace(/[^\x20-\x7E]/g, '_')}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
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
  if (mimeType === 'video/mp4' || mimeType === 'audio/mp4') return new TextDecoder().decode(header.slice(4, 8)) === 'ftyp'
  if (mimeType === 'audio/ogg') return new TextDecoder().decode(header.slice(0, 4)) === 'OggS'
  if (mimeType === 'video/webm' || mimeType === 'audio/webm') return header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3
  if (mimeType === 'audio/mpeg') return new TextDecoder().decode(header.slice(0, 3)) === 'ID3' || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)
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

// A Worker cannot fetch its own workers.dev hostname (Cloudflare answers 1042 loop),
// so the bot database layer calls the bot routes in-process instead of over HTTP.
async function callWorkerBotApi(env, origin, path, init = {}) {
  const headers = new Headers(init.headers)
  headers.set('X-Bot-Secret', env.BOT_API_SECRET)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const request = new Request(`${origin}${path}`, {
    method: init.method || 'GET',
    headers,
    body: init.body,
  })
  const response = await handleBot(request, env, new URL(request.url).pathname)
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || `Bot API returned ${response.status}`)
  return result
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
      const result = await callWorkerBotApi(env, origin, '/api/bot/invite/consume', {
        method: 'POST',
        body: JSON.stringify({ code, telegramId, staff }),
      })
      return result.data
    },
    async getProfileByTelegram(telegramId) {
      const result = await callWorkerBotApi(env, origin, `/api/bot/profile?telegram_id=${encodeURIComponent(telegramId)}`)
      return result.data
    },
    async getStudentHomework(chatId) {
      const result = await callWorkerBotApi(env, origin, '/api/bot/student-homework', {
        method: 'POST',
        body: JSON.stringify({ chat_id: Number(chatId) }),
      })
      return result.data || []
    },
    async getStudentSchedule(studentId) {
      const membership = await env.DB.prepare('SELECT group_id FROM group_students WHERE student_id = ?')
        .bind(studentId).all()
      const groupIds = (membership.results || []).map((row) => row.group_id)
      if (!groupIds.length) return []
      const state = await loadScheduleState(env, groupIds)
      const start = tashkentToday()
      const lessons = []
      for (let offset = 0; offset < 14; offset += 1) {
        const date = shiftScheduleDate(start, offset)
        for (const group of state.groups) {
          for (const lesson of getEffectiveLesson(group.id, date, {
            group,
            groups: state.groups,
            versions: state.versions,
            overrides: state.overrides,
          })) {
            if (lesson.status === 'rescheduled') continue
            lessons.push({
              ...lesson,
              groupName: group.name,
              date,
            })
          }
        }
      }
      return lessons.sort((left, right) => left.date.localeCompare(right.date)
        || String(left.startTime || '').localeCompare(String(right.startTime || '')))
    },
    async selectHomework(chatId, homeworkId) {
      const result = await callWorkerBotApi(env, origin, '/api/bot/select-homework', {
        method: 'POST',
        body: JSON.stringify({ chat_id: Number(chatId), homework_id: homeworkId }),
      })
      return result.data
    },
    async addHomeworkText(chatId, homeworkId, text) {
      const link = await env.DB.prepare('SELECT student_id FROM telegram_links WHERE chat_id = ?')
        .bind(Number(chatId)).first()
      if (!link) throw new Error('Telegram akkaunt ulanmagan.')
      const draft = await findOrCreateHomeworkDraft(env, homeworkId, link.student_id)
      if (draft.error) throw new Error('Uy vazifasi topilmadi yoki sizga tegishli emas.')
      const content = String(draft.submission.content_text || '')
      const next = [content, String(text || '').trim()].filter(Boolean).join('\n').slice(0, 20000)
      await env.DB.prepare(`UPDATE homework_submissions SET content_text = ?, text_answer = ?
        WHERE id = ? AND state = 'draft'`).bind(next, next, draft.submission.id).run()
      await addHomeworkEvent(env, draft.submission, 'file_added', null, { kind: 'text', length: next.length })
      return draft.submission
    },
    async addTelegramHomeworkFile(chatId, homeworkId, fileId, options = {}) {
      const link = await env.DB.prepare('SELECT student_id FROM telegram_links WHERE chat_id = ?')
        .bind(Number(chatId)).first()
      if (!link) throw new Error('Telegram akkaunt ulanmagan.')
      const draft = await findOrCreateHomeworkDraft(env, homeworkId, link.student_id)
      if (draft.error) throw new Error('Uy vazifasi topilmadi yoki sizga tegishli emas.')
      const kind = options.kind || 'attachment'
      const duration = Number(options.duration || 0)
      if (kind !== 'attachment' && duration < 3) throw new Error('Ovozli xabar yoki dumaloq video kamida 3 soniya bo‘lishi kerak.')
      const existing = await env.DB.prepare(`SELECT id FROM homework_submission_files
        WHERE submission_id = ? AND kind IN ('voice', 'video_note')`).bind(draft.submission.id).first()
      if (kind !== 'attachment' && existing) throw new Error('Bu vazifa uchun bitta proof allaqachon yuborilgan.')
      const infoResponse = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`)
      const info = await infoResponse.json()
      if (!infoResponse.ok || !info.ok || !info.result?.file_path) throw new Error('Telegram fayl manzili topilmadi.')
      const download = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${info.result.file_path}`)
      if (!download.ok) throw new Error('Telegram faylini yuklab bo‘lmadi.')
      const bytes = await download.arrayBuffer()
      if (!bytes.byteLength || bytes.byteLength > 20 * 1024 * 1024) throw new Error('Bot orqali yuboriladigan fayl 20 MB dan oshmasligi kerak.')
      const key = `homework/${crypto.randomUUID()}`
      const originalName = String(options.name || (kind === 'voice' ? 'ovozli-xabar.ogg' : kind === 'video_note' ? 'dumaloq-video.mp4' : 'telegram-fayl'))
        .replace(/[\r\n]/g, '_').slice(0, 180)
      await env.FILES.put(key, bytes, {
        httpMetadata: { contentType: 'application/octet-stream' },
        customMetadata: { originalName },
      })
      const fileRecordId = crypto.randomUUID()
      await env.DB.prepare(`INSERT INTO homework_submission_files
        (id, submission_id, kind, r2_key, original_name, mime_type, size_bytes, duration_seconds,
          telegram_chat_id, telegram_message_id, telegram_file_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` )
        .bind(fileRecordId, draft.submission.id, kind, key, originalName,
          options.mimeType || 'application/octet-stream', bytes.byteLength, kind === 'attachment' ? null : duration,
          options.telegramChatId || null, options.telegramMessageId || null, fileId).run()
      await addHomeworkEvent(env, draft.submission, kind === 'attachment' ? 'file_added' : 'proof_added', null, {
        file_id: fileRecordId, kind, name: originalName, size_bytes: bytes.byteLength, duration_seconds: duration || null,
      })
      return { submissionId: draft.submission.id, title: draft.homework.title }
    },
    async confirmHomework(chatId, homeworkId) {
      const link = await env.DB.prepare('SELECT student_id FROM telegram_links WHERE chat_id = ?')
        .bind(Number(chatId)).first()
      if (!link) throw new Error('Telegram akkaunt ulanmagan.')
      const submission = await env.DB.prepare(`SELECT * FROM homework_submissions
        WHERE homework_id = ? AND student_id = ? AND state = 'draft'
        ORDER BY attempt_number DESC LIMIT 1`).bind(homeworkId, link.student_id).first()
      if (!submission) throw new Error('Faol draft topilmadi.')
      const response = await confirmHomeworkDraft(env, submission, null)
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Vazifani topshirib bo‘lmadi.')
      }
      return true
    },
    async getHomeworkDraftState(chatId, homeworkId) {
      const link = await env.DB.prepare('SELECT student_id FROM telegram_links WHERE chat_id = ?')
        .bind(Number(chatId)).first()
      if (!link) return null
      const draft = await findOrCreateHomeworkDraft(env, homeworkId, link.student_id)
      if (draft.error) return null
      return draft.submission
    },
    async createQuestion(chatId, text, file = null) {
      const response = await fetch(`${origin}/api/bot/question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': env.BOT_API_SECRET },
        body: JSON.stringify({ chat_id: Number(chatId), text, ...file }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Savolni yuborib bo‘lmadi.')
      return result.data
    },
    async getPendingHomework(chatId) {
      const result = await callWorkerBotApi(env, origin, `/api/bot/pending-homework?chat_id=${encodeURIComponent(chatId)}`)
      return result.data
    },
    async submitHomework(values) {
      const result = await callWorkerBotApi(env, origin, '/api/bot/submission', {
        method: 'POST',
        body: JSON.stringify(values),
      })
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

export async function expireHomeworkDrafts(env) {
  const expired = await env.DB.prepare(`SELECT * FROM homework_submissions
    WHERE state = 'draft' AND expires_at IS NOT NULL AND expires_at <= ? LIMIT 100`).bind(Date.now()).all()
  for (const submission of expired.results || []) {
    const changed = await env.DB.prepare(`UPDATE homework_submissions SET state = 'expired'
      WHERE id = ? AND state = 'draft' AND expires_at <= ?`).bind(submission.id, Date.now()).run()
    if (!changed.meta?.changes) continue
    await addHomeworkEvent(env, submission, 'expired', null, { expired_at: Date.now() })
    if (env.TELEGRAM_BOT_TOKEN) {
      try {
        const [chats, homework] = await Promise.all([
          env.DB.prepare('SELECT chat_id FROM telegram_links WHERE student_id = ?').bind(submission.student_id).all(),
          env.DB.prepare('SELECT title FROM homework WHERE id = ?').bind(submission.homework_id).first(),
        ])
        const bot = getWorkerBot(env, env.TELEGRAM_WEBAPP_URL ? new URL(env.TELEGRAM_WEBAPP_URL).origin : 'https://localhost')
        for (const { chat_id: chatId } of chats.results || []) {
          await bot.api.sendMessage(chatId,
            `“${homework?.title || 'Uy vazifasi'}” uchun draft 24 soat ichida yuborilmagani sababli tugadi. Vazifa hali ochiq bo‘lsa, Mini App’dan qayta boshlang.`)
        }
      } catch (error) {
        console.error('Homework draft expiry reminder failed', error instanceof Error ? error.name : 'UnknownError')
      }
    }
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
  const state = await loadScheduleState(env)
  const today = tashkentToday()
  return state.groups.filter((group) => {
    const relevantVersions = state.versions.filter((version) => version.group_id === group.id
      && (!version.valid_to || version.valid_to > today))
    if (!relevantVersions.length) return teacherOwnsGroup(group, profile.teacher_id)
    return relevantVersions.some((version) => normalizedSchedule(parsedSchedule(version.schedule))
      .some((slot) => (slot.teacherId || group.teacher_id) === profile.teacher_id))
  }).map((group) => group.id)
}

async function membershipGroupIds(env, studentId) {
  if (!studentId) return []
  const rows = await env.DB.prepare('SELECT group_id FROM group_students WHERE student_id = ?').bind(studentId).all()
  return (rows.results || []).map((row) => row.group_id)
}

async function canRead(env, profile, table, row) {
  if (canAccessEndpoint(profile.role, 'data:staff-wide-read')) return true
  if (table === 'profiles') return row.id === profile.id
  if (table === 'teachers') return row.id === profile.teacher_id
  if (table === 'payments') return STAFF.has(profile.role)
    || (profile.role === 'student' && row.student_id === profile.student_id)
  if (table === 'homework_review_history') {
    if (STAFF.has(profile.role)) return true
    if (profile.role === 'student') return row.student_id === profile.student_id
    if (profile.role === 'teacher') {
      const homework = await env.DB.prepare('SELECT * FROM homework WHERE id = ?').bind(row.homework_id).first()
      return Boolean(homework && await canRead(env, profile, 'homework', homework))
    }
    return false
  }
  if (table === 'groups') {
    if (profile.role === 'teacher') return (await ownedGroupIds(env, profile)).includes(row.id)
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
    return action === 'delete' && canAccessEndpoint(profile.role, 'staff:manage') && row.id !== profile.id
  }
  if (canAccessEndpoint(profile.role, 'data:reception-row-write')) return true
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

function queryColumns(table) {
  return COLUMNS[table].filter((column) => !(table === 'profiles' && column === 'is_active'))
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
  const selectedFields = fields.includes('*')
    ? queryColumns(table).filter((column) => column !== 'auth_user_id')
    : fields.filter((column) => !(table === 'profiles' && column === 'is_active'))
  const relationKeys = relation.map(({ table: name }) => (
    name === 'groups' ? 'group_id'
      : name === 'students' ? 'student_id'
        : name === 'teachers' ? 'teacher_id'
          : null
  )).filter(Boolean)
  const queryFields = [...new Set([...selectedFields, ...relationKeys])]
  if (!queryFields.length) queryFields.push('id')
  const projection = queryFields.map((column) => `"${column}"`).join(', ')
  let sql = `SELECT ${projection} FROM "${table}"`
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
  const databasePagination = service || canAccessEndpoint(profile?.role, 'data:staff-wide-query')
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
  if (table === 'profiles') {
    const ids = rows.map((row) => row.id)
    if (ids.length) {
      const activeRows = await env.DB.prepare(`SELECT id, is_active FROM accounts WHERE id IN (${ids.map(() => '?').join(',')})`)
        .bind(...ids).all()
      const activeById = new Map((activeRows.results || []).map((row) => [row.id, row.is_active]))
      rows = rows.map((row) => ({ ...row, is_active: activeById.get(row.id) === 1 }))
    }
  }
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
        ? await env.DB.prepare(`SELECT ${queryColumns(link.table).map((column) => `"${column}"`).join(', ')} FROM "${link.table}" WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()
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
  if (table === 'groups' && action === 'update' && values && Object.hasOwn(values, 'schedule')) {
    throw new Error('Use the schedule change endpoint to preserve schedule history.')
  }
  if (table === 'payments' && action === 'upsert') throw new Error('Payment upsert is not supported; use an audited insert or update.')
  const allowedColumns = new Set(COLUMNS[table] || [])
  if (table === 'profiles') allowedColumns.delete('is_active')
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
      const statement = env.DB.prepare(sql).bind(...columns.map((column) => typeof row[column] === 'object' && row[column] !== null ? JSON.stringify(row[column]) : row[column]))
      const result = await statement.run()
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
      if (table === 'payments' && !service) {
        throw new Error('To‘lovni o‘chirish mumkin emas. Bekor qilish uchun maxsus amalni ishlating.')
      }
      if (table === 'profiles') {
        await env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(row.id).run()
      } else {
        const primary = table === 'group_students'
          ? ['group_id', 'student_id']
          : table === 'telegram_links' ? ['chat_id'] : ['id']
        const deletion = env.DB.prepare(`DELETE FROM "${table}" WHERE ${primary.map((column) => `"${column}" = ?`).join(' AND ')}`)
          .bind(...primary.map((column) => row[column]))
        await deletion.run()
      }
      affected.push(row)
      continue
    }
    const patch = { ...values }
    const auditReason = table === 'payments' && typeof patch.reason === 'string' ? patch.reason : ''
    if (table === 'payments') delete patch.reason
    if (Object.keys(patch).some((column) => !allowedColumns.has(column))) throw new Error('Invalid columns')
    if (!service && table === 'payments' && row.voided_at) throw new Error('Bekor qilingan to‘lovni tuzatib bo‘lmaydi.')
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
    const updated = { ...row, ...patch }
    const updateStatement = env.DB.prepare(`UPDATE "${table}" SET ${columns.map((column) => `"${column}" = ?`).join(',')} WHERE ${primary.map((column) => `"${column}" = ?`).join(' AND ')}`)
      .bind(...columns.map((column) => typeof patch[column] === 'object' && patch[column] !== null ? JSON.stringify(patch[column]) : patch[column]), ...primary.map((column) => row[column]))
    if (!service && table === 'payments') {
      await updateStatement.run()
      await recordPaymentAudit(env, {
        action: 'corrected',
        paymentId: row.id,
        actor: profile,
        reason: auditReason,
        oldData: paymentSnapshot(row),
        newData: paymentSnapshot(updated),
      })
    } else await updateStatement.run()
    affected.push(updated)
  }
  return body.returning ? affected : null
}

async function authLogin(request, env) {
  let payload
  try { payload = await request.json() } catch { return fail('Login yoki parol noto‘g‘ri.', 401) }
  const parsed = LoginSchema.safeParse(payload)
  if (!parsed.success) return fail('Login yoki parol noto‘g‘ri.', 401)
  if (!env.AUTH_SECRET) return fail('Authentication is not configured.', 503)
  const login = normalizeLogin(parsed.data.username)
  if (!isValidLogin(login)) return fail('Login yoki parol noto‘g‘ri.', 401)
  if (!(await consumeLoginAttempt(env, request, login))) {
    await logLoginFailure(env, request, login)
    return fail('Juda ko‘p urinish. 15 daqiqadan so‘ng qayta urinib ko‘ring.', 429)
  }
  const row = await env.DB.prepare(`SELECT p.*, a.password_hash, a.password_salt, a.password_iterations,
    a.password_reset_required, a.session_version, a.is_active
    FROM profiles p JOIN accounts a ON a.id = p.id WHERE p.username = ? COLLATE NOCASE`)
    .bind(login).first()
  const salt = row?.password_salt || '00000000000000000000000000000000'
  const iterations = row?.password_iterations || PASSWORD_ITERATIONS
  const hash = await derivePassword(parsed.data.password, salt, iterations)
  if (!row?.password_hash || !constantTimeEqual(hash, row.password_hash) || !row.is_active || row.role === 'student') {
    await logLoginFailure(env, request, login)
    return fail('Login yoki parol noto‘g‘ri.', 401)
  }
  await clearLoginAttempts(env, request, login)
  const profile = { ...row }
  delete profile.password_hash
  delete profile.password_salt
  delete profile.password_iterations
  return json(await issueSession(profile, env, Boolean(row.password_reset_required)))
}

async function authCreate(request, env, actor) {
  if (!canAccessEndpoint(actor.role, 'staff:manage')) return fail('Ruxsat yo‘q.', 403)
  let body
  try { body = await request.json() } catch { return fail('Login, ism yoki parol noto‘g‘ri.', 400) }
  const metadata = body.options?.data || {}
  const parsed = z.object({
    username: z.string().trim().min(2).max(64),
    password: z.string().min(12).max(128),
    role: z.enum(['teacher', 'reception']),
    name: z.string().trim().min(1).max(160),
    phone: z.string().trim().max(40).optional(),
    teacher_id: z.string().nullable().optional(),
    student_id: z.string().nullable().optional(),
  }).safeParse({
    username: metadata.username || body.username || body.email,
    password: body.password,
    role: metadata.role || body.role || 'teacher',
    name: metadata.name || body.name || metadata.username || body.username || body.email,
    phone: metadata.phone ?? body.phone,
    teacher_id: metadata.teacher_id ?? body.teacher_id,
    student_id: metadata.student_id ?? body.student_id,
  })
  if (!parsed.success) return fail('Login, ism yoki parol noto‘g‘ri.', 400)
  const { password } = parsed.data
  const username = normalizeLogin(parsed.data.username)
  const role = parsed.data.role
  const name = parsed.data.name
  if (!isValidLogin(username)) return fail('Login formati noto‘g‘ri.', 400)
  const exists = await env.DB.prepare('SELECT id FROM profiles WHERE username = ? COLLATE NOCASE').bind(username).first()
  if (exists) return fail('Bu login allaqachon band.', 409)

  const id = crypto.randomUUID()
  const { hash, salt } = await hashPassword(password)
  const teacherId = parsed.data.teacher_id || null
  await env.DB.batch([
    env.DB.prepare('INSERT INTO accounts (id, password_hash, password_salt, password_iterations, password_reset_required) VALUES (?, ?, ?, ?, 1)')
      .bind(id, hash, salt, PASSWORD_ITERATIONS),
    env.DB.prepare('INSERT INTO profiles (id, username, name, role, teacher_id, phone) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, username, name, role, teacherId, parsed.data.phone || ''),
  ])
  return json({ user: { id, username, name, role, teacher_id: teacherId }, session: {} }, 201)
}

async function telegramLogin(request, env) {
  let payload
  try { payload = await request.json() } catch { return fail('Telegram so‘rovi noto‘g‘ri.', 400) }
  const parsed = z.object({ initData: z.string().min(1).max(16_384) }).strict().safeParse(payload)
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
    WHERE a.is_active = 1 AND (p.telegram_id = ? OR (p.role = 'student' AND s.telegram_id = ?)
      OR (p.role = 'teacher' AND t.telegram_id = ?)
    )
    LIMIT 2`).bind(telegramId, telegramId, telegramId).all()
  if (matches.results?.length !== 1) {
    return json({
      error: 'Telegram akkaunti ulanmagan. Login va parol bilan kiring.',
      code: 'TELEGRAM_NOT_LINKED',
    }, 403)
  }

  const profile = matches.results[0]
  try {
    const statements = [
      env.DB.prepare('UPDATE profiles SET telegram_id = ? WHERE id = ?').bind(telegramId, profile.id),
    ]
    if (profile.role === 'student' && profile.student_id) {
      statements.push(env.DB.prepare('UPDATE students SET telegram_id = ? WHERE id = ?').bind(telegramId, profile.student_id))
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

async function telegramPasswordLogin(request, env) {
  let body
  try { body = await request.json() } catch { return fail('Login yoki parol noto‘g‘ri.', 401) }
  const parsed = z.object({
    initData: z.string().min(1).max(16_384),
    username: z.string().trim().min(2).max(64),
    password: z.string().min(6).max(128),
  }).strict().safeParse(body)
  if (!parsed.success || !env.TELEGRAM_BOT_TOKEN || !env.AUTH_SECRET) return fail('Login yoki parol noto‘g‘ri.', 401)
  const verified = await verifyTelegramInitData(parsed.data.initData, env.TELEGRAM_BOT_TOKEN)
  const telegramId = Number(verified?.user?.id)
  const username = normalizeLogin(parsed.data.username)
  if (!verified || !Number.isSafeInteger(telegramId) || !isValidLogin(username)) {
    await logLoginFailure(env, request, username || 'invalid', telegramId || null)
    return fail('Login yoki parol noto‘g‘ri.', 401)
  }
  if (!(await consumeLoginAttempt(env, request, username, telegramId))) {
    await logLoginFailure(env, request, username, telegramId)
    return fail('Juda ko‘p urinish. 15 daqiqadan so‘ng qayta urinib ko‘ring.', 429)
  }
  const row = await env.DB.prepare(`SELECT p.*, a.password_hash, a.password_salt, a.password_iterations,
    a.password_reset_required, a.session_version, a.is_active
    FROM profiles p JOIN accounts a ON a.id = p.id WHERE p.username = ? COLLATE NOCASE`)
    .bind(username).first()
  const salt = row?.password_salt || '00000000000000000000000000000000'
  const hash = await derivePassword(parsed.data.password, salt, row?.password_iterations || PASSWORD_ITERATIONS)
  if (!row?.password_hash || !constantTimeEqual(hash, row.password_hash) || !row.is_active) {
    await logLoginFailure(env, request, username, telegramId)
    return fail('Login yoki parol noto‘g‘ri.', 401)
  }
  if (row.telegram_id && Number(row.telegram_id) !== telegramId) {
    await logLoginFailure(env, request, username, telegramId)
    return fail('Bu akkaunt boshqa Telegram\'ga ulangan. Qabulxonaga murojaat qiling.', 409)
  }
  const occupied = await env.DB.prepare('SELECT id FROM profiles WHERE telegram_id = ? AND id != ?')
    .bind(telegramId, row.id).first()
  if (occupied) {
    await logLoginFailure(env, request, username, telegramId)
    return fail('Bu Telegram akkaunti boshqa foydalanuvchiga ulangan. Qabulxonaga murojaat qiling.', 409)
  }
  try {
    const statements = [
      env.DB.prepare('UPDATE profiles SET telegram_id = ? WHERE id = ? AND (telegram_id IS NULL OR telegram_id = ?)')
        .bind(telegramId, row.id, telegramId),
    ]
    if (row.role === 'student' && row.student_id) {
      const linked = await env.DB.prepare('SELECT student_id FROM telegram_links WHERE student_id = ? OR chat_id = ?')
        .bind(row.student_id, telegramId).first()
      if (linked && (linked.student_id !== row.student_id)) {
        return fail('Bu Telegram akkaunti boshqa foydalanuvchiga ulangan. Qabulxonaga murojaat qiling.', 409)
      }
      statements.push(env.DB.prepare('UPDATE students SET telegram_id = ? WHERE id = ?').bind(telegramId, row.student_id))
      statements.push(env.DB.prepare(`INSERT INTO telegram_links (chat_id, student_id, linked_at)
        VALUES (?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET student_id = excluded.student_id, linked_at = excluded.linked_at`)
        .bind(telegramId, row.student_id, new Date().toISOString()))
    }
    if (row.role === 'teacher' && row.teacher_id) {
      statements.push(env.DB.prepare('UPDATE teachers SET telegram_id = ? WHERE id = ?').bind(telegramId, row.teacher_id))
    }
    await env.DB.batch(statements)
  } catch {
    await logLoginFailure(env, request, username, telegramId)
    return fail('Bu akkaunt boshqa Telegram\'ga ulangan. Qabulxonaga murojaat qiling.', 409)
  }
  await clearLoginAttempts(env, request, username, telegramId)
  const profile = { ...row, telegram_id: telegramId }
  delete profile.password_hash
  delete profile.password_salt
  delete profile.password_iterations
  return json(await issueSession(profile, env, Boolean(row.password_reset_required), 'telegram'))
}

async function uniqueUsername(env, name) {
  const base = loginBaseFromName(name)
  let candidate = base
  for (let suffix = 2; suffix <= 10000; suffix += 1) {
    const exists = await env.DB.prepare('SELECT 1 AS found FROM profiles WHERE username = ? COLLATE NOCASE')
      .bind(candidate).first()
    if (!exists) return candidate
    candidate = `${base.slice(0, 64 - String(suffix).length)}${suffix}`
  }
  throw new Error('Login yaratib bo‘lmadi.')
}

async function handleStaffAccounts(request, env, actor, pathname) {
  if (!actor || actor.role !== 'owner') return fail('Ruxsat yo‘q.', actor ? 403 : 401)
  if (request.method === 'GET' && pathname === '/api/staff') {
    const rows = await env.DB.prepare(`SELECT p.id, p.username, p.name, p.phone, p.role, p.teacher_id,
        p.telegram_id, a.is_active
      FROM profiles p JOIN accounts a ON a.id = p.id
      WHERE p.role IN ('teacher', 'reception') ORDER BY p.name COLLATE NOCASE`).all()
    return json({ data: rows.results || [] })
  }
  let body
  try { body = await request.json() } catch { return fail('Xodim ma’lumoti noto‘g‘ri.', 400) }
  if (request.method === 'POST' && pathname === '/api/staff') {
    const parsed = z.object({
      name: z.string().trim().min(2).max(160),
      phone: z.string().trim().max(40).optional().default(''),
      role: z.enum(['reception', 'teacher']),
      username: z.string().trim().max(64).optional().default(''),
      auto_username: z.boolean().optional().default(false),
      password: z.string().min(12).max(128),
      monthly_salary: z.number().finite().min(0).optional().default(0),
      teacher_id: z.string().min(1).max(128).optional(),
    }).strict().safeParse(body)
    if (!parsed.success) return fail('Ism, login, rol yoki parol noto‘g‘ri.', 400)
    const username = parsed.data.auto_username || !parsed.data.username
      ? await uniqueUsername(env, parsed.data.name)
      : parsed.data.username.toLowerCase()
    if (!isValidLogin(username)) return fail('Login formati noto‘g‘ri.', 400)
    const duplicate = await env.DB.prepare('SELECT 1 AS found FROM profiles WHERE username = ? COLLATE NOCASE')
      .bind(username).first()
    if (duplicate) return fail('Bu login allaqachon band.', 409)
    const id = crypto.randomUUID()
    let teacherId = parsed.data.role === 'teacher' ? parsed.data.teacher_id || crypto.randomUUID() : null
    if (teacherId) {
      const teacher = await env.DB.prepare('SELECT id FROM teachers WHERE id = ?').bind(teacherId).first()
      if (parsed.data.teacher_id && !teacher) return fail('O‘qituvchi profili topilmadi.', 404)
      const linked = await env.DB.prepare('SELECT 1 AS found FROM profiles WHERE teacher_id = ? AND role = ?')
        .bind(teacherId, 'teacher').first()
      if (linked) return fail('O‘qituvchi uchun akkaunt allaqachon mavjud.', 409)
    }
    const { hash, salt } = await hashPassword(parsed.data.password)
    const statements = [
      env.DB.prepare(`INSERT INTO accounts
        (id, password_hash, password_salt, password_iterations, password_reset_required)
        VALUES (?, ?, ?, ?, 0)`).bind(id, hash, salt, PASSWORD_ITERATIONS),
      env.DB.prepare(`INSERT INTO profiles (id, username, name, role, teacher_id, phone)
        VALUES (?, ?, ?, ?, ?, ?)`).bind(id, username, parsed.data.name, parsed.data.role, teacherId, parsed.data.phone),
    ]
    if (teacherId) {
      const exists = await env.DB.prepare('SELECT id FROM teachers WHERE id = ?').bind(teacherId).first()
      statements.push(exists
        ? env.DB.prepare('UPDATE teachers SET name = ?, phone = ?, monthly_salary = ? WHERE id = ?')
          .bind(parsed.data.name, parsed.data.phone, parsed.data.monthly_salary, teacherId)
        : env.DB.prepare(`INSERT INTO teachers (id, name, phone, monthly_salary) VALUES (?, ?, ?, ?)`)
          .bind(teacherId, parsed.data.name, parsed.data.phone, parsed.data.monthly_salary))
    }
    try { await env.DB.batch(statements) } catch (error) {
      if (/unique constraint/i.test(error instanceof Error ? error.message : '')) return fail('Bu login allaqachon band.', 409)
      throw error
    }
    return json({ data: { id, username, name: parsed.data.name, phone: parsed.data.phone, role: parsed.data.role, teacher_id: teacherId, is_active: 1 } }, 201)
  }
  const match = pathname.match(/^\/api\/staff\/([^/]+)$/)
  if (request.method !== 'POST' || !match) return fail('Xodim endpointi topilmadi.', 404)
  const targetId = match[1]
  const target = await env.DB.prepare(`SELECT p.id, p.username, p.name, p.phone, p.role, p.teacher_id
    FROM profiles p WHERE p.id = ? AND p.role IN ('teacher', 'reception')`).bind(targetId).first()
  if (!target) return fail('Xodim topilmadi.', 404)
  const parsed = z.object({
    name: z.string().trim().min(2).max(160).optional(),
    phone: z.string().trim().max(40).optional(),
    username: z.string().trim().max(64).optional(),
    role: z.enum(['reception', 'teacher']).optional(),
    password: z.string().min(12).max(128).optional(),
    is_active: z.boolean().optional(),
    monthly_salary: z.number().finite().min(0).optional(),
  }).strict().safeParse(body)
  if (!parsed.success || !Object.keys(parsed.data).length) return fail('Xodim ma’lumoti noto‘g‘ri.', 400)
  const updates = parsed.data
  const name = updates.name ?? target.name
  const phone = updates.phone ?? target.phone ?? ''
  const username = updates.username === undefined ? target.username : updates.username.toLowerCase()
  if (!isValidLogin(username)) return fail('Login formati noto‘g‘ri.', 400)
  const duplicate = await env.DB.prepare('SELECT 1 AS found FROM profiles WHERE username = ? COLLATE NOCASE AND id != ?')
    .bind(username, targetId).first()
  if (duplicate) return fail('Bu login allaqachon band.', 409)
  const nextRole = updates.role ?? target.role
  let teacherId = target.teacher_id
  const statements = [
    env.DB.prepare('UPDATE profiles SET username = ?, name = ?, phone = ?, role = ? WHERE id = ?')
      .bind(username, name, phone, nextRole, targetId),
  ]
  if (nextRole === 'teacher' && !teacherId) {
    teacherId = crypto.randomUUID()
    statements[0] = env.DB.prepare('UPDATE profiles SET username = ?, name = ?, phone = ?, role = ?, teacher_id = ? WHERE id = ?')
      .bind(username, name, phone, nextRole, teacherId, targetId)
    statements.push(env.DB.prepare('INSERT INTO teachers (id, name, phone, monthly_salary) VALUES (?, ?, ?, ?)')
      .bind(teacherId, name, phone, updates.monthly_salary || 0))
  } else if (nextRole === 'reception') {
    teacherId = null
    statements[0] = env.DB.prepare('UPDATE profiles SET username = ?, name = ?, phone = ?, role = ?, teacher_id = NULL WHERE id = ?')
      .bind(username, name, phone, nextRole, targetId)
  }
  if (target.teacher_id && (name !== target.name || phone !== target.phone || updates.monthly_salary !== undefined)) {
    statements.push(env.DB.prepare(`UPDATE teachers SET name = ?, phone = ?, monthly_salary = COALESCE(?, monthly_salary)
      WHERE id = ?`).bind(name, phone, updates.monthly_salary ?? null, target.teacher_id))
  }
  if (updates.password) {
    const { hash, salt } = await hashPassword(updates.password)
    statements.push(env.DB.prepare(`UPDATE accounts SET password_hash = ?, password_salt = ?,
      password_iterations = ?, password_reset_required = 0, session_version = session_version + 1
      WHERE id = ?`).bind(hash, salt, PASSWORD_ITERATIONS, targetId))
  }
  if (updates.is_active !== undefined) {
    statements.push(env.DB.prepare('UPDATE accounts SET is_active = ?, session_version = session_version + 1 WHERE id = ?')
      .bind(Number(updates.is_active), targetId))
  }
  await env.DB.batch(statements)
  return json({ data: { id: targetId, username, name, phone, role: nextRole, teacher_id: teacherId, is_active: updates.is_active } })
}

async function validateStudentGroups(env, groupIds) {
  const ids = [...new Set(groupIds)]
  if (ids.length > 50 || ids.some((id) => typeof id !== 'string' || id.length > 128)) {
    throw new Error('Guruh tanlovi noto‘g‘ri.')
  }
  if (!ids.length) return ids
  const existing = await env.DB.prepare(`SELECT id FROM groups WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids).all()
  if ((existing.results || []).length !== ids.length) throw new Error('Tanlangan guruh topilmadi.')
  return ids
}

async function handleStudentRecords(request, env, actor, pathname) {
  if (!actor || !['owner', 'reception'].includes(actor.role)) return fail('Ruxsat yo‘q.', actor ? 403 : 401)
  if (pathname === '/api/students' && request.method !== 'POST') return fail('Method not allowed.', 405)
  let body
  try { body = await request.json() } catch { return fail('O‘quvchi ma’lumoti noto‘g‘ri.', 400) }
  const action = body.action || 'create'
  if (pathname === '/api/students' && action === 'create') {
    const parsed = z.object({
      name: z.string().trim().min(3).max(160),
      phone: z.string().trim().max(40).optional().default(''),
      parent_phone: z.string().trim().max(80).optional().default(''),
      monthly_fee: z.number().finite().min(0).optional().default(0),
      joined_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      group_ids: z.array(z.string().min(1).max(128)).max(50).optional().default([]),
      username: z.string().trim().max(64).optional().default(''),
      auto_username: z.boolean().optional().default(false),
      password: z.string().min(6).max(128),
    }).strict().safeParse(body)
    if (!parsed.success) return fail('O‘quvchi ma’lumoti yoki paroli noto‘g‘ri.', 400)
    if (!env.STUDENT_PASSWORD_KEY) return fail('O‘quvchi parolini himoyalash sozlanmagan.', 503)
    let groupIds
    try { groupIds = await validateStudentGroups(env, parsed.data.group_ids) } catch (error) {
      return fail(error instanceof Error ? error.message : 'Guruh tanlovi noto‘g‘ri.', 400)
    }
    const username = parsed.data.auto_username || !parsed.data.username
      ? await uniqueUsername(env, parsed.data.name)
      : parsed.data.username.toLowerCase()
    if (!isValidLogin(username)) return fail('Login formati noto‘g‘ri.', 400)
    const duplicate = await env.DB.prepare('SELECT 1 AS found FROM profiles WHERE username = ? COLLATE NOCASE')
      .bind(username).first()
    if (duplicate) return fail('Bu login allaqachon band.', 409)
    const studentId = crypto.randomUUID()
    const accountId = crypto.randomUUID()
    const publicCode = `KS-${crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`
    const { hash, salt } = await hashPassword(parsed.data.password)
    const encrypted = await encryptStudentPassword(parsed.data.password, env)
    const statements = [
      env.DB.prepare(`INSERT INTO accounts
        (id, password_hash, password_salt, password_iterations, password_reset_required)
        VALUES (?, ?, ?, ?, 0)`).bind(accountId, hash, salt, PASSWORD_ITERATIONS),
      env.DB.prepare(`INSERT INTO students
        (id, name, phone, parent_phone, monthly_fee, joined_at, public_code, login, auth_user_id,
          password_ciphertext, password_iv)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(studentId, parsed.data.name, parsed.data.phone, parsed.data.parent_phone, parsed.data.monthly_fee,
          parsed.data.joined_at || new Date().toISOString().slice(0, 10), publicCode, username, accountId,
          encrypted.password_ciphertext, encrypted.password_iv),
      env.DB.prepare(`INSERT INTO profiles (id, username, name, role, student_id)
        VALUES (?, ?, ?, 'student', ?)`).bind(accountId, username, parsed.data.name, studentId),
      ...groupIds.map((groupId) => env.DB.prepare('INSERT INTO group_students (group_id, student_id) VALUES (?, ?)')
        .bind(groupId, studentId)),
    ]
    try { await env.DB.batch(statements) } catch (error) {
      if (/unique constraint/i.test(error instanceof Error ? error.message : '')) return fail('Bu login allaqachon band.', 409)
      throw error
    }
    return json({ data: { id: studentId, name: parsed.data.name, username, phone: parsed.data.phone, parent_phone: parsed.data.parent_phone, group_ids: groupIds, public_code: publicCode, telegram_linked: false } }, 201)
  }
  const match = pathname.match(/^\/api\/students\/([^/]+)$/)
  if (action !== 'update' || request.method !== 'POST' || !match) return fail('O‘quvchi endpointi topilmadi.', 404)
  const studentId = match[1]
  const student = await env.DB.prepare(`SELECT s.*, p.id AS account_id, p.username AS account_username
    FROM students s LEFT JOIN profiles p ON p.id = s.auth_user_id AND p.role = 'student'
    WHERE s.id = ?`).bind(studentId).first()
  if (!student) return fail('O‘quvchi topilmadi.', 404)
  const parsed = z.object({
    name: z.string().trim().min(3).max(160).optional(),
    phone: z.string().trim().max(40).optional(),
    parent_phone: z.string().trim().max(80).optional(),
    joined_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    monthly_fee: z.number().finite().min(0).optional(),
    group_ids: z.array(z.string().min(1).max(128)).max(50).optional(),
    username: z.string().trim().max(64).optional(),
  }).strict().safeParse(body)
  if (!parsed.success || !Object.keys(parsed.data).length) return fail('O‘quvchi ma’lumoti noto‘g‘ri.', 400)
  const updates = parsed.data
  const username = updates.username === undefined ? student.login || student.account_username : updates.username.toLowerCase()
  if (updates.username !== undefined && !isValidLogin(username)) return fail('Login formati noto‘g‘ri.', 400)
  if (updates.username !== undefined) {
    const duplicate = await env.DB.prepare('SELECT 1 AS found FROM profiles WHERE username = ? COLLATE NOCASE AND id != ?')
      .bind(username, student.account_id || '').first()
    if (duplicate) return fail('Bu login allaqachon band.', 409)
  }
  let groupIds
  try { if (updates.group_ids) groupIds = await validateStudentGroups(env, updates.group_ids) } catch (error) {
    return fail(error instanceof Error ? error.message : 'Guruh tanlovi noto‘g‘ri.', 400)
  }
  const assignments = []
  const values = []
  for (const [field, column] of [['name', 'name'], ['phone', 'phone'], ['parent_phone', 'parent_phone'], ['joined_at', 'joined_at'], ['monthly_fee', 'monthly_fee']]) {
    if (updates[field] !== undefined) {
      assignments.push(`"${column}" = ?`)
      values.push(updates[field])
    }
  }
  if (updates.username !== undefined) {
    assignments.push('login = ?')
    values.push(username)
  }
  const statements = []
  if (assignments.length) statements.push(env.DB.prepare(`UPDATE students SET ${assignments.join(', ')} WHERE id = ?`)
    .bind(...values, studentId))
  if (updates.name !== undefined && student.account_id) {
    statements.push(env.DB.prepare('UPDATE profiles SET name = ? WHERE id = ?').bind(updates.name, student.account_id))
  }
  if (updates.username !== undefined && student.account_id) {
    statements.push(env.DB.prepare('UPDATE profiles SET username = ? WHERE id = ?').bind(username, student.account_id))
  }
  if (groupIds) {
    statements.push(env.DB.prepare('DELETE FROM group_students WHERE student_id = ?').bind(studentId))
    statements.push(...groupIds.map((groupId) => env.DB.prepare('INSERT INTO group_students (group_id, student_id) VALUES (?, ?)')
      .bind(groupId, studentId)))
  }
  if (statements.length) {
    try { await env.DB.batch(statements) } catch (error) {
      if (/unique constraint/i.test(error instanceof Error ? error.message : '')) return fail('Bu login allaqachon band.', 409)
      throw error
    }
  }
  return json({ data: { id: studentId, username, group_ids: groupIds || undefined } })
}

async function consumePasswordRevealLimit(env, actorId, studentId) {
  const key = await hmacKey(env.AUTH_SECRET)
  const identifier = hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`student-reveal:${actorId}:${studentId}`)))
  const now = Date.now()
  const current = await env.DB.prepare('SELECT attempts, window_started_at, blocked_until FROM login_attempts WHERE identifier = ?')
    .bind(identifier).first()
  if (current?.blocked_until > now) return false
  const reset = !current || now - current.window_started_at >= 10 * 60 * 1000
  const attempts = reset ? 1 : current.attempts + 1
  const blockedUntil = attempts > 5 ? now + 10 * 60 * 1000 : 0
  await env.DB.prepare(`INSERT INTO login_attempts (identifier, attempts, window_started_at, blocked_until)
    VALUES (?, ?, ?, ?) ON CONFLICT(identifier) DO UPDATE SET attempts = excluded.attempts,
    window_started_at = excluded.window_started_at, blocked_until = excluded.blocked_until`)
    .bind(identifier, attempts, reset ? now : current.window_started_at, blockedUntil).run()
  return attempts <= 5
}

async function handleStudentPassword(request, env, actor, pathname) {
  if (!actor || !['owner', 'reception'].includes(actor.role)) return fail('Ruxsat yo‘q.', actor ? 403 : 401)
  const reveal = pathname.match(/^\/api\/students\/([^/]+)\/password\/reveal$/)
  const change = pathname.match(/^\/api\/students\/([^/]+)\/password$/)
  const unlink = pathname.match(/^\/api\/students\/([^/]+)\/telegram\/unlink$/)
  const studentId = reveal?.[1] || change?.[1] || unlink?.[1]
  if (!studentId || request.method !== 'POST') return fail('O‘quvchi endpointi topilmadi.', 404)
  const student = await env.DB.prepare(`SELECT s.id, s.auth_user_id, s.password_ciphertext, s.password_iv,
      p.id AS profile_id, p.username, p.telegram_id
    FROM students s LEFT JOIN profiles p ON p.id = s.auth_user_id AND p.role = 'student'
    WHERE s.id = ?`).bind(studentId).first()
  if (!student) return fail('O‘quvchi topilmadi.', 404)
  if (reveal) {
    if (!(await consumePasswordRevealLimit(env, actor.id, studentId))) {
      return fail('Parolni ko‘p marta ko‘rsatdingiz. 10 daqiqadan keyin urinib ko‘ring.', 429)
    }
    if (!student.password_ciphertext || !student.password_iv) return fail('Parol saqlanmagan. Yangi parol o‘rnating.', 404)
    let password
    try { password = await decryptStudentPassword(student, env) } catch {
      throw new Error('O‘quvchi parolini ochib bo‘lmadi; STUDENT_PASSWORD_KEY noto‘g‘ri sozlangan.')
    }
    await env.DB.prepare(`INSERT INTO student_credential_audit (id, student_id, actor_id, action)
      VALUES (?, ?, ?, 'reveal')`).bind(crypto.randomUUID(), studentId, actor.id).run()
    return json({ password })
  }
  if (unlink) {
    const statements = [
      env.DB.prepare('UPDATE profiles SET telegram_id = NULL WHERE id = ?').bind(student.profile_id || ''),
      env.DB.prepare('UPDATE students SET telegram_id = NULL WHERE id = ?').bind(studentId),
      env.DB.prepare('DELETE FROM telegram_links WHERE student_id = ?').bind(studentId),
    ]
    await env.DB.batch(statements)
    return json({ data: { unlinked: true } })
  }
  let body
  try { body = await request.json() } catch { return fail('Parol noto‘g‘ri.', 400) }
  const parsed = z.object({
    password: z.string().min(6).max(128),
    username: z.string().trim().max(64).optional(),
  }).strict().safeParse(body)
  if (!parsed.success || !env.STUDENT_PASSWORD_KEY) {
    return fail(!env.STUDENT_PASSWORD_KEY ? 'O‘quvchi parolini himoyalash sozlanmagan.' : 'Parol kamida 6 belgidan iborat bo‘lishi kerak.', !env.STUDENT_PASSWORD_KEY ? 503 : 400)
  }
  const username = (parsed.data.username || student.username || await uniqueUsername(env, (await env.DB.prepare('SELECT name FROM students WHERE id = ?').bind(studentId).first())?.name || 'student')).toLowerCase()
  if (!isValidLogin(username)) return fail('Login formati noto‘g‘ri.', 400)
  const duplicate = await env.DB.prepare('SELECT 1 AS found FROM profiles WHERE username = ? COLLATE NOCASE AND id != ?')
    .bind(username, student.profile_id || '').first()
  if (duplicate) return fail('Bu login allaqachon band.', 409)
  const { hash, salt } = await hashPassword(parsed.data.password)
  const encrypted = await encryptStudentPassword(parsed.data.password, env)
  const statements = []
  let profileId = student.profile_id
  if (profileId) {
    statements.push(env.DB.prepare(`UPDATE accounts SET password_hash = ?, password_salt = ?, password_iterations = ?,
      password_reset_required = 0, session_version = session_version + 1 WHERE id = ?`)
      .bind(hash, salt, PASSWORD_ITERATIONS, profileId))
    statements.push(env.DB.prepare('UPDATE profiles SET username = ? WHERE id = ?').bind(username, profileId))
  } else {
    profileId = crypto.randomUUID()
    statements.push(env.DB.prepare(`INSERT INTO accounts
      (id, password_hash, password_salt, password_iterations, password_reset_required)
      VALUES (?, ?, ?, ?, 0)`).bind(profileId, hash, salt, PASSWORD_ITERATIONS))
    const name = await env.DB.prepare('SELECT name FROM students WHERE id = ?').bind(studentId).first()
    statements.push(env.DB.prepare(`INSERT INTO profiles (id, username, name, role, student_id)
      VALUES (?, ?, ?, 'student', ?)`).bind(profileId, username, name.name, studentId))
  }
  statements.push(env.DB.prepare(`UPDATE students SET auth_user_id = ?, login = ?,
    password_ciphertext = ?, password_iv = ? WHERE id = ?`)
    .bind(profileId, username, encrypted.password_ciphertext, encrypted.password_iv, studentId))
  statements.push(env.DB.prepare(`INSERT INTO student_credential_audit (id, student_id, actor_id, action)
    VALUES (?, ?, ?, 'change')`).bind(crypto.randomUUID(), studentId, actor.id))
  await env.DB.batch(statements)
  return json({ data: { username } })
}

async function createTelegramInvite(request, env, actor) {
  if (!canAccessEndpoint(actor.role, 'student:telegram-invite')
    && !canAccessEndpoint(actor.role, 'staff:manage')) return fail('Ruxsat yo‘q.', 403)
  const parsed = z.object({
    profileId: z.string().uuid().optional(),
    studentId: z.string().min(1).optional(),
  }).strict().refine((value) => Boolean(value.profileId || value.studentId)).safeParse(await request.json())
  if (!parsed.success) return fail('Foydalanuvchi tanlanmagan.', 400)
  let target
  if (parsed.data.studentId) {
    if (!canAccessEndpoint(actor.role, 'student:telegram-invite')) return fail('Ruxsat yo‘q.', 403)
    const student = await env.DB.prepare('SELECT id, name, auth_user_id FROM students WHERE id = ?')
      .bind(parsed.data.studentId).first()
    if (!student) return fail('O‘quvchi topilmadi.', 404)
    target = student.auth_user_id
      ? await env.DB.prepare('SELECT id, username, name, role, telegram_id FROM profiles WHERE id = ?')
        .bind(student.auth_user_id).first()
      : null
    if (!target) {
      const id = crypto.randomUUID()
      const internalUsername = `student-${crypto.randomUUID()}`
      await env.DB.batch([
        env.DB.prepare('INSERT INTO accounts (id, password_hash, password_salt, password_iterations, password_reset_required) VALUES (?, NULL, NULL, ?, 1)')
          .bind(id, PASSWORD_ITERATIONS),
        env.DB.prepare("INSERT INTO profiles (id, username, name, role, student_id) VALUES (?, ?, ?, 'student', ?)")
          .bind(id, internalUsername, student.name, student.id),
        env.DB.prepare('UPDATE students SET auth_user_id = ? WHERE id = ?').bind(id, student.id),
      ])
      target = { id, username: internalUsername, name: student.name, role: 'student', telegram_id: null }
    }
  } else {
    target = await env.DB.prepare('SELECT id, username, name, role, telegram_id FROM profiles WHERE id = ?')
      .bind(parsed.data.profileId).first()
  }
  if (!target) return fail('Foydalanuvchi topilmadi.', 404)
  if (actor.role === 'reception' && target.role !== 'student') {
    return fail('Qabulxona faqat o‘quvchi uchun ulash havolasi yaratishi mumkin.', 403)
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
  const staff = ['reception', 'owner'].includes(target.role)
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
  if (parsed.data.staff !== ['reception', 'owner'].includes(invite.role)) {
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
  const rows = await env.DB.prepare(`SELECT h.id, h.title, h.due_at, hs.status, hs.state
    FROM homework h JOIN group_students gs ON gs.group_id = h.group_id
    LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = gs.student_id
      AND hs.attempt_number = (
        SELECT MAX(latest.attempt_number) FROM homework_submissions latest
        WHERE latest.homework_id = h.id AND latest.student_id = gs.student_id
      )
    WHERE gs.student_id = ? AND (hs.id IS NULL OR hs.state = 'draft' OR hs.status = 'rejected')
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
    .bind(parsed.data.chat_id, parsed.data.homework_id, Date.now() + 24 * 60 * 60 * 1000).run()
  const link = await env.DB.prepare('SELECT student_id FROM telegram_links WHERE chat_id = ?')
    .bind(parsed.data.chat_id).first()
  const draft = link && await findOrCreateHomeworkDraft(env, parsed.data.homework_id, link.student_id)
  if (!draft || draft.error) return draft?.error || fail('Telegram akkaunt ulanmagan.', 404)
  return json({ data: { id: draft.submission.id, title: draft.homework.title } })
}

async function handleRpc(request, env, actor, name) {
  const args = await request.json()
  if (name === 'lookup_login_email') {
    if (!canAccessEndpoint(actor.role, 'staff:manage')) return json({ data: null, error: { message: 'forbidden' } }, 403)
    const username = normalizeLogin(args.p_login)
    const profile = await env.DB.prepare('SELECT username FROM profiles WHERE username = ? COLLATE NOCASE').bind(username).first()
    return json({ data: profile ? `${profile.username}@kamol.school` : null, error: null })
  }
  if (name === 'staff_set_user_password') {
    if (!canAccessEndpoint(actor.role, 'staff:manage')) return json({ data: null, error: { message: 'forbidden' } }, 403)
    const parsed = z.object({
      new_password: z.string().min(12).max(128),
      target_user: z.string().uuid(),
    }).safeParse(args)
    if (!parsed.success) return json({ data: null, error: { message: 'invalid password or user id' } }, 400)
    const target = await env.DB.prepare('SELECT role FROM profiles WHERE id = ?').bind(parsed.data.target_user).first()
    if (!target || !['reception', 'teacher'].includes(target.role)) {
      return json({ data: null, error: { message: 'forbidden or user not found' } }, 403)
    }
    const password = parsed.data.new_password
    const { hash, salt } = await hashPassword(password)
    await env.DB.prepare(`UPDATE accounts SET password_hash = ?, password_salt = ?,
      password_iterations = ?, password_reset_required = 1, session_version = session_version + 1
      WHERE id = ?`).bind(hash, salt, PASSWORD_ITERATIONS, parsed.data.target_user).run()
    return json({ data: null, error: null })
  }
  if (name === 'staff_set_user_active') {
    if (!canAccessEndpoint(actor.role, 'staff:manage')) return json({ data: null, error: { message: 'forbidden' } }, 403)
    const parsed = z.object({ target_user: z.string().uuid(), is_active: z.boolean() }).strict().safeParse(args)
    if (!parsed.success) return json({ data: null, error: { message: 'invalid account or status' } }, 400)
    const target = await env.DB.prepare('SELECT role FROM profiles WHERE id = ?')
      .bind(parsed.data.target_user).first()
    if (!target || target.role !== 'reception') return json({ data: null, error: { message: 'forbidden or user not found' } }, 403)
    await env.DB.prepare('UPDATE accounts SET is_active = ?, session_version = session_version + 1 WHERE id = ?')
      .bind(Number(parsed.data.is_active), parsed.data.target_user).run()
    return json({ data: null, error: null })
  }
  if (name === 'staff_update_reception_profile') {
    if (!canAccessEndpoint(actor.role, 'staff:manage')) return json({ data: null, error: { message: 'forbidden' } }, 403)
    const parsed = z.object({
      target_user: z.string().uuid(),
      name: z.string().trim().min(2).max(128),
      username: z.string().trim().min(2).max(128).regex(/^[a-zA-Z0-9._-]+$/),
    }).strict().safeParse(args)
    if (!parsed.success) return json({ data: null, error: { message: 'invalid account data' } }, 400)
    const target = await env.DB.prepare('SELECT role FROM profiles WHERE id = ?')
      .bind(parsed.data.target_user).first()
    if (!target || target.role !== 'reception') return json({ data: null, error: { message: 'forbidden or user not found' } }, 403)
    const duplicate = await env.DB.prepare('SELECT id FROM profiles WHERE username = ? COLLATE NOCASE AND id != ?')
      .bind(parsed.data.username, parsed.data.target_user).first()
    if (duplicate) return json({ data: null, error: { message: 'username already exists' } }, 409)
    await env.DB.prepare('UPDATE profiles SET name = ?, username = ? WHERE id = ?')
      .bind(parsed.data.name, parsed.data.username, parsed.data.target_user).run()
    return json({ data: null, error: null })
  }
  return json({ data: null, error: { message: 'RPC not found' } }, 404)
}

async function handleDatabase(request, env, profile, service) {
  let payload
  try { payload = await request.json() } catch { return fail('Invalid database request.') }
  const parsed = DatabaseSchema.safeParse(payload)
  if (!parsed.success) return fail('Invalid database request.')
  const body = parsed.data
  if (!TABLES.has(body.table)) return fail('Unknown table.')
  if (profile?.password_reset_required && profile.auth_method !== 'telegram') {
    return fail('Davom etish uchun parolni yangilang.', 403)
  }
  if (body.table === 'staff_codes' && !service && !canAccessEndpoint(profile?.role, 'data:staff-wide-read')) return fail('Access denied.', 403)
  if (body.table === 'telegram_links' && !service && !canAccessEndpoint(profile?.role, 'data:staff-wide-read')) return fail('Access denied.', 403)
  if (!service && !profile) return fail('Login required.', 401)
  const action = body.action || 'select'
  if (!service && !canAccessTable(profile, body.table, action)) return fail('Access denied.', 403)
  if (body.table === 'payments' && action === 'delete') {
    return fail('To‘lovni o‘chirish mumkin emas. Bekor qilish uchun maxsus amalni ishlating.', 405)
  }
  if (body.table === 'students' && action !== 'select') {
    return fail('Use the explicit student account endpoint.', 405)
  }
  if (body.table === 'groups' && action === 'update' && body.values
    && (Object.hasOwn(body.values, 'schedule') || Object.hasOwn(body.values, 'teacher_id'))) {
    return fail('Jadval yoki o‘qituvchini jadval o‘zgarishi orqali yangilang.', 405)
  }
  try {
    if (!body.action || body.action === 'select') {
      const rows = await selectRows(env, profile, body, service)
      const data = body.maybeSingle ? rows[0] ?? null : rows
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

async function addHomeworkEvent(env, submission, eventType, actorId, details = {}) {
  await env.DB.prepare(`INSERT INTO homework_events
    (id, homework_id, submission_id, student_id, actor_id, event_type, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), submission.homework_id, submission.id, submission.student_id,
      actorId || null, eventType, JSON.stringify(details)).run()
}

async function findOrCreateHomeworkDraft(env, homeworkId, studentId, actorId = null) {
  const homework = await env.DB.prepare('SELECT * FROM homework WHERE id = ?').bind(homeworkId).first()
  if (!homework) return { error: fail('Uy vazifasi topilmadi.', 404) }
  const member = await env.DB.prepare('SELECT 1 AS found FROM group_students WHERE group_id = ? AND student_id = ?')
    .bind(homework.group_id, studentId).first()
  if (!member) return { error: fail('Uy vazifasi sizga biriktirilmagan.', 403) }
  let submission = await env.DB.prepare(`SELECT * FROM homework_submissions
    WHERE homework_id = ? AND student_id = ? AND state = 'draft'
    ORDER BY attempt_number DESC LIMIT 1`).bind(homeworkId, studentId).first()
  if (!submission) {
    const latest = await env.DB.prepare(`SELECT COALESCE(MAX(attempt_number), 0) AS attempt
      FROM homework_submissions WHERE homework_id = ? AND student_id = ?`)
      .bind(homeworkId, studentId).first()
    submission = {
      id: crypto.randomUUID(),
      homework_id: homeworkId,
      student_id: studentId,
      attempt_number: Number(latest?.attempt || 0) + 1,
      text_answer: '',
      content_text: '',
    }
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000
    try {
      await env.DB.prepare(`INSERT INTO homework_submissions
        (id, homework_id, student_id, attempt_number, state, status, expires_at)
        VALUES (?, ?, ?, ?, 'draft', 'pending', ?)`)
        .bind(submission.id, homeworkId, studentId, submission.attempt_number, expiresAt).run()
    } catch (error) {
      if (!/unique constraint/i.test(error instanceof Error ? error.message : '')) throw error
      const concurrentDraft = await env.DB.prepare(`SELECT * FROM homework_submissions
        WHERE homework_id = ? AND student_id = ? AND state = 'draft' ORDER BY attempt_number DESC LIMIT 1`)
        .bind(homeworkId, studentId).first()
      if (!concurrentDraft) throw error
      submission = concurrentDraft
      const files = await env.DB.prepare(`SELECT id, kind, r2_key, original_name, mime_type,
        size_bytes, duration_seconds, created_at FROM homework_submission_files
        WHERE submission_id = ? ORDER BY created_at, id`).bind(submission.id).all()
      return { submission: { ...submission, files: files.results || [] }, homework }
    }
    await addHomeworkEvent(env, submission, 'draft_created', actorId, { expires_at: expiresAt })
    if (submission.attempt_number > 1) {
      await addHomeworkEvent(env, submission, 'resubmitted', actorId, { attempt_number: submission.attempt_number })
    }
  }
  const files = await env.DB.prepare(`SELECT id, kind, r2_key, original_name, mime_type,
    size_bytes, duration_seconds, created_at FROM homework_submission_files
    WHERE submission_id = ? ORDER BY created_at, id`).bind(submission.id).all()
  return { submission: { ...submission, files: files.results || [] }, homework }
}

async function createStudentDraft(request, env, profile) {
  if (profile.role !== 'student' || profile.auth_method !== 'telegram' || !profile.student_id) {
    return fail('Access denied.', 403)
  }
  const parsed = z.object({
    homework_id: z.string().min(1).max(128),
    text: z.string().max(20000).optional(),
  }).strict().safeParse(await request.json())
  if (!parsed.success) return fail('Uy vazifasi ma’lumoti noto‘g‘ri.', 400)
  const result = await findOrCreateHomeworkDraft(env, parsed.data.homework_id, profile.student_id, profile.id)
  if (result.error) return result.error
  const text = parsed.data.text?.trim()
  if (text && text !== result.submission.content_text) {
    await env.DB.prepare(`UPDATE homework_submissions SET content_text = ?, text_answer = ?
      WHERE id = ? AND state = 'draft'`)
      .bind(text, text, result.submission.id).run()
    await addHomeworkEvent(env, result.submission, 'file_added', profile.id, { kind: 'text', length: text.length })
    result.submission.content_text = text
    result.submission.text_answer = text
  }
  return json({ data: result.submission }, 201)
}

async function uploadHomeworkDraftFile(request, env, profile) {
  if (profile.role !== 'student' || profile.auth_method !== 'telegram' || !profile.student_id) {
    return fail('Access denied.', 403)
  }
  if (!env.FILES) return fail('R2 binding is not configured.', 503)
  const form = await request.formData()
  const submissionId = String(form.get('submission_id') || '')
  const file = form.get('file')
  if (!(file instanceof File) || file.size <= 0 || file.size > 100 * 1024 * 1024) {
    return fail('Har bir fayl 100 MB dan kichik bo‘lishi kerak.', 413)
  }
  const submission = await env.DB.prepare(`SELECT * FROM homework_submissions
    WHERE id = ? AND student_id = ? AND state = 'draft'`)
    .bind(submissionId, profile.student_id).first()
  if (!submission || (submission.expires_at && submission.expires_at <= Date.now())) {
    return fail('Draft topilmadi yoki muddati tugagan.', 404)
  }
  const key = `homework/${crypto.randomUUID()}`
  const originalName = String(file.name || 'fayl').replace(/[\r\n]/g, '_').slice(0, 180)
  const metadata = {
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: { originalName, uploaderId: profile.id },
  }
  if (typeof globalThis.FixedLengthStream === 'function') {
    const fixedLength = new globalThis.FixedLengthStream(file.size)
    const upload = env.FILES.put(key, fixedLength.readable, metadata)
    await file.stream().pipeTo(fixedLength.writable)
    await upload
  } else {
    await env.FILES.put(key, await file.arrayBuffer(), metadata)
  }
  const fileId = crypto.randomUUID()
  await env.DB.prepare(`INSERT INTO homework_submission_files
    (id, submission_id, kind, r2_key, original_name, mime_type, size_bytes)
    VALUES (?, ?, 'attachment', ?, ?, ?, ?)`)
    .bind(fileId, submission.id, key, originalName, file.type || 'application/octet-stream', file.size).run()
  await addHomeworkEvent(env, submission, 'file_added', profile.id, {
    file_id: fileId, name: originalName, size_bytes: file.size,
  })
  return json({ data: { id: fileId, name: originalName, size_bytes: file.size } }, 201)
}

async function uploadHomeworkDraftProof(request, env, profile) {
  if (profile.role !== 'student' || profile.auth_method !== 'telegram' || !profile.student_id) {
    return fail('Access denied.', 403)
  }
  if (!env.FILES) return fail('R2 binding is not configured.', 503)
  const form = await request.formData()
  const submissionId = String(form.get('submission_id') || '')
  const file = form.get('file')
  const duration = Number(form.get('duration_seconds') || 0)
  if (!(file instanceof File) || file.size <= 0 || file.size > 20 * 1024 * 1024
    || !String(file.type || '').toLowerCase().startsWith('audio/')) {
    return fail('Ovozli proof 20 MB dan kichik audio fayl bo‘lishi kerak.', 413)
  }
  if (!Number.isFinite(duration) || duration < 3 || duration > 600) {
    return fail('Ovozli proof kamida 3 soniya bo‘lishi kerak.', 400)
  }
  const submission = await env.DB.prepare(`SELECT * FROM homework_submissions
    WHERE id = ? AND student_id = ? AND state = 'draft'`)
    .bind(submissionId, profile.student_id).first()
  if (!submission || (submission.expires_at && submission.expires_at <= Date.now())) {
    return fail('Draft topilmadi yoki muddati tugagan.', 404)
  }
  const existingProof = await env.DB.prepare(`SELECT id FROM homework_submission_files
    WHERE submission_id = ? AND kind IN ('voice', 'video_note')`).bind(submission.id).first()
  if (existingProof) return fail('Bu draft uchun proof allaqachon qo‘shilgan.', 409)
  const key = `homework/${crypto.randomUUID()}`
  const originalName = String(file.name || 'ovozli-proof').replace(/[\r\n]/g, '_').slice(0, 180)
  await env.FILES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: { originalName, uploaderId: profile.id },
  })
  const fileId = crypto.randomUUID()
  await env.DB.prepare(`INSERT INTO homework_submission_files
    (id, submission_id, kind, r2_key, original_name, mime_type, size_bytes, duration_seconds)
    VALUES (?, ?, 'voice', ?, ?, ?, ?, ?)`)
    .bind(fileId, submission.id, key, originalName, file.type || 'application/octet-stream', file.size, duration).run()
  await addHomeworkEvent(env, submission, 'proof_added', profile.id, {
    file_id: fileId, kind: 'voice', name: originalName, size_bytes: file.size, duration_seconds: duration,
  })
  return json({ data: { id: fileId, kind: 'voice', name: originalName, duration_seconds: duration } }, 201)
}

async function confirmHomeworkDraft(env, submission, actorId) {
  if (submission.state !== 'draft') return fail('Draft allaqachon yuborilgan yoki yopilgan.', 409)
  if (submission.expires_at && submission.expires_at <= Date.now()) return fail('Draft muddati tugagan.', 410)
  const files = await env.DB.prepare(`SELECT kind, duration_seconds FROM homework_submission_files WHERE submission_id = ?`)
    .bind(submission.id).all()
  const rows = files.results || []
  const proofs = rows.filter((file) => file.kind === 'voice' || file.kind === 'video_note')
  const proofCount = proofs.length
  const hasAttachment = rows.some((file) => file.kind === 'attachment')
  if (proofCount !== 1 || Number(proofs[0]?.duration_seconds || 0) < 3
    || (!hasAttachment && !String(submission.content_text || '').trim())) {
    return fail('Topshirish uchun kamida bitta fayl yoki matn va aynan bitta kamida 3 soniyalik ovozli xabar yoki dumaloq video kerak.', 400)
  }
  const submittedAt = new Date().toISOString()
  await env.DB.prepare(`UPDATE homework_submissions SET state = 'submitted', status = 'pending',
    submitted_at = ?, expires_at = NULL WHERE id = ? AND state = 'draft'`)
    .bind(submittedAt, submission.id).run()
  await addHomeworkEvent(env, submission, 'submitted', actorId, {
    submitted_at: submittedAt,
    attempt_number: submission.attempt_number,
  })
  await notifyTeacherOfSubmission(env, submission, submittedAt)
  return json({ data: { id: submission.id, state: 'submitted', submitted_at: submittedAt } })
}

export function formatTashkentDateTime(value) {
  const date = new Date(value)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tashkent',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]))
  return `${values.day}.${values.month}.${values.year} ${values.hour}:${values.minute}`
}

export function buildHomeworkNotificationText({ studentName, groupName, homeworkTitle, submittedAt, dueAt, attachments, proofKind }) {
  const due = new Date(dueAt || '')
  const sent = new Date(submittedAt)
  const isLate = Number.isFinite(due.getTime()) && sent > due
  const lateMinutes = isLate ? Math.ceil((sent.getTime() - due.getTime()) / 60000) : 0
  const lateness = lateMinutes >= 1440
    ? `${Math.floor(lateMinutes / 1440)} kun ${Math.floor((lateMinutes % 1440) / 60)} soat`
    : lateMinutes >= 60 ? `${Math.floor(lateMinutes / 60)} soat ${lateMinutes % 60} daqiqa` : `${lateMinutes} daqiqa`
  const fileNames = attachments.length ? attachments.map((file) => file.original_name).join(', ') : 'Ilova fayli yo‘q'
  return [
    'Yangi uy vazifasi topshirildi.',
    `O‘quvchi: ${studentName || 'O‘quvchi'}`,
    `Guruh: ${groupName || '—'}`,
    `Vazifa: ${homeworkTitle || 'Uy vazifasi'}`,
    `Vaqt: ${formatTashkentDateTime(submittedAt)} (Asia/Tashkent)`,
    isLate ? `Kechikdi: ${lateness}` : 'O‘z vaqtida topshirildi.',
    `Fayllar: ${attachments.length}; ${fileNames}`,
    `Proof: ${proofKind === 'video_note' ? 'dumaloq video' : 'ovozli xabar'}`,
  ].join('\n')
}

async function notifyTeacherOfSubmission(env, submission, submittedAt) {
  if (!env.TELEGRAM_BOT_TOKEN) return
  try {
    const [homework, student, files] = await Promise.all([
      env.DB.prepare(`SELECT h.*, g.name AS group_name FROM homework h
        LEFT JOIN groups g ON g.id = h.group_id WHERE h.id = ?`).bind(submission.homework_id).first(),
      env.DB.prepare('SELECT name FROM students WHERE id = ?').bind(submission.student_id).first(),
      env.DB.prepare(`SELECT kind, original_name, telegram_file_id, telegram_chat_id, telegram_message_id FROM homework_submission_files
        WHERE submission_id = ? ORDER BY created_at, id`).bind(submission.id).all(),
    ])
    const teachers = await env.DB.prepare(`SELECT telegram_id FROM profiles
      WHERE role = 'teacher' AND teacher_id = ? AND telegram_id IS NOT NULL`)
      .bind(homework?.teacher_id || '').all()
    if (!teachers.results?.length) return
    const fileRows = files.results || []
    const proof = fileRows.find((file) => file.kind === 'voice' || file.kind === 'video_note')
    const attachmentRows = fileRows.filter((file) => file.kind === 'attachment')
    const bot = getWorkerBot(env, env.TELEGRAM_WEBAPP_URL ? new URL(env.TELEGRAM_WEBAPP_URL).origin : 'https://localhost')
    const appUrl = new URL(env.TELEGRAM_WEBAPP_URL || 'https://localhost/miniapp.html')
    appUrl.searchParams.set('review', submission.id)
    const text = buildHomeworkNotificationText({
      studentName: student?.name,
      groupName: homework?.group_name,
      homeworkTitle: homework?.title,
      submittedAt,
      dueAt: homework?.due_at || homework?.deadline,
      attachments: attachmentRows,
      proofKind: proof?.kind,
    })
    for (const { telegram_id: chatId } of teachers.results) {
      await bot.api.sendMessage(chatId, text, {
        reply_markup: { inline_keyboard: [[{ text: 'Ilovada ochish', url: appUrl.toString() }]] },
      })
      if (proof?.telegram_chat_id && proof.telegram_message_id) {
        await bot.api.copyMessage(chatId, proof.telegram_chat_id, proof.telegram_message_id)
      } else if (proof?.telegram_file_id) {
        if (proof.kind === 'video_note') await bot.api.sendVideoNote(chatId, proof.telegram_file_id)
        else await bot.api.sendVoice(chatId, proof.telegram_file_id)
      }
    }
  } catch (error) {
    console.error('Teacher homework notification failed', error instanceof Error ? error.name : 'UnknownError')
  }
}

async function getStudentMiniAppOverview(request, env, profile) {
  if (profile.role !== 'student' || profile.auth_method !== 'telegram' || !profile.student_id
    || !canAccessEndpoint(profile.role, 'miniapp:student')) {
    return fail('Access denied.', 403)
  }
  const rows = await env.DB.prepare(`SELECT h.id, h.group_id, h.teacher_id, h.title, h.description,
      h.file_url, h.due_at, g.name AS group_name, s.id AS submission_id,
      s.attempt_number, s.content_text, s.status, s.state, s.student_result,
      s.student_reason, s.teacher_result, s.feedback, s.submitted_at, s.created_at
    FROM homework h
    JOIN groups g ON g.id = h.group_id
    JOIN group_students gs ON gs.group_id = h.group_id
    LEFT JOIN homework_submissions s ON s.homework_id = h.id AND s.student_id = gs.student_id
      AND s.attempt_number = (
        SELECT MAX(latest.attempt_number) FROM homework_submissions latest
        WHERE latest.homework_id = h.id AND latest.student_id = gs.student_id
      )
    WHERE gs.student_id = ? ORDER BY h.due_at, h.created_at DESC LIMIT 200`)
    .bind(profile.student_id).all()
  const homeworks = await Promise.all((rows.results || []).map(async (row) => {
    let submission = null
    if (row.submission_id) {
      const files = await env.DB.prepare(`SELECT id, kind, r2_key, original_name, mime_type,
        size_bytes, duration_seconds, created_at FROM homework_submission_files
        WHERE submission_id = ? ORDER BY created_at, id`).bind(row.submission_id).all()
      submission = {
        id: row.submission_id,
        homework_id: row.id,
        attempt_number: row.attempt_number,
        content_text: row.content_text,
        status: row.status,
        state: row.state,
        student_result: row.student_result,
        student_reason: row.student_reason,
        teacher_result: row.teacher_result,
        feedback: row.feedback,
        submitted_at: row.submitted_at,
        created_at: row.created_at,
        files: await Promise.all((files.results || []).map(async (file) => ({
          ...file,
          download_url: await signFileUrl(env, new URL(request.url).origin, file.r2_key),
        }))),
      }
    }
    return {
      id: row.id,
      group_id: row.group_id,
      teacher_id: row.teacher_id,
      title: row.title,
      description: row.description,
      file_url: row.file_url,
      due_at: row.due_at,
      groups: { name: row.group_name },
      submission,
    }
  }))
  const [paymentRows, attendanceRows, groupRows] = await Promise.all([
    env.DB.prepare(`SELECT id, student_id, student_name, amount, month, year, paid_at
      FROM payments WHERE student_id = ? ORDER BY paid_at DESC LIMIT 100`).bind(profile.student_id).all(),
    env.DB.prepare(`SELECT a.id, a.student_id, a.group_id, a.date, a.status, a.note, g.name AS group_name
      FROM attendance a LEFT JOIN groups g ON g.id = a.group_id
      WHERE a.student_id = ? ORDER BY a.date DESC LIMIT 100`).bind(profile.student_id).all(),
    env.DB.prepare(`SELECT g.id, g.name, g.teacher_id, g.schedule
      FROM groups g JOIN group_students gs ON gs.group_id = g.id
      WHERE gs.student_id = ? ORDER BY g.name`).bind(profile.student_id).all(),
  ])
  const scheduleState = await loadScheduleState(env, (groupRows.results || []).map((group) => group.id))
  return json({
    data: {
      homeworks,
      payments: paymentRows.results || [],
      attendance: (attendanceRows.results || []).map(({ group_name, ...attendance }) => ({
        ...attendance,
        groups: { name: group_name },
      })),
      groups: (groupRows.results || []).map((group) => ({
        ...group,
        schedule: JSON.parse(group.schedule || '[]'),
        scheduleVersions: scheduleState.versions.filter((version) => version.group_id === group.id),
        scheduleOverrides: scheduleState.overrides.filter((override) => override.group_id === group.id),
      })),
    },
  })
}

async function handleHomeworkRoutes(request, env, profile, pathname) {
  if (!profile) return fail('Login required.', 401)
  if (profile.role === 'student' && profile.auth_method !== 'telegram') return fail('Access denied.', 403)
  if (pathname === '/api/homework/student' && request.method === 'GET') {
    if (profile.role !== 'student' || !profile.student_id) return fail('Access denied.', 403)
    const rows = await env.DB.prepare(`SELECT s.* FROM homework_submissions s
      WHERE s.student_id = ? AND s.attempt_number = (
        SELECT MAX(latest.attempt_number) FROM homework_submissions latest
        WHERE latest.homework_id = s.homework_id AND latest.student_id = s.student_id
      )`).bind(profile.student_id).all()
    const submissions = await Promise.all((rows.results || []).map(async (submission) => {
      const files = await env.DB.prepare(`SELECT id, kind, r2_key, original_name, mime_type,
        size_bytes, duration_seconds, created_at FROM homework_submission_files
        WHERE submission_id = ? ORDER BY created_at, id`).bind(submission.id).all()
      return {
        ...submission,
        files: await Promise.all((files.results || []).map(async (file) => ({
          ...file,
          download_url: await signFileUrl(env, new URL(request.url).origin, file.r2_key),
        }))),
      }
    }))
    return json({ data: submissions })
  }
  if (pathname === '/api/homework/draft' && request.method === 'POST') {
    return createStudentDraft(request, env, profile)
  }
  if (pathname === '/api/homework/draft/file' && request.method === 'POST') {
    return uploadHomeworkDraftFile(request, env, profile)
  }
  if (pathname === '/api/homework/draft/proof' && request.method === 'POST') {
    return uploadHomeworkDraftProof(request, env, profile)
  }
  if (pathname === '/api/homework/draft/confirm' && request.method === 'POST') {
    if (profile.role !== 'student' || !profile.student_id) return fail('Access denied.', 403)
    const parsed = z.object({ submission_id: z.string().min(1).max(128) }).strict().safeParse(await request.json())
    if (!parsed.success) return fail('Draft ma’lumoti noto‘g‘ri.', 400)
    const submission = await env.DB.prepare(`SELECT * FROM homework_submissions
      WHERE id = ? AND student_id = ?`).bind(parsed.data.submission_id, profile.student_id).first()
    if (!submission) return fail('Draft topilmadi.', 404)
    return confirmHomeworkDraft(env, submission, profile.id)
  }
  if (pathname === '/api/homework/declaration' && request.method === 'POST') {
    if (profile.role !== 'student' || !profile.student_id) return fail('Access denied.', 403)
    const parsed = z.object({
      submission_id: z.string().min(1).max(128),
      result: z.enum(['done', 'not_done']),
      reason: z.string().max(2000).optional(),
    }).strict().safeParse(await request.json())
    if (!parsed.success) return fail('Natija ma’lumoti noto‘g‘ri.', 400)
    const submission = await env.DB.prepare(`SELECT * FROM homework_submissions
      WHERE id = ? AND student_id = ? AND state IN ('submitted', 'checked')`)
      .bind(parsed.data.submission_id, profile.student_id).first()
    if (!submission) return fail('Avval to‘liq topshiriqni yuboring.', 409)
    await env.DB.prepare(`UPDATE homework_submissions SET student_result = ?, student_reason = ?
      WHERE id = ?`).bind(parsed.data.result, parsed.data.reason?.trim() || '', submission.id).run()
    await addHomeworkEvent(env, submission, parsed.data.result === 'done' ? 'student_done' : 'student_not_done',
      profile.id, { reason: parsed.data.reason?.trim() || '' })
    return json({ data: true })
  }
  if (pathname === '/api/homework/history' && request.method === 'GET') {
    if (!['owner', 'reception', 'teacher', 'student'].includes(profile.role)) return fail('Access denied.', 403)
    const url = new URL(request.url)
    const homeworkId = url.searchParams.get('homework_id')
    const studentId = profile.role === 'student' ? profile.student_id : url.searchParams.get('student_id')
    if (!homeworkId && !studentId) return fail('Vazifa yoki o‘quvchi tanlanishi kerak.', 400)
    if (profile.role === 'teacher' && !homeworkId) return fail('O‘z guruhingizdagi vazifani tanlang.', 400)
    if (homeworkId) {
      const homework = await env.DB.prepare('SELECT * FROM homework WHERE id = ?').bind(homeworkId).first()
      if (!homework || !(await canRead(env, profile, 'homework', homework))) return fail('Access denied.', 403)
    }
    if (profile.role === 'student' && studentId !== profile.student_id) return fail('Access denied.', 403)
    const clauses = []
    const values = []
    if (homeworkId) { clauses.push('homework_id = ?'); values.push(homeworkId) }
    if (studentId) { clauses.push('student_id = ?'); values.push(studentId) }
    const rows = await env.DB.prepare(`SELECT * FROM homework_events WHERE ${clauses.join(' AND ')} ORDER BY created_at, rowid LIMIT 1000`)
      .bind(...values).all()
    const submissionRows = homeworkId
      ? await env.DB.prepare(`SELECT s.*, st.name AS student_name FROM homework_submissions s
        JOIN students st ON st.id = s.student_id WHERE s.homework_id = ?
        ${studentId ? 'AND s.student_id = ?' : ''}
        ORDER BY s.attempt_number DESC LIMIT 500`)
        .bind(...(studentId ? [homeworkId, studentId] : [homeworkId])).all()
      : { results: [] }
    const submissions = await Promise.all((submissionRows.results || []).map(async (submission) => {
      const files = await env.DB.prepare(`SELECT id, kind, original_name, mime_type,
        size_bytes, duration_seconds, r2_key FROM homework_submission_files
        WHERE submission_id = ? ORDER BY created_at, id`).bind(submission.id).all()
      return {
        ...submission,
        files: await Promise.all((files.results || []).map(async (file) => ({
          ...file,
          download_url: await signFileUrl(env, new URL(request.url).origin, file.r2_key),
        }))),
      }
    }))
    return json({ data: { events: rows.results || [], submissions } })
  }
  if (pathname === '/api/homework/review' && request.method === 'GET') {
    if (!['owner', 'reception', 'teacher'].includes(profile.role)) return fail('Access denied.', 403)
    if (profile.role === 'reception' && !canAccessEndpoint(profile.role, 'homework:read')) return fail('Access denied.', 403)
    if (profile.role === 'teacher' && !canAccessEndpoint(profile.role, 'homework:read-write')) return fail('Access denied.', 403)
    const url = new URL(request.url)
    const homeworkId = url.searchParams.get('homework_id')
    const homeworkRows = homeworkId
      ? await env.DB.prepare('SELECT * FROM homework WHERE id = ?').bind(homeworkId).all()
      : await env.DB.prepare('SELECT * FROM homework ORDER BY due_at DESC LIMIT 200').all()
    const submissions = []
    const notSubmitted = []
    for (const homework of homeworkRows.results || []) {
      if (!(await canRead(env, profile, 'homework', homework))) continue
      const submittedRows = await env.DB.prepare(`SELECT s.*, st.name AS student_name
        FROM homework_submissions s JOIN students st ON st.id = s.student_id
        WHERE s.homework_id = ? AND s.state IN ('submitted', 'checked')
        ORDER BY s.submitted_at DESC`).bind(homework.id).all()
      for (const submission of submittedRows.results || []) {
        const files = await env.DB.prepare(`SELECT id, kind, r2_key, original_name, mime_type,
          size_bytes, duration_seconds, created_at FROM homework_submission_files
          WHERE submission_id = ? ORDER BY created_at, id`).bind(submission.id).all()
        const safeFiles = await Promise.all((files.results || []).map(async (file) => ({
          ...file,
          download_url: await signFileUrl(env, new URL(request.url).origin, file.r2_key),
        })))
        submissions.push({ ...submission, homework_title: homework.title, group_id: homework.group_id, files: safeFiles })
      }
      const missing = await env.DB.prepare(`SELECT st.id, st.name FROM group_students gs
        JOIN students st ON st.id = gs.student_id
        WHERE gs.group_id = ? AND NOT EXISTS (
          SELECT 1 FROM homework_submissions s WHERE s.homework_id = ? AND s.student_id = gs.student_id
            AND s.state IN ('submitted', 'checked')
        )`).bind(homework.group_id, homework.id).all()
      for (const student of missing.results || []) {
        notSubmitted.push({ ...student, homework_id: homework.id, homework_title: homework.title })
      }
    }
    return json({ data: { submissions, not_submitted: notSubmitted } })
  }
  if (pathname === '/api/homework/review' && request.method === 'POST') {
    if (!['owner', 'teacher'].includes(profile.role)) return fail('Access denied.', 403)
    const parsed = z.object({
      submission_id: z.string().min(1).max(128),
      result: z.enum(['done', 'not_done']),
      comment: z.string().max(2000).optional(),
    }).strict().safeParse(await request.json())
    if (!parsed.success) return fail('Tekshiruv ma’lumoti noto‘g‘ri.', 400)
    const submission = await env.DB.prepare(`SELECT * FROM homework_submissions
      WHERE id = ? AND state IN ('submitted', 'checked')`).bind(parsed.data.submission_id).first()
    if (!submission || !(await canRead(env, profile, 'homework_submissions', submission))) {
      return fail('Topshiriq topilmadi yoki ruxsat yo‘q.', 403)
    }
    const eventType = parsed.data.result === 'done' ? 'teacher_done' : 'teacher_not_done'
    const comment = parsed.data.comment?.trim() || ''
    const nextStatus = parsed.data.result === 'done' ? 'approved' : 'rejected'
    const reviewedAt = new Date().toISOString()
    await env.DB.batch([
      env.DB.prepare(`UPDATE homework_submissions SET teacher_result = ?, review_note = ?,
        feedback = ?, reviewed_by = ?, reviewed_at = ?, state = 'checked',
        status = ? WHERE id = ?`)
        .bind(parsed.data.result, comment, comment, profile.id, reviewedAt, nextStatus, submission.id),
      env.DB.prepare(`INSERT INTO homework_review_history
        (id, submission_id, homework_id, student_id, reviewer_id, reviewer_name,
          old_status, new_status, old_comment, new_comment, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), submission.id, submission.homework_id, submission.student_id,
          profile.id, profile.name || '', submission.status, nextStatus, submission.feedback || '', comment, reviewedAt),
    ])
    await addHomeworkEvent(env, submission, eventType, profile.id, {
      result: parsed.data.result, comment,
    })
    if (comment) {
      await addHomeworkEvent(env, submission, 'comment', profile.id, { comment })
    }
    return json({ data: true })
  }
  return fail('Not found.', 404)
}

async function notifyQuestionReceivers(env, origin, studentId, text) {
  const recipients = await env.DB.prepare(`SELECT telegram_id FROM profiles
    WHERE role IN ('owner', 'reception') AND telegram_id IS NOT NULL`).all()
  let notificationFailed = false
  if ((recipients.results || []).length && env.TELEGRAM_BOT_TOKEN) {
    try {
      const student = await env.DB.prepare('SELECT name FROM students WHERE id = ?').bind(studentId).first()
      const bot = getWorkerBot(env, origin)
      for (const recipient of recipients.results) {
        await bot.api.sendMessage(recipient.telegram_id,
          `Yangi savol keldi.\nO‘quvchi: ${student?.name || 'O‘quvchi'}\nMatn: ${text.slice(0, 1000)}`)
      }
    } catch (error) {
      notificationFailed = true
      console.error('Reception question notification failed', error instanceof Error ? error.name : 'UnknownError')
    }
  } else if ((recipients.results || []).length) {
    notificationFailed = true
  }
  return notificationFailed
}

async function createQuestion(request, env, profile) {
  if (!canAccessEndpoint(profile.role, 'questions:create') || profile.role !== 'student'
    || profile.auth_method !== 'telegram' || !profile.student_id) {
    return fail('Access denied.', 403)
  }
  let text
  let groupId
  let file = null
  if (request.headers.get('Content-Type')?.includes('multipart/form-data')) {
    const form = await request.formData()
    text = String(form.get('text') || '').trim()
    groupId = String(form.get('group_id') || '')
    const value = form.get('file')
    if (value instanceof File && value.size > 0) file = value
  } else {
    const parsed = z.object({
      text: z.string().trim().min(1).max(10000),
      group_id: z.string().max(128).optional(),
    }).strict().safeParse(await request.json())
    if (!parsed.success) return fail('Savol matnini kiriting.', 400)
    text = parsed.data.text
    groupId = parsed.data.group_id || ''
  }
  if (!text || text.length > 10000) return fail('Savol matnini kiriting.', 400)
  if (file && file.size > 20 * 1024 * 1024) return fail('Savol fayli 20 MB dan oshmasligi kerak.', 413)
  if (file && !env.FILES) return fail('R2 binding is not configured.', 503)
  let taggedGroupId = null
  if (groupId) {
    const membership = await env.DB.prepare('SELECT 1 AS found FROM group_students WHERE student_id = ? AND group_id = ?')
      .bind(profile.student_id, groupId).first()
    if (!membership) return fail('Guruh sizga biriktirilmagan.', 403)
    taggedGroupId = groupId
  }
  const ticketId = crypto.randomUUID()
  await env.DB.prepare(`INSERT INTO question_tickets (id, student_id, tagged_group_id)
    VALUES (?, ?, ?)`).bind(ticketId, profile.student_id, taggedGroupId).run()
  let fileKey = null
  if (file) {
    fileKey = `questions/${crypto.randomUUID()}`
    await env.FILES.put(fileKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: 'application/octet-stream' },
      customMetadata: { originalName: String(file.name || 'savol-fayli').replace(/[\r\n"]/g, '_').slice(0, 180) },
    })
  }
  await env.DB.prepare(`INSERT INTO question_messages (id, ticket_id, actor_id, actor_role, body, file_key)
    VALUES (?, ?, ?, 'student', ?, ?)`).bind(crypto.randomUUID(), ticketId, profile.id, text, fileKey).run()
  const notificationFailed = await notifyQuestionReceivers(env, new URL(request.url).origin, profile.student_id, text)
  return json({ data: { id: ticketId, notification_failed: notificationFailed } }, 201)
}

async function handleQuestions(request, env, profile, pathname) {
  if (!profile) return fail('Login required.', 401)
  if (pathname === '/api/questions' && request.method === 'POST') return createQuestion(request, env, profile)
  if (pathname === '/api/questions' && request.method === 'GET') {
    if (!['owner', 'reception', 'teacher', 'student'].includes(profile.role)) return fail('Access denied.', 403)
    if (profile.role === 'student' && !canAccessEndpoint(profile.role, 'questions:create')) return fail('Access denied.', 403)
    if (profile.role === 'teacher' && !canAccessEndpoint(profile.role, 'questions:inbox')) return fail('Access denied.', 403)
    const url = new URL(request.url)
    const status = url.searchParams.get('status') || ''
    const search = String(url.searchParams.get('search') || '').trim().slice(0, 120)
    if (status && !['open', 'answered', 'closed'].includes(status)) return fail('Holat noto‘g‘ri.', 400)
    const where = []
    const args = []
    if (status) { where.push('t.status = ?'); args.push(status) }
    if (search) { where.push('(st.name LIKE ? OR qm.body LIKE ?)'); args.push(`%${search}%`, `%${search}%`) }
    if (profile.role === 'student') {
      where.push('t.student_id = ?')
      args.push(profile.student_id)
    } else if (profile.role === 'teacher') {
      where.push('t.tagged_group_id IN (SELECT id FROM groups WHERE teacher_id = ?)')
      args.push(profile.teacher_id || '')
    } else if (profile.role !== 'owner' && profile.role !== 'reception') {
      return fail('Access denied.', 403)
    }
    const unreadFilter = profile.role === 'student'
      ? "unread.actor_role IN ('owner', 'reception', 'teacher')"
      : "unread.actor_role = 'student'"
    const rows = await env.DB.prepare(`SELECT DISTINCT t.*, st.name AS student_name,
      (SELECT COUNT(*) FROM question_messages unread
        WHERE unread.ticket_id = t.id AND ${unreadFilter} AND unread.read_at IS NULL) AS unread_count
      FROM question_tickets t JOIN students st ON st.id = t.student_id
      LEFT JOIN question_messages qm ON qm.ticket_id = t.id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY t.last_message_at DESC LIMIT 200`).bind(...args).all()
    if (['owner', 'reception', 'teacher'].includes(profile.role)) {
      const ticketIds = (rows.results || []).map((ticket) => ticket.id)
      if (ticketIds.length) {
        await env.DB.prepare(`UPDATE question_messages SET read_at = ?
          WHERE actor_role = 'student' AND read_at IS NULL
            AND ticket_id IN (${ticketIds.map(() => '?').join(',')})`)
          .bind(new Date().toISOString(), ...ticketIds).run()
      }
    }
    const tickets = await Promise.all((rows.results || []).map(async (ticket) => {
      const messages = await env.DB.prepare(`SELECT id, actor_id, actor_role, body, file_key, created_at, read_at
        FROM question_messages WHERE ticket_id = ? ORDER BY created_at, rowid`).bind(ticket.id).all()
      return {
        ...ticket,
        messages: await Promise.all((messages.results || []).map(async (message) => ({
          ...message,
          file_url: message.file_key ? await signFileUrl(env, new URL(request.url).origin, message.file_key) : null,
        }))),
      }
    }))
    if (profile.role === 'student') {
      const ticketIds = (rows.results || []).map((ticket) => ticket.id)
      if (ticketIds.length) {
        await env.DB.prepare(`UPDATE question_messages SET read_at = ?
          WHERE actor_role IN ('owner', 'reception', 'teacher') AND read_at IS NULL
            AND ticket_id IN (${ticketIds.map(() => '?').join(',')})`)
          .bind(new Date().toISOString(), ...ticketIds).run()
      }
    }
    for (const ticket of tickets) ticket.unread_count = 0
    return json({ data: tickets })
  }
  const match = pathname.match(/^\/api\/questions\/([^/]+)\/(reply|close)$/)
  if (!match) return fail('Not found.', 404)
  const [, ticketId, action] = match
  const ticket = await env.DB.prepare('SELECT * FROM question_tickets WHERE id = ?').bind(ticketId).first()
  if (!ticket) return fail('Savol topilmadi.', 404)
  const staffCanAnswer = ['owner', 'reception'].includes(profile.role)
    || (profile.role === 'teacher' && canAccessEndpoint(profile.role, 'questions:reply') && ticket.tagged_group_id
      && (await ownedGroupIds(env, profile)).includes(ticket.tagged_group_id))
  if (!staffCanAnswer) return fail('Access denied.', 403)
  if (request.method !== 'POST') return fail('Method not allowed.', 405)
  if (action === 'close') {
    if (!['owner', 'reception'].includes(profile.role)) return fail('Access denied.', 403)
    await env.DB.prepare(`UPDATE question_tickets SET status = 'closed', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`).bind(ticket.id).run()
    return json({ data: true })
  }
  if (!['owner', 'reception'].includes(profile.role) && profile.role !== 'teacher') return fail('Access denied.', 403)
  const parsed = z.object({ text: z.string().trim().min(1).max(10000) }).strict().safeParse(await request.json())
  if (!parsed.success) return fail('Javob matnini kiriting.', 400)
  await env.DB.prepare(`INSERT INTO question_messages (id, ticket_id, actor_id, actor_role, body)
    VALUES (?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), ticket.id, profile.id, profile.role, parsed.data.text).run()
  await env.DB.prepare(`UPDATE question_tickets SET status = 'answered', last_message_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(ticket.id).run()
  const chats = await env.DB.prepare('SELECT chat_id FROM telegram_links WHERE student_id = ?')
    .bind(ticket.student_id).all()
  let deliveryFailed = false
  try {
    const bot = await getWorkerBot(env, new URL(request.url).origin)
    for (const chat of chats.results || []) await bot.api.sendMessage(chat.chat_id, `Maktab javobi:\n${parsed.data.text}`)
  } catch (error) {
    deliveryFailed = true
    console.error('Question reply delivery failed', error instanceof Error ? error.name : 'UnknownError')
  }
  return json({ data: { delivery_failed: deliveryFailed } })
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
  if (pathname === '/api/bot/question') {
    const parsed = z.object({
      chat_id: z.number().int().positive(),
      text: z.string().trim().min(1).max(10000),
      file_id: z.string().min(1).max(512).optional(),
      file_name: z.string().max(180).optional(),
      file_kind: z.enum(['attachment', 'voice']).optional(),
    }).strict().safeParse(await request.json())
    if (!parsed.success) return fail('Savol matnini kiriting.', 400)
    const link = await env.DB.prepare('SELECT student_id FROM telegram_links WHERE chat_id = ?')
      .bind(parsed.data.chat_id).first()
    if (!link) return fail('Telegram akkaunt ulanmagan.', 404)
    let fileKey = null
    if (parsed.data.file_id) {
      if (!env.FILES || !env.TELEGRAM_BOT_TOKEN) return fail('Savol fayli xizmati sozlanmagan.', 503)
      const fileInfoResponse = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(parsed.data.file_id)}`)
      const fileInfo = await fileInfoResponse.json()
      if (!fileInfoResponse.ok || !fileInfo.ok || !fileInfo.result?.file_path) return fail('Telegram fayl topilmadi.', 400)
      const download = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${fileInfo.result.file_path}`)
      if (!download.ok) return fail('Telegram faylini yuklab bo‘lmadi.', 502)
      const bytes = await download.arrayBuffer()
      if (!bytes.byteLength || bytes.byteLength > 20 * 1024 * 1024) return fail('Fayl 20 MB dan oshmasligi kerak.', 413)
      fileKey = `questions/${crypto.randomUUID()}`
      await env.FILES.put(fileKey, bytes, {
        httpMetadata: { contentType: 'application/octet-stream' },
        customMetadata: { originalName: parsed.data.file_name || 'telegram-savol-fayli' },
      })
    }
    const ticketId = crypto.randomUUID()
    await env.DB.prepare(`INSERT INTO question_tickets (id, student_id) VALUES (?, ?)`)
      .bind(ticketId, link.student_id).run()
    await env.DB.prepare(`INSERT INTO question_messages (id, ticket_id, actor_role, body, file_key)
      VALUES (?, ?, 'student', ?, ?)`).bind(crypto.randomUUID(), ticketId, parsed.data.text, fileKey).run()
    const notificationFailed = await notifyQuestionReceivers(env, new URL(request.url).origin, link.student_id, parsed.data.text)
    return json({ data: { id: ticketId, notification_failed: notificationFailed } }, 201)
  }
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
    return fail('Eski topshirish usuli o‘chirildi. Draft + proof + tasdiqlash oqimidan foydalaning.', 410)
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
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/webm'].includes(file.type)) return fail('Unsupported file type.', 415)
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
  if (!profile) return fail('Login required.', 401)
  if (!canAccessEndpoint(profile.role, 'finance:summary')) return fail('Access denied.', 403)
  const url = new URL(request.url)
  const from = url.searchParams.get('from') || ''
  const to = url.searchParams.get('to') || ''
  const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
  if (!isDate(from) || !isDate(to) || from > to) return fail('Invalid date range.', 400)
  const [payments, salaries, expenses] = await Promise.all([
    env.DB.prepare('SELECT amount FROM payments WHERE voided_at IS NULL AND substr(paid_at, 1, 10) BETWEEN ? AND ?').bind(from, to).all(),
    env.DB.prepare('SELECT amount FROM salary_payments WHERE substr(paid_at, 1, 10) BETWEEN ? AND ?').bind(from, to).all(),
    env.DB.prepare('SELECT amount FROM expenses WHERE date BETWEEN ? AND ?').bind(from, to).all(),
  ])
  return json(calculateFinanceSummary({
    payments: payments.results || [],
    salaries: salaries.results || [],
    expenses: expenses.results || [],
  }))
}

const PAYMENT_METHODS = ['cash', 'card', 'transfer']

function paymentSnapshot(row) {
  return {
    student_id: row.student_id,
    student_name: row.student_name,
    amount: row.amount,
    month: row.month,
    year: row.year,
    paid_at: row.paid_at,
    method: row.method,
    note: row.note,
  }
}

async function recordPaymentAudit(env, { action, paymentId, actor, reason = '', oldData, newData }) {
  await env.DB.prepare(`INSERT INTO payment_audit (id, payment_id, action, actor_id, actor_name, reason, old_data, new_data, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    crypto.randomUUID(), paymentId, action, actor?.id || null, actor?.name || '',
    String(reason || '').slice(0, 500), JSON.stringify(oldData || {}), JSON.stringify(newData || {}),
    new Date().toISOString(),
  ).run()
}

async function correctPayment(request, env, profile) {
  if (!STAFF.has(profile?.role)) return fail('Ruxsat yo‘q.', 403)
  const parsed = z.object({
    id: z.string().min(1).max(64),
    amount: z.number().positive().optional(),
    month: z.number().int().min(1).max(12).optional(),
    year: z.number().int().min(2000).max(2100).optional(),
    paid_at: z.string().min(1).max(40).optional(),
    method: z.enum(PAYMENT_METHODS).optional(),
    note: z.string().max(500).optional(),
    reason: z.string().max(500).optional(),
  }).strict().safeParse(await request.json())
  if (!parsed.success) return fail('To‘lov ma’lumotlari noto‘g‘ri.', 400)
  const payment = await env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(parsed.data.id).first()
  if (!payment) return fail('To‘lov topilmadi.', 404)
  if (payment.voided_at) return fail('Bekor qilingan to‘lovni tuzatib bo‘lmaydi.', 409)
  const patch = {}
  for (const key of ['amount', 'month', 'year', 'paid_at', 'method', 'note']) {
    if (parsed.data[key] !== undefined) patch[key] = parsed.data[key]
  }
  if (!Object.keys(patch).length) return fail('Tuzatish uchun ma’lumot yo‘q.', 400)
  if (patch.paid_at && Number.isNaN(Date.parse(patch.paid_at))) return fail('Sana noto‘g‘ri.', 400)
  const now = new Date().toISOString()
  const columns = Object.keys(patch)
  await env.DB.prepare(`UPDATE payments SET ${columns.map((column) => `"${column}" = ?`).join(', ')}, updated_at = ?, updated_by = ? WHERE id = ?`)
    .bind(...columns.map((column) => patch[column]), now, profile.id, payment.id).run()
  const next = { ...payment, ...patch, updated_at: now, updated_by: profile.id }
  await recordPaymentAudit(env, {
    action: 'corrected', paymentId: payment.id, actor: profile,
    reason: parsed.data.reason || '', oldData: paymentSnapshot(payment), newData: paymentSnapshot(next),
  })
  return json({ data: paymentSnapshot(next) })
}

async function voidPayment(request, env, profile) {
  if (!STAFF.has(profile?.role)) return fail('Ruxsat yo‘q.', 403)
  const parsed = z.object({
    id: z.string().min(1).max(64),
    reason: z.string().trim().min(3).max(500),
  }).strict().safeParse(await request.json())
  if (!parsed.success) return fail('Bekor qilish sababi majburiy.', 400)
  const payment = await env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(parsed.data.id).first()
  if (!payment) return fail('To‘lov topilmadi.', 404)
  if (payment.voided_at) return fail('To‘lov allaqachon bekor qilingan.', 409)
  const now = new Date().toISOString()
  await env.DB.prepare('UPDATE payments SET voided_at = ?, voided_by = ?, void_reason = ?, updated_at = ?, updated_by = ? WHERE id = ?')
    .bind(now, profile.id, parsed.data.reason, now, profile.id, payment.id).run()
  const next = { ...payment, voided_at: now, voided_by: profile.id, void_reason: parsed.data.reason }
  await recordPaymentAudit(env, {
    action: 'voided', paymentId: payment.id, actor: profile,
    reason: parsed.data.reason, oldData: paymentSnapshot(payment),
    newData: { ...paymentSnapshot(next), void_reason: parsed.data.reason, voided_at: now },
  })
  return json({ data: { id: payment.id, voided_at: now, void_reason: parsed.data.reason } })
}

async function paymentsHistory(request, env, profile) {
  if (!STAFF.has(profile?.role)) return fail('Ruxsat yo‘q.', 403)
  const paymentId = new URL(request.url).searchParams.get('payment_id')
  const rows = paymentId
    ? await env.DB.prepare('SELECT * FROM payment_audit WHERE payment_id = ? ORDER BY created_at DESC LIMIT 200').bind(paymentId).all()
    : await env.DB.prepare('SELECT * FROM payment_audit ORDER BY created_at DESC LIMIT 200').all()
  return json({ data: rows.results || [] })
}

const WEEKDAY_NAMES = ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba']

function scheduleDate(value) {
  const date = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const parsed = new Date(`${date}T12:00:00Z`)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? null : date
}

function tashkentToday() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).map(({ type, value }) => [type, value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

function shiftScheduleDate(date, days) {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function scheduleWeekday(date) {
  const jsDay = new Date(`${date}T12:00:00Z`).getUTCDay()
  return jsDay === 0 ? 7 : jsDay
}

function scheduleDateLabel(date) {
  const [year, month, day] = date.split('-')
  const weekday = WEEKDAY_NAMES[new Date(`${date}T12:00:00Z`).getUTCDay()]
  return `${day}.${month}.${year}, ${weekday}`
}

function parsedSchedule(value) {
  if (Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function normalizedSchedule(slots) {
  const weekdays = normalizeScheduleWeekdays(slots)
  return weekdays.map((slot, index) => ({
    ...slot,
    slotId: String(slot.slotId || slot.slot_id || `slot-${index}`),
    day: Number(slot.day),
    startTime: String(slot.startTime || ''),
    endTime: String(slot.endTime || ''),
    teacherId: slot.teacherId || slot.teacher_id || null,
  }))
}

function activeWeeklySchedule(group, versions, date) {
  const selected = versions
    .filter((version) => version.group_id === group.id
      && version.valid_from <= date
      && (!version.valid_to || date < version.valid_to))
    .sort((left, right) => left.valid_from.localeCompare(right.valid_from)
      || String(left.created_at || '').localeCompare(String(right.created_at || ''))
      || left.id.localeCompare(right.id))
    .at(-1)
  return normalizedSchedule(parsedSchedule(selected?.schedule ?? group.schedule))
}

async function loadScheduleState(env, groupIds = null) {
  let groups
  if (groupIds) {
    const ids = [...new Set(groupIds)].slice(0, 500)
    if (!ids.length) return { groups: [], versions: [], overrides: [] }
    const placeholders = ids.map(() => '?').join(',')
    const result = await env.DB.prepare(`SELECT id, name, teacher_id, schedule FROM groups WHERE id IN (${placeholders})`)
      .bind(...ids).all()
    groups = result.results || []
  } else {
    const result = await env.DB.prepare('SELECT id, name, teacher_id, schedule FROM groups').all()
    groups = result.results || []
  }
  if (!groups.length) return { groups: [], versions: [], overrides: [] }
  const placeholders = groups.map(() => '?').join(',')
  const ids = groups.map((group) => group.id)
  const [versionRows, overrideRows] = await Promise.all([
    env.DB.prepare(`SELECT * FROM schedule_versions WHERE group_id IN (${placeholders})`).bind(...ids).all(),
    env.DB.prepare(`SELECT * FROM schedule_overrides WHERE group_id IN (${placeholders}) AND reverted_at IS NULL`).bind(...ids).all(),
  ])
  return { groups, versions: versionRows.results || [], overrides: overrideRows.results || [] }
}

function currentDaySchedule(group, state, date) {
  return activeWeeklySchedule(group, state.versions, date)
}

function teacherOwnsScheduleOnDate(group, state, teacherId, date) {
  return currentDaySchedule(group, state, date).some((slot) => (
    (slot.teacherId || group.teacher_id) === teacherId
  ))
}

async function accessibleScheduleGroupIds(env, profile) {
  if (['owner', 'reception'].includes(profile.role)) {
    const { results } = await env.DB.prepare('SELECT id FROM groups ORDER BY name').all()
    return (results || []).map((row) => row.id)
  }
  if (profile.role === 'teacher') {
    return ownedGroupIds(env, profile)
  }
  if (profile.role === 'student' && profile.student_id) {
    const { results } = await env.DB.prepare('SELECT group_id FROM group_students WHERE student_id = ?')
      .bind(profile.student_id).all()
    return (results || []).map((row) => row.group_id)
  }
  return []
}

async function scheduleRecipients(env, groupId, teacherIds, includeReception) {
  const recipients = new Map()
  const students = await env.DB.prepare(`SELECT s.id AS entity_id, s.name, s.telegram_id AS legacy_telegram_id,
      p.id AS profile_id, p.telegram_id AS profile_telegram_id, tl.chat_id
    FROM group_students gs
    JOIN students s ON s.id = gs.student_id
    LEFT JOIN profiles p ON p.student_id = s.id
    LEFT JOIN accounts a ON a.id = p.id
    LEFT JOIN telegram_links tl ON tl.student_id = s.id
    WHERE gs.group_id = ? AND (p.id IS NULL OR a.is_active = 1)`).bind(groupId).all()
  for (const student of students.results || []) {
    const id = `student:${student.entity_id}`
    const existing = recipients.get(id) || {
      recipientId: student.profile_id || id,
      entityId: student.entity_id,
      name: student.name,
      profileId: student.profile_id,
      telegramId: null,
    }
    existing.telegramId ||= student.profile_telegram_id || student.legacy_telegram_id || student.chat_id || null
    recipients.set(id, existing)
  }

  const ids = [...new Set(teacherIds.filter(Boolean))]
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',')
    const teachers = await env.DB.prepare(`SELECT t.id AS entity_id, t.name, t.telegram_id AS legacy_telegram_id,
        p.id AS profile_id, p.telegram_id AS profile_telegram_id
      FROM teachers t LEFT JOIN profiles p ON p.teacher_id = t.id
      WHERE t.id IN (${placeholders})`).bind(...ids).all()
    for (const teacher of teachers.results || []) {
      recipients.set(`teacher:${teacher.entity_id}`, {
        recipientId: teacher.profile_id || `teacher:${teacher.entity_id}`,
        entityId: teacher.entity_id,
        name: teacher.name,
        profileId: teacher.profile_id,
        telegramId: teacher.profile_telegram_id || teacher.legacy_telegram_id || null,
      })
    }
  }
  if (includeReception) {
    const reception = await env.DB.prepare(`SELECT p.id AS profile_id, p.name, p.telegram_id
      FROM profiles p JOIN accounts a ON a.id = p.id
      WHERE p.role = 'reception' AND a.is_active = 1`).all()
    for (const person of reception.results || []) {
      recipients.set(`reception:${person.profile_id}`, {
        recipientId: person.profile_id,
        entityId: person.profile_id,
        name: person.name,
        profileId: person.profile_id,
        telegramId: person.telegram_id || null,
      })
    }
  }
  return [...recipients.values()]
}

function scheduleNoticeText({ groupName, type, kind, reason, oldLesson, newLesson }) {
  const groupLine = `Guruh: ${groupName}`
  const reasonLine = reason ? `Sabab: ${reason}` : ''
  if (kind === 'reminder') {
    const lessonDate = newLesson?.date || newLesson?.newDate || oldLesson?.date || '—'
    return `Ertangi dars eslatmasi\n${groupLine}\nSana: ${scheduleDateLabel(lessonDate)}\nVaqt: ${newLesson?.startTime || oldLesson?.startTime || '—'}–${newLesson?.endTime || oldLesson?.endTime || '—'}`
  }
  if (kind === 'undo') {
    const date = newLesson?.date || oldLesson?.date || '—'
    return `Dars jadvalidagi o‘zgarish qaytarildi.\n${groupLine}\nSana: ${scheduleDateLabel(date)}\nVaqt: ${newLesson?.startTime || '—'}–${newLesson?.endTime || '—'}${reasonLine ? `\n${reasonLine}` : ''}`
  }
  if (type === 'replace') {
    return `Haftalik jadval yangilandi.\n${groupLine}\nKuchga kirish sanasi: ${scheduleDateLabel(newLesson?.date || oldLesson?.date)}${reasonLine ? `\n${reasonLine}` : ''}`
  }
  if (type === 'single' && newLesson?.status === 'cancelled') {
    return `Bir kunlik dars bekor qilindi.\n${groupLine}\nSana: ${scheduleDateLabel(oldLesson.date)}\nEski vaqt: ${oldLesson.startTime}–${oldLesson.endTime}${reasonLine ? `\n${reasonLine}` : ''}`
  }
  const effectiveDate = type === 'permanent' ? newLesson.date : (newLesson.newDate || newLesson.date)
  const duration = type === 'permanent' ? 'Doimiy jadval o‘zgardi' : 'Bir kunlik dars o‘zgardi'
  return `${duration}.\n${groupLine}\nSana: ${scheduleDateLabel(effectiveDate)}\nEski vaqt: ${oldLesson.startTime}–${oldLesson.endTime}\nYangi vaqt: ${newLesson.startTime}–${newLesson.endTime}${reasonLine ? `\n${reasonLine}` : ''}`
}

function scheduleReminderDate(date) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day - 1, 13)).toISOString()
}

async function enqueueScheduleNotices(env, {
  changeId, group, type, reason, oldLesson, newLesson, actorRole, recipients: providedRecipients,
}) {
  const teacherIds = [
    oldLesson?.teacherId || group.teacher_id,
    newLesson?.teacherId || group.teacher_id,
  ]
  const recipients = providedRecipients || await scheduleRecipients(env, group.id, teacherIds, actorRole === 'teacher')
  const now = new Date().toISOString()
  let reminderDate = null
  if (type === 'single' && newLesson?.status !== 'cancelled') {
    reminderDate = newLesson?.newDate || newLesson?.date || null
  } else if (type === 'permanent' && newLesson?.day) {
    reminderDate = newLesson.date
    while (reminderDate && scheduleWeekday(reminderDate) !== Number(newLesson.day)) {
      reminderDate = shiftScheduleDate(reminderDate, 1)
    }
  }
  if (reminderDate && reminderDate <= tashkentToday()) reminderDate = null
  const entries = []
  for (const recipient of recipients) {
    const kinds = ['change', ...(reminderDate ? ['reminder'] : [])]
    for (const kind of kinds) {
      const lessonDate = kind === 'reminder' ? reminderDate : (newLesson?.date || oldLesson?.date)
      const scheduledAt = kind === 'reminder' ? scheduleReminderDate(lessonDate) : now
      const message = scheduleNoticeText({ groupName: group.name, type, kind, reason, oldLesson, newLesson })
      if (recipient.profileId) {
        entries.push(env.DB.prepare(`INSERT OR IGNORE INTO schedule_notification_outbox
          (id, change_id, recipient_id, recipient_name, channel, notification_kind, telegram_id, message,
           status, scheduled_at, next_attempt_at, sent_at)
          VALUES (?, ?, ?, ?, 'in_app', ?, ?, ?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), changeId, recipient.profileId, recipient.name, kind, recipient.telegramId,
            message, kind === 'reminder' ? 'queued' : 'sent', scheduledAt, scheduledAt, kind === 'reminder' ? null : now))
      }
      entries.push(env.DB.prepare(`INSERT OR IGNORE INTO schedule_notification_outbox
        (id, change_id, recipient_id, recipient_name, channel, notification_kind, telegram_id, message,
         status, scheduled_at, next_attempt_at)
        VALUES (?, ?, ?, ?, 'telegram', ?, ?, ?, ?, ?, ?)` )
        .bind(crypto.randomUUID(), changeId, recipient.recipientId, recipient.name, kind,
          recipient.telegramId, message, recipient.telegramId ? 'queued' : 'not_linked', scheduledAt, scheduledAt))
    }
  }
  return entries
}

function scheduleChangePayloadSchema() {
  return z.object({
    requestId: z.string().trim().min(8).max(128),
    groupId: z.string().min(1).max(64),
    type: z.enum(['single', 'permanent', 'replace']),
    reason: z.string().trim().min(3).max(500),
    slotId: z.string().min(1).max(80).optional(),
    originalDate: z.string().optional(),
    validFrom: z.string().optional(),
    action: z.enum(['change', 'cancel']).optional(),
    newDate: z.string().optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    day: z.number().int().min(1).max(7).optional(),
    teacherId: z.string().max(64).nullable().optional(),
    schedule: z.array(z.object({
      slotId: z.string().min(1).max(80).optional(),
      day: z.number().int().min(1).max(7),
      startTime: z.string(),
      endTime: z.string(),
      teacherId: z.string().max(64).nullable().optional(),
    }).strict()).max(30).optional(),
  }).strict().superRefine((payload, context) => {
    if (payload.type === 'replace' && !payload.schedule) {
      context.addIssue({ code: 'custom', message: 'Haftalik jadval ma’lumotlari kiritilmagan.', path: ['schedule'] })
    }
  })
}

function groupById(state, groupId) {
  return state.groups.find((group) => group.id === groupId) || null
}

function selectedSourceLesson(group, state, slotId, date) {
  return getEffectiveLesson(group.id, date, { group, groups: state.groups, versions: state.versions, overrides: state.overrides })
    .find((lesson) => lesson.slotId === slotId && !['cancelled', 'rescheduled'].includes(lesson.status))
}

function notifyCount(recipients) {
  return recipients.length
}

async function validateScheduleChange(env, payload, profile) {
  const state = await loadScheduleState(env)
  const group = groupById(state, payload.groupId)
  if (!group) return { error: 'Guruh topilmadi.', status: 404 }
  const today = tashkentToday()
  const startDate = scheduleDate(payload.type === 'single' ? payload.originalDate : payload.validFrom)
  if (!startDate || startDate < today) return { error: 'O‘tgan sanani tanlab bo‘lmaydi.', status: 400 }
  if (profile.role === 'teacher' && !teacherOwnsScheduleOnDate(group, state, profile.teacher_id, startDate)) {
    return { error: 'Faqat o‘zingiz dars beradigan guruh jadvalini o‘zgartira olasiz.', status: 403 }
  }

  let oldLesson
  let newLesson
  if (payload.type === 'single') {
    if (!payload.slotId || !payload.action) return { error: 'Dars o‘zgarishi to‘liq emas.', status: 400 }
    oldLesson = selectedSourceLesson(group, state, payload.slotId, startDate)
    if (!oldLesson) return { error: 'Tanlangan sanada bu guruhning darsi yo‘q.', status: 400 }
    if (state.overrides.some((item) => item.group_id === group.id
      && item.slot_id === payload.slotId && item.original_date === startDate)) {
      return { error: 'Bu dars uchun allaqachon o‘zgarish bor.', status: 409 }
    }
    if (payload.action === 'cancel') {
      newLesson = { ...oldLesson, status: 'cancelled', date: startDate }
    } else {
      const targetDate = scheduleDate(payload.newDate || startDate)
      if (!targetDate) return { error: 'Yangi sana noto‘g‘ri.', status: 400 }
      if (targetDate < today) return { error: 'O‘tgan sanaga dars ko‘chirib bo‘lmaydi.', status: 400 }
      newLesson = {
        ...oldLesson,
        date: targetDate,
        newDate: targetDate === startDate ? null : targetDate,
        startTime: payload.startTime || oldLesson.startTime,
        endTime: payload.endTime || oldLesson.endTime,
        teacherId: payload.teacherId === undefined ? oldLesson.teacherId : payload.teacherId,
        groupId: group.id,
        status: 'changed',
      }
      const conflict = findDateScheduleConflict({
        date: targetDate, lesson: newLesson, groups: state.groups, versions: state.versions,
        overrides: state.overrides, excludeSlotId: targetDate === startDate ? payload.slotId : null,
      })
      if (conflict) return { error: conflict, status: 409 }
    }
  } else {
    const nextSchedule = payload.type === 'replace'
      ? normalizedSchedule(payload.schedule || [])
      : activeWeeklySchedule(group, state.versions, startDate).map((slot) => ({ ...slot }))
    const index = nextSchedule.findIndex((slot) => slot.slotId === payload.slotId)
    if (payload.type === 'permanent' && index < 0) return { error: 'Tanlangan dars jadvalda topilmadi.', status: 404 }
    const previousSchedule = activeWeeklySchedule(group, state.versions, startDate)
    if (payload.type === 'permanent') {
      oldLesson = previousSchedule[index]
      nextSchedule[index] = {
        ...nextSchedule[index],
        day: payload.day ?? nextSchedule[index].day,
        startTime: payload.startTime || nextSchedule[index].startTime,
        endTime: payload.endTime || nextSchedule[index].endTime,
        teacherId: payload.teacherId === undefined ? nextSchedule[index].teacherId : payload.teacherId,
      }
    } else {
      oldLesson = { date: startDate, startTime: '', endTime: '' }
    }
    for (const slot of nextSchedule) {
      if (timeToMinutes(slot.startTime) === null || timeToMinutes(slot.endTime) === null
        || timeToMinutes(slot.endTime) <= timeToMinutes(slot.startTime)) {
        return { error: 'Darsning tugash vaqti boshlanishidan keyin bo‘lishi kerak.', status: 400 }
      }
    }
    for (let index = 0; index < nextSchedule.length; index += 1) {
      const current = nextSchedule[index]
      for (const other of nextSchedule.slice(index + 1)) {
        if (current.day !== other.day) continue
        const currentStart = timeToMinutes(current.startTime)
        const currentEnd = timeToMinutes(current.endTime)
        const otherStart = timeToMinutes(other.startTime)
        const otherEnd = timeToMinutes(other.endTime)
        if (currentStart < otherEnd && otherStart < currentEnd) {
          return { error: 'Guruhning yangi jadvalida ikki dars ustma-ust kelmoqda.', status: 409 }
        }
      }
    }
    const horizon = 370
    for (let offset = 0; offset < horizon; offset += 1) {
      const date = shiftScheduleDate(startDate, offset)
      const dayLessons = nextSchedule.filter((slot) => slot.day === scheduleWeekday(date))
      for (const slot of dayLessons) {
        const conflict = findDateScheduleConflict({
          date, lesson: { ...slot, groupId: group.id, teacherId: slot.teacherId || group.teacher_id },
          groups: state.groups, versions: state.versions, overrides: state.overrides,
          excludeSlotId: slot.slotId,
        })
        if (conflict) return { error: conflict, status: 409 }
      }
    }
    if (payload.type === 'permanent') {
      newLesson = {
        ...nextSchedule.find((slot) => slot.slotId === payload.slotId),
        date: startDate,
      }
    } else {
      newLesson = { date: startDate, startTime: '', endTime: '' }
    }
    const teacherIds = [...previousSchedule, ...nextSchedule].map((slot) => slot.teacherId || group.teacher_id)
    const recipients = await scheduleRecipients(env, group.id, [...teacherIds, group.teacher_id], profile.role === 'teacher')
    return { group, state, oldLesson, newLesson, nextSchedule, previousSchedule, recipients, startDate }
  }
  const recipients = await scheduleRecipients(env, group.id, [
    oldLesson.teacherId || group.teacher_id,
    newLesson.teacherId || group.teacher_id,
  ], profile.role === 'teacher')
  return { group, state, oldLesson, newLesson, recipients, startDate }
}

async function handleScheduleRoutes(request, env, profile, pathname) {
  if (!profile) return fail('Tizimga kiring.', 401)
  const url = new URL(request.url)
  if (pathname === '/api/notifications' && request.method === 'GET') {
    if (!canAccessEndpoint(profile.role, 'notifications:read') && !['owner', 'reception', 'teacher'].includes(profile.role)) {
      return fail('Ruxsat yo‘q.', 403)
    }
    const now = new Date().toISOString()
    const { results } = await env.DB.prepare(`SELECT o.id, o.change_id, o.notification_kind, o.message, o.scheduled_at,
        o.sent_at, c.group_id, g.name AS group_name
      FROM schedule_notification_outbox o
      JOIN schedule_changes c ON c.id = o.change_id
      JOIN groups g ON g.id = c.group_id
      WHERE o.channel = 'in_app' AND o.recipient_id = ? AND o.status = 'sent' AND o.scheduled_at <= ?
      ORDER BY o.scheduled_at DESC LIMIT 100`).bind(profile.id, now).all()
    return json({ data: results || [] })
  }

  if (pathname === '/api/schedule/state' && request.method === 'GET') {
    if (!canAccessEndpoint(profile.role, 'schedule:read')) return fail('Ruxsat yo‘q.', 403)
    const groupIds = await accessibleScheduleGroupIds(env, profile)
    const state = await loadScheduleState(env, groupIds)
    return json({ data: { groups: state.groups.map((group) => ({
      group_id: group.id,
      versions: state.versions.filter((version) => version.group_id === group.id),
      overrides: state.overrides.filter((override) => override.group_id === group.id),
    })) } })
  }

  if (pathname === '/api/schedule/history' && request.method === 'GET') {
    if (!canAccessEndpoint(profile.role, 'schedule:read')) return fail('Ruxsat yo‘q.', 403)
    const groupId = url.searchParams.get('group_id')
    if (!groupId || !(await accessibleScheduleGroupIds(env, profile)).includes(groupId)) return fail('Guruh topilmadi yoki ruxsat yo‘q.', 403)
    const [events, changes] = await Promise.all([
      env.DB.prepare(`SELECT e.*, p.name AS actor_name FROM schedule_change_events e
        LEFT JOIN profiles p ON p.id = e.actor_id WHERE e.group_id = ? ORDER BY e.created_at DESC LIMIT 100`)
        .bind(groupId).all(),
      env.DB.prepare(`SELECT id, created_at FROM schedule_changes WHERE group_id = ? ORDER BY created_at DESC LIMIT 100`)
        .bind(groupId).all(),
    ])
    const changeIds = (changes.results || []).map((row) => row.id)
    const deliveries = changeIds.length
      ? await env.DB.prepare(`SELECT id, change_id, recipient_id, recipient_name, channel, notification_kind, status,
          attempts, last_error, sent_at, scheduled_at
        FROM schedule_notification_outbox WHERE change_id IN (${changeIds.map(() => '?').join(',')})
        ORDER BY created_at DESC`).bind(...changeIds).all()
      : { results: [] }
    return json({ data: { events: events.results || [], deliveries: deliveries.results || [] } })
  }

  if (pathname === '/api/schedule/preview' && request.method === 'POST') {
    const parsed = scheduleChangePayloadSchema().safeParse(await request.json())
    if (!parsed.success) return fail('Jadval o‘zgarishi ma’lumotlari noto‘g‘ri.', 400)
    if (!canAccessEndpoint(profile.role, 'schedule:manage') && !canAccessEndpoint(profile.role, 'schedule:manage-own')) {
      return fail('Jadval o‘zgartirishga ruxsat yo‘q.', 403)
    }
    const validation = await validateScheduleChange(env, parsed.data, profile)
    if (validation.error) return fail(validation.error, validation.status)
    return json({ data: { notificationCount: notifyCount(validation.recipients), oldLesson: validation.oldLesson, newLesson: validation.newLesson } })
  }

  if (pathname === '/api/schedule/changes' && request.method === 'POST') {
    const parsed = scheduleChangePayloadSchema().safeParse(await request.json())
    if (!parsed.success) return fail('Jadval o‘zgarishi ma’lumotlari noto‘g‘ri.', 400)
    if (!canAccessEndpoint(profile.role, 'schedule:manage') && !canAccessEndpoint(profile.role, 'schedule:manage-own')) {
      return fail('Jadval o‘zgartirishga ruxsat yo‘q.', 403)
    }
    const existingRequest = await env.DB.prepare('SELECT id FROM schedule_changes WHERE request_id = ?')
      .bind(parsed.data.requestId).first()
    if (existingRequest) return json({ data: { id: existingRequest.id, duplicate: true } })
    const validation = await validateScheduleChange(env, parsed.data, profile)
    if (validation.error) return fail(validation.error, validation.status)

    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const oldData = {
      lesson: validation.oldLesson,
      schedule: validation.previousSchedule || null,
      teacherId: validation.group.teacher_id,
    }
    const newData = {
      lesson: validation.newLesson,
      schedule: validation.nextSchedule || null,
      teacherId: validation.nextSchedule?.find((slot) => slot.teacherId)?.teacherId || validation.group.teacher_id,
      type: parsed.data.type,
    }
    const statements = [
      env.DB.prepare(`INSERT INTO schedule_changes
        (id, group_id, request_id, change_type, actor_id, reason, old_data, new_data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, validation.group.id, parsed.data.requestId, parsed.data.type, profile.id, parsed.data.reason,
          JSON.stringify(oldData), JSON.stringify(newData), now),
    ]
    if (parsed.data.type === 'single') {
      statements.push(env.DB.prepare(`INSERT INTO schedule_overrides
        (id, group_id, slot_id, original_date, action, original_start_time, original_end_time,
         new_start_time, new_end_time, new_date, new_teacher_id, reason, change_id, changed_by, changed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), validation.group.id, parsed.data.slotId, validation.startDate,
          parsed.data.action, validation.oldLesson.startTime, validation.oldLesson.endTime,
          parsed.data.action === 'cancel' ? null : validation.newLesson.startTime,
          parsed.data.action === 'cancel' ? null : validation.newLesson.endTime,
          parsed.data.action === 'cancel' ? null : (validation.newLesson.newDate || validation.startDate),
          parsed.data.action === 'cancel' ? null : validation.newLesson.teacherId,
          parsed.data.reason, id, profile.id, now))
    } else {
      statements.push(env.DB.prepare(`UPDATE schedule_versions SET valid_to = ?
        WHERE group_id = ? AND valid_to IS NULL`).bind(validation.startDate, validation.group.id))
      statements.push(env.DB.prepare(`INSERT INTO schedule_versions
        (id, group_id, valid_from, valid_to, schedule, change_id, created_by, created_at)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), validation.group.id, validation.startDate,
          JSON.stringify(validation.nextSchedule), id, profile.id, now))
      statements.push(env.DB.prepare('UPDATE groups SET teacher_id = ? WHERE id = ?')
        .bind(newData.teacherId, validation.group.id))
    }
    statements.push(env.DB.prepare(`INSERT INTO schedule_change_events
      (id, change_id, group_id, request_id, event_type, actor_id, details, created_at)
      VALUES (?, ?, ?, ?, 'created', ?, ?, ?)`)
      .bind(crypto.randomUUID(), id, validation.group.id, parsed.data.requestId, profile.id,
        JSON.stringify({ oldData, newData, reason: parsed.data.reason }), now))
    statements.push(...await enqueueScheduleNotices(env, {
      changeId: id, group: validation.group, type: parsed.data.type, reason: parsed.data.reason,
      oldLesson: validation.oldLesson, newLesson: validation.newLesson, actorRole: profile.role,
      recipients: validation.recipients,
    }))
    try {
      await env.DB.batch(statements)
    } catch (error) {
      if (/unique|constraint/i.test(error?.message || '')) {
        const duplicate = await env.DB.prepare('SELECT id FROM schedule_changes WHERE request_id = ?')
          .bind(parsed.data.requestId).first()
        if (duplicate) return json({ data: { id: duplicate.id, duplicate: true } })
        return fail('Bu dars uchun jadval o‘zgarishi mavjud.', 409)
      }
      throw error
    }
    return json({ data: { id, duplicate: false } }, 201)
  }

  const undoMatch = /^\/api\/schedule\/changes\/([^/]+)\/undo$/.exec(pathname)
  if (undoMatch && request.method === 'POST') {
    if (!canAccessEndpoint(profile.role, 'schedule:manage') && !canAccessEndpoint(profile.role, 'schedule:manage-own')) {
      return fail('Jadval o‘zgarishini qaytarishga ruxsat yo‘q.', 403)
    }
    const change = await env.DB.prepare('SELECT * FROM schedule_changes WHERE id = ?').bind(decodeURIComponent(undoMatch[1])).first()
    if (!change) return fail('O‘zgarish topilmadi.', 404)
    if (change.status !== 'active') return fail('Bu o‘zgarish allaqachon qaytarilgan.', 409)
    const state = await loadScheduleState(env, [change.group_id])
    const group = groupById(state, change.group_id)
    const today = tashkentToday()
    const oldData = JSON.parse(change.old_data || '{}')
    const newData = JSON.parse(change.new_data || '{}')
    if (profile.role === 'teacher') {
      const historicalTeacherIds = [
        oldData.teacherId,
        newData.teacherId,
        oldData.lesson?.teacherId,
        newData.lesson?.teacherId,
        ...(oldData.schedule || []).map((slot) => slot.teacherId),
        ...(newData.schedule || []).map((slot) => slot.teacherId),
      ]
      if (!historicalTeacherIds.includes(profile.teacher_id)) {
        return fail('Faqat o‘zingizga tegishli jadval o‘zgarishini qaytara olasiz.', 403)
      }
    }
    if (change.change_type !== 'single') {
      const changedVersion = state.versions.find((version) => version.change_id === change.id)
      const hasLaterVersion = changedVersion && state.versions.some((version) => (
        version.group_id === change.group_id
        && version.valid_from > changedVersion.valid_from
        && version.id !== changedVersion.id
      ))
      if (hasLaterVersion) {
        return fail('Keyinroq jadval o‘zgarishlari bor. Avval so‘nggi o‘zgarishni qaytaring.', 409)
      }
    }
    const now = new Date().toISOString()
    const statements = []
    if (change.change_type === 'single') {
      statements.push(env.DB.prepare('UPDATE schedule_overrides SET reverted_at = ? WHERE change_id = ? AND reverted_at IS NULL')
        .bind(now, change.id))
    } else {
      const currentSchedule = activeWeeklySchedule(group, state.versions, today)
      let restoredSchedule
      if (change.change_type === 'replace') {
        restoredSchedule = normalizedSchedule(oldData.schedule || [])
      } else {
        restoredSchedule = currentSchedule.map((slot) => ({ ...slot }))
        const changedSlot = newData.lesson
        const previousSlot = oldData.lesson
        const index = restoredSchedule.findIndex((slot) => slot.slotId === changedSlot?.slotId)
        if (index >= 0 && previousSlot) restoredSchedule[index] = { ...previousSlot, slotId: changedSlot.slotId }
      }
      if (!restoredSchedule) return fail('Oldingi jadvalni tiklab bo‘lmadi.', 409)
      const undoId = crypto.randomUUID()
      statements.push(env.DB.prepare('UPDATE schedule_versions SET valid_to = ? WHERE group_id = ? AND valid_to IS NULL')
        .bind(today, group.id))
      statements.push(env.DB.prepare(`INSERT INTO schedule_versions
        (id, group_id, valid_from, valid_to, schedule, change_id, created_by, created_at)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), group.id, today, JSON.stringify(restoredSchedule), undoId, profile.id, now))
      statements.push(env.DB.prepare('UPDATE groups SET teacher_id = ? WHERE id = ?')
        .bind(oldData.teacherId || group.teacher_id, group.id))
    }
    statements.push(env.DB.prepare('UPDATE schedule_changes SET status = ?, reverted_at = ? WHERE id = ?')
      .bind('reverted', now, change.id))
    const undoRequestId = `undo:${change.id}`
    statements.push(env.DB.prepare(`INSERT INTO schedule_change_events
      (id, change_id, group_id, request_id, event_type, actor_id, details, created_at)
      VALUES (?, ?, ?, ?, 'reverted', ?, ?, ?)`)
      .bind(crypto.randomUUID(), change.id, group.id, null, profile.id,
        JSON.stringify({ oldData: newData, newData: oldData, reason: change.reason, requestId: undoRequestId }), now))
    const undoOldLesson = newData.lesson || oldData.lesson || {}
    const undoNewLesson = oldData.lesson || newData.lesson || {}
    const undoTeacherIds = [
      undoOldLesson.teacherId || group.teacher_id,
      undoNewLesson.teacherId || group.teacher_id,
      ...(oldData.schedule || []).map((slot) => slot.teacherId || oldData.teacherId),
      ...(newData.schedule || []).map((slot) => slot.teacherId || newData.teacherId),
    ]
    const recipients = await scheduleRecipients(env, group.id, undoTeacherIds, profile.role === 'teacher')
    for (const recipient of recipients) {
      for (const channel of ['in_app', 'telegram']) {
        if (channel === 'in_app' && !recipient.profileId) continue
        const telegramId = channel === 'telegram' ? recipient.telegramId : null
        const status = channel === 'telegram' ? (telegramId ? 'queued' : 'not_linked') : 'sent'
        statements.push(env.DB.prepare(`INSERT OR IGNORE INTO schedule_notification_outbox
          (id, change_id, recipient_id, recipient_name, channel, notification_kind, telegram_id, message,
           status, scheduled_at, next_attempt_at, sent_at)
          VALUES (?, ?, ?, ?, ?, 'undo', ?, ?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), change.id, recipient.profileId || recipient.recipientId,
            recipient.name, channel, telegramId,
            scheduleNoticeText({ groupName: group.name, type: change.change_type, kind: 'undo',
              reason: change.reason, oldLesson: undoOldLesson, newLesson: undoNewLesson }),
            status, now, now, status === 'sent' ? now : null))
      }
    }
    try {
      await env.DB.batch(statements)
    } catch (error) {
      console.error('Schedule undo failed', error instanceof Error ? error.message : 'UnknownError')
      return fail('Jadval o‘zgarishini qaytarib bo‘lmadi.', 409)
    }
    return json({ data: { id: change.id, reverted: true } })
  }

  const resendMatch = /^\/api\/schedule\/notifications\/([^/]+)\/resend$/.exec(pathname)
  if (resendMatch && request.method === 'POST') {
    if (!STAFF.has(profile.role)) return fail('Faqat Egasi yoki Qabulxona qayta yubora oladi.', 403)
    const notification = await env.DB.prepare(`SELECT o.* FROM schedule_notification_outbox o
      JOIN schedule_changes c ON c.id = o.change_id
      WHERE o.id = ? AND o.channel = 'telegram'`).bind(decodeURIComponent(resendMatch[1])).first()
    if (!notification) return fail('Xabarnoma topilmadi.', 404)
    if (notification.status !== 'failed') return fail('Faqat yuborilmagan xatoli xabarni qayta yuborish mumkin.', 409)
    if (!notification.telegram_id) return fail('Telegram akkaunt ulanmagan.', 409)
    await env.DB.prepare(`UPDATE schedule_notification_outbox
      SET status = 'queued', attempts = 0, next_attempt_at = ?, last_error = NULL
      WHERE id = ? AND status = 'failed'`).bind(new Date().toISOString(), notification.id).run()
    return json({ data: { id: notification.id, status: 'queued' } })
  }

  return fail('Schedule route not found.', 404)
}

async function processScheduleNotificationOutbox(env) {
  const now = new Date().toISOString()
  await env.DB.prepare(`UPDATE schedule_notification_outbox SET status = 'queued'
    WHERE status = 'sending' AND next_attempt_at <= ?`).bind(now).run()
  const due = await env.DB.prepare(`SELECT * FROM schedule_notification_outbox
    WHERE status = 'queued' AND scheduled_at <= ? AND next_attempt_at <= ?
    ORDER BY scheduled_at, created_at LIMIT 20`).bind(now, now).all()
  if (!due.results?.length) return
  let bot = null
  for (const item of due.results) {
    const leaseUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    const claim = await env.DB.prepare(`UPDATE schedule_notification_outbox
      SET status = 'sending', next_attempt_at = ?
      WHERE id = ? AND status = 'queued' AND scheduled_at <= ? AND next_attempt_at <= ?`)
      .bind(leaseUntil, item.id, now, now).run()
    if (!claim.meta?.changes) continue
    try {
      if (item.channel === 'telegram') {
        if (!env.TELEGRAM_BOT_TOKEN) throw Object.assign(new Error('Telegram bot sozlanmagan.'), { retryable: false })
        bot ||= await getWorkerBot(env, env.TELEGRAM_WEBAPP_URL ? new URL(env.TELEGRAM_WEBAPP_URL).origin : 'https://localhost')
        await bot.api.sendMessage(item.telegram_id, item.message)
      }
      await env.DB.prepare(`UPDATE schedule_notification_outbox
        SET status = 'sent', sent_at = ?, attempts = attempts + 1, last_error = NULL
        WHERE id = ? AND status = 'sending'`).bind(now, item.id).run()
    } catch (error) {
      const attempts = Number(item.attempts || 0) + 1
      const code = error?.error_code || error?.error?.error_code || 0
      const retryAfter = Number(error?.parameters?.retry_after || error?.error?.parameters?.retry_after || 0)
      const retry = error?.retryable !== false && code !== 403 && attempts < 8
      const waitSeconds = retryAfter || Math.min(21600, 30 * (2 ** (attempts - 1)))
      const nextAttempt = new Date(Date.now() + waitSeconds * 1000).toISOString()
      const message = String(error?.description || error?.message || 'Telegramga yuborilmadi.').slice(0, 300)
      await env.DB.prepare(`UPDATE schedule_notification_outbox
        SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ?
        WHERE id = ? AND status = 'sending'`)
        .bind(retry ? 'queued' : 'failed', attempts, nextAttempt, message, item.id).run()
    }
  }
}

async function handleRequest(request, env) {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)
  if (url.pathname === '/api/health') return json({ ok: true, service: 'kamol-cloudflare-api' })
  if (url.pathname === '/api/telegram/bot-info' && request.method === 'GET') {
    if (env.TELEGRAM_BOT_USERNAME) return json({ bot_username: env.TELEGRAM_BOT_USERNAME })
    if (!env.TELEGRAM_BOT_TOKEN) return fail('Telegram bot sozlanmagan.', 503)
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`)
    const result = await response.json()
    if (!response.ok || !result.ok || !result.result?.username) return fail('Telegram bot nomini aniqlab bo‘lmadi.', 502)
    return json({ bot_username: result.result.username })
  }
  if (url.pathname === '/api/telegram/webhook' && request.method === 'POST') return handleTelegramWebhook(request, env)
  if (url.pathname === '/api/auth/seed-owner' && request.method === 'POST') return handleOwnerSeed(request, env)
  if (url.pathname.startsWith('/api/bot/')) return handleBot(request, env, url.pathname)
  if ((url.pathname === '/api/auth/telegram' || url.pathname === '/api/telegram-auth') && request.method === 'POST') return telegramLogin(request, env)
  if (url.pathname === '/api/auth/telegram/password' && request.method === 'POST') return telegramPasswordLogin(request, env)
  if (url.pathname === '/api/auth/login' && request.method === 'POST') return authLogin(request, env)
  if (url.pathname === '/api/auth/refresh' && request.method === 'POST') return refreshSession(request, env)

  const service = Boolean(env.BOT_API_SECRET && request.headers.get('X-Bot-Secret') === env.BOT_API_SECRET)
  const profile = await authenticate(request, env)
  if (url.pathname === '/api/schedule/state'
    || url.pathname === '/api/schedule/history'
    || url.pathname === '/api/schedule/preview'
    || url.pathname === '/api/schedule/changes'
    || url.pathname.startsWith('/api/schedule/changes/')
    || url.pathname.startsWith('/api/schedule/notifications/')
    || url.pathname === '/api/notifications') {
    return handleScheduleRoutes(request, env, profile, url.pathname)
  }
  if (url.pathname === '/api/auth/me') {
    return profile
      ? json({ user: { ...profile, must_reset_password: Boolean(profile.password_reset_required) } })
      : fail('Session expired.', 401)
  }
  if (url.pathname === '/api/staff' || url.pathname.startsWith('/api/staff/')) {
    return handleStaffAccounts(request, env, profile, url.pathname)
  }
  if (url.pathname === '/api/students' || /^\/api\/students\/[^/]+$/.test(url.pathname)) {
    return handleStudentRecords(request, env, profile, url.pathname)
  }
  if (/^\/api\/students\/[^/]+\/(?:password(?:\/reveal)?|telegram\/unlink)$/.test(url.pathname)) {
    return handleStudentPassword(request, env, profile, url.pathname)
  }
  if (url.pathname === '/api/miniapp/student/overview' && request.method === 'GET') {
    if (!profile) return fail('Login required.', 401)
    return getStudentMiniAppOverview(request, env, profile)
  }
  if (url.pathname.startsWith('/api/files/') && request.method === 'GET') {
    if (!profile) return fail('Login required.', 401)
    if (profile.role === 'student' && profile.auth_method !== 'telegram') return fail('Access denied.', 403)
    if (!canAccessEndpoint(profile.role, 'files:homework-access')) return fail('Access denied.', 403)
    return handleFileDownload(request, env, profile)
  }
  if (profile?.role === 'student'
    && (profile.auth_method !== 'telegram'
      || !(url.pathname === '/api/auth/logout' || url.pathname.startsWith('/api/files/')
        || ['/api/miniapp/student/overview', '/api/homework/draft', '/api/homework/draft/file',
        '/api/homework/draft/proof', '/api/homework/draft/confirm', '/api/homework/declaration',
          '/api/homework/history', '/api/homework/student', '/api/questions'].includes(url.pathname)))) {
    return fail('Access denied.', 403)
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
    if (profile.role === 'student' || !canAccessEndpoint(profile.role, 'auth:staff')) return fail('Access denied.', 403)
    const parsed = z.object({ password: z.string().min(12).max(128) }).safeParse(await request.json())
    if (!parsed.success) return fail('Parol kamida 12 belgidan iborat bo‘lishi kerak.')
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
  if (url.pathname === '/api/payments/correct' && request.method === 'POST') {
    if (!profile) return fail('Login required.', 401)
    return correctPayment(request, env, profile)
  }
  if (url.pathname === '/api/payments/void' && request.method === 'POST') {
    if (!profile) return fail('Login required.', 401)
    return voidPayment(request, env, profile)
  }
  if (url.pathname === '/api/payments/history' && request.method === 'GET') {
    if (!profile) return fail('Login required.', 401)
    return paymentsHistory(request, env, profile)
  }
  if (url.pathname.startsWith('/api/homework/')) {
    return handleHomeworkRoutes(request, env, profile, url.pathname)
  }
  if (url.pathname === '/api/questions' || url.pathname.startsWith('/api/questions/')) {
    return handleQuestions(request, env, profile, url.pathname)
  }
  if (url.pathname.startsWith('/api/rpc/')) {
    if (!profile) return fail('Login required.', 401)
    if (profile.role === 'student') return fail('Access denied.', 403)
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
    if (!(file instanceof File) || file.size <= 0 || file.size > 100 * 1024 * 1024) return fail('Each file must be smaller than 100 MB.')
    if (homeworkId) {
      const homework = await env.DB.prepare('SELECT * FROM homework WHERE id = ?').bind(homeworkId).first()
      if (!homework || !(await canRead(env, profile, 'homework', homework))) return fail('Homework access denied.', 403)
    } else if (profile.role === 'teacher') {
      if (!groupId || !(await ownedGroupIds(env, profile)).includes(groupId)) return fail('Group access denied.', 403)
    } else if (!canAccessEndpoint(profile.role, 'data:staff-wide-read')) {
      return fail('Homework context is required.', 400)
    }
    const key = `homework/${crypto.randomUUID()}`
    const metadata = {
      httpMetadata: { contentType: 'application/octet-stream' },
      customMetadata: { originalName: file.name.slice(0, 180), uploaderId: profile.id },
    }
    if (typeof globalThis.FixedLengthStream === 'function') {
      const fixedLength = new globalThis.FixedLengthStream(file.size)
      const upload = env.FILES.put(key, fixedLength.readable, metadata)
      await file.stream().pipeTo(fixedLength.writable)
      await upload
    } else {
      await env.FILES.put(key, await file.arrayBuffer(), metadata)
    }
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
  if (!headers.has('Content-Security-Policy')) {
    headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'")
  }
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
    const requestPath = new URL(request.url).pathname
    const maxRequestSize = ['/api/files', '/api/homework/draft/file'].includes(requestPath)
      ? 101 * 1024 * 1024
      : requestPath === '/api/questions' ? 21 * 1024 * 1024 : 12 * 1024 * 1024
    if (Number(request.headers.get('Content-Length') || 0) > maxRequestSize) {
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
    context.waitUntil(Promise.all([
      processBotEvents(env),
      expireHomeworkDrafts(env),
      processScheduleNotificationOutbox(env),
    ]).catch((error) => {
      console.error('Scheduled tasks failed', error instanceof Error ? error.name : 'UnknownError')
    }))
  },
}
