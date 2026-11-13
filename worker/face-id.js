import { z } from 'zod'
import { getEffectiveLesson, timeToMinutes } from '../shared/schedule.js'
import { canAccessEndpoint } from '../shared/role-permissions.js'

export const FACE_ANGLES = Object.freeze(['front', 'left', 'right'])
export const FACE_VERIFY_MAJOR = 5
export const FACE_VERIFY_MINOR = 75
export const EARLY_WINDOW_MINUTES = 60
export const ABSENT_GRACE_MINUTES = 5
const MAX_FACE_BYTES = 400 * 1024
const PHOTO_URL_TTL_MS = 60 * 60 * 1000
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000
const encoder = new TextEncoder()

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function fail(message, status = 400) {
  return json({ error: message }, status)
}

function base64Url(bytes) {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function base64UrlBytes(value) {
  const base64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (char) => char.charCodeAt(0))
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function signingKey(env) {
  if (typeof env.AUTH_SECRET !== 'string' || env.AUTH_SECRET.length < 32) throw new Error('Authentication secret is not configured securely.')
  return crypto.subtle.importKey('raw', encoder.encode(env.AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signFacePhotoUrl(env, origin, key) {
  const expires = Date.now() + PHOTO_URL_TTL_MS
  const signature = await crypto.subtle.sign('HMAC', await signingKey(env), encoder.encode(`face:${key}:${expires}`))
  return `${origin}/api/face-photo/${key}?exp=${expires}&sig=${base64Url(signature)}`
}

export function parseDeviceTime(value) {
  const text = String(value || '').trim().replace(' ', 'T')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return null
  const normalized = text.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
  // Hikvision vaqtni zonasisiz yuborishi mumkin; maktab Toshkentda (UTC+5, yozgi vaqt yo‘q).
  const withZone = /([zZ]|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}+05:00`
  const date = new Date(withZone)
  return Number.isNaN(date.getTime()) ? null : date
}

export function tashkentClock(date) {
  const shifted = new Date(date.getTime() + TASHKENT_OFFSET_MS)
  return {
    date: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    time: shifted.toISOString().slice(11, 16),
  }
}

function lessonStartIso(date, time) {
  return new Date(`${date}T${time}:00+05:00`).toISOString()
}

/** Skan vaqti (Toshkent, daqiqa) va dars bo‘yicha holat: oynadan tashqarida bo‘lsa null. */
export function faceAttendanceStatus(scanMinutes, lesson) {
  const start = timeToMinutes(lesson?.startTime)
  const end = timeToMinutes(lesson?.endTime)
  if (start === null || end === null) return null
  if (scanMinutes < start - EARLY_WINDOW_MINUTES || scanMinutes > end) return null
  if (scanMinutes <= start) return { status: 'present', lateMinutes: 0 }
  return { status: 'late', lateMinutes: scanMinutes - start }
}

function formatDate(date) {
  const [year, month, day] = String(date || '').split('-')
  return day ? `${day}.${month}.${year}` : String(date || '')
}

export function faceAttendanceNotice({ studentName, groupName, status, lateMinutes, date, checkedInAt }) {
  const name = studentName || 'O‘quvchi'
  if (status === 'late') {
    const arrived = checkedInAt ? tashkentClock(new Date(checkedInAt)).time : ''
    return [
      `${name} darsga ${Number(lateMinutes) || 0} daqiqa kechikdi.`,
      `Guruh: ${groupName || '—'}`,
      `Sana: ${formatDate(date)}`,
      ...(arrived ? [`Kelgan vaqti: ${arrived}`] : []),
    ].join('\n')
  }
  if (status === 'absent') {
    return [`${name} darsga kelmadi.`, `Guruh: ${groupName || '—'}`, `Sana: ${formatDate(date)}`].join('\n')
  }
  return null
}

async function lessonsForGroups(env, groupIds, date) {
  const ids = [...new Set(groupIds)].filter(Boolean).slice(0, 200)
  if (!ids.length) return []
  const placeholders = ids.map(() => '?').join(',')
  const [groups, versions, overrides] = await Promise.all([
    env.DB.prepare(`SELECT id, name, teacher_id, schedule FROM groups WHERE id IN (${placeholders})`).bind(...ids).all(),
    env.DB.prepare(`SELECT * FROM schedule_versions WHERE group_id IN (${placeholders})`).bind(...ids).all(),
    env.DB.prepare(`SELECT * FROM schedule_overrides WHERE group_id IN (${placeholders}) AND reverted_at IS NULL`).bind(...ids).all(),
  ])
  const state = { versions: versions.results || [], overrides: overrides.results || [] }
  const lessons = []
  for (const group of groups.results || []) {
    for (const lesson of getEffectiveLesson(group.id, date, { group, ...state })) {
      if (['cancelled', 'rescheduled'].includes(lesson.status)) continue
      lessons.push({ ...lesson, groupName: group.name })
    }
  }
  return lessons
}

async function ensureEmployeeNo(env, studentId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = await env.DB.prepare('SELECT employee_no FROM face_people WHERE student_id = ?').bind(studentId).first()
    if (existing) return Number(existing.employee_no)
    await env.DB.prepare(`INSERT OR IGNORE INTO face_people (student_id, employee_no)
      SELECT ?, COALESCE(MAX(n), 1000) + 1 FROM (
        SELECT employee_no AS n FROM face_people UNION ALL SELECT employee_no AS n FROM face_sync
      )`).bind(studentId).run()
  }
  throw new Error('Face ID raqamini ajratib bo‘lmadi.')
}

/** O‘quvchi rasmlari o‘zgarganda barcha faol qurilmalar uchun sinxronizatsiyani navbatga qo‘yadi. */
export async function queueFaceSync(env, studentId) {
  const now = new Date().toISOString()
  const [student, count, devices] = await Promise.all([
    env.DB.prepare('SELECT id, name FROM students WHERE id = ?').bind(studentId).first(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM student_faces WHERE student_id = ?').bind(studentId).first(),
    env.DB.prepare('SELECT id FROM face_devices WHERE is_active = 1').all(),
  ])
  if (!student || !Number(count?.n)) {
    await env.DB.prepare(`UPDATE face_sync SET action = 'delete', status = 'pending', version = version + 1,
      attempts = 0, last_error = NULL, updated_at = ? WHERE student_id = ?`).bind(now, studentId).run()
    return
  }
  if (!devices.results?.length) return
  const employeeNo = await ensureEmployeeNo(env, studentId)
  await env.DB.batch(devices.results.map((device) => env.DB.prepare(`INSERT INTO face_sync
      (student_id, device_id, employee_no, person_name, action, status, version, updated_at)
      VALUES (?, ?, ?, ?, 'upsert', 'pending', 1, ?)
      ON CONFLICT(student_id, device_id) DO UPDATE SET employee_no = excluded.employee_no,
        person_name = excluded.person_name, action = 'upsert', status = 'pending',
        version = face_sync.version + 1, attempts = 0, last_error = NULL, updated_at = excluded.updated_at`)
    .bind(studentId, device.id, employeeNo, String(student.name || '').slice(0, 32), now)))
}

/** O‘quvchi o‘chirilishidan oldin: R2 rasmlarini o‘chiradi va qurilmadan o‘chirishni navbatga qo‘yadi. */
export async function forgetStudentFaces(env, studentId) {
  const { results } = await env.DB.prepare('SELECT r2_key FROM student_faces WHERE student_id = ?').bind(studentId).all()
  for (const row of results || []) await env.FILES?.delete(row.r2_key)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM student_faces WHERE student_id = ?').bind(studentId),
    env.DB.prepare(`UPDATE face_sync SET action = 'delete', status = 'pending', version = version + 1,
      attempts = 0, last_error = NULL, updated_at = ? WHERE student_id = ?`).bind(new Date().toISOString(), studentId),
  ])
}

async function enqueueAllForDevice(env, deviceId) {
  const { results } = await env.DB.prepare(`SELECT DISTINCT f.student_id FROM student_faces f
    JOIN students s ON s.id = f.student_id`).all()
  for (const row of results || []) {
    const employeeNo = await ensureEmployeeNo(env, row.student_id)
    const student = await env.DB.prepare('SELECT name FROM students WHERE id = ?').bind(row.student_id).first()
    await env.DB.prepare(`INSERT OR IGNORE INTO face_sync (student_id, device_id, employee_no, person_name, action, status, updated_at)
      VALUES (?, ?, ?, ?, 'upsert', 'pending', ?)`)
      .bind(row.student_id, deviceId, employeeNo, String(student?.name || '').slice(0, 32), new Date().toISOString()).run()
  }
}

function syncSummary(rows) {
  if (!rows.length) return null
  if (rows.some((row) => row.status === 'error')) return 'error'
  if (rows.some((row) => row.status === 'pending')) return 'pending'
  return 'synced'
}

function isJpeg(bytes) {
  const header = new Uint8Array(bytes.slice(0, 3))
  return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
}

async function studentFaceDetails(env, studentId, origin) {
  const [photos, sync, person] = await Promise.all([
    env.DB.prepare(`SELECT id, angle, r2_key, size_bytes, created_at FROM student_faces WHERE student_id = ?
      ORDER BY CASE angle WHEN 'front' THEN 0 WHEN 'left' THEN 1 ELSE 2 END`).bind(studentId).all(),
    env.DB.prepare(`SELECT fs.device_id, d.name AS device_name, fs.action, fs.status, fs.last_error, fs.synced_at, fs.updated_at
      FROM face_sync fs JOIN face_devices d ON d.id = fs.device_id WHERE fs.student_id = ?`).bind(studentId).all(),
    env.DB.prepare('SELECT employee_no FROM face_people WHERE student_id = ?').bind(studentId).first(),
  ])
  const syncRows = sync.results || []
  return {
    student_id: studentId,
    employee_no: person?.employee_no ?? null,
    photos: await Promise.all((photos.results || []).map(async (photo) => ({
      id: photo.id,
      angle: photo.angle,
      size_bytes: photo.size_bytes,
      created_at: photo.created_at,
      url: await signFacePhotoUrl(env, origin, photo.r2_key),
    }))),
    sync: syncRows,
    sync_status: syncSummary(syncRows),
  }
}

/** Imzolangan rasm havolasi: <img> sarlavha yubora olmagani uchun auth o‘rniga HMAC imzo tekshiriladi. */
export async function handleFacePhoto(request, env) {
  if (!env.FILES || !env.AUTH_SECRET) return fail('File service is not configured.', 503)
  const url = new URL(request.url)
  let key
  try {
    key = decodeURIComponent(url.pathname.slice('/api/face-photo/'.length))
  } catch {
    return fail('Invalid file path.')
  }
  if (!key.startsWith('faces/') || key.includes('..')) return fail('Invalid file path.')
  const expires = Number(url.searchParams.get('exp'))
  if (!Number.isSafeInteger(expires) || expires < Date.now()) return fail('File link expired.', 403)
  try {
    const valid = await crypto.subtle.verify('HMAC', await signingKey(env), base64UrlBytes(url.searchParams.get('sig')),
      encoder.encode(`face:${key}:${expires}`))
    if (!valid) return fail('Invalid file signature.', 403)
  } catch {
    return fail('Invalid file signature.', 403)
  }
  const object = await env.FILES.get(key)
  if (!object) return fail('File not found.', 404)
  return new Response(object.body, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  })
}

const DeviceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  serial: z.string().trim().max(80).optional().default(''),
}).strict()

async function newDeviceToken() {
  const token = `kfd_${base64Url(crypto.getRandomValues(new Uint8Array(32)))}`
  return { token, hash: await sha256Hex(token) }
}

/** Xodimlar uchun Face ID marshrutlari (rasm, holat, qurilmalar, davomatni yakunlash). */
export async function handleFaceStaffRoutes(request, env, profile, pathname) {
  if (!profile) return fail('Login required.', 401)
  if (!canAccessEndpoint(profile.role, 'face:manage')) return fail('Access denied.', 403)
  const origin = new URL(request.url).origin

  if (pathname === '/api/face/overview' && request.method === 'GET') {
    const [devices, people, sync] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS n FROM face_devices WHERE is_active = 1').first(),
      env.DB.prepare('SELECT student_id, COUNT(*) AS photos FROM student_faces GROUP BY student_id').all(),
      env.DB.prepare(`SELECT fs.student_id, fs.status, fs.last_error FROM face_sync fs
        JOIN face_devices d ON d.id = fs.device_id WHERE d.is_active = 1 AND fs.action = 'upsert'`).all(),
    ])
    const syncByStudent = new Map()
    for (const row of sync.results || []) {
      if (!syncByStudent.has(row.student_id)) syncByStudent.set(row.student_id, [])
      syncByStudent.get(row.student_id).push(row)
    }
    return json({
      data: {
        devices: Number(devices?.n || 0),
        students: (people.results || []).map((row) => {
          const rows = syncByStudent.get(row.student_id) || []
          return {
            student_id: row.student_id,
            photos: Number(row.photos),
            sync_status: syncSummary(rows),
            last_error: rows.find((item) => item.status === 'error')?.last_error || null,
          }
        }),
      },
    })
  }

  if (pathname === '/api/face/attendance/finalize' && request.method === 'POST') {
    let body = {}
    try { body = await request.json() } catch { /* bo‘sh so‘rov — bugungi sana */ }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.date || '')) ? body.date : undefined
    return json({ data: await finalizeFaceAbsences(env, { date }) })
  }

  if (pathname === '/api/face/devices' || pathname.startsWith('/api/face/devices/')) {
    if (!canAccessEndpoint(profile.role, 'face:devices')) return fail('Access denied.', 403)
    if (pathname === '/api/face/devices' && request.method === 'GET') {
      const { results } = await env.DB.prepare(`SELECT d.id, d.name, d.serial, d.is_active, d.last_seen_at, d.last_event_at, d.created_at,
          (SELECT COUNT(*) FROM face_sync fs WHERE fs.device_id = d.id AND fs.status = 'synced' AND fs.action = 'upsert') AS synced_count,
          (SELECT COUNT(*) FROM face_sync fs WHERE fs.device_id = d.id AND fs.status = 'pending') AS pending_count,
          (SELECT COUNT(*) FROM face_sync fs WHERE fs.device_id = d.id AND fs.status = 'error') AS error_count
        FROM face_devices d ORDER BY d.created_at`).all()
      return json({ data: results || [] })
    }
    if (pathname === '/api/face/devices' && request.method === 'POST') {
      let body
      try { body = await request.json() } catch { return fail('Qurilma ma’lumoti noto‘g‘ri.') }
      const parsed = DeviceSchema.safeParse(body)
      if (!parsed.success) return fail('Qurilma nomi kiritilishi kerak.')
      const id = crypto.randomUUID()
      const { token, hash } = await newDeviceToken()
      await env.DB.prepare(`INSERT INTO face_devices (id, name, serial, token_hash, created_by)
        VALUES (?, ?, ?, ?, ?)`).bind(id, parsed.data.name, parsed.data.serial, hash, profile.id).run()
      await enqueueAllForDevice(env, id)
      return json({ data: { id, name: parsed.data.name, serial: parsed.data.serial, token } }, 201)
    }
    const match = pathname.match(/^\/api\/face\/devices\/([^/]+)$/)
    if (match && request.method === 'POST') {
      const device = await env.DB.prepare('SELECT * FROM face_devices WHERE id = ?').bind(match[1]).first()
      if (!device) return fail('Qurilma topilmadi.', 404)
      let body
      try { body = await request.json() } catch { return fail('So‘rov noto‘g‘ri.') }
      const action = String(body?.action || '')
      if (action === 'rotate') {
        const { token, hash } = await newDeviceToken()
        await env.DB.prepare('UPDATE face_devices SET token_hash = ? WHERE id = ?').bind(hash, device.id).run()
        return json({ data: { id: device.id, token } })
      }
      if (action === 'disable' || action === 'enable') {
        await env.DB.prepare('UPDATE face_devices SET is_active = ? WHERE id = ?').bind(action === 'enable' ? 1 : 0, device.id).run()
        if (action === 'enable') await enqueueAllForDevice(env, device.id)
        return json({ data: { id: device.id, is_active: action === 'enable' } })
      }
      if (action === 'delete') {
        await env.DB.prepare('DELETE FROM face_devices WHERE id = ?').bind(device.id).run()
        return json({ data: { id: device.id, deleted: true } })
      }
      return fail('Noma’lum amal.')
    }
    return fail('Face ID route not found.', 404)
  }

  const faces = pathname.match(/^\/api\/students\/([^/]+)\/faces(?:\/([^/]+))?$/)
  if (!faces) return fail('Face ID route not found.', 404)
  const studentId = decodeURIComponent(faces[1])
  const student = await env.DB.prepare('SELECT id, name FROM students WHERE id = ?').bind(studentId).first()
  if (!student) return fail('O‘quvchi topilmadi.', 404)

  if (!faces[2] && request.method === 'GET') return json({ data: await studentFaceDetails(env, studentId, origin) })

  if (!faces[2] && request.method === 'POST') {
    if (!env.FILES) return fail('R2 binding is not configured.', 503)
    let form
    try { form = await request.formData() } catch { return fail('Rasm yuborilmadi.') }
    const file = form.get('file')
    const angle = String(form.get('angle') || '')
    if (!FACE_ANGLES.includes(angle)) return fail('Rasm burchagi noto‘g‘ri.')
    if (!(file instanceof File) || file.size <= 0) return fail('Rasm yuborilmadi.')
    if (file.size > MAX_FACE_BYTES) return fail('Rasm hajmi 400 KB dan oshmasligi kerak.', 413)
    const bytes = await file.arrayBuffer()
    if (!isJpeg(bytes)) return fail('Faqat JPEG rasm qabul qilinadi.', 415)
    const previous = await env.DB.prepare('SELECT id, r2_key FROM student_faces WHERE student_id = ? AND angle = ?')
      .bind(studentId, angle).first()
    const key = `faces/${studentId}/${angle}-${crypto.randomUUID()}.jpg`
    await env.FILES.put(key, bytes, {
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: { studentId, angle, uploaderId: profile.id },
    })
    await env.DB.batch([
      env.DB.prepare('DELETE FROM student_faces WHERE student_id = ? AND angle = ?').bind(studentId, angle),
      env.DB.prepare(`INSERT INTO student_faces (id, student_id, r2_key, angle, size_bytes, created_by)
        VALUES (?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), studentId, key, angle, bytes.byteLength, profile.id),
    ])
    if (previous) await env.FILES.delete(previous.r2_key)
    await queueFaceSync(env, studentId)
    return json({ data: await studentFaceDetails(env, studentId, origin) }, 201)
  }

  if (faces[2] === 'sync' && request.method === 'POST') {
    await queueFaceSync(env, studentId)
    return json({ data: await studentFaceDetails(env, studentId, origin) })
  }

  if (faces[2] && request.method === 'DELETE') {
    const photo = await env.DB.prepare('SELECT id, r2_key FROM student_faces WHERE id = ? AND student_id = ?')
      .bind(decodeURIComponent(faces[2]), studentId).first()
    if (!photo) return fail('Rasm topilmadi.', 404)
    await env.DB.prepare('DELETE FROM student_faces WHERE id = ?').bind(photo.id).run()
    await env.FILES?.delete(photo.r2_key)
    await queueFaceSync(env, studentId)
    return json({ data: await studentFaceDetails(env, studentId, origin) })
  }

  return fail('Face ID route not found.', 404)
}

