import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Miniflare } from 'miniflare'
import worker, { canAccessTable } from '../worker/index.js'
import { calculateFinanceSummary, validateGroupSchedule } from '../worker/domain.js'
import { hashInviteCode } from '../worker/telegram-auth.js'

const authSecret = 'test-auth-secret-with-sufficient-entropy'
let miniflare
let env

async function request(path, { method = 'GET', body, token, headers = {} } = {}) {
  const requestHeaders = new Headers(headers)
  if (body !== undefined && !(body instanceof FormData)) requestHeaders.set('Content-Type', 'application/json')
  if (token) requestHeaders.set('Authorization', `Bearer ${token}`)
  const requestBody = body === undefined
    ? undefined
    : body instanceof FormData ? body : JSON.stringify(body)
  return worker.fetch(new Request(`https://school.test${path}`, {
    method,
    headers: requestHeaders,
    body: requestBody,
  }), env)
}

async function loginOwner() {
  const loginResponse = await request('/api/auth/login', {
    method: 'POST',
    body: { username: 'owner', password: 'secure-owner-password' },
  })
  expect(loginResponse.status).toBe(200)
  return (await loginResponse.json()).session
}

async function telegramInitData(telegramId, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: 'test-query',
    user: JSON.stringify({ id: telegramId, first_name: 'Test Student' }),
  })
  const checkString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secret = await crypto.subtle.sign(
    'HMAC',
    await crypto.subtle.importKey('raw', new TextEncoder().encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    new TextEncoder().encode(env.TELEGRAM_BOT_TOKEN),
  )
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(checkString))
  params.set('hash', [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join(''))
  return params.toString()
}

async function seedOwner() {
  const response = await request('/api/auth/seed-owner', {
    method: 'POST',
    headers: { 'X-Owner-Seed-Secret': 'test-seed-secret' },
    body: { username: 'owner', name: 'Owner', password: 'secure-owner-password' },
  })
  expect(response.status).toBe(201)
}

