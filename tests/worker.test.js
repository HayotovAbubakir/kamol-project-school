import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Miniflare } from 'miniflare'
import worker, { buildHomeworkNotificationText, canAccessTable, expireHomeworkDrafts } from '../worker/index.js'
import { calculateFinanceSummary, validateGroupSchedule } from '../worker/domain.js'
import { hashInviteCode } from '../worker/telegram-auth.js'
import {
  extractHikvisionEvents,
  faceAttendanceNotice,
  faceAttendanceStatus,
  finalizeFaceAbsences,
  parseDeviceTime,
} from '../worker/face-id.js'
import { isValidLogin, loginBaseFromName } from '../shared/account-credentials.js'
import { findDateScheduleConflict, getEffectiveLesson } from '../shared/schedule.js'
import {
  ROLE_PERMISSIONS,
  ROLES,
  canAccessEndpoint as hasEndpointPermission,
  canAccessPage as hasPagePermission,
  canAccessTable as hasRoleTablePermission,
} from '../shared/role-permissions.js'

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
    'CREATE TABLE accounts (id TEXT PRIMARY KEY, password_hash TEXT, password_salt TEXT, password_iterations INTEGER NOT NULL DEFAULT 100000, password_reset_required INTEGER NOT NULL DEFAULT 1, session_version INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1)',
    'CREATE TABLE login_attempts (identifier TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, window_started_at INTEGER NOT NULL, blocked_until INTEGER NOT NULL DEFAULT 0)',
    'CREATE TABLE auth_failure_events (id TEXT PRIMARY KEY, identifier_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE student_credential_audit (id TEXT PRIMARY KEY, student_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    "CREATE TABLE profiles (id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, username TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('owner', 'teacher', 'student', 'reception')), teacher_id TEXT, student_id TEXT, telegram_id INTEGER, phone TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    'CREATE UNIQUE INDEX profiles_telegram_id_unique_idx ON profiles(telegram_id) WHERE telegram_id IS NOT NULL',
    'CREATE TABLE refresh_tokens (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, used_at INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE students (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT \'\', parent_phone TEXT NOT NULL DEFAULT \'\', monthly_fee REAL NOT NULL DEFAULT 0, joined_at TEXT NOT NULL DEFAULT (date(\'now\')), public_code TEXT UNIQUE, login TEXT UNIQUE COLLATE NOCASE, auth_user_id TEXT, telegram_id INTEGER, password_ciphertext TEXT, password_iv TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE teachers (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT \'\', monthly_salary REAL NOT NULL DEFAULT 0, telegram_id INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    "CREATE TABLE attendance (id TEXT PRIMARY KEY, student_id TEXT NOT NULL, group_id TEXT NOT NULL, date TEXT NOT NULL DEFAULT (date('now')), status TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', marked_by TEXT, marked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, source TEXT NOT NULL DEFAULT 'manual', checked_in_at TEXT, late_minutes INTEGER, UNIQUE (student_id, group_id, date))",
    "CREATE TABLE student_faces (id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE, r2_key TEXT NOT NULL UNIQUE, angle TEXT NOT NULL CHECK (angle IN ('front', 'left', 'right')), size_bytes INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (student_id, angle))",
    'CREATE TABLE face_people (student_id TEXT PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE, employee_no INTEGER NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    "CREATE TABLE face_devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, serial TEXT NOT NULL DEFAULT '', token_hash TEXT NOT NULL UNIQUE, is_active INTEGER NOT NULL DEFAULT 1, last_seen_at TEXT, last_event_at TEXT, created_by TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE face_sync (student_id TEXT NOT NULL, device_id TEXT NOT NULL REFERENCES face_devices(id) ON DELETE CASCADE, employee_no INTEGER NOT NULL, person_name TEXT NOT NULL DEFAULT '', action TEXT NOT NULL DEFAULT 'upsert', status TEXT NOT NULL DEFAULT 'pending', version INTEGER NOT NULL DEFAULT 1, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, synced_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (student_id, device_id))",
    "CREATE TABLE face_events (id TEXT PRIMARY KEY, device_id TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, employee_no TEXT, student_id TEXT, event_time TEXT NOT NULL, major INTEGER, minor INTEGER, raw TEXT NOT NULL DEFAULT '{}', processed INTEGER NOT NULL DEFAULT 0, result TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    'CREATE TABLE face_lesson_closures (group_id TEXT NOT NULL, date TEXT NOT NULL, slot_id TEXT NOT NULL, absent_count INTEGER NOT NULL DEFAULT 0, closed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (group_id, date, slot_id))',
    'CREATE TABLE telegram_links (chat_id INTEGER PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE group_students (group_id TEXT NOT NULL, student_id TEXT NOT NULL, PRIMARY KEY (group_id, student_id))',
    "CREATE TABLE groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, teacher_id TEXT, monthly_fee REAL NOT NULL DEFAULT 0, schedule TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE homework (id TEXT PRIMARY KEY, group_id TEXT NOT NULL, teacher_id TEXT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', due_at TEXT, deadline TEXT, file_url TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE homework_submissions (id TEXT PRIMARY KEY, homework_id TEXT NOT NULL, student_id TEXT NOT NULL, attempt_number INTEGER NOT NULL DEFAULT 1, file_url TEXT, text_answer TEXT NOT NULL DEFAULT '', content_text TEXT NOT NULL DEFAULT '', video_note_url TEXT, voice_url TEXT, status TEXT NOT NULL DEFAULT 'pending', state TEXT NOT NULL DEFAULT 'draft', student_result TEXT, student_reason TEXT NOT NULL DEFAULT '', teacher_result TEXT, feedback TEXT NOT NULL DEFAULT '', review_note TEXT NOT NULL DEFAULT '', submitted_at TEXT, reviewed_by TEXT, reviewed_at TEXT, expires_at INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(homework_id, student_id, attempt_number))",
    "CREATE UNIQUE INDEX homework_submissions_one_active_draft_idx ON homework_submissions(homework_id, student_id) WHERE state = 'draft'",
    "CREATE TABLE homework_submission_files (id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('attachment', 'voice', 'video_note')), r2_key TEXT NOT NULL UNIQUE, original_name TEXT NOT NULL DEFAULT '', mime_type TEXT NOT NULL DEFAULT 'application/octet-stream', size_bytes INTEGER NOT NULL CHECK (size_bytes > 0), duration_seconds REAL, telegram_chat_id INTEGER, telegram_message_id INTEGER, telegram_file_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    'CREATE UNIQUE INDEX homework_submission_single_proof_idx ON homework_submission_files(submission_id) WHERE kind IN (\'voice\', \'video_note\')',
    "CREATE TABLE homework_review_history (id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, homework_id TEXT NOT NULL, student_id TEXT NOT NULL, reviewer_id TEXT, reviewer_name TEXT NOT NULL DEFAULT '', old_status TEXT, new_status TEXT NOT NULL, old_comment TEXT NOT NULL DEFAULT '', new_comment TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE homework_events (id TEXT PRIMARY KEY, homework_id TEXT NOT NULL, submission_id TEXT, student_id TEXT, actor_id TEXT, event_type TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TRIGGER homework_events_no_update BEFORE UPDATE ON homework_events BEGIN SELECT RAISE(ABORT, 'Homework history is append-only'); END",
    "CREATE TRIGGER homework_events_no_delete BEFORE DELETE ON homework_events BEGIN SELECT RAISE(ABORT, 'Homework history is append-only'); END",
    "CREATE TABLE question_tickets (id TEXT PRIMARY KEY, student_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', tagged_group_id TEXT, last_message_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE question_messages (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, actor_id TEXT, actor_role TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', file_key TEXT, read_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    'CREATE TABLE bot_events (id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL, row_data TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE bot_event_cursors (name TEXT PRIMARY KEY, last_event_id INTEGER NOT NULL DEFAULT 0)',
    'CREATE TABLE telegram_invites (code_hash TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id), created_by TEXT NOT NULL REFERENCES profiles(id), expires_at INTEGER NOT NULL, used_at INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE bot_pending_homework (chat_id INTEGER PRIMARY KEY, homework_id TEXT NOT NULL, expires_at INTEGER NOT NULL)',
    'CREATE TABLE payments (id TEXT PRIMARY KEY, student_id TEXT, student_name TEXT NOT NULL DEFAULT \'\', amount REAL NOT NULL, month INTEGER NOT NULL, year INTEGER NOT NULL, paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, method TEXT NOT NULL DEFAULT \'cash\', note TEXT NOT NULL DEFAULT \'\', voided_at TEXT, voided_by TEXT, void_reason TEXT NOT NULL DEFAULT \'\', updated_at TEXT, updated_by TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE payment_audit (id TEXT PRIMARY KEY, payment_id TEXT NOT NULL, action TEXT NOT NULL, actor_id TEXT, actor_name TEXT NOT NULL DEFAULT \'\', reason TEXT NOT NULL DEFAULT \'\', old_data TEXT NOT NULL DEFAULT \'{}\', new_data TEXT NOT NULL DEFAULT \'{}\', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE salary_payments (id TEXT PRIMARY KEY, teacher_id TEXT NOT NULL, amount REAL NOT NULL, paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE schedule_versions (id TEXT PRIMARY KEY, group_id TEXT NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT, schedule TEXT NOT NULL, change_id TEXT, created_by TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    "CREATE TABLE schedule_changes (id TEXT PRIMARY KEY, group_id TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE, change_type TEXT NOT NULL, actor_id TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', old_data TEXT NOT NULL, new_data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, reverted_at TEXT)",
    "CREATE TABLE schedule_overrides (id TEXT PRIMARY KEY, group_id TEXT NOT NULL, slot_id TEXT NOT NULL, original_date TEXT NOT NULL, action TEXT NOT NULL, original_start_time TEXT NOT NULL, original_end_time TEXT NOT NULL, new_start_time TEXT, new_end_time TEXT, new_date TEXT, new_teacher_id TEXT, reason TEXT NOT NULL DEFAULT '', change_id TEXT NOT NULL, changed_by TEXT NOT NULL, changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, reverted_at TEXT)",
    "CREATE TABLE schedule_change_events (id TEXT PRIMARY KEY, change_id TEXT NOT NULL, group_id TEXT NOT NULL, request_id TEXT, event_type TEXT NOT NULL, actor_id TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE schedule_notification_outbox (id TEXT PRIMARY KEY, change_id TEXT NOT NULL, recipient_id TEXT NOT NULL, recipient_name TEXT NOT NULL DEFAULT '', channel TEXT NOT NULL, notification_kind TEXT NOT NULL, telegram_id INTEGER, message TEXT NOT NULL, status TEXT NOT NULL, scheduled_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, last_error TEXT, sent_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(change_id, recipient_id, channel, notification_kind))",
    "CREATE TABLE expenses (id TEXT PRIMARY KEY, title TEXT NOT NULL, amount REAL NOT NULL, category TEXT NOT NULL DEFAULT 'Operatsion', date TEXT NOT NULL DEFAULT (date('now')), recorded_by TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    "CREATE INDEX payment_audit_payment_idx ON payment_audit(payment_id)",
    // migrations/0010_perf_indexes.sql
    'CREATE INDEX IF NOT EXISTS payments_student_paid_at_idx ON payments(student_id, paid_at)',
    'CREATE INDEX IF NOT EXISTS payment_audit_created_at_idx ON payment_audit(created_at)',
    'CREATE INDEX IF NOT EXISTS attendance_group_date_idx ON attendance(group_id, date)',
    'CREATE INDEX IF NOT EXISTS attendance_student_date_idx ON attendance(student_id, date)',
    'CREATE INDEX IF NOT EXISTS homework_teacher_due_idx ON homework(teacher_id, due_at)',
    'CREATE INDEX IF NOT EXISTS homework_due_at_idx ON homework(due_at)',
    'CREATE INDEX IF NOT EXISTS homework_submissions_draft_expiry_idx ON homework_submissions(state, expires_at)',
    'CREATE INDEX IF NOT EXISTS salary_payments_paid_at_idx ON salary_payments(paid_at)',
    'CREATE INDEX IF NOT EXISTS salary_payments_teacher_idx ON salary_payments(teacher_id)',
    'CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses(date)',
    'CREATE INDEX IF NOT EXISTS face_sync_device_employee_idx ON face_sync(device_id, employee_no, version)',
    'CREATE INDEX IF NOT EXISTS face_lesson_closures_date_idx ON face_lesson_closures(date)',
    `CREATE VIEW monthly_homework_report AS
      SELECT st.id AS student_id, st.name AS student_name,
        date(substr(COALESCE(h.due_at, h.created_at), 1, 7) || '-01') AS month_start,
        COUNT(h.id) AS assigned_count,
        SUM(CASE WHEN hs.submitted_at IS NOT NULL AND (
          h.due_at IS NULL OR julianday(hs.submitted_at) <= julianday(h.due_at)
        ) THEN 1 ELSE 0 END) AS submitted_on_time_count,
        SUM(CASE WHEN hs.submitted_at IS NOT NULL AND h.due_at IS NOT NULL
          AND julianday(hs.submitted_at) > julianday(h.due_at) THEN 1 ELSE 0 END) AS late_count,
        SUM(CASE WHEN hs.student_result = 'not_done' OR hs.teacher_result = 'not_done'
          OR (hs.submitted_at IS NULL AND h.due_at IS NOT NULL AND julianday(h.due_at) < julianday('now'))
          THEN 1 ELSE 0 END) AS not_done_count,
        SUM(CASE WHEN hs.teacher_result = 'done' THEN 1 ELSE 0 END) AS bajardi_count,
        SUM(CASE WHEN hs.teacher_result = 'not_done' THEN 1 ELSE 0 END) AS bajarmadi_count
      FROM homework h JOIN group_students gs ON gs.group_id = h.group_id
      JOIN students st ON st.id = gs.student_id
      LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = st.id
        AND hs.attempt_number = (
          SELECT MAX(latest.attempt_number) FROM homework_submissions latest
          WHERE latest.homework_id = h.id AND latest.student_id = st.id
        )
      GROUP BY st.id, st.name, substr(COALESCE(h.due_at, h.created_at), 1, 7)`,
  ]
  for (const statement of schema) await db.prepare(statement).run()
  await db.prepare(`CREATE TRIGGER groups_schedule_requires_version
    BEFORE UPDATE OF schedule ON groups
    WHEN NEW.schedule IS NOT OLD.schedule
    BEGIN SELECT RAISE(ABORT, 'Use schedule version endpoints to change a group schedule'); END`).run()
  await db.prepare(`CREATE TRIGGER groups_schedule_seed_version
    AFTER INSERT ON groups
    WHEN NOT EXISTS (SELECT 1 FROM schedule_versions WHERE group_id = NEW.id)
    BEGIN
      INSERT INTO schedule_versions (id, group_id, valid_from, schedule, created_at)
      VALUES ('initial-' || NEW.id, NEW.id, '0001-01-01', NEW.schedule, CURRENT_TIMESTAMP);
    END`).run()
  env = {
    DB: db,
    FILES: await miniflare.getR2Bucket('FILES'),
    AUTH_SECRET: authSecret,
    STUDENT_PASSWORD_KEY: crypto.getRandomValues(new Uint8Array(32)).reduce((value, byte) => value + byte.toString(16).padStart(2, '0'), ''),
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
  it('formats teacher homework notifications with required student, timing, file, and proof details', () => {
    const text = buildHomeworkNotificationText({
      studentName: 'Test Student',
      groupName: 'A1',
      homeworkTitle: 'Unit 4',
      submittedAt: '2026-01-01T00:04:00.000Z',
      dueAt: '2026-01-01T00:00:00.000Z',
      attachments: [{ original_name: 'answer.pdf' }, { original_name: 'notes.txt' }],
      proofKind: 'video_note',
    })
    expect(text).toContain('O‘quvchi: Test Student')
    expect(text).toContain('Guruh: A1')
    expect(text).toContain('Vazifa: Unit 4')
    expect(text).toContain('Vaqt: 01.01.2026 05:04 (Asia/Tashkent)')
    expect(text).toContain('Kechikdi: 4 daqiqa')
    expect(text).toContain('Fayllar: 2; answer.pdf, notes.txt')
    expect(text).toContain('Proof: dumaloq video')
  })

  it('keeps homework history append-only and computes monthly report counters', async () => {
    await env.DB.prepare('INSERT INTO students (id, name) VALUES (?, ?)').bind('report-student', 'Report Student').run()
    await env.DB.prepare('INSERT INTO groups (id, name) VALUES (?, ?)').bind('report-group', 'Report Group').run()
    await env.DB.prepare('INSERT INTO group_students (group_id, student_id) VALUES (?, ?)')
      .bind('report-group', 'report-student').run()
    await env.DB.batch([
      env.DB.prepare('INSERT INTO homework (id, group_id, title, due_at, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind('report-on-time', 'report-group', 'On time', '2020-01-05T00:00:00.000Z', '2020-01-01'),
      env.DB.prepare('INSERT INTO homework (id, group_id, title, due_at, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind('report-late', 'report-group', 'Late', '2020-01-05T00:00:00.000Z', '2020-01-01'),
      env.DB.prepare('INSERT INTO homework (id, group_id, title, due_at, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind('report-missing', 'report-group', 'Missing', '2020-01-10T00:00:00.000Z', '2020-01-01'),
      env.DB.prepare(`INSERT INTO homework_submissions
        (id, homework_id, student_id, attempt_number, state, status, teacher_result, submitted_at)
        VALUES (?, ?, ?, 1, 'checked', 'approved', 'done', ?)`)
        .bind('report-on-time-submission', 'report-on-time', 'report-student', '2020-01-04T00:00:00.000Z'),
      env.DB.prepare(`INSERT INTO homework_submissions
        (id, homework_id, student_id, attempt_number, state, status, student_result, teacher_result, submitted_at)
        VALUES (?, ?, ?, 1, 'checked', 'rejected', 'not_done', 'not_done', ?)`)
        .bind('report-late-submission', 'report-late', 'report-student', '2020-01-07T00:00:00.000Z'),
      env.DB.prepare(`INSERT INTO homework_events
        (id, homework_id, submission_id, student_id, event_type, details)
        VALUES (?, ?, ?, ?, 'submitted', '{}')`)
        .bind('append-only-event', 'report-on-time', 'report-on-time-submission', 'report-student'),
    ])
    await expect(env.DB.prepare('UPDATE homework_events SET details = ? WHERE id = ?')
      .bind('changed', 'append-only-event').run()).rejects.toThrow(/append-only/)
    await expect(env.DB.prepare('DELETE FROM homework_events WHERE id = ?')
      .bind('append-only-event').run()).rejects.toThrow(/append-only/)

    const report = await env.DB.prepare(`SELECT assigned_count, submitted_on_time_count,
      late_count, not_done_count, bajardi_count, bajarmadi_count
      FROM monthly_homework_report WHERE student_id = ? AND month_start = '2020-01-01'`)
      .bind('report-student').first()
    expect(report).toEqual({
      assigned_count: 3,
      submitted_on_time_count: 1,
      late_count: 1,
      not_done_count: 2,
      bajardi_count: 1,
      bajarmadi_count: 1,
    })
  })

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
    const roles = [...ROLES]
    const tables = ['profiles', 'teachers', 'groups', 'students', 'telegram_links', 'group_students',
      'payments', 'salary_payments', 'expenses', 'attendance', 'staff_codes',
      'homework', 'homework_submissions', 'monthly_homework_report', 'payment_audit', 'homework_review_history']
    const actions = ['select', 'insert', 'upsert', 'update', 'delete']
    for (const role of roles) {
      for (const table of tables) {
        for (const action of actions) {
          expect(canAccessTable({ role }, table, action))
            .toBe(hasRoleTablePermission(role, table, action))
        }
      }
    }
  })

  it('limits financial tables to the owner', () => {
    expect(canAccessTable({ role: 'owner' }, 'expenses', 'select')).toBe(true)
    expect(canAccessTable({ role: 'reception' }, 'expenses', 'select')).toBe(false)
    expect(canAccessTable({ role: 'reception' }, 'payments', 'select')).toBe(true)
    expect(canAccessTable({ role: 'student' }, 'payments', 'select')).toBe(false)
    expect(canAccessTable({ role: 'student' }, 'payments', 'insert')).toBe(false)
    expect(canAccessTable({ role: 'student' }, 'homework_submissions', 'insert')).toBe(false)
  })

  it('gives owner a permission superset for every role in the shared matrix', () => {
    const tableNames = new Set(ROLES.flatMap((role) => (
      ROLE_PERMISSIONS[role].tables === '*'
        ? ['profiles', 'teachers', 'groups', 'students', 'telegram_links', 'group_students', 'payments',
          'salary_payments', 'expenses', 'attendance', 'homework', 'homework_submissions']
        : Object.keys(ROLE_PERMISSIONS[role].tables)
    )))
    for (const role of ROLES) {
      for (const table of tableNames) {
        const actions = ROLE_PERMISSIONS[role].tables === '*'
          ? ['select', 'insert', 'update', 'delete', 'upsert']
          : ROLE_PERMISSIONS[role].tables[table] || []
        for (const action of actions) {
          expect(hasRoleTablePermission('owner', table, action)).toBe(true)
        }
      }
      const endpoints = ROLE_PERMISSIONS[role].endpoints === '*'
        ? []
        : ROLE_PERMISSIONS[role].endpoints
      for (const endpoint of endpoints) expect(hasEndpointPermission('owner', endpoint)).toBe(true)
      const pages = ROLE_PERMISSIONS[role].pages === '*'
        ? []
        : ROLE_PERMISSIONS[role].pages
      for (const page of pages) expect(hasPagePermission('owner', page)).toBe(true)
    }
  })
})