async function authenticateDevice(request, env, url) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    || request.headers.get('X-Device-Token')
    || url.searchParams.get('token')
    || ''
  if (!/^kfd_[A-Za-z0-9_-]{20,}$/.test(token)) return null
  const device = await env.DB.prepare('SELECT * FROM face_devices WHERE token_hash = ? AND is_active = 1')
    .bind(await sha256Hex(token)).first()
  if (!device) return null
  await env.DB.prepare('UPDATE face_devices SET last_seen_at = ? WHERE id = ?').bind(new Date().toISOString(), device.id).run()
  return device
}

function numberOrNull(value) {
  const number = Number(value)
  return value === undefined || value === null || value === '' || !Number.isFinite(number) ? null : number
}

/** Hikvision AcsEvent qidiruv javobi yoki HTTP listening hodisasini yagona ko‘rinishga keltiradi. */
export function extractHikvisionEvents(payload) {
  const events = []
  const visit = (item, fallbackTime) => {
    if (!item || typeof item !== 'object') return
    if (Array.isArray(item)) {
      for (const entry of item) visit(entry, fallbackTime)
      return
    }
    if (item.AcsEvent?.InfoList) {
      visit(item.AcsEvent.InfoList, fallbackTime)
      return
    }
    if (Array.isArray(item.InfoList)) {
      visit(item.InfoList, fallbackTime)
      return
    }
    if (Array.isArray(item.events)) {
      visit(item.events, fallbackTime)
      return
    }
    if (item.AccessControllerEvent && typeof item.AccessControllerEvent === 'object') {
      const inner = item.AccessControllerEvent
      events.push({
        major: numberOrNull(inner.majorEventType ?? inner.major),
        minor: numberOrNull(inner.subEventType ?? inner.minor),
        employeeNo: String(inner.employeeNoString ?? inner.employeeNo ?? '').trim(),
        time: item.dateTime || inner.time || fallbackTime || '',
        serialNo: numberOrNull(inner.serialNo),
        raw: item,
      })
      return
    }
    if ('major' in item || 'minor' in item || 'employeeNoString' in item) {
      events.push({
        major: numberOrNull(item.major),
        minor: numberOrNull(item.minor),
        employeeNo: String(item.employeeNoString ?? item.employeeNo ?? '').trim(),
        time: item.time || item.dateTime || fallbackTime || '',
        serialNo: numberOrNull(item.serialNo),
        raw: item,
      })
    }
  }
  visit(payload)
  return events
}