beforeAll(async () => {
  miniflare = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2025-09-15',
    d1Databases: { DB: 'kamol-test' },
    r2Buckets: { FILES: 'kamol-test-files' },
  })
  const db = await miniflare.getD1Database('DB')
  const schema = [
    'CREATE TABLE accounts (id TEXT PRIMARY KEY, password_hash TEXT, password_salt TEXT, password_iterations INTEGER NOT NULL DEFAULT 100000, password_reset_required INTEGER NOT NULL DEFAULT 1, session_version INTEGER NOT NULL DEFAULT 0)',
    'CREATE TABLE login_attempts (identifier TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, window_started_at INTEGER NOT NULL, blocked_until INTEGER NOT NULL DEFAULT 0)',
    "CREATE TABLE profiles (id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, username TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'teacher', 'student', 'reception')), teacher_id TEXT, student_id TEXT, telegram_id INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    'CREATE UNIQUE INDEX profiles_telegram_id_unique_idx ON profiles(telegram_id) WHERE telegram_id IS NOT NULL',
    'CREATE TABLE refresh_tokens (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, used_at INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE students (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT \'\', parent_phone TEXT NOT NULL DEFAULT \'\', monthly_fee REAL NOT NULL DEFAULT 0, joined_at TEXT NOT NULL DEFAULT (date(\'now\')), public_code TEXT UNIQUE, login TEXT UNIQUE, auth_user_id TEXT, telegram_id INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE teachers (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT \'\', monthly_salary REAL NOT NULL DEFAULT 0, telegram_id INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE telegram_links (chat_id INTEGER PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE group_students (group_id TEXT NOT NULL, student_id TEXT NOT NULL, PRIMARY KEY (group_id, student_id))',
    "CREATE TABLE groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, teacher_id TEXT, monthly_fee REAL NOT NULL DEFAULT 0, schedule TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE homework (id TEXT PRIMARY KEY, group_id TEXT NOT NULL, teacher_id TEXT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', due_at TEXT, deadline TEXT, file_url TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)",
    'CREATE TABLE homework_submissions (id TEXT PRIMARY KEY, homework_id TEXT NOT NULL, student_id TEXT NOT NULL, file_url TEXT, text_answer TEXT NOT NULL DEFAULT \'\', content_text TEXT NOT NULL DEFAULT \'\', video_note_url TEXT, voice_url TEXT, status TEXT NOT NULL DEFAULT \'pending\', feedback TEXT NOT NULL DEFAULT \'\', review_note TEXT NOT NULL DEFAULT \'\', submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, reviewed_by TEXT, reviewed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(homework_id, student_id))',
    'CREATE TABLE homework_review_history (id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, homework_id TEXT NOT NULL, student_id TEXT NOT NULL, reviewer_id TEXT, reviewer_name TEXT NOT NULL DEFAULT \'\', old_status TEXT, new_status TEXT NOT NULL, old_comment TEXT NOT NULL DEFAULT \'\', new_comment TEXT NOT NULL DEFAULT \'\', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE telegram_invites (code_hash TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id), created_by TEXT NOT NULL REFERENCES profiles(id), expires_at INTEGER NOT NULL, used_at INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE bot_pending_homework (chat_id INTEGER PRIMARY KEY, homework_id TEXT NOT NULL, expires_at INTEGER NOT NULL)',
    'CREATE TABLE payments (id TEXT PRIMARY KEY, student_id TEXT, student_name TEXT NOT NULL DEFAULT \'\', amount REAL NOT NULL, month INTEGER NOT NULL, year INTEGER NOT NULL, paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, method TEXT NOT NULL DEFAULT \'cash\', note TEXT NOT NULL DEFAULT \'\', voided_at TEXT, voided_by TEXT, void_reason TEXT NOT NULL DEFAULT \'\', updated_at TEXT, updated_by TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE payment_audit (id TEXT PRIMARY KEY, payment_id TEXT NOT NULL, action TEXT NOT NULL, actor_id TEXT, actor_name TEXT NOT NULL DEFAULT \'\', reason TEXT NOT NULL DEFAULT \'\', old_data TEXT NOT NULL DEFAULT \'{}\', new_data TEXT NOT NULL DEFAULT \'{}\', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE salary_payments (id TEXT PRIMARY KEY, teacher_id TEXT NOT NULL, amount REAL NOT NULL, paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    "CREATE TABLE expenses (id TEXT PRIMARY KEY, title TEXT NOT NULL, amount REAL NOT NULL, category TEXT NOT NULL DEFAULT 'Operatsion', date TEXT NOT NULL DEFAULT (date('now')), recorded_by TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  ]
  for (const statement of schema) await db.prepare(statement).run()
  env = {
    DB: db,
    FILES: await miniflare.getR2Bucket('FILES'),
    AUTH_SECRET: authSecret,
    BOT_API_SECRET: 'test-bot-secret',
    OWNER_SEED_SECRET: 'test-seed-secret',
    TELEGRAM_BOT_TOKEN: 'test-telegram-token',
    TELEGRAM_BOT_USERNAME: 'KamolTestBot',
    TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
    ASSETS: { fetch: async () => new Response('asset') },
  }
  await seedOwner()
}, 30000)

afterAll(async () => {
  await miniflare?.dispose()
})

describe('schedule and finance domain rules', () => {
  it('rejects overlapping teacher schedules across groups', () => {
    const groups = [{
      id: 'existing',
      teacher_id: 'teacher-1',
      schedule: [{ day: 'mon', startTime: '09:00', endTime: '10:00' }],
    }]
    expect(validateGroupSchedule(
      [{ day: 'mon', startTime: '09:30', endTime: '10:30' }],
      groups,
      'new',
      'teacher-1',
    )).toMatch(/O‘qituvchi/)
  })

  it('rejects malformed saved schedules instead of skipping conflict checks', () => {
    expect(validateGroupSchedule(
      [{ day: 'mon', startTime: '09:00', endTime: '10:00' }],
      [{ id: 'existing', teacher_id: 'teacher-1', schedule: '{invalid' }],
      'new',
      'teacher-1',
    )).toMatch(/jadvali noto‘g‘ri/)
  })

  it('calculates income, costs, and net correctly', () => {
    expect(calculateFinanceSummary({
      payments: [{ amount: 100 }, { amount: '50' }],
      salaries: [{ amount: 30 }],
      expenses: [{ amount: 20 }, { amount: 5 }],
    })).toEqual({ income: 150, salary_cost: 30, expense_cost: 25, net: 95 })
  })
})