describe('effective schedule dates', () => {
  const group = {
    id: 'group-1',
    name: 'Boshlang‘ich',
    teacher_id: 'teacher-1',
    schedule: [{ slotId: 'slot-1', day: 1, startTime: '09:00', endTime: '10:00', teacherId: 'teacher-1' }],
  }
  const date = '2026-11-09'

  it('uses the base schedule when no version or override applies', () => {
    expect(getEffectiveLesson(group.id, date, { group })).toMatchObject([
      { slotId: 'slot-1', date, startTime: '09:00', endTime: '10:00', status: 'regular' },
    ])
  })

  it('applies a single-date time change and cancellation', () => {
    const overrides = [
      {
        group_id: group.id, slot_id: 'slot-1', original_date: date, action: 'change',
        original_start_time: '09:00', original_end_time: '10:00',
        new_start_time: '10:00', new_end_time: '11:00',
      },
    ]
    expect(getEffectiveLesson(group.id, date, { group, overrides })[0])
      .toMatchObject({ startTime: '10:00', endTime: '11:00', status: 'changed' })
    expect(getEffectiveLesson(group.id, date, {
      group,
      overrides: [{ ...overrides[0], action: 'cancel' }],
    })[0]).toMatchObject({ status: 'cancelled' })
  })

  it('moves a lesson to another date and keeps its original-date marker', () => {
    const overrides = [{
      group_id: group.id, slot_id: 'slot-1', original_date: date, new_date: '2026-11-10',
      action: 'change', new_start_time: '11:00', new_end_time: '12:00',
    }]
    expect(getEffectiveLesson(group.id, date, { group, overrides })[0]).toMatchObject({
      status: 'rescheduled', newDate: '2026-11-10',
    })
    expect(getEffectiveLesson(group.id, '2026-11-10', { group, overrides })[0]).toMatchObject({
      status: 'changed', originalDate: date, startTime: '11:00', endTime: '12:00',
    })
  })

  it('selects the effective-dated weekly version and ignores reverted overrides', () => {
    const versions = [{
      id: 'version-2', group_id: group.id, valid_from: '2026-11-16',
      schedule: JSON.stringify([{ slotId: 'slot-1', day: 1, startTime: '12:00', endTime: '13:00' }]),
    }]
    expect(getEffectiveLesson(group.id, '2026-11-16', { group, versions })[0])
      .toMatchObject({ startTime: '12:00', status: 'regular' })
    expect(getEffectiveLesson(group.id, date, {
      group,
      overrides: [{
        group_id: group.id, slot_id: 'slot-1', original_date: date, action: 'cancel',
        reverted_at: '2026-11-08T12:00:00Z',
      }],
    })[0]).toMatchObject({ status: 'regular' })
  })

  it('detects teacher and same-group date conflicts', () => {
    const otherGroup = {
      id: 'group-2',
      name: 'O‘rta',
      teacher_id: 'teacher-1',
      schedule: [{ slotId: 'slot-2', day: 1, startTime: '09:00', endTime: '10:00' }],
    }
    expect(findDateScheduleConflict({
      date,
      lesson: { groupId: group.id, teacherId: 'teacher-1', startTime: '09:30', endTime: '10:30' },
      groups: [group, otherGroup],
      excludeSlotId: 'slot-1',
    })).toMatch(/O‘qituvchi/)
    expect(findDateScheduleConflict({
      date,
      lesson: { groupId: group.id, teacherId: 'teacher-1', startTime: '09:30', endTime: '10:30' },
      groups: [group],
      excludeSlotId: 'slot-other',
    })).toMatch(/Guruhning/)
  })
})

