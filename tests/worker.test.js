import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Miniflare } from 'miniflare'
import worker, { canAccessTable } from '../worker/index.js'
import { calculateFinanceSummary, validateGroupSchedule } from '../worker/domain.js'

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
    'CREATE TABLE accounts (id TEXT PRIMARY KEY, password_hash TEXT, password_salt TEXT, password_iterations INTEGER NOT NULL DEFAULT 120000, password_reset_required INTEGER NOT NULL DEFAULT 1, session_version INTEGER NOT NULL DEFAULT 0)',
    'CREATE TABLE login_attempts (identifier TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, window_started_at INTEGER NOT NULL, blocked_until INTEGER NOT NULL DEFAULT 0)',
    "CREATE TABLE profiles (id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, username TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'teacher', 'student', 'reception')), teacher_id TEXT, student_id TEXT, telegram_id INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    'CREATE TABLE refresh_tokens (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, used_at INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    "CREATE TABLE groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, teacher_id TEXT, monthly_fee REAL NOT NULL DEFAULT 0, schedule TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE homework (id TEXT PRIMARY KEY, group_id TEXT NOT NULL, teacher_id TEXT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', due_at TEXT, deadline TEXT, file_url TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)",
    'CREATE TABLE payments (id TEXT PRIMARY KEY, student_id TEXT, student_name TEXT NOT NULL DEFAULT \'\', amount REAL NOT NULL, month INTEGER NOT NULL, year INTEGER NOT NULL, paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE salary_payments (id TEXT PRIMARY KEY, teacher_id TEXT NOT NULL, amount REAL NOT NULL, paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    "CREATE TABLE expenses (id TEXT PRIMARY KEY, title TEXT NOT NULL, amount REAL NOT NULL, category TEXT NOT NULL DEFAULT 'Operatsion', date TEXT NOT NULL DEFAULT (date('now')), recorded_by TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  ]
  for (const statement of schema) await db.prepare(statement).run()
  env = {
    DB: db,
    FILES: await miniflare.getR2Bucket('FILES'),
    AUTH_SECRET: authSecret,
    BOT_API_SECRET: 'test-bot-secret',
    MIGRATION_SECRET: 'test-migration-secret',
    OWNER_SEED_SECRET: 'test-seed-secret',
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
  it('limits financial tables to the owner', () => {
    expect(canAccessTable({ role: 'owner' }, 'expenses', 'select')).toBe(true)
    expect(canAccessTable({ role: 'admin' }, 'expenses', 'select')).toBe(false)
    expect(canAccessTable({ role: 'reception' }, 'payments', 'select')).toBe(false)
    expect(canAccessTable({ role: 'student' }, 'homework_submissions', 'insert')).toBe(true)
  })
})

describe('D1 worker routes and authentication', () => {
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