describe('server permission rules', () => {
  it('covers every role, table, and operation in the permission matrix', () => {
    const roles = ['owner', 'admin', 'reception', 'teacher', 'student']
    const tables = [
      'profiles', 'teachers', 'groups', 'students', 'telegram_links', 'group_students',
      'payments', 'salary_payments', 'expenses', 'attendance', 'staff_codes',
      'homework', 'homework_submissions', 'monthly_homework_report',
    ]
    const actions = ['select', 'insert', 'upsert', 'update', 'delete']
    const allowed = {
      owner: Object.fromEntries(tables.map((table) => [table, actions])),
      admin: {
        profiles: ['select'], teachers: actions, groups: actions, students: actions,
        telegram_links: actions, group_students: actions, payments: ['select', 'insert', 'upsert', 'update'],
        attendance: actions, homework: actions, homework_submissions: actions,
        monthly_homework_report: ['select'],
      },
      reception: {
        profiles: ['select'], teachers: actions, groups: actions, students: actions,
        telegram_links: actions, group_students: actions, payments: ['select', 'insert', 'upsert', 'update'],
        attendance: actions, homework: actions, homework_submissions: actions,
        monthly_homework_report: ['select'],
      },
      teacher: {
        profiles: ['select'], teachers: ['select'], groups: ['select'], students: ['select'],
        group_students: ['select'], attendance: ['select', 'insert', 'upsert', 'update'],
        homework: actions, homework_submissions: ['select', 'update'],
      },
      student: {
        profiles: ['select'], teachers: ['select'], groups: ['select'], students: ['select'],
        group_students: ['select'], payments: ['select'], attendance: ['select'],
        homework: ['select'], homework_submissions: ['select', 'insert', 'upsert', 'update'],
      },
    }

    for (const role of roles) {
      for (const table of tables) {
        for (const action of actions) {
          expect(canAccessTable({ role }, table, action)).toBe(allowed[role][table]?.includes(action) || false)
        }
      }
    }
  })

  it('limits financial tables to the owner', () => {
    expect(canAccessTable({ role: 'owner' }, 'expenses', 'select')).toBe(true)
    expect(canAccessTable({ role: 'admin' }, 'expenses', 'select')).toBe(false)
    expect(canAccessTable({ role: 'reception' }, 'payments', 'select')).toBe(true)
    expect(canAccessTable({ role: 'student' }, 'payments', 'select')).toBe(true)
    expect(canAccessTable({ role: 'student' }, 'payments', 'insert')).toBe(false)
    expect(canAccessTable({ role: 'student' }, 'homework_submissions', 'insert')).toBe(true)
  })
})