describe('schedule change API', () => {
  it('previews, authorizes, persists, deduplicates, and reverses a change with fan-out', async () => {
    const owner = await loginOwner()
    const dateNow = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())
    const date = new Date(`${dateNow}T12:00:00Z`)
    date.setUTCDate(date.getUTCDate() + 1)
    const lessonDate = date.toISOString().slice(0, 10)
    const weekday = date.getUTCDay() || 7
    const staffResponse = await request('/api/staff', {
      method: 'POST',
      token: owner.access_token,
      body: {
        name: 'Schedule Teacher',
        username: 'schedule-teacher',
        role: 'teacher',
        password: 'schedule-test-password',
        auto_username: false,
      },
    })
    expect(staffResponse.status).toBe(201)
    const teacher = (await staffResponse.json()).data
    await env.DB.prepare('UPDATE profiles SET telegram_id = ? WHERE id = ?').bind(1234567, teacher.id).run()

    await env.DB.prepare(`INSERT INTO students (id, name, login, telegram_id)
      VALUES ('schedule-student', 'Schedule Student', 'schedule-student', 1234568)`).run()
    await env.DB.prepare(`INSERT INTO accounts (id, password_reset_required, is_active)
      VALUES ('schedule-student-profile', 0, 1)`).run()
    await env.DB.prepare(`INSERT INTO profiles (id, username, name, role, student_id, telegram_id)
      VALUES ('schedule-student-profile', 'schedule-student-profile', 'Schedule Student', 'student', 'schedule-student', 1234568)`).run()
    await env.DB.prepare(`INSERT INTO groups (id, name, teacher_id, schedule)
      VALUES ('schedule-group', 'Schedule Group', ?, ?)`)
      .bind(teacher.teacher_id, JSON.stringify([{
        slotId: 'schedule-slot', day: weekday, startTime: '09:00', endTime: '10:00', teacherId: teacher.teacher_id,
      }])).run()
    await env.DB.prepare('INSERT INTO group_students (group_id, student_id) VALUES (?, ?)')
      .bind('schedule-group', 'schedule-student').run()
    await env.DB.prepare(`INSERT INTO groups (id, name, teacher_id, schedule)
      VALUES ('schedule-busy-group', 'Schedule Busy Group', ?, ?)`)
      .bind(teacher.teacher_id, JSON.stringify([{
        slotId: 'busy-slot', day: weekday, startTime: '11:30', endTime: '12:30', teacherId: teacher.teacher_id,
      }])).run()

    const login = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'schedule-teacher', password: 'schedule-test-password' },
    })
    expect(login.status).toBe(200)
    const teacherSession = (await login.json()).session
    const requestId = 'schedule-change-test-001'
    const payload = {
      requestId,
      groupId: 'schedule-group',
      type: 'single',
      reason: 'Xona band bo‘lgani uchun',
      slotId: 'schedule-slot',
      originalDate: lessonDate,
      action: 'change',
      newDate: lessonDate,
      startTime: '10:00',
      endTime: '11:00',
    }

    expect((await request('/api/schedule/preview', { method: 'POST', token: owner.access_token, body: payload })).status).toBe(200)
    expect((await request('/api/schedule/preview', { method: 'POST', token: teacherSession.access_token, body: payload })).status).toBe(200)
    expect((await request('/api/schedule/preview', { method: 'POST', body: payload })).status).toBe(401)
    expect((await request('/api/schedule/preview', {
      method: 'POST',
      token: owner.access_token,
      body: { ...payload, requestId: 'schedule-conflict-test-001', startTime: '11:00', endTime: '12:00' },
    })).status).toBe(409)
    expect((await request('/api/schedule/preview', {
      method: 'POST',
      token: owner.access_token,
      body: {
        requestId: 'schedule-weekly-conflict-test-001',
        groupId: 'schedule-group',
        type: 'replace',
        validFrom: lessonDate,
        reason: 'Yangi jadvalni tekshirish',
        schedule: [
          { slotId: 'slot-a', day: weekday, startTime: '09:00', endTime: '10:00', teacherId: teacher.teacher_id },
          { slotId: 'slot-b', day: weekday, startTime: '09:30', endTime: '10:30', teacherId: teacher.teacher_id },
        ],
      },
    })).status).toBe(409)
    const distantConflictDate = new Date(`${lessonDate}T12:00:00Z`)
    distantConflictDate.setUTCDate(distantConflictDate.getUTCDate() + 400)
    const distantConflictDateValue = distantConflictDate.toISOString().slice(0, 10)
    await env.DB.prepare(`UPDATE schedule_versions SET valid_to = ?
      WHERE group_id = 'schedule-busy-group' AND valid_to IS NULL`)
      .bind(distantConflictDateValue).run()
    await env.DB.prepare(`INSERT INTO schedule_versions
      (id, group_id, valid_from, schedule, change_id, created_by)
      VALUES ('distant-busy-version', 'schedule-busy-group', ?, ?, NULL, NULL)`)
      .bind(distantConflictDateValue, JSON.stringify([{
        slotId: 'busy-slot', day: weekday, startTime: '15:30', endTime: '16:30', teacherId: teacher.teacher_id,
      }])).run()
    expect((await request('/api/schedule/preview', {
      method: 'POST',
      token: owner.access_token,
      body: {
        requestId: 'schedule-distant-conflict-test-001',
        groupId: 'schedule-group',
        type: 'permanent',
        validFrom: lessonDate,
        slotId: 'schedule-slot',
        day: weekday,
        startTime: '15:00',
        endTime: '16:00',
        reason: 'Kelajakdagi ziddiyatni tekshirish',
      },
    })).status).toBe(409)
    const foreign = {
      ...payload,
      groupId: 'foreign-schedule-group',
      requestId: 'schedule-change-test-foreign',
    }
    await env.DB.prepare(`INSERT INTO groups (id, name, teacher_id, schedule)
      VALUES ('foreign-schedule-group', 'Foreign Schedule Group', 'other-teacher', '[]')`).run()
    expect((await request('/api/schedule/preview', {
      method: 'POST', token: teacherSession.access_token, body: foreign,
    })).status).toBe(403)

    const create = await request('/api/schedule/changes', { method: 'POST', token: owner.access_token, body: payload })
    expect(create.status).toBe(201)
    const created = (await create.json()).data
    const duplicate = await request('/api/schedule/changes', { method: 'POST', token: owner.access_token, body: payload })
    expect((await duplicate.json()).data).toEqual({ id: created.id, duplicate: true })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM schedule_changes WHERE request_id = ?')
      .bind(requestId).first()).toMatchObject({ count: 1 })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM schedule_notification_outbox WHERE change_id = ?')
      .bind(created.id).first()).toMatchObject({ count: 8 })
    expect(await env.DB.prepare('SELECT new_start_time FROM schedule_overrides WHERE change_id = ?')
      .bind(created.id).first()).toMatchObject({ new_start_time: '10:00' })

    const undo = await request(`/api/schedule/changes/${created.id}/undo`, {
      method: 'POST', token: owner.access_token, body: {},
    })
    expect(undo.status).toBe(200)
    expect((await env.DB.prepare('SELECT reverted_at FROM schedule_overrides WHERE change_id = ?')
      .bind(created.id).first()).reverted_at).toBeTruthy()
    expect(await env.DB.prepare(`SELECT COUNT(*) AS count FROM schedule_notification_outbox
      WHERE change_id = ? AND notification_kind = 'undo'`).bind(created.id).first()).toMatchObject({ count: 4 })

    const receptionCreate = await request('/api/staff', {
      method: 'POST',
      token: owner.access_token,
      body: {
        name: 'Schedule Reception',
        username: 'schedule-reception',
        role: 'reception',
        password: 'schedule-reception-password',
        auto_username: false,
      },
    })
    expect(receptionCreate.status).toBe(201)
    const receptionLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'schedule-reception', password: 'schedule-reception-password' },
    })
    const receptionSession = (await receptionLogin.json()).session
    const cancelPayload = {
      ...payload,
      requestId: 'schedule-cancel-test-001',
      action: 'cancel',
    }
    expect((await request('/api/schedule/preview', {
      method: 'POST', token: receptionSession.access_token, body: cancelPayload,
    })).status).toBe(200)
    const receptionChange = await request('/api/schedule/changes', {
      method: 'POST', token: receptionSession.access_token, body: cancelPayload,
    })
    expect(receptionChange.status).toBe(201)
    const receptionChangeId = (await receptionChange.json()).data.id
    expect(await env.DB.prepare(`SELECT COUNT(*) AS count FROM schedule_notification_outbox
      WHERE change_id = ? AND notification_kind = 'reminder'`).bind(receptionChangeId).first())
      .toMatchObject({ count: 0 })
  })

  it('rejects direct weekly schedule or teacher updates that bypass schedule history', async () => {
    const owner = await loginOwner()
    for (const values of [{ schedule: [] }, { teacher_id: 'other-teacher' }]) {
      const response = await request('/api/db', {
        method: 'POST',
        token: owner.access_token,
        body: { table: 'groups', action: 'update', filters: [{ op: 'eq', column: 'id', value: 'schedule-group' }], values },
      })
      expect(response.status).toBe(405)
    }
  })
})