/** Hikvision multipart (event_log + Picture) ichidan JSON qismlarni ajratadi. */
export function parseMultipartJson(text, contentType) {
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType || '')?.[1]
  const parts = boundary ? text.split(`--${boundary}`) : [text]
  const payloads = []
  for (const part of parts) {
    const separator = part.indexOf('\r\n\r\n') >= 0 ? '\r\n\r\n' : '\n\n'
    const body = part.includes(separator) ? part.slice(part.indexOf(separator) + separator.length) : part
    const start = body.indexOf('{')
    const end = body.lastIndexOf('}')
    if (start < 0 || end <= start) continue
    try { payloads.push(JSON.parse(body.slice(start, end + 1))) } catch { /* rasm yoki XML qism */ }
  }
  return payloads
}

async function readEventPayloads(request) {
  const contentType = request.headers.get('Content-Type') || ''
  const text = await request.text()
  if (/multipart\//i.test(contentType)) return parseMultipartJson(text, contentType)
  try { return [JSON.parse(text)] } catch { return parseMultipartJson(text, '') }
}

/** Bitta tasdiqlangan yuz skanini o‘quvchining shu kundagi darslariga qo‘llaydi. */
export async function applyFaceScan(env, studentId, scannedAt) {
  const clock = tashkentClock(scannedAt)
  const { results: memberships } = await env.DB.prepare('SELECT group_id FROM group_students WHERE student_id = ?')
    .bind(studentId).all()
  const lessons = await lessonsForGroups(env, (memberships || []).map((row) => row.group_id), clock.date)
  const checkedIn = scannedAt.toISOString()
  const outcomes = []
  for (const lesson of lessons) {
    const decision = faceAttendanceStatus(clock.minutes, lesson)
    if (!decision) continue
    const existing = await env.DB.prepare('SELECT * FROM attendance WHERE student_id = ? AND group_id = ? AND date = ?')
      .bind(studentId, lesson.groupId, clock.date).first()
    const lateMinutes = decision.status === 'late' ? decision.lateMinutes : 0
    if (!existing) {
      await env.DB.prepare(`INSERT INTO attendance (id, student_id, group_id, date, status, note, source, checked_in_at, late_minutes, marked_at)
        VALUES (?, ?, ?, ?, ?, '', 'face', ?, ?, ?)`)
        .bind(crypto.randomUUID(), studentId, lesson.groupId, clock.date, decision.status, checkedIn, lateMinutes, new Date().toISOString()).run()
      outcomes.push(`${lesson.groupId}:${decision.status}`)
      continue
    }
    // Avvalgi (erta) skan saqlanadi; o‘qituvchi tasdiqlab o‘zgartirgan yozuvga tegilmaydi.
    if (existing.checked_in_at && existing.checked_in_at <= checkedIn) {
      outcomes.push(`${lesson.groupId}:kept`)
      continue
    }
    if (existing.source === 'manual' && existing.checked_in_at) {
      outcomes.push(`${lesson.groupId}:manual-override`)
      continue
    }
    await env.DB.prepare(`UPDATE attendance SET status = ?, source = 'face', checked_in_at = ?, late_minutes = ?,
      marked_by = NULL, marked_at = ? WHERE id = ?`)
      .bind(decision.status, checkedIn, lateMinutes, new Date().toISOString(), existing.id).run()
    outcomes.push(`${lesson.groupId}:${decision.status}`)
  }
  return outcomes.length ? outcomes.join(',') : 'no_lesson'
}

async function ingestEvents(env, device, payloads) {
  const summary = { received: 0, accepted: 0, duplicates: 0, ignored: 0, unknown: 0 }
  for (const event of payloads.flatMap((payload) => extractHikvisionEvents(payload))) {
    summary.received += 1
    const scannedAt = parseDeviceTime(event.time)
    if (event.major !== FACE_VERIFY_MAJOR || event.minor !== FACE_VERIFY_MINOR || !event.employeeNo || !scannedAt) {
      summary.ignored += 1
      continue
    }
    const person = /^\d{1,12}$/.test(event.employeeNo)
      ? await env.DB.prepare('SELECT student_id FROM face_people WHERE employee_no = ?').bind(Number(event.employeeNo)).first()
      : null
    const eventId = crypto.randomUUID()
    const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO face_events
        (id, device_id, dedupe_key, employee_no, student_id, event_time, major, minor, raw)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(eventId, device.id, `${device.id}:${event.employeeNo}:${scannedAt.toISOString()}`, event.employeeNo,
        person?.student_id || null, scannedAt.toISOString(), event.major, event.minor,
        JSON.stringify(event.raw).slice(0, 4000)).run()
    if (!inserted.meta?.changes) {
      summary.duplicates += 1
      continue
    }
    let result = 'unknown_person'
    if (person?.student_id) {
      result = await applyFaceScan(env, person.student_id, scannedAt)
      summary.accepted += 1
    } else summary.unknown += 1
    await env.DB.prepare('UPDATE face_events SET processed = 1, result = ? WHERE id = ?').bind(result.slice(0, 500), eventId).run()
  }
  if (summary.received) {
    await env.DB.prepare('UPDATE face_devices SET last_event_at = ? WHERE id = ?').bind(new Date().toISOString(), device.id).run()
  }
  return summary
}

const SyncResultSchema = z.object({
  results: z.array(z.object({
    employee_no: z.union([z.number().int(), z.string().regex(/^\d{1,12}$/)]),
    version: z.number().int().min(1),
    status: z.enum(['synced', 'error']),
    error: z.string().max(500).optional(),
  })).max(100),
})

/** Qurilma/bridge marshrutlari: qurilma tokeni bilan himoyalangan. */
export async function handleFaceDeviceRoutes(request, env, url) {
  const device = await authenticateDevice(request, env, url)
  if (!device) return fail('Device token is invalid.', 401)
  const pathname = url.pathname

  if (pathname === '/api/face/device/pending' && request.method === 'GET') {
    const { results } = await env.DB.prepare(`SELECT * FROM face_sync WHERE device_id = ? AND status = 'pending'
      ORDER BY updated_at LIMIT 10`).bind(device.id).all()
    const items = []
    for (const row of results || []) {
      const photos = row.action === 'upsert'
        ? (await env.DB.prepare(`SELECT angle, r2_key FROM student_faces WHERE student_id = ?
            ORDER BY CASE angle WHEN 'front' THEN 0 WHEN 'left' THEN 1 ELSE 2 END`).bind(row.student_id).all()).results || []
        : []
      items.push({
        student_id: row.student_id,
        employee_no: String(row.employee_no),
        name: row.person_name,
        action: row.action,
        version: row.version,
        photos: await Promise.all(photos.map(async (photo) => ({
          angle: photo.angle,
          url: await signFacePhotoUrl(env, url.origin, photo.r2_key),
        }))),
      })
    }
    return json({ data: { device: { id: device.id, name: device.name }, items } })
  }

  if (pathname === '/api/face/device/sync-result' && request.method === 'POST') {
    let body
    try { body = await request.json() } catch { return fail('Invalid sync result.') }
    const parsed = SyncResultSchema.safeParse(body)
    if (!parsed.success) return fail('Invalid sync result.')
    const now = new Date().toISOString()
    let updated = 0
    for (const result of parsed.data.results) {
      const row = await env.DB.prepare('SELECT * FROM face_sync WHERE device_id = ? AND employee_no = ? AND version = ?')
        .bind(device.id, Number(result.employee_no), result.version).first()
      if (!row) continue
      if (result.status === 'synced' && row.action === 'delete') {
        await env.DB.prepare('DELETE FROM face_sync WHERE device_id = ? AND student_id = ? AND version = ?')
          .bind(device.id, row.student_id, row.version).run()
      } else {
        await env.DB.prepare(`UPDATE face_sync SET status = ?, last_error = ?, attempts = attempts + 1, updated_at = ?,
          synced_at = CASE WHEN ? = 'synced' THEN COALESCE(synced_at, ?) ELSE synced_at END
          WHERE device_id = ? AND student_id = ? AND version = ?`)
          .bind(result.status, result.status === 'error' ? (result.error || 'Noma’lum xato') : null, now,
            result.status, now, device.id, row.student_id, row.version).run()
      }
      updated += 1
    }
    return json({ data: { updated } })
  }

  if (pathname === '/api/face/device/events' && request.method === 'POST') {
    const payloads = await readEventPayloads(request)
    return json({ data: await ingestEvents(env, device, payloads) })
  }

  return fail('Device route not found.', 404)
}

/**
 * Dars tugagach (+5 daqiqa) skan qilmagan, Face ID ga ulangan o‘quvchilarni "kelmadi" deb belgilaydi.
 * Faol qurilma bo‘lmasa hech narsa qilmaydi; mavjud (qo‘lda yoki skan) yozuvlarga tegmaydi.
 */
export async function finalizeFaceAbsences(env, { date, now = new Date() } = {}) {
  const summary = { closed: 0, absent: 0 }
  const active = await env.DB.prepare('SELECT COUNT(*) AS n FROM face_devices WHERE is_active = 1').first()
  if (!Number(active?.n)) return summary
  const clock = tashkentClock(now)
  const targetDate = date || clock.date
  if (targetDate > clock.date) return summary
  const { results: enrolledRows } = await env.DB.prepare(`SELECT student_id, MIN(synced_at) AS synced_at FROM face_sync
    WHERE action = 'upsert' AND synced_at IS NOT NULL GROUP BY student_id`).all()
  if (!enrolledRows?.length) return summary
  const enrolled = new Map(enrolledRows.map((row) => [row.student_id, row.synced_at]))
  const { results: memberships } = await env.DB.prepare(`SELECT gs.group_id, gs.student_id, s.joined_at
    FROM group_students gs JOIN students s ON s.id = gs.student_id`).all()
  const byGroup = new Map()
  for (const row of memberships || []) {
    if (!enrolled.has(row.student_id)) continue
    if (!byGroup.has(row.group_id)) byGroup.set(row.group_id, [])
    byGroup.get(row.group_id).push(row)
  }
  if (!byGroup.size) return summary
  const lessons = await lessonsForGroups(env, [...byGroup.keys()], targetDate)
  const { results: closedRows } = await env.DB.prepare('SELECT group_id, slot_id FROM face_lesson_closures WHERE date = ?')
    .bind(targetDate).all()
  const closed = new Set((closedRows || []).map((row) => `${row.group_id}:${row.slot_id}`))
  for (const lesson of lessons) {
    const end = timeToMinutes(lesson.endTime)
    if (end === null || closed.has(`${lesson.groupId}:${lesson.slotId}`)) continue
    if (targetDate === clock.date && clock.minutes < end + ABSENT_GRACE_MINUTES) continue
    const startIso = lessonStartIso(targetDate, lesson.startTime)
    const students = (byGroup.get(lesson.groupId) || []).filter((row) => (
      enrolled.get(row.student_id) <= startIso && String(row.joined_at || '') <= targetDate
    ))
    const markedAt = new Date().toISOString()
    const results = await env.DB.batch([
      ...students.map((row) => env.DB.prepare(`INSERT OR IGNORE INTO attendance
          (id, student_id, group_id, date, status, note, source, marked_at)
          VALUES (?, ?, ?, ?, 'absent', '', 'face', ?)`)
        .bind(crypto.randomUUID(), row.student_id, lesson.groupId, targetDate, markedAt)),
      env.DB.prepare(`INSERT OR IGNORE INTO face_lesson_closures (group_id, date, slot_id, absent_count)
        VALUES (?, ?, ?, ?)`).bind(lesson.groupId, targetDate, lesson.slotId, students.length),
    ])
    summary.closed += 1
    summary.absent += results.slice(0, students.length).reduce((sum, result) => sum + Number(result.meta?.changes || 0), 0)
  }
  return summary
}