describe('D1 worker routes and authentication', () => {
  it('creates an owner with a PBKDF2 hash that can authenticate', async () => {
    const stored = await env.DB.prepare(`SELECT a.password_hash, a.password_salt, a.password_iterations
      FROM accounts a JOIN profiles p ON p.id = a.id WHERE p.username = 'owner'`).first()
    expect(stored.password_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(stored.password_salt).toMatch(/^[a-f0-9]{32}$/)
    expect(stored.password_iterations).toBe(100000)
    expect(await loginOwner()).toHaveProperty('access_token')
  })

  it('logs owner seed exceptions while returning a generic server error', async () => {
    const originalDatabase = env.DB
    const failure = new Error('test seed failure')
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    env.DB = { prepare() { throw failure } }

    try {
      const response = await request('/api/auth/seed-owner', {
        method: 'POST',
        headers: { 'X-Owner-Seed-Secret': 'test-seed-secret' },
        body: { username: 'probe-owner', name: 'Probe', password: 'secure-probe-password' },
      })
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: 'Internal server error.' })
      expect(errorLog).toHaveBeenCalledWith('Worker request failed', {
        path: '/api/auth/seed-owner',
        error: failure,
      })
    } finally {
      env.DB = originalDatabase
      errorLog.mockRestore()
    }
  })

  it('creates a hashed, expiring Telegram invite and consumes it once', async () => {
    const ownerSession = await loginOwner()
    await env.DB.prepare('INSERT INTO students (id, name) VALUES (?, ?)').bind('telegram-student', 'Telegram Student').run()
    const account = await request('/api/auth/signup', {
      method: 'POST',
      token: ownerSession.access_token,
      body: {
        username: 'telegramstudent',
        password: 'temporary-password',
        role: 'student',
        name: 'Telegram Student',
        student_id: 'telegram-student',
      },
    })
    expect(account.status).toBe(201)
    const profileId = (await account.json()).user.id
    const inviteResponse = await request('/api/telegram/invites', {
      method: 'POST',
      token: ownerSession.access_token,
      body: { profileId },
    })
    expect(inviteResponse.status).toBe(201)
    const invite = await inviteResponse.json()
    const code = new URL(invite.invite_url).searchParams.get('start')
    const stored = await env.DB.prepare('SELECT code_hash, expires_at FROM telegram_invites WHERE profile_id = ?')
      .bind(profileId).first()
    expect(stored.code_hash).toBe(await hashInviteCode(code))
    expect(stored.code_hash).not.toContain(code)
    expect(stored.expires_at).toBeGreaterThan(Date.now())

    const link = await request('/api/bot/invite/consume', {
      method: 'POST',
      headers: { 'X-Bot-Secret': env.BOT_API_SECRET },
      body: { code, telegramId: 987654321, staff: false },
    })
    expect(link.status).toBe(200)
    expect((await link.json()).data.role).toBe('student')
    const replay = await request('/api/bot/invite/consume', {
      method: 'POST',
      headers: { 'X-Bot-Secret': env.BOT_API_SECRET },
      body: { code, telegramId: 987654321, staff: false },
    })
    expect(replay.status).toBe(400)
    const linkedChat = await env.DB.prepare('SELECT student_id FROM telegram_links WHERE chat_id = ?')
      .bind(987654321).first()
    expect(linkedChat.student_id).toBe('telegram-student')

    const telegramLogin = await request('/api/auth/telegram', {
      method: 'POST',
      body: { initData: await telegramInitData(987654321) },
    })
    expect(telegramLogin.status).toBe(200)
    const miniAppSession = await telegramLogin.json()
    expect(miniAppSession.user.role).toBe('student')
    await env.DB.prepare('INSERT INTO payments (id, student_id, amount, month, year, paid_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('own-payment', 'telegram-student', 100, 1, 2026, '2020-01-01').run()
    await env.DB.prepare('INSERT INTO payments (id, student_id, amount, month, year, paid_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('other-payment', 'different-student', 200, 1, 2026, '2020-01-01').run()
    const ownPayments = await request('/api/db', {
      method: 'POST',
      token: miniAppSession.session.access_token,
      body: { table: 'payments', columns: 'id, student_id, amount' },
    })
    expect(ownPayments.status).toBe(200)
    expect((await ownPayments.json()).data).toEqual([
      { id: 'own-payment', student_id: 'telegram-student', amount: 100 },
    ])
    const paymentWrite = await request('/api/db', {
      method: 'POST',
      token: miniAppSession.session.access_token,
      body: { table: 'payments', action: 'insert', values: { student_id: 'telegram-student', amount: 1, month: 1, year: 2026 } },
    })
    expect(paymentWrite.status).toBe(403)

    await env.DB.prepare('INSERT INTO groups (id, name, teacher_id) VALUES (?, ?, ?)')
      .bind('telegram-group', 'Student Group', 'teacher-one').run()
    await env.DB.prepare('INSERT INTO group_students (group_id, student_id) VALUES (?, ?)')
      .bind('telegram-group', 'telegram-student').run()
    const homeworkId = '00000000-0000-4000-8000-000000000001'
    await env.DB.prepare('INSERT INTO homework (id, group_id, teacher_id, title) VALUES (?, ?, ?, ?)')
      .bind(homeworkId, 'telegram-group', 'teacher-one', 'Test homework').run()
    const openTasks = await request('/api/bot/student-homework', {
      method: 'POST',
      headers: { 'X-Bot-Secret': env.BOT_API_SECRET },
      body: { chat_id: 987654321 },
    })
    expect((await openTasks.json()).data).toHaveLength(1)
    const selected = await request('/api/bot/select-homework', {
      method: 'POST',
      headers: { 'X-Bot-Secret': env.BOT_API_SECRET },
      body: { chat_id: 987654321, homework_id: homeworkId },
    })
    expect(selected.status).toBe(200)
    const submission = await request('/api/bot/submission', {
      method: 'POST',
      headers: { 'X-Bot-Secret': env.BOT_API_SECRET },
      body: { chat_id: 987654321, homework_id: homeworkId, student_id: 'telegram-student', content_text: 'Javob' },
    })
    expect(submission.status).toBe(200)
    const pending = await env.DB.prepare('SELECT homework_id FROM bot_pending_homework WHERE chat_id = ?')
      .bind(987654321).first()
    expect(pending).toBeNull()

    const tampered = await request('/api/auth/telegram', {
      method: 'POST',
      body: { initData: `${await telegramInitData(987654321)}&query_id=changed` },
    })
    expect(tampered.status).toBe(401)
  })

  it('authenticates, rotates refresh tokens once, and revokes sessions on logout', async () => {
    const ownerSession = await loginOwner()
    const refreshedResponse = await request('/api/auth/refresh', {
      method: 'POST',
      body: { refresh_token: ownerSession.refresh_token },
    })
    expect(refreshedResponse.status).toBe(200)
    const refreshed = await refreshedResponse.json()
    const replay = await request('/api/auth/refresh', {
      method: 'POST',
      body: { refresh_token: ownerSession.refresh_token },
    })
    expect(replay.status).toBe(401)

    const logout = await request('/api/auth/logout', { token: refreshed.session.access_token, method: 'POST' })
    expect(logout.status).toBe(200)
    const me = await request('/api/auth/me', { token: refreshed.session.access_token })
    expect(me.status).toBe(401)
  })

  it('rate limits repeated login failures', async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await request('/api/auth/login', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '192.0.2.10' },
        body: { username: 'missing-user', password: 'not-a-valid-password' },
      })
      expect(response.status).toBe(401)
    }
    const blocked = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '192.0.2.10' },
      body: { username: 'missing-user', password: 'not-a-valid-password' },
    })
    expect(blocked.status).toBe(429)
  })

  it('blocks non-owners from finance endpoints and validates group conflicts', async () => {
    const ownerSession = await loginOwner()
    const createStudent = await request('/api/auth/signup', {
      method: 'POST',
      token: ownerSession.access_token,
      body: {
        username: 'student1',
        password: 'temporary-password',
        role: 'student',
        name: 'Student One',
      },
    })
    expect(createStudent.status).toBe(201)
    const student = await createStudent.json()
    const studentLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'student1', password: 'temporary-password' },
    })
    expect(studentLogin.status).toBe(200)
    const studentSession = await studentLogin.json()

    const finance = await request('/api/finance/summary?from=2026-01-01&to=2026-12-31', {
      token: studentSession.session.access_token,
    })
    expect(finance.status).toBe(403)
    const ownerFinance = await request('/api/finance/summary?from=2026-01-01&to=2026-12-31', {
      token: ownerSession.access_token,
    })
    expect(ownerFinance.status).toBe(200)
    expect(await ownerFinance.json()).toEqual({ income: 0, salary_cost: 0, expense_cost: 0, net: 0 })
    await env.DB.prepare('INSERT INTO teachers (id, name) VALUES (?, ?)').bind('salary-teacher', 'Salary Teacher').run()
    await env.DB.prepare('INSERT INTO salary_payments (id, teacher_id, amount, paid_at) VALUES (?, ?, ?, ?)')
      .bind('salary-test', 'salary-teacher', 10, '2020-01-01').run()
    const salaryRows = await request('/api/db', {
      method: 'POST',
      token: ownerSession.access_token,
      body: { table: 'salary_payments', columns: 'id, amount, teachers(name)' },
    })
    expect(salaryRows.status).toBe(200)
    expect((await salaryRows.json()).data).toEqual([
      { id: 'salary-test', amount: 10, teachers: { name: 'Salary Teacher' } },
    ])

    const ownProfile = await request('/api/db', {
      method: 'POST',
      token: studentSession.session.access_token,
      body: { table: 'profiles', filters: [{ op: 'eq', column: 'id', value: student.user.id }] },
    })
    expect(ownProfile.status).toBe(403)

    const markedReset = await env.DB.prepare('UPDATE accounts SET password_reset_required = 1 WHERE id = ?')
      .bind(student.user.id).run()
    expect(markedReset.success).toBe(true)
    const resetBlocked = await request('/api/finance/summary?from=2026-01-01&to=2026-12-31', {
      token: studentSession.session.access_token,
    })
    expect(resetBlocked.status).toBe(403)
    const passwordChanged = await request('/api/auth/update', {
      method: 'POST',
      token: studentSession.session.access_token,
      body: { password: 'new-secure-password' },
    })
    expect(passwordChanged.status).toBe(200)
    const changedSession = await passwordChanged.json()
    expect(changedSession.user.must_reset_password).toBe(false)
    const profileAfterReset = await request('/api/db', {
      method: 'POST',
      token: changedSession.session.access_token,
      body: { table: 'profiles', filters: [{ op: 'eq', column: 'id', value: student.user.id }] },
    })
    expect(profileAfterReset.status).toBe(200)
    const usernameLookup = await request('/api/rpc/lookup_login_email', {
      method: 'POST',
      token: changedSession.session.access_token,
      body: { p_login: 'owner' },
    })
    expect(usernameLookup.status).toBe(403)
    expect((await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'student1', password: 'new-secure-password' },
    })).status).toBe(200)

    const first = await request('/api/db', {
      method: 'POST',
      token: ownerSession.access_token,
      body: {
        table: 'groups',
        action: 'insert',
        values: { name: 'First', teacher_id: 'teacher-1', schedule: [{ day: 'mon', startTime: '09:00', endTime: '10:00' }] },
      },
    })
    expect(first.status).toBe(200)
    const conflict = await request('/api/db', {
      method: 'POST',
      token: ownerSession.access_token,
      body: {
        table: 'groups',
        action: 'insert',
        values: { name: 'Second', teacher_id: 'teacher-1', schedule: [{ day: 'mon', startTime: '09:30', endTime: '10:30' }] },
      },
    })
    expect(conflict.status).toBe(400)
    expect((await conflict.json()).error.message).toMatch(/O‘qituvchi/)
  })

  it('prevents a teacher from moving homework to another group', async () => {
    const ownerSession = await loginOwner()
    const teacherCreated = await request('/api/auth/signup', {
      method: 'POST',
      token: ownerSession.access_token,
      body: {
        username: 'teacher1',
        password: 'temporary-password',
        role: 'teacher',
        name: 'Teacher One',
        teacher_id: 'teacher-1',
      },
    })
    expect(teacherCreated.status).toBe(201)
    const teacherLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'teacher1', password: 'temporary-password' },
    })
    const initialSession = (await teacherLogin.json()).session
    const reset = await request('/api/auth/update', {
      method: 'POST',
      token: initialSession.access_token,
      body: { password: 'new-teacher-password' },
    })
    const teacherSession = (await reset.json()).session

    await env.DB.prepare('INSERT INTO groups (id, name, teacher_id) VALUES (?, ?, ?)')
      .bind('another-group', 'Another', 'teacher-2').run()
    const ownGroup = await env.DB.prepare('SELECT id FROM groups WHERE teacher_id = ? LIMIT 1')
      .bind('teacher-1').first()
    await env.DB.prepare('INSERT INTO homework (id, group_id, teacher_id, title) VALUES (?, ?, ?, ?)')
      .bind('homework-1', ownGroup.id, 'teacher-1', 'Original title').run()

    const attempt = await request('/api/db', {
      method: 'POST',
      token: teacherSession.access_token,
      body: {
        table: 'homework',
        action: 'update',
        filters: [{ op: 'eq', column: 'id', value: 'homework-1' }],
        values: { group_id: 'another-group', teacher_id: 'teacher-2', title: 'Updated title' },
      },
    })
    expect(attempt.status).toBe(200)
    const stored = await env.DB.prepare('SELECT group_id, teacher_id, title FROM homework WHERE id = ?')
      .bind('homework-1').first()
    expect(stored).toEqual({ group_id: ownGroup.id, teacher_id: 'teacher-1', title: 'Updated title' })
  })
})