describe('D1 worker routes and authentication', () => {
  it('does not expose disabled staff as active Telegram bot profiles', async () => {
    const owner = await loginOwner()
    const telegramId = 987654329
    const previousProfile = await env.DB.prepare('SELECT telegram_id FROM profiles WHERE id = ?')
      .bind(owner.user.id).first()
    await env.DB.prepare('UPDATE profiles SET telegram_id = ? WHERE id = ?').bind(telegramId, owner.user.id).run()
    const profileRequest = () => request(`/api/bot/profile?telegram_id=${telegramId}`, {
      headers: { 'X-Bot-Secret': env.BOT_API_SECRET },
    })

    expect((await (await profileRequest()).json()).data).toMatchObject({ role: 'owner' })
    await env.DB.prepare('UPDATE accounts SET is_active = 0 WHERE id = ?').bind(owner.user.id).run()
    try {
      expect((await (await profileRequest()).json()).data).toBeNull()
    } finally {
      await env.DB.prepare('UPDATE accounts SET is_active = 1 WHERE id = ?').bind(owner.user.id).run()
      await env.DB.prepare('UPDATE profiles SET telegram_id = ? WHERE id = ?')
        .bind(previousProfile?.telegram_id || null, owner.user.id).run()
    }
  })

  it('enforces representative endpoint groups for every role and unauthenticated callers', async () => {
    const ownerSession = await loginOwner()
    const ownerToken = ownerSession.access_token
    const staff = {}
    const staffIds = {}
    for (const role of ['reception', 'teacher']) {
      const username = `matrix-${role}`
      const created = await request('/api/auth/signup', {
        method: 'POST',
        token: ownerToken,
        body: { username, password: 'matrix-password-123', role, name: `Matrix ${role}` },
      })
      expect(created.status).toBe(201)
      staffIds[role] = (await created.json()).user.id
      const login = await request('/api/auth/login', {
        method: 'POST',
        body: { username, password: 'matrix-password-123' },
      })
      const loginSession = (await login.json()).session
      const passwordReset = await request('/api/auth/update', {
        method: 'POST',
        token: loginSession.access_token,
        body: { password: 'matrix-password-456' },
      })
      staff[role] = (await passwordReset.json()).session.access_token
    }
    const receptionInvite = await request('/api/telegram/invites', {
      method: 'POST',
      token: ownerToken,
      body: { profileId: staffIds.reception },
    })
    expect(receptionInvite.status).toBe(201)
    expect(new URL((await receptionInvite.json()).invite_url).searchParams.get('start')).toMatch(/^login_/)
    const forbiddenStaffInvite = await request('/api/telegram/invites', {
      method: 'POST',
      token: staff.reception,
      body: { profileId: staffIds.teacher },
    })
    expect(forbiddenStaffInvite.status).toBe(403)

    await env.DB.prepare('INSERT INTO students (id, name) VALUES (?, ?)').bind('matrix-student', 'Matrix Student').run()
    const inviteResponse = await request('/api/telegram/invites', {
      method: 'POST',
      token: ownerToken,
      body: { studentId: 'matrix-student' },
    })
    const inviteUrl = new URL((await inviteResponse.json()).invite_url)
    const inviteCode = inviteUrl.searchParams.get('start')
    const consumed = await request('/api/bot/invite/consume', {
      method: 'POST',
      headers: { 'X-Bot-Secret': env.BOT_API_SECRET },
      body: { code: inviteCode, telegramId: 987654322, staff: false },
    })
    expect(consumed.status).toBe(200)
    const studentLogin = await request('/api/auth/telegram', {
      method: 'POST',
      body: { initData: await telegramInitData(987654322) },
    })
    const tokens = {
      owner: ownerToken,
      reception: staff.reception,
      teacher: staff.teacher,
      student: (await studentLogin.json()).session.access_token,
      unauthenticated: undefined,
    }

    for (const [role, token] of Object.entries(tokens)) {
      const ownerFinance = await request('/api/finance/summary?from=2026-01-01&to=2026-12-31', { token })
      expect(ownerFinance.status, `${role}: finance`).toBe(role === 'owner' ? 200 : role === 'unauthenticated' ? 401 : 403)

      const restrictedTable = await request('/api/db', {
        method: 'POST',
        token,
        body: { table: 'expenses', columns: 'id, amount' },
      })
      expect(restrictedTable.status, `${role}: finance table`).toBe(role === 'owner' ? 200 : role === 'unauthenticated' ? 401 : 403)

      const staffManagement = await request('/api/rpc/staff_update_reception_profile', {
        method: 'POST',
        token,
        body: { target_user: staffIds.reception, name: 'Updated reception', username: 'matrix-reception' },
      })
      expect(staffManagement.status, `${role}: staff management`).toBe(role === 'owner' ? 200 : role === 'unauthenticated' ? 401 : 403)

      const homeworkReview = await request('/api/homework/review', { token })
      expect(homeworkReview.status, `${role}: homework review`).toBe(
        ['owner', 'reception', 'teacher'].includes(role) ? 200 : role === 'unauthenticated' ? 401 : 403,
      )

      if (role === 'teacher') {
        const unscopedHistory = await request('/api/homework/history?student_id=matrix-student', { token })
        expect(unscopedHistory.status).toBe(400)
      }

      const studentOverview = await request('/api/miniapp/student/overview', { token })
      expect(studentOverview.status, `${role}: student Mini App`).toBe(role === 'student' ? 200 : role === 'unauthenticated' ? 401 : 403)

      const questions = await request('/api/questions', { token })
      expect(questions.status, `${role}: questions`).toBe(role === 'unauthenticated' ? 401 : 200)

      const scheduleManagement = await request('/api/schedule/preview', {
        method: 'POST',
        token,
        body: {
          requestId: 'schedule-role-matrix-001',
          groupId: 'missing-schedule-group',
          type: 'single',
          reason: 'Ruxsat tekshiruvi',
          slotId: 'slot-1',
          originalDate: '2026-11-08',
          action: 'cancel',
        },
      })
      expect(scheduleManagement.status, `${role}: schedule management`).toBe(
        ['owner', 'reception', 'teacher'].includes(role) ? 404 : role === 'unauthenticated' ? 401 : 403,
      )
    }
  })

  it('audits payment corrections and forbids permanent payment deletion', async () => {
    const ownerSession = await loginOwner()
    const createReception = await request('/api/auth/signup', {
      method: 'POST',
      token: ownerSession.access_token,
      body: { username: 'audit-reception', password: 'strong-reception-password', role: 'reception', name: 'Reception' },
    })
    expect(createReception.status).toBe(201)
    const receptionLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'audit-reception', password: 'strong-reception-password' },
    })
    const receptionReset = await request('/api/auth/update', {
      method: 'POST',
      token: (await receptionLogin.json()).session.access_token,
      body: { password: 'strong-reception-password-updated' },
    })
    const receptionToken = (await receptionReset.json()).session.access_token
    const create = await request('/api/db', {
      method: 'POST',
      token: ownerSession.access_token,
      body: { table: 'payments', action: 'insert', values: { id: 'audit-payment', amount: 25, month: 1, year: 2026, paid_at: '2020-01-01T00:00:00.000Z' } },
    })
    expect(create.status).toBe(200)
    const receptionEdit = await request('/api/db', {
      method: 'POST',
      token: receptionToken,
      body: { table: 'payments', action: 'update', filters: [{ op: 'eq', column: 'id', value: 'audit-payment' }], values: { amount: 30 } },
    })
    expect(receptionEdit.status, await receptionEdit.clone().text()).toBe(200)
    const update = await request('/api/db', {
      method: 'POST',
      token: ownerSession.access_token,
      body: { table: 'payments', action: 'update', filters: [{ op: 'eq', column: 'id', value: 'audit-payment' }], values: { amount: 35 } },
    })
    expect(update.status).toBe(200)
    const deletion = await request('/api/db', {
      method: 'POST',
      token: ownerSession.access_token,
      body: { table: 'payments', action: 'delete', filters: [{ op: 'eq', column: 'id', value: 'audit-payment' }] },
    })
    expect(deletion.status).toBe(405)
    const events = await env.DB.prepare('SELECT action, old_data, new_data FROM payment_audit WHERE payment_id = ? ORDER BY created_at, rowid')
      .bind('audit-payment').all()
    expect((events.results || []).map((row) => row.action)).toEqual(['corrected', 'corrected'])
    expect(JSON.parse(events.results[0].old_data).amount).toBe(25)
    expect(JSON.parse(events.results[0].new_data).amount).toBe(30)
    expect(JSON.parse(events.results[1].old_data).amount).toBe(30)
    expect(JSON.parse(events.results[1].new_data).amount).toBe(35)
  })

  it('serves homework files as authenticated downloads with restrictive headers', async () => {
    const ownerSession = await loginOwner()
    await env.DB.prepare('INSERT INTO groups (id, name) VALUES (?, ?)').bind('file-group', 'Files').run()
    await env.DB.prepare('INSERT INTO homework (id, group_id, title) VALUES (?, ?, ?)')
      .bind('file-homework', 'file-group', 'File check').run()
    const form = new FormData()
    form.append('file', new File(['<script>alert(1)</script>'], 'unsafe.svg', { type: 'image/svg+xml' }))
    form.append('homework_id', 'file-homework')
    const uploaded = await request('/api/files', {
      method: 'POST',
      token: ownerSession.access_token,
      body: form,
    })
    expect(uploaded.status).toBe(200)
    const { file_url: fileUrl } = await uploaded.json()
    await env.DB.prepare('UPDATE homework SET file_url = ? WHERE id = ?').bind(fileUrl, 'file-homework').run()
    const filePath = new URL(fileUrl).pathname + new URL(fileUrl).search
    const download = await request(filePath, { token: ownerSession.access_token })
    expect(download.status).toBe(200)
    expect(download.headers.get('Content-Disposition')).toContain('attachment')
    expect(download.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(download.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox")
    const unauthenticated = await request(filePath)
    expect(unauthenticated.status).toBe(401)

    const expiredUrl = new URL(fileUrl)
    expiredUrl.searchParams.set('exp', String(Date.now() - 1000))
    await env.DB.prepare('UPDATE homework SET file_url = ? WHERE id = ?').bind(expiredUrl.toString(), 'file-homework').run()
    const listed = await request('/api/db', {
      method: 'POST',
      token: ownerSession.access_token,
      body: { table: 'homework', columns: 'id, file_url', filters: [{ column: 'id', op: 'eq', value: 'file-homework' }] },
    })
    const [row] = (await listed.json()).data
    const refreshed = new URL(row.file_url)
    expect(Number(refreshed.searchParams.get('exp'))).toBeGreaterThan(Date.now())
    const refreshedDownload = await request(refreshed.pathname + refreshed.search, { token: ownerSession.access_token })
    expect(refreshedDownload.status).toBe(200)
  })

  it('rejects website student credentials and student account creation', async () => {
    const ownerSession = await loginOwner()
    const forbiddenSignup = await request('/api/auth/signup', {
      method: 'POST',
      token: ownerSession.access_token,
      body: { username: 'student-web', password: 'long-student-password', role: 'student', name: 'Student' },
    })
    expect(forbiddenSignup.status).toBe(400)
    await env.DB.prepare('INSERT INTO accounts (id, password_hash, password_salt) VALUES (?, NULL, NULL)')
      .bind('student-web-id').run()
    await env.DB.prepare("INSERT INTO profiles (id, username, name, role, student_id) VALUES (?, ?, ?, 'student', ?)")
      .bind('student-web-id', 'student-web', 'Student', 'student-web-id').run()
    const login = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'student-web', password: 'long-student-password' },
    })
    expect(login.status).toBe(401)
    expect(await login.json()).toEqual({ error: 'Login yoki parol noto‘g‘ri.' })
  })

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
    const inviteResponse = await request('/api/telegram/invites', {
      method: 'POST',
      token: ownerSession.access_token,
      body: { studentId: 'telegram-student' },
    })
    expect(inviteResponse.status).toBe(201)
    const invite = await inviteResponse.json()
    const profileId = (await env.DB.prepare('SELECT auth_user_id FROM students WHERE id = ?')
      .bind('telegram-student').first()).auth_user_id
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
    const studentFinance = await request('/api/finance/summary?from=2026-01-01&to=2026-12-31', {
      token: miniAppSession.session.access_token,
    })
    expect(studentFinance.status).toBe(403)
    const genericStudentData = await request('/api/db', {
      method: 'POST',
      token: miniAppSession.session.access_token,
      body: { table: 'payments', columns: 'id, amount' },
    })
    expect(genericStudentData.status).toBe(403)
    const studentRpc = await request('/api/rpc/lookup_login_email', {
      method: 'POST',
      token: miniAppSession.session.access_token,
      body: { p_login: 'owner' },
    })
    expect(studentRpc.status).toBe(403)
    await env.DB.prepare('INSERT INTO payments (id, student_id, amount, month, year, paid_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('own-payment', 'telegram-student', 100, 1, 2026, '2020-01-01').run()
    await env.DB.prepare('INSERT INTO payments (id, student_id, amount, month, year, paid_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('other-payment', 'different-student', 200, 1, 2026, '2020-01-01').run()
    const ownPayments = await request('/api/miniapp/student/overview', { token: miniAppSession.session.access_token })
    expect(ownPayments.status).toBe(200)
    expect((await ownPayments.json()).data.payments).toEqual([
      expect.objectContaining({ id: 'own-payment', student_id: 'telegram-student', amount: 100 }),
    ])
    const paymentWrite = await request('/api/db', {
      method: 'POST',
      token: miniAppSession.session.access_token,
      body: { table: 'payments', action: 'insert', values: { student_id: 'telegram-student', amount: 1, month: 1, year: 2026 } },
    })
    expect(paymentWrite.status).toBe(403)

    await env.DB.prepare('INSERT INTO groups (id, name, teacher_id, schedule) VALUES (?, ?, ?, ?)')
      .bind('telegram-group', 'Student Group', 'teacher-one',
        JSON.stringify([{ day: 0, startTime: '09:00', endTime: '10:00', teacherId: 'teacher-one' }])).run()
    await env.DB.prepare('INSERT INTO group_students (group_id, student_id) VALUES (?, ?)')
      .bind('telegram-group', 'telegram-student').run()
    const studentSchedule = await request('/api/miniapp/student/overview', { token: miniAppSession.session.access_token })
    expect((await studentSchedule.json()).data.groups).toEqual([
      expect.objectContaining({
        id: 'telegram-group',
        schedule: [{ day: 0, startTime: '09:00', endTime: '10:00', teacherId: 'teacher-one' }],
      }),
    ])
    const homeworkId = '00000000-0000-4000-8000-000000000001'
    await env.DB.prepare('INSERT INTO homework (id, group_id, teacher_id, title) VALUES (?, ?, ?, ?)')
      .bind(homeworkId, 'telegram-group', 'teacher-one', 'Test homework').run()
    const overview = await request('/api/miniapp/student/overview', { token: miniAppSession.session.access_token })
    expect(overview.status).toBe(200)
    expect((await overview.json()).data.homeworks.map((task) => task.id)).toContain(homeworkId)
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
    expect(submission.status).toBe(410)
    const pending = await env.DB.prepare('SELECT homework_id FROM bot_pending_homework WHERE chat_id = ?')
      .bind(987654321).first()
    expect(pending.homework_id).toBe(homeworkId)

    const draftResponse = await request('/api/homework/draft', {
      method: 'POST',
      token: miniAppSession.session.access_token,
      body: { homework_id: homeworkId, text: 'Mini App javobi' },
    })
    expect(draftResponse.status).toBe(201)
    const draft = (await draftResponse.json()).data
    const missingProof = await request('/api/homework/draft/confirm', {
      method: 'POST',
      token: miniAppSession.session.access_token,
      body: { submission_id: draft.id },
    })
    expect(missingProof.status).toBe(400)
    expect((await env.DB.prepare('SELECT state FROM homework_submissions WHERE id = ?').bind(draft.id).first()).state).toBe('draft')
    const shortProofForm = new FormData()
    shortProofForm.append('submission_id', draft.id)
    shortProofForm.append('duration_seconds', '2')
    shortProofForm.append('file', new File(['short'], 'proof.webm', { type: 'audio/webm' }))
    const shortProof = await request('/api/homework/draft/confirm', {
      method: 'POST',
      token: miniAppSession.session.access_token,
      body: { submission_id: draft.id },
    })
    expect(shortProof.status).toBe(400)
    const tooShortProof = await request('/api/homework/draft/proof', {
      method: 'POST',
      token: miniAppSession.session.access_token,
      body: shortProofForm,
    })
    expect(tooShortProof.status).toBe(400)
    shortProofForm.set('duration_seconds', '3')
    const validProof = await request('/api/homework/draft/proof', {
      method: 'POST',
      token: miniAppSession.session.access_token,
      body: shortProofForm,
    })
    expect(validProof.status).toBe(201)
    const confirmed = await request('/api/homework/draft/confirm', {
      method: 'POST',
      token: miniAppSession.session.access_token,
      body: { submission_id: draft.id },
    })
    expect(confirmed.status).toBe(200)
    const persistedSubmission = await env.DB.prepare('SELECT state, attempt_number FROM homework_submissions WHERE id = ?')
      .bind(draft.id).first()
    expect(persistedSubmission.state).toBe('submitted')
    const declaration = await request('/api/homework/declaration', {
      method: 'POST',
      token: miniAppSession.session.access_token,
      body: { submission_id: draft.id, result: 'done' },
    })
    expect(declaration.status).toBe(200)
    const history = await request(`/api/homework/history?homework_id=${homeworkId}`, {
      token: miniAppSession.session.access_token,
    })
    expect((await history.json()).data.events.map((event) => event.event_type)).toEqual([
      'draft_created', 'file_added', 'proof_added', 'submitted', 'student_done',
    ])
    const studentHomework = await request('/api/homework/student', { token: miniAppSession.session.access_token })
    const homeworkFiles = (await studentHomework.json()).data[0].files
    expect(homeworkFiles[0].kind).toBe('voice')
    const downloadedProof = await request(new URL(homeworkFiles[0].download_url).pathname + new URL(homeworkFiles[0].download_url).search, {
      token: miniAppSession.session.access_token,
    })
    expect(downloadedProof.status).toBe(200)
    expect(downloadedProof.headers.get('Content-Disposition')).toContain('attachment')
    expect(downloadedProof.headers.get('X-Content-Type-Options')).toBe('nosniff')

    const review = await request('/api/homework/review', {
      method: 'POST',
      token: ownerSession.access_token,
      body: { submission_id: draft.id, result: 'not_done', comment: 'Qayta ishlang.' },
    })
    expect(review.status).toBe(200)
    const afterReview = await request(`/api/homework/history?homework_id=${homeworkId}`, {
      token: miniAppSession.session.access_token,
    })
    expect((await afterReview.json()).data.events.map((event) => event.event_type)).toEqual([
      'draft_created', 'file_added', 'proof_added', 'submitted', 'student_done', 'teacher_not_done', 'comment',
    ])
    const receptionSignup = await request('/api/auth/signup', {
      method: 'POST',
      token: ownerSession.access_token,
      body: { username: 'homework-reception', name: 'Homework Reception', password: 'secure-reception-password', role: 'reception' },
    })
    expect(receptionSignup.status).toBe(201)
    const receptionLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'homework-reception', password: 'secure-reception-password' },
    })
    const receptionLoginData = await receptionLogin.json()
    const passwordUpdate = await request('/api/auth/update', {
      method: 'POST',
      token: receptionLoginData.session.access_token,
      body: { password: 'secure-reception-password-reset' },
    })
    const receptionToken = (await passwordUpdate.json()).session.access_token
    expect((await request('/api/homework/review', { token: receptionToken })).status).toBe(200)
    expect((await request('/api/homework/review', {
      method: 'POST',
      token: receptionToken,
      body: { submission_id: draft.id, result: 'done' },
    })).status).toBe(403)
    const resubmission = await request('/api/homework/draft', {
      method: 'POST',
      token: miniAppSession.session.access_token,
      body: { homework_id: homeworkId, text: 'Qayta topshirish' },
    })
    const resubmissionData = (await resubmission.json()).data
    expect(resubmissionData.attempt_number).toBe(2)
    const resubmissionId = resubmissionData.id
    await env.DB.prepare('UPDATE homework_submissions SET expires_at = ? WHERE id = ?')
      .bind(Date.now() - 1, resubmissionId).run()
    const savedBotToken = env.TELEGRAM_BOT_TOKEN
    env.TELEGRAM_BOT_TOKEN = ''
    await expireHomeworkDrafts(env)
    env.TELEGRAM_BOT_TOKEN = savedBotToken
    expect((await env.DB.prepare('SELECT state FROM homework_submissions WHERE id = ?').bind(resubmissionId).first()).state).toBe('expired')
    const expiryEvent = await env.DB.prepare(`SELECT event_type FROM homework_events
      WHERE submission_id = ? ORDER BY rowid DESC LIMIT 1`).bind(resubmissionId).first()
    expect(expiryEvent.event_type).toBe('expired')

    const ticketResponse = await request('/api/questions', {
      method: 'POST',
      token: miniAppSession.session.access_token,
      body: { text: 'Savolim bor', group_id: 'telegram-group' },
    })
    expect(ticketResponse.status).toBe(201)
    const ticketId = (await ticketResponse.json()).data.id
    const inbox = await request('/api/questions?status=open', { token: receptionToken })
    const inboxData = (await inbox.json()).data
    expect(inboxData[0].id).toBe(ticketId)
    // Birinchi ochilishda yangi xabar soni ko‘rinadi, so‘ng xabarlar o‘qilgan deb belgilanadi.
    expect(inboxData[0].unread_count).toBe(1)
    const inboxAgain = (await (await request('/api/questions?status=open', { token: receptionToken })).json()).data
    expect(inboxAgain[0].unread_count).toBe(0)
    const previousBotToken = env.TELEGRAM_BOT_TOKEN
    env.TELEGRAM_BOT_TOKEN = ''
    const reply = await request(`/api/questions/${ticketId}/reply`, {
      method: 'POST',
      token: receptionToken,
      body: { text: 'Javob tayyor.' },
    })
    env.TELEGRAM_BOT_TOKEN = previousBotToken
    expect(reply.status).toBe(200)
    expect((await env.DB.prepare('SELECT status FROM question_tickets WHERE id = ?').bind(ticketId).first()).status).toBe('answered')

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

  it('blocks reception from finance endpoints and validates group conflicts', async () => {
    const ownerSession = await loginOwner()
    const createTeacher = await request('/api/auth/signup', {
      method: 'POST',
      token: ownerSession.access_token,
      body: { username: 'finance-teacher', password: 'secure-teacher-password', role: 'teacher', name: 'Teacher' },
    })
    expect(createTeacher.status).toBe(201)
    const teacherLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'finance-teacher', password: 'secure-teacher-password' },
    })
    const teacherToken = (await teacherLogin.json()).session.access_token
    const teacherFinance = await request('/api/finance/summary?from=2026-01-01&to=2026-12-31', {
      token: teacherToken,
    })
    expect(teacherFinance.status).toBe(403)
    const createReception = await request('/api/auth/signup', {
      method: 'POST',
      token: ownerSession.access_token,
      body: {
        username: 'reception1',
        password: 'long-secure-reception-password',
        role: 'reception',
        name: 'Reception One',
      },
    })
    expect(createReception.status).toBe(201)
    const receptionUser = (await createReception.json()).user
    const receptionCannotEdit = await request('/api/rpc/staff_update_reception_profile', {
      method: 'POST',
      token: (await request('/api/auth/login', {
        method: 'POST',
        body: { username: 'reception1', password: 'long-secure-reception-password' },
      }).then((response) => response.json())).session.access_token,
      body: { target_user: receptionUser.id, name: 'Blocked Edit', username: 'reception1' },
    })
    expect(receptionCannotEdit.status).toBe(403)
    const ownerEdit = await request('/api/rpc/staff_update_reception_profile', {
      method: 'POST',
      token: ownerSession.access_token,
      body: { target_user: receptionUser.id, name: 'Reception One Updated', username: 'reception1' },
    })
    expect(ownerEdit.status).toBe(200)
    const deactivate = await request('/api/rpc/staff_set_user_active', {
      method: 'POST',
      token: ownerSession.access_token,
      body: { target_user: receptionUser.id, is_active: false },
    })
    expect(deactivate.status).toBe(200)
    const disabledLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'reception1', password: 'long-secure-reception-password' },
    })
    expect(disabledLogin.status).toBe(401)
    const activate = await request('/api/rpc/staff_set_user_active', {
      method: 'POST',
      token: ownerSession.access_token,
      body: { target_user: receptionUser.id, is_active: true },
    })
    expect(activate.status).toBe(200)
    const receptionLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'reception1', password: 'long-secure-reception-password' },
    })
    expect(receptionLogin.status).toBe(200)
    const reception = await receptionLogin.json()

    const finance = await request('/api/finance/summary?from=2026-01-01&to=2026-12-31', {
      token: reception.session.access_token,
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

    const usernameLookup = await request('/api/rpc/lookup_login_email', {
      method: 'POST',
      token: reception.session.access_token,
      body: { p_login: 'owner' },
    })
    expect(usernameLookup.status).toBe(403)
    expect((await request('/api/finance/summary?from=2026-01-01&to=2026-12-31')).status).toBe(401)

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
    await env.DB.prepare('INSERT INTO groups (id, name, teacher_id) VALUES (?, ?, ?)')
      .bind('teacher-own-group', 'Own', 'teacher-1').run()
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
    const session = await createStaff('payment-reception1', 'reception')
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
    expect(ownerDelete.status).toBe(405)
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
    await env.DB.prepare(`INSERT INTO homework_submissions
      (id, homework_id, student_id, content_text, status, state, submitted_at)
      VALUES (?, ?, ?, ?, 'pending', 'submitted', ?)`)
      .bind('review-submission', 'review-homework', 'review-student', 'Matn', new Date().toISOString()).run()

    const approved = await request('/api/homework/review', {
      method: 'POST',
      token: ownerSession.access_token,
      body: { submission_id: 'review-submission', result: 'done', comment: 'Yaxshi' },
    })
    expect(approved.status).toBe(200)
    const rejected = await request('/api/homework/review', {
      method: 'POST',
      token: ownerSession.access_token,
      body: { submission_id: 'review-submission', result: 'not_done', comment: 'Qayta ishlang' },
    })
    expect(rejected.status).toBe(200)

    const history = await request('/api/homework/history?homework_id=review-homework', {
      token: ownerSession.access_token,
    })
    const historyData = (await history.json()).data
    expect(historyData.events.map((event) => event.event_type)).toEqual([
      'teacher_done', 'comment', 'teacher_not_done', 'comment',
    ])
    expect(historyData.submissions[0].teacher_result).toBe('not_done')
    const reviewHistory = await env.DB.prepare(`SELECT old_status, new_status, old_comment, new_comment
      FROM homework_review_history WHERE submission_id = ? ORDER BY created_at, rowid`)
      .bind('review-submission').all()
    expect(reviewHistory.results).toEqual([
      { old_status: 'pending', new_status: 'approved', old_comment: '', new_comment: 'Yaxshi' },
      { old_status: 'approved', new_status: 'rejected', old_comment: 'Yaxshi', new_comment: 'Qayta ishlang' },
    ])

    const receptionSession = await createStaff('payment-reception2', 'reception')
    const receptionReview = await request('/api/homework/review', {
      method: 'POST',
      token: receptionSession.access_token,
      body: { submission_id: 'review-submission', result: 'done' },
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
      expect(sent.some((text) => text.includes('Kamol School boti'))).toBe(true)
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

describe('account credentials and explicit student access', () => {
  async function createStudent(ownerToken, name, password = 'student-pass-123') {
    return request('/api/students', {
      method: 'POST',
      token: ownerToken,
      body: { name, password, auto_username: true },
    })
  }

  it('transliterates Uzbek Cyrillic names and picks numeric suffixes for duplicate logins', async () => {
    expect(loginBaseFromName('Абдуллоҳ Зияев')).toBe('abdulloh.ziyayev')
    expect(loginBaseFromName('Oʻtkir Gʻaniyev')).toBe('otkir.ganiyev')
    expect(isValidLogin('abdulloh.ziyayev')).toBe(true)
    expect(isValidLogin('Abdulloh Ziyoyev')).toBe(false)

    const owner = await loginOwner()
    const first = await createStudent(owner.access_token, 'Абдуллоҳ Зияев')
    const second = await createStudent(owner.access_token, 'Абдуллоҳ Зияев')
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect((await first.json()).data.username).toBe('abdulloh.ziyayev')
    expect((await second.json()).data.username).toBe('abdulloh.ziyayev2')
  })

  it('creates staff only for the owner and supports edits, password reset, and disable', async () => {
    const owner = await loginOwner()
    const createdResponse = await request('/api/staff', {
      method: 'POST',
      token: owner.access_token,
      body: { name: 'Dilnoza Qabul', phone: '+998901234567', role: 'reception', username: 'dilnoza.qabul', password: 'owner-set-password-123' },
    })
    expect(createdResponse.status).toBe(201)
    const created = (await createdResponse.json()).data
    const receptionLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: created.username, password: 'owner-set-password-123' },
    })
    const receptionSession = (await receptionLogin.json()).session
    const forbiddenCreate = await request('/api/staff', {
      method: 'POST',
      token: receptionSession.access_token,
      body: { name: 'New Staff', role: 'reception', password: 'another-owner-set-password' },
    })
    expect(forbiddenCreate.status).toBe(403)

    const update = await request(`/api/staff/${created.id}`, {
      method: 'POST',
      token: owner.access_token,
      body: { name: 'Dilnoza Yangilandi', phone: '+998909876543', password: 'new-owner-set-password-123', is_active: false },
    })
    expect(update.status).toBe(200)
    expect((await request('/api/auth/login', {
      method: 'POST',
      body: { username: created.username, password: 'new-owner-set-password-123' },
    })).status).toBe(401)
    expect((await request('/api/staff', { method: 'GET', token: owner.access_token })).status).toBe(200)
  })

  it('creates students through the website-safe endpoint, rejects website sign-in, and binds verified Telegram login', async () => {
    const owner = await loginOwner()
    const createdResponse = await createStudent(owner.access_token, 'O‘quvchi Test')
    expect(createdResponse.status).toBe(201)
    const created = (await createdResponse.json()).data
    expect(created.username).toBe('oquvchi.test')

    const websiteLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: created.username, password: 'student-pass-123' },
    })
    expect(websiteLogin.status).toBe(401)

    const telegramId = 987654301
    const login = await request('/api/auth/telegram/password', {
      method: 'POST',
      body: { initData: await telegramInitData(telegramId), username: created.username, password: 'student-pass-123' },
    })
    expect(login.status).toBe(200)
    const session = (await login.json()).session
    expect(session.user.role).toBe('student')
    const linked = await env.DB.prepare('SELECT telegram_id FROM profiles WHERE id = ?').bind(session.user.id).first()
    expect(linked.telegram_id).toBe(telegramId)

    const repeatedSameAccount = await request('/api/auth/telegram/password', {
      method: 'POST',
      body: { initData: await telegramInitData(987654302), username: created.username, password: 'student-pass-123' },
    })
    expect(repeatedSameAccount.status).toBe(409)
    expect((await repeatedSameAccount.json()).error).toContain('boshqa Telegram')
    const anotherStudent = (await (await createStudent(owner.access_token, 'Boshqa Oquvchi')).json()).data
    const repeatedSameTelegram = await request('/api/auth/telegram/password', {
      method: 'POST',
      body: { initData: await telegramInitData(telegramId), username: anotherStudent.username, password: 'student-pass-123' },
    })
    expect(repeatedSameTelegram.status).toBe(409)
    expect((await repeatedSameTelegram.json()).error).toContain('boshqa foydalanuvchiga ulangan')

    const list = await request('/api/db', {
      method: 'POST',
      token: owner.access_token,
      body: { table: 'students', columns: '*' },
    })
    const listBody = await list.text()
    expect(list.status).toBe(200)
    expect(listBody).not.toContain('password_ciphertext')
    expect(listBody).not.toContain('password_iv')
    expect(listBody).not.toContain('student-pass-123')
  })

  it('edits a student without changing the join date and deletes while keeping payment history', async () => {
    const owner = await loginOwner()
    const created = (await (await createStudent(owner.access_token, 'Tahrir Test')).json()).data
    const before = await env.DB.prepare('SELECT joined_at FROM students WHERE id = ?').bind(created.id).first()

    const edit = await request(`/api/students/${created.id}`, {
      method: 'POST',
      token: owner.access_token,
      body: { action: 'update', name: 'Tahrir Yangilandi', phone: '+998901112233' },
    })
    expect(edit.status).toBe(200)
    const after = await env.DB.prepare('SELECT name, phone, joined_at FROM students WHERE id = ?').bind(created.id).first()
    expect(after).toMatchObject({ name: 'Tahrir Yangilandi', phone: '+998901112233', joined_at: before.joined_at })

    await env.DB.prepare(`INSERT INTO payments (id, student_id, student_name, amount, month, year)
      VALUES (?, ?, '', 300000, 1, 2026)`).bind(crypto.randomUUID(), created.id).run()
    await env.DB.prepare('INSERT INTO telegram_links (chat_id, student_id) VALUES (?, ?)').bind(70001, created.id).run()

    const removed = await request(`/api/students/${created.id}`, {
      method: 'POST',
      token: owner.access_token,
      body: { action: 'delete' },
    })
    expect(removed.status).toBe(200)
    expect(await env.DB.prepare('SELECT id FROM students WHERE id = ?').bind(created.id).first()).toBeNull()
    expect(await env.DB.prepare('SELECT chat_id FROM telegram_links WHERE chat_id = 70001').first()).toBeNull()
    const kept = await env.DB.prepare('SELECT student_name, amount FROM payments WHERE student_name = ?').bind('Tahrir Yangilandi').first()
    expect(kept).toMatchObject({ amount: 300000 })
    const relogin = await request('/api/auth/telegram/password', {
      method: 'POST',
      body: { initData: await telegramInitData(987654399), username: created.username, password: 'student-pass-123' },
    })
    expect(relogin.status).not.toBe(200)
  })

  it('allows only owner and reception to reveal passwords and records reveal/change audit events', async () => {
    const owner = await loginOwner()
    const created = (await (await createStudent(owner.access_token, 'Maxfiy Parol')).json()).data
    const revealPath = `/api/students/${created.id}/password/reveal`
    expect((await request(revealPath, { method: 'POST', body: {} })).status).toBe(401)

    const teacherResponse = await request('/api/staff', {
      method: 'POST',
      token: owner.access_token,
      body: { name: 'Test Teacher', role: 'teacher', password: 'teacher-owner-set-123', auto_username: true },
    })
    const teacher = (await teacherResponse.json()).data
    const teacherLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: teacher.username, password: 'teacher-owner-set-123' },
    })
    const teacherToken = (await teacherLogin.json()).session.access_token
    expect((await request(revealPath, { method: 'POST', token: teacherToken, body: {} })).status).toBe(403)

    const studentLogin = await request('/api/auth/telegram/password', {
      method: 'POST',
      body: { initData: await telegramInitData(987654303), username: created.username, password: 'student-pass-123' },
    })
    const studentToken = (await studentLogin.json()).session.access_token
    expect((await request(revealPath, { method: 'POST', token: studentToken, body: {} })).status).toBe(403)
    const ownerReveal = await request(revealPath, { method: 'POST', token: owner.access_token, body: {} })
    expect(ownerReveal.status).toBe(200)
    expect((await ownerReveal.json()).password).toBe('student-pass-123')

    const receptionResponse = await request('/api/staff', {
      method: 'POST',
      token: owner.access_token,
      body: { name: 'Reception Staff', role: 'reception', password: 'reception-owner-set-123', auto_username: true },
    })
    const reception = (await receptionResponse.json()).data
    const receptionLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: reception.username, password: 'reception-owner-set-123' },
    })
    const receptionToken = (await receptionLogin.json()).session.access_token
    expect((await request(revealPath, { method: 'POST', token: receptionToken, body: {} })).status).toBe(200)
    const receptionStudent = await createStudent(receptionToken, 'Reception Created')
    expect(receptionStudent.status).toBe(201)

    const change = await request(`/api/students/${created.id}/password`, {
      method: 'POST',
      token: receptionToken,
      body: { username: 'maxfiy.parol', password: 'changed-student-pass' },
    })
    expect(change.status).toBe(200)
    const revealAfterChange = await request(revealPath, { method: 'POST', token: owner.access_token, body: {} })
    expect((await revealAfterChange.json()).password).toBe('changed-student-pass')
    const audit = await env.DB.prepare('SELECT actor_id, action, created_at FROM student_credential_audit WHERE student_id = ? ORDER BY created_at')
      .bind(created.id).all()
    expect(audit.results.filter((row) => row.action === 'reveal')).toHaveLength(3)
    expect(audit.results.filter((row) => row.action === 'change')).toHaveLength(1)
  })

  it('rate limits password reveal and logs failed login attempts without storing the login text', async () => {
    const owner = await loginOwner()
    const created = (await (await createStudent(owner.access_token, 'Limit Test')).json()).data
    const path = `/api/students/${created.id}/password/reveal`
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await request(path, { method: 'POST', token: owner.access_token, body: {} })).status).toBe(200)
    }
    expect((await request(path, { method: 'POST', token: owner.access_token, body: {} })).status).toBe(429)

    const headers = { 'CF-Connecting-IP': '198.51.100.45' }
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await request('/api/auth/login', {
        method: 'POST',
        headers,
        body: { username: created.username, password: 'wrong-password-123' },
      })).status).toBe(401)
    }
    expect((await request('/api/auth/login', {
      method: 'POST',
      headers,
      body: { username: created.username, password: 'wrong-password-123' },
    })).status).toBe(429)
    const failures = await env.DB.prepare('SELECT identifier_hash FROM auth_failure_events').all()
    expect(failures.results.length).toBeGreaterThan(0)
    expect(JSON.stringify(failures.results)).not.toContain(created.username)
  })

  it('rejects unknown tables and malformed payloads, accepts maybeSingle, and forbids student writes through the generic API', async () => {
    const owner = await loginOwner()
    const student = (await (await createStudent(owner.access_token, 'Database Guard')).json()).data
    const profile = await env.DB.prepare('SELECT auth_user_id FROM students WHERE id = ?').bind(student.id).first()
    const maybeSingle = await request('/api/db', {
      method: 'POST',
      token: owner.access_token,
      body: { table: 'profiles', columns: 'id, username', filters: [{ op: 'eq', column: 'id', value: profile.auth_user_id }], maybeSingle: true },
    })
    expect(maybeSingle.status).toBe(200)
    expect((await maybeSingle.json()).data.username).toBe(student.username)

    expect((await request('/api/db', { method: 'POST', token: owner.access_token, body: { table: 'users' } })).status).toBe(400)
    expect((await request('/api/db', { method: 'POST', token: owner.access_token, body: { table: 'students', mystery: true } })).status).toBe(400)
    const teacherResponse = await request('/api/staff', {
      method: 'POST',
      token: owner.access_token,
      body: { name: 'Database Teacher', role: 'teacher', password: 'teacher-owner-set-123' },
    })
    const teacher = (await teacherResponse.json()).data
    const teacherLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: teacher.username, password: 'teacher-owner-set-123' },
    })
    const forbidden = await request('/api/db', {
      method: 'POST',
      token: (await teacherLogin.json()).session.access_token,
      body: { table: 'students', action: 'update', filters: [{ op: 'eq', column: 'id', value: student.id }], values: { name: 'Tampered' } },
    })
    expect(forbidden.status).toBe(403)
  })
})