describe('payment corrections and homework results', () => {
  async function createStaff(username, role) {
    const ownerSession = await loginOwner()
    const created = await request('/api/auth/signup', {
      method: 'POST',
      token: ownerSession.access_token,
      body: { username, password: 'temporary-password', role, name: username },
    })
    expect(created.status).toBe(201)
    const login = await request('/api/auth/login', {
      method: 'POST',
      body: { username, password: 'temporary-password' },
    })
    expect(login.status).toBe(200)
    const first = await login.json()
    const reset = await request('/api/auth/update', {
      method: 'POST',
      token: first.session.access_token,
      body: { password: `${username}-secure-password` },
    })
    expect(reset.status).toBe(200)
    return (await reset.json()).session
  }

  it('lets reception correct and void payments with an audit trail, but not delete them', async () => {
    const session = await createStaff('reception1', 'reception')
    await env.DB.prepare('INSERT INTO students (id, name) VALUES (?, ?)').bind('pay-student', 'Pay Student').run()
    await env.DB.prepare('INSERT INTO payments (id, student_id, student_name, amount, month, year, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind('pay-1', 'pay-student', 'Pay Student', 100, 3, 2026, '2026-03-05T10:00:00.000Z').run()

    const corrected = await request('/api/payments/correct', {
      method: 'POST',
      token: session.access_token,
      body: { id: 'pay-1', amount: 150, method: 'card', note: 'Karta orqali', reason: 'Summa xato yozilgan' },
    })
    expect(corrected.status).toBe(200)
    const stored = await env.DB.prepare('SELECT amount, method, note FROM payments WHERE id = ?').bind('pay-1').first()
    expect(stored).toEqual({ amount: 150, method: 'card', note: 'Karta orqali' })

    const noReason = await request('/api/payments/void', {
      method: 'POST',
      token: session.access_token,
      body: { id: 'pay-1' },
    })
    expect(noReason.status).toBe(400)
    const voided = await request('/api/payments/void', {
      method: 'POST',
      token: session.access_token,
      body: { id: 'pay-1', reason: 'Mijoz to‘lovni qaytardi' },
    })
    expect(voided.status).toBe(200)
    const voidRow = await env.DB.prepare('SELECT voided_at, void_reason FROM payments WHERE id = ?').bind('pay-1').first()
    expect(voidRow.voided_at).toBeTruthy()
    expect(voidRow.void_reason).toContain('qaytardi')

    const afterVoid = await request('/api/payments/correct', {
      method: 'POST',
      token: session.access_token,
      body: { id: 'pay-1', amount: 200 },
    })
    expect(afterVoid.status).toBe(409)

    const history = await request('/api/payments/history?payment_id=pay-1', { token: session.access_token })
    expect(history.status).toBe(200)
    const historyRows = (await history.json()).data
    expect(historyRows.map((row) => row.action)).toEqual(['voided', 'corrected'])
    expect(JSON.parse(historyRows[1].old_data).amount).toBe(100)
    expect(JSON.parse(historyRows[1].new_data).amount).toBe(150)

    const receptionDelete = await request('/api/db', {
      method: 'POST',
      token: session.access_token,
      body: { table: 'payments', action: 'delete', filters: [{ op: 'eq', column: 'id', value: 'pay-1' }] },
    })
    expect(receptionDelete.status).toBe(403)

    const ownerSession = await loginOwner()
    const ownerDelete = await request('/api/db', {
      method: 'POST',
      token: ownerSession.access_token,
      body: { table: 'payments', action: 'delete', filters: [{ op: 'eq', column: 'id', value: 'pay-1' }] },
    })
    expect(ownerDelete.status).toBe(200)
  })

  it('keeps the homework result teacher-only, requires media, and records every change', async () => {
    const ownerSession = await loginOwner()
    await env.DB.prepare('INSERT INTO teachers (id, name) VALUES (?, ?)').bind('teacher-review', 'Review Teacher').run()
    await env.DB.prepare('INSERT INTO groups (id, name, teacher_id) VALUES (?, ?, ?)')
      .bind('review-group', 'Review Group', 'teacher-review').run()
    await env.DB.prepare('INSERT INTO students (id, name) VALUES (?, ?)').bind('review-student', 'Review Student').run()
    await env.DB.prepare('INSERT INTO group_students (group_id, student_id) VALUES (?, ?)')
      .bind('review-group', 'review-student').run()
    await env.DB.prepare('INSERT INTO homework (id, group_id, teacher_id, title, deadline) VALUES (?, ?, ?, ?, ?)')
      .bind('review-homework', 'review-group', 'teacher-review', 'Essay', '2026-01-01T00:00:00.000Z').run()
    await env.DB.prepare('INSERT INTO homework_submissions (id, homework_id, student_id, content_text, status) VALUES (?, ?, ?, ?, ?)')
      .bind('review-submission', 'review-homework', 'review-student', 'Matn', 'pending').run()

    const incomplete = await request('/api/homework/review', {
      method: 'POST',
      token: ownerSession.access_token,
      body: { submission_id: 'review-submission', status: 'approved' },
    })
    expect(incomplete.status).toBe(400)

    await env.DB.prepare('UPDATE homework_submissions SET video_note_url = ? WHERE id = ?')
      .bind('https://files.test/video.mp4', 'review-submission').run()
    const approved = await request('/api/homework/review', {
      method: 'POST',
      token: ownerSession.access_token,
      body: { submission_id: 'review-submission', status: 'approved', comment: 'Yaxshi' },
    })
    expect(approved.status).toBe(200)
    const rejected = await request('/api/homework/review', {
      method: 'POST',
      token: ownerSession.access_token,
      body: { submission_id: 'review-submission', status: 'rejected', comment: 'Qayta ishlang' },
    })
    expect(rejected.status).toBe(200)

    const history = await request('/api/homework/history?submission_id=review-submission', {
      token: ownerSession.access_token,
    })
    const historyRows = (await history.json()).data
    expect(historyRows).toHaveLength(2)
    expect(historyRows[0].old_status).toBe('approved')
    expect(historyRows[0].new_status).toBe('rejected')
    expect(historyRows[1].old_status).toBe('pending')
    expect(historyRows[1].new_comment).toBe('Yaxshi')

    const receptionSession = await createStaff('reception2', 'reception')
    const receptionReview = await request('/api/homework/review', {
      method: 'POST',
      token: receptionSession.access_token,
      body: { submission_id: 'review-submission', status: 'approved' },
    })
    expect(receptionReview.status).toBe(403)
  })
})

describe('telegram webhook endpoint', () => {
  function startUpdate(updateId) {
    return {
      update_id: updateId,
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 424242, type: 'private' },
        from: { id: 424242, is_bot: false, first_name: 'Test' },
        text: '/start',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      },
    }
  }

  function telegramFetchMock(calls) {
    return vi.fn(async (input) => {
      const url = String(input instanceof Request ? input.url : input)
      calls.push(url)
      if (url.startsWith('https://school.test/')) return Response.json({ data: null })
      if (url.endsWith('/getMe')) {
        return Response.json({ ok: true, result: { id: 99, is_bot: true, first_name: 'Test Bot', username: 'KamolTestBot' } })
      }
      if (url.endsWith('/sendMessage')) {
        return Response.json({ ok: true, result: { message_id: 1, date: 0, chat: { id: 424242, type: 'private' } } })
      }
      if (url.endsWith('/setChatMenuButton')) return Response.json({ ok: true, result: true })
      throw new Error(`Unexpected Telegram API call: ${url.replace(/bot[^/]+/, 'bot<redacted>')}`)
    })
  }

  it('handles a /start update instead of failing because the bot was never initialized', async () => {
    const calls = []
    vi.stubGlobal('fetch', telegramFetchMock(calls))
    try {
      const response = await request('/api/telegram/webhook', {
        method: 'POST',
        headers: { 'X-Telegram-Bot-Api-Secret-Token': env.TELEGRAM_WEBHOOK_SECRET },
        body: startUpdate(1),
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true })
      expect(calls.some((url) => url.endsWith('/getMe'))).toBe(true)
      expect(calls.some((url) => url.endsWith('/sendMessage'))).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('answers /start without fetching the Worker\'s own API (Cloudflare 1042 loop)', async () => {
    const calls = []
    const sent = []
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input)
      calls.push(url)
      // Production behaviour: a Worker fetching its own workers.dev host fails with 1042 text.
      if (url.startsWith('https://school.test/api/bot/')) return new Response('error code: 1042', { status: 200 })
      if (url.endsWith('/getMe')) {
        return Response.json({ ok: true, result: { id: 99, is_bot: true, first_name: 'Test Bot', username: 'KamolTestBot' } })
      }
      if (url.endsWith('/sendMessage')) {
        sent.push(JSON.parse(init.body).text)
        return Response.json({ ok: true, result: { message_id: 1, date: 0, chat: { id: 424242, type: 'private' } } })
      }
      if (url.endsWith('/setChatMenuButton')) return Response.json({ ok: true, result: true })
      throw new Error(`Unexpected Telegram API call: ${url.replace(/bot[^/]+/, 'bot<redacted>')}`)
    }))
    try {
      const response = await request('/api/telegram/webhook', {
        method: 'POST',
        headers: { 'X-Telegram-Bot-Api-Secret-Token': env.TELEGRAM_WEBHOOK_SECRET },
        body: startUpdate(3),
      })
      expect(response.status).toBe(200)
      expect(calls.some((url) => url.startsWith('https://school.test/api/bot/'))).toBe(false)
      expect(sent.some((text) => text.includes('Kamol School ota-ona boti'))).toBe(true)
      expect(sent.some((text) => text.includes('So‘rovni bajarishda xatolik'))).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects updates with an invalid secret token without calling the bot API', async () => {
    const calls = []
    vi.stubGlobal('fetch', telegramFetchMock(calls))
    try {
      const response = await request('/api/telegram/webhook', {
        method: 'POST',
        headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret' },
        body: startUpdate(2),
      })
      expect(response.status).toBe(401)
      expect(calls).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