describe('Face ID attendance', () => {
  const lessonDate = '2026-11-16'
  const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9])], 'front.jpg', { type: 'image/jpeg' })

  async function staffSession(owner, role, name, password) {
    const created = (await (await request('/api/staff', {
      method: 'POST',
      token: owner.access_token,
      body: { name, role, password },
    })).json()).data
    return (await (await request('/api/auth/login', {
      method: 'POST',
      body: { username: created.username, password },
    })).json()).session
  }

  async function uploadFace(token, studentId, angle = 'front', file = jpeg()) {
    const form = new FormData()
    form.set('angle', angle)
    form.set('file', file)
    return request(`/api/students/${studentId}/faces`, { method: 'POST', token, body: form })
  }

  function acsEvent(employeeNo, time, extra = {}) {
    return { AcsEvent: { InfoList: [{ major: 5, minor: 75, time, employeeNoString: String(employeeNo), ...extra }] } }
  }

  it('applies the present/late rule within the early window and builds short notices', () => {
    const lesson = { startTime: '14:00', endTime: '15:30' }
    expect(faceAttendanceStatus(13 * 60 - 1, lesson)).toBeNull()
    expect(faceAttendanceStatus(13 * 60, lesson)).toEqual({ status: 'present', lateMinutes: 0 })
    expect(faceAttendanceStatus(14 * 60, lesson)).toEqual({ status: 'present', lateMinutes: 0 })
    expect(faceAttendanceStatus(14 * 60 + 12, lesson)).toEqual({ status: 'late', lateMinutes: 12 })
    expect(faceAttendanceStatus(15 * 60 + 31, lesson)).toBeNull()
    expect(parseDeviceTime('2026-11-16T14:12:00').toISOString()).toBe('2026-11-16T09:12:00.000Z')
    expect(parseDeviceTime('2026-11-16T14:12:00+0500').toISOString()).toBe('2026-11-16T09:12:00.000Z')
    const late = faceAttendanceNotice({ studentName: 'Ali', groupName: 'A1', status: 'late', lateMinutes: 12, date: lessonDate, checkedInAt: '2026-11-16T09:12:00.000Z' })
    expect(late).toBe('Ali darsga 12 daqiqa kechikdi.\nGuruh: A1\nSana: 16.11.2026\nKelgan vaqti: 14:12')
    expect(faceAttendanceNotice({ studentName: 'Ali', groupName: 'A1', status: 'absent', date: lessonDate })).toBe('Ali darsga kelmadi.\nGuruh: A1\nSana: 16.11.2026')
    expect(faceAttendanceNotice({ status: 'present' })).toBeNull()
    expect(extractHikvisionEvents({
      dateTime: '2026-11-16T14:01:00+05:00',
      eventType: 'AccessControllerEvent',
      AccessControllerEvent: { majorEventType: 5, subEventType: 75, employeeNoString: '1001', serialNo: 7 },
    })).toMatchObject([{ major: 5, minor: 75, employeeNo: '1001', time: '2026-11-16T14:01:00+05:00', serialNo: 7 }])
  })

  it('enrolls faces, syncs through the device token, ingests scans, dedupes, and marks absentees', async () => {
    const owner = await loginOwner()
    const groupId = crypto.randomUUID()
    await env.DB.prepare('INSERT INTO groups (id, name, schedule) VALUES (?, ?, ?)')
      .bind(groupId, 'Face A1', JSON.stringify([{ slotId: 'mon', day: 1, startTime: '14:00', endTime: '15:30' }])).run()
    const students = []
    for (const name of ['Face Present', 'Face Late', 'Face Absent']) {
      const created = (await (await request('/api/students', {
        method: 'POST',
        token: owner.access_token,
        body: { name, password: 'student-pass-123', auto_username: true, group_ids: [groupId], joined_at: '2026-01-01' },
      })).json()).data
      students.push(created)
    }

    expect((await request('/api/face/devices', { method: 'POST', body: { name: 'Kirish' } })).status).toBe(401)
    const reception = await staffSession(owner, 'reception', 'Face Reception', 'reception-face-pass-123')
    expect((await request('/api/face/devices', { method: 'POST', token: reception.access_token, body: { name: 'X' } })).status).toBe(403)
    const teacher = await staffSession(owner, 'teacher', 'Face Teacher', 'teacher-face-pass-123')
    expect((await uploadFace(teacher.access_token, students[0].id)).status).toBe(403)

    const deviceResponse = await request('/api/face/devices', { method: 'POST', token: owner.access_token, body: { name: 'Kirish', serial: 'DS-K1T341' } })
    expect(deviceResponse.status).toBe(201)
    const device = (await deviceResponse.json()).data
    expect(device.token).toMatch(/^kfd_/)
    const stored = await env.DB.prepare('SELECT token_hash FROM face_devices WHERE id = ?').bind(device.id).first()
    expect(stored.token_hash).not.toContain(device.token)

    expect((await uploadFace(reception.access_token, students[0].id, 'up')).status).toBe(400)
    expect((await uploadFace(reception.access_token, students[0].id, 'front', new File(['not a jpeg'], 'x.jpg', { type: 'image/jpeg' }))).status).toBe(415)
    for (const student of students) expect((await uploadFace(reception.access_token, student.id)).status).toBe(201)
    const replaced = await uploadFace(owner.access_token, students[0].id)
    expect(replaced.status).toBe(201)
    const details = (await replaced.json()).data
    expect(details.photos).toHaveLength(1)
    expect(details.sync_status).toBe('pending')
    const photo = await request(new URL(details.photos[0].url).pathname + new URL(details.photos[0].url).search)
    expect(photo.status).toBe(200)
    expect(photo.headers.get('Content-Type')).toBe('image/jpeg')
    const tampered = new URL(details.photos[0].url)
    tampered.searchParams.set('sig', 'AAAA')
    expect((await request(tampered.pathname + tampered.search)).status).toBe(403)

    expect((await request('/api/face/device/pending')).status).toBe(401)
    expect((await request('/api/face/device/pending', { headers: { Authorization: 'Bearer kfd_wrong-token-value-123456789' } })).status).toBe(401)
    const auth = { Authorization: `Bearer ${device.token}` }
    const pending = (await (await request('/api/face/device/pending', { headers: auth })).json()).data
    expect(pending.items).toHaveLength(3)
    expect(pending.items[0].photos[0].url).toContain('/api/face-photo/faces/')
    const byStudent = new Map(pending.items.map((item) => [item.student_id, item]))
    const synced = await request('/api/face/device/sync-result', {
      method: 'POST',
      headers: auth,
      body: { results: pending.items.map((item) => ({ employee_no: item.employee_no, version: item.version, status: 'synced' })) },
    })
    expect((await synced.json()).data.updated).toBe(3)
    await env.DB.prepare("UPDATE face_sync SET synced_at = '2026-01-01T00:00:00.000Z' WHERE device_id = ?").bind(device.id).run()
    const overview = (await (await request('/api/face/overview', { token: reception.access_token })).json()).data
    expect(overview.students.find((row) => row.student_id === students[0].id).sync_status).toBe('synced')

    const [present, late, absent] = students.map((student) => byStudent.get(student.id).employee_no)
    const first = await request('/api/face/device/events', { method: 'POST', headers: auth, body: acsEvent(present, `${lessonDate}T13:10:00+05:00`) })
    expect((await first.json()).data).toMatchObject({ accepted: 1, duplicates: 0 })
    const duplicate = await request('/api/face/device/events', { method: 'POST', headers: auth, body: acsEvent(present, `${lessonDate}T13:10:00+05:00`) })
    expect((await duplicate.json()).data).toMatchObject({ accepted: 0, duplicates: 1 })
    const ignored = await request('/api/face/device/events', { method: 'POST', headers: auth, body: { AcsEvent: { InfoList: [{ major: 5, minor: 76, time: `${lessonDate}T14:00:00+05:00`, employeeNoString: late }] } } })
    expect((await ignored.json()).data).toMatchObject({ accepted: 0, ignored: 1 })

    const boundary = 'MIME_boundary'
    const multipart = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="event_log"',
      'Content-Type: application/json',
      '',
      JSON.stringify({
        dateTime: `${lessonDate}T14:12:40+05:00`,
        eventType: 'AccessControllerEvent',
        AccessControllerEvent: { majorEventType: 5, subEventType: 75, employeeNoString: late, serialNo: 99 },
      }),
      `--${boundary}`,
      'Content-Disposition: form-data; name="Picture"; filename="face.jpg"',
      'Content-Type: image/jpeg',
      '',
      '\u00ff\u00d8binary',
      `--${boundary}--`,
      '',
    ].join('\r\n')
    const pushed = await worker.fetch(new Request(`https://school.test/api/face/device/events?token=${device.token}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: multipart,
    }), env)
    expect((await pushed.json()).data).toMatchObject({ accepted: 1 })

    const rows = async () => new Map(((await env.DB.prepare('SELECT * FROM attendance WHERE group_id = ? AND date = ?')
      .bind(groupId, lessonDate).all()).results || []).map((row) => [row.student_id, row]))
    let marks = await rows()
    expect(marks.get(students[0].id)).toMatchObject({ status: 'present', source: 'face', late_minutes: 0 })
    expect(marks.get(students[1].id)).toMatchObject({ status: 'late', source: 'face', late_minutes: 12 })
    expect(marks.has(students[2].id)).toBe(false)

    const beforeEnd = await finalizeFaceAbsences(env, { date: lessonDate, now: new Date(`${lessonDate}T15:32:00+05:00`) })
    expect(beforeEnd).toEqual({ closed: 0, absent: 0 })
    const closed = await finalizeFaceAbsences(env, { date: lessonDate, now: new Date(`${lessonDate}T15:40:00+05:00`) })
    expect(closed).toEqual({ closed: 1, absent: 1 })
    expect(await finalizeFaceAbsences(env, { date: lessonDate, now: new Date(`${lessonDate}T16:00:00+05:00`) })).toEqual({ closed: 0, absent: 0 })
    marks = await rows()
    expect(marks.get(students[2].id)).toMatchObject({ status: 'absent', source: 'face' })
    expect(marks.get(students[0].id).status).toBe('present')

    const manual = (values) => request('/api/db', {
      method: 'POST',
      token: owner.access_token,
      body: { table: 'attendance', action: 'upsert', conflict: 'student_id,group_id,date', values },
    })
    const blocked = await manual({ student_id: students[1].id, group_id: groupId, date: lessonDate, status: 'present', note: '' })
    expect(blocked.status).toBe(409)
    expect((await blocked.json()).error.message).toContain('FACE_ID_LOCKED')
    const autoAbsentFix = await manual({ student_id: students[2].id, group_id: groupId, date: lessonDate, status: 'present', note: '' })
    expect(autoAbsentFix.status).toBe(200)
    const confirmed = await manual({ student_id: students[1].id, group_id: groupId, date: lessonDate, status: 'present', note: '', override_face: true })
    expect(confirmed.status).toBe(200)
    marks = await rows()
    expect(marks.get(students[1].id)).toMatchObject({ status: 'present', source: 'manual', late_minutes: null })
    expect(marks.get(students[2].id)).toMatchObject({ status: 'present', source: 'manual' })

    const late2 = await request('/api/face/device/events', { method: 'POST', headers: auth, body: acsEvent(late, `${lessonDate}T14:20:00+05:00`) })
    expect((await late2.json()).data.accepted).toBe(1)
    expect((await rows()).get(students[1].id).source).toBe('manual')

    const removed = await request(`/api/students/${students[2].id}`, { method: 'POST', token: owner.access_token, body: { action: 'delete' } })
    expect(removed.status).toBe(200)
    const deletion = (await (await request('/api/face/device/pending', { headers: auth })).json()).data.items
    expect(deletion).toEqual([expect.objectContaining({ employee_no: absent, action: 'delete', photos: [] })])
  })
})

describe('batched bootstrap reads', () => {
  async function staffSession(owner, role, name, password) {
    const created = (await (await request('/api/staff', {
      method: 'POST',
      token: owner.access_token,
      body: { name, role, password },
    })).json()).data
    return (await (await request('/api/auth/login', {
      method: 'POST',
      body: { username: created.username, password },
    })).json()).session
  }

  const bootstrap = (token, body) => request('/api/bootstrap', { method: 'POST', token, body })
  const dbSelect = async (token, body) => (await (await request('/api/db', { method: 'POST', token, body })).json()).data

  it('returns the same rows as /api/db, pages past 500 rows on the server, and includes schedule state', async () => {
    const owner = await loginOwner()
    await env.DB.batch(Array.from({ length: 520 }, (_, index) => env.DB
      .prepare('INSERT INTO expenses (id, title, amount, category, date) VALUES (?, ?, ?, ?, ?)')
      .bind(`bootstrap-expense-${index}`, `Bulk ${index}`, 1000, 'Operatsion', '2026-03-01')))
    const response = await bootstrap(owner.access_token, {
      queries: {
        expenses: { table: 'expenses', order: { column: 'date', ascending: false }, all: true },
        teachers: { table: 'teachers', order: { column: 'created_at', ascending: true } },
        groups: { table: 'groups', columns: 'id, name, monthly_fee', order: { column: 'created_at', ascending: true }, all: true },
      },
      schedule: true,
    })
    expect(response.status).toBe(200)
    const { data } = await response.json()
    const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM expenses').first()
    expect(total.n).toBeGreaterThan(500)
    expect(data.results.expenses).toMatchObject({ error: null })
    expect(data.results.expenses.data).toHaveLength(total.n)
    expect(data.results.teachers.data).toEqual(await dbSelect(owner.access_token, { table: 'teachers', order: { column: 'created_at', ascending: true } }))
    expect(data.results.groups.data).toEqual(await dbSelect(owner.access_token, { table: 'groups', columns: 'id, name, monthly_fee', order: { column: 'created_at', ascending: true }, limit: 500 }))
    const schedule = await request('/api/schedule/state', { token: owner.access_token })
    expect(data.schedule).toEqual((await schedule.json()).data)
  })

  it('applies the same per-table role, row, and column rules as /api/db', async () => {
    const owner = await loginOwner()
    const teacher = await staffSession(owner, 'teacher', 'Bootstrap Teacher', 'bootstrap-teacher-123')
    const teacherId = teacher.user.teacher_id
    const ownGroup = crypto.randomUUID()
    const otherGroup = crypto.randomUUID()
    const ownStudent = crypto.randomUUID()
    const otherStudent = crypto.randomUUID()
    await env.DB.batch([
      env.DB.prepare('INSERT INTO groups (id, name, teacher_id, monthly_fee, schedule) VALUES (?, ?, ?, ?, ?)').bind(ownGroup, 'Bootstrap Own', teacherId, 300000,
        JSON.stringify([{ slotId: 'slot-0', day: 3, startTime: '07:00', endTime: '07:30', teacherId }])),
      env.DB.prepare('INSERT INTO groups (id, name, teacher_id, monthly_fee, schedule) VALUES (?, ?, ?, ?, ?)').bind(otherGroup, 'Bootstrap Other', null, 300000, '[]'),
      env.DB.prepare('INSERT INTO students (id, name) VALUES (?, ?)').bind(ownStudent, 'Bootstrap Own Student'),
      env.DB.prepare('INSERT INTO students (id, name) VALUES (?, ?)').bind(otherStudent, 'Bootstrap Other Student'),
      env.DB.prepare('INSERT INTO group_students (group_id, student_id) VALUES (?, ?)').bind(ownGroup, ownStudent),
      env.DB.prepare('INSERT INTO group_students (group_id, student_id) VALUES (?, ?)').bind(otherGroup, otherStudent),
      env.DB.prepare("INSERT INTO attendance (id, student_id, group_id, date, status) VALUES (?, ?, ?, '2026-04-01', 'present')").bind(crypto.randomUUID(), ownStudent, ownGroup),
      env.DB.prepare("INSERT INTO attendance (id, student_id, group_id, date, status) VALUES (?, ?, ?, '2026-04-01', 'absent')").bind(crypto.randomUUID(), otherStudent, otherGroup),
    ])
    const queries = {
      groups: { table: 'groups', columns: 'id, name, teacher_id, schedule', order: { column: 'created_at', ascending: true } },
      students: { table: 'students', columns: 'id, name, phone', order: { column: 'created_at', ascending: true } },
      links: { table: 'group_students', order: { column: 'group_id', ascending: true } },
      attendance: { table: 'attendance', order: { column: 'date', ascending: false } },
    }
    const response = await bootstrap(teacher.access_token, {
      queries: {
        ...Object.fromEntries(Object.entries(queries).map(([key, query]) => [key, { ...query, all: true }])),
        payments: { table: 'payments', all: true },
        fees: { table: 'groups', columns: 'id, monthly_fee' },
        profiles: { table: 'profiles' },
      },
      schedule: true,
    })
    expect(response.status).toBe(200)
    const { data } = await response.json()
    for (const [key, query] of Object.entries(queries)) {
      expect(data.results[key].error).toBeNull()
      expect(data.results[key].data).toEqual(await dbSelect(teacher.access_token, query))
    }
    expect(data.results.groups.data.map((group) => group.id)).toEqual([ownGroup])
    expect(data.results.students.data.map((student) => student.id)).toEqual([ownStudent])
    expect(data.results.attendance.data.map((row) => row.student_id)).toEqual([ownStudent])
    expect(data.results.payments).toEqual({ data: null, error: { message: 'Access denied.', status: 403 } })
    expect(data.results.fees).toEqual({ data: null, error: { message: 'Access denied', status: 403 } })
    expect(data.results.profiles.error.status).toBe(403)
    const schedule = await request('/api/schedule/state', { token: teacher.access_token })
    expect(data.schedule).toEqual((await schedule.json()).data)
  })

  it('rejects anonymous, write, oversized, and malformed batches', async () => {
    const owner = await loginOwner()
    expect((await bootstrap(null, { queries: { teachers: { table: 'teachers' } } })).status).toBe(401)
    expect((await bootstrap(owner.access_token, { queries: { expenses: { table: 'expenses', action: 'insert', values: { title: 'x', amount: 1 } } } })).status).toBe(400)
    expect((await bootstrap(owner.access_token, { queries: { users: { table: 'users' } } })).status).toBe(400)
    expect((await bootstrap(owner.access_token, { queries: { teachers: { table: 'teachers' } }, extra: true })).status).toBe(400)
    const many = Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`q${index}`, { table: 'teachers' }]))
    expect((await bootstrap(owner.access_token, { queries: many })).status).toBe(400)
  })
})
