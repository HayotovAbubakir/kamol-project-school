import { authFetch, cloudflare } from '../lib/cloudflare.js'
import { normalizeScheduleWeekdays } from '../../shared/schedule.js'
import { canAccessTable } from '../../shared/role-permissions.js'
import { groupFeeHistoryByGroup } from '../../shared/fees.js'
import { t } from './i18n.js'

export const MAX_HOMEWORK_FILE_BYTES = 100 * 1024 * 1024
export const MAX_QUESTION_FILE_BYTES = 20 * 1024 * 1024
export const MAX_PROOF_FILE_BYTES = 20 * 1024 * 1024

function assertConfigured() {
  if (!cloudflare) throw new Error(t('Cloudflare API sozlanmagan.'))
}

function unwrap(result) {
  if (result.error) throw result.error
  return result.data || []
}

async function workerApi(path, options = {}) {
  const response = await authFetch(path, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  })
  let result = {}
  try { result = await response.json() } catch { /* bo‘sh javob */ }
  if (!response.ok) {
    throw new Error(result.error || (response.status === 401
      ? t('Sessiya tugagan. Telegram ilovasini qayta oching.')
      : t('So‘rovni bajarib bo‘lmadi.')))
  }
  return result.data
}

export async function fetchProfile(userId) {
  assertConfigured()
  const { data, error } = await cloudflare.auth.getUser()
  if (error) throw error
  if (!data.user || data.user.id !== userId) throw new Error(t('Foydalanuvchi profili topilmadi.'))
  return { ...data.user, teacherId: data.user.teacher_id }
}

export async function loadStudentMiniAppOverview() {
  return workerApi('/api/miniapp/student/overview')
}

export async function loadScheduleNotifications() {
  return workerApi('/api/notifications')
}

export async function previewScheduleChange(payload) {
  return workerApi('/api/schedule/preview', { method: 'POST', body: JSON.stringify(payload) })
}

export async function createScheduleChange(payload) {
  return workerApi('/api/schedule/changes', { method: 'POST', body: JSON.stringify(payload) })
}

export async function loadScheduleChangeHistory(groupId) {
  return workerApi(`/api/schedule/history?group_id=${encodeURIComponent(groupId)}`)
}

export async function undoScheduleChange(changeId) {
  return workerApi(`/api/schedule/changes/${encodeURIComponent(changeId)}/undo`, {
    method: 'POST', body: JSON.stringify({}),
  })
}

export async function resendScheduleNotification(notificationId) {
  return workerApi(`/api/schedule/notifications/${encodeURIComponent(notificationId)}/resend`, {
    method: 'POST', body: JSON.stringify({}),
  })
}

async function uploadFile(file, context) {
  if (!file) return null
  if (file.size <= 0 || file.size > MAX_HOMEWORK_FILE_BYTES) {
    throw new Error(t('Har bir fayl hajmi 100 MB dan oshmasligi kerak.'))
  }
  const form = new FormData()
  form.append('file', file)
  form.append('homework_id', context.homeworkId || '')
  form.append('group_id', context.groupId || '')
  const response = await authFetch('/api/files', { method: 'POST', body: form })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || t('Cloudflare R2 yuklash xatosi ({status}).', { status: response.status }))
  return result.file_url
}

export async function loadHomeworks(profile) {
  assertConfigured()
  let homeworks

  if (profile.role === 'student') {
    return (await loadStudentMiniAppOverview()).homeworks
  }

  // Eng yangi muddatlar birinchi: eski vazifalar 100 talik ro‘yxatni to‘ldirib qo‘ymasin.
  let query = cloudflare.from('homework')
    .select('id, group_id, teacher_id, title, description, file_url, due_at, groups(name)')
    .order('due_at', { ascending: false })
    .limit(200)
  if (profile.role === 'teacher') query = query.eq('teacher_id', profile.teacher_id)
  homeworks = unwrap(await query)
  if (!homeworks.length) return []

  const submissions = unwrap(await cloudflare.from('homework_submissions')
    .select('id, homework_id, student_id, attempt_number, content_text, file_url, video_note_url, voice_url, status, state, student_result, teacher_result, feedback, submitted_at, students(name)')
    .in('homework_id', homeworks.map((task) => task.id))
    .order('attempt_number', { ascending: false })
    .limit(500))
  const review = await workerApi('/api/homework/review')
  const byHomework = new Map()
  for (const submission of submissions) {
    const enhanced = review.submissions.find((item) => item.id === submission.id)
    const list = byHomework.get(submission.homework_id) || []
    list.push({ ...submission, files: enhanced?.files || [], student_name: enhanced?.student_name || submission.students?.name })
    byHomework.set(submission.homework_id, list)
  }
  return homeworks.map((task) => ({
    ...task,
    submissions: byHomework.get(task.id) || [],
    notSubmitted: review.not_submitted.filter((student) => student.homework_id === task.id),
  }))
}

export async function loadGroups(profile) {
  assertConfigured()
  const columns = profile?.role === 'teacher'
    ? 'id, name, teacher_id, schedule'
    : 'id, name, teacher_id, monthly_fee, schedule'
  const rows = unwrap(await cloudflare.from('groups')
    .select(columns)
    .order('name')
    .all())
  const scheduleState = await workerApi('/api/schedule/state')
  const stateByGroup = new Map((scheduleState.groups || []).map((state) => [state.group_id, state]))
  // Narx tarixi: o‘tgan oy qarzlari o‘sha oydagi narxda hisoblanadi. Jadval yo‘q bo‘lsa — joriy narx.
  let feeHistoryByGroup = new Map()
  if (canAccessTable(profile?.role, 'group_fee_history')) {
    const history = await cloudflare.from('group_fee_history').select('group_id, monthly_fee, valid_from').order('group_id').all()
    if (!history.error) feeHistoryByGroup = groupFeeHistoryByGroup(history.data || [])
  }
  return rows.map((group) => ({
    ...group,
    feeHistory: feeHistoryByGroup.get(group.id) || [],
    schedule: normalizeScheduleWeekdays(Array.isArray(group.schedule) ? group.schedule : JSON.parse(group.schedule || '[]')),
    scheduleVersions: stateByGroup.get(group.id)?.versions || [],
    scheduleOverrides: stateByGroup.get(group.id)?.overrides || [],
  }))
}

export async function createHomework(profile, input) {
  assertConfigured()
  if (!profile.teacher_id) throw new Error(t('O‘qituvchi profili guruhga bog‘lanmagan.'))
  let fileUrl = null
  if (input.file) fileUrl = await uploadFile(input.file, { groupId: input.groupId })
  const deadline = input.deadline
    ? new Date(`${input.deadline}:00+05:00`).toISOString()
    : null

  const { data, error } = await cloudflare.from('homework').insert({
    teacher_id: profile.teacher_id,
    group_id: input.groupId,
    title: input.title.trim(),
    description: input.description.trim(),
    due_at: deadline,
    deadline,
    file_url: fileUrl,
  }).select('id').single()
  if (error) throw error
  return data
}

export async function submitHomework(profile, homework, input) {
  assertConfigured()
  if (!profile.student_id) throw new Error(t('O‘quvchi profili bazaga bog‘lanmagan.'))
  const submission = await workerApi('/api/homework/draft', {
    method: 'POST',
    body: JSON.stringify({ homework_id: homework.id, text: input.text.trim() }),
  })
  const files = input.files || (input.file ? [input.file] : [])
  const oversized = files.find((file) => file.size <= 0 || file.size > MAX_HOMEWORK_FILE_BYTES)
  if (oversized) throw new Error(t('“{name}” fayli bo‘sh yoki 100 MB dan katta.', { name: oversized.name }))
  for (const file of files) {
    const form = new FormData()
    form.append('submission_id', submission.id)
    form.append('file', file)
    await workerApi('/api/homework/draft/file', { method: 'POST', body: form })
  }
  return submission
}

export async function uploadHomeworkDraftProof(submissionId, blob, durationSeconds) {
  if (!blob?.size) throw new Error(t('Ovozli xabar yozilmadi. Qayta urinib ko‘ring.'))
  if (blob.size > MAX_PROOF_FILE_BYTES) throw new Error(t('Ovozli xabar 20 MB dan oshmasligi kerak. Qisqaroq yozing.'))
  if (blob.type && !blob.type.startsWith('audio/')) throw new Error(t('Faqat ovozli yozuv qabul qilinadi.'))
  const extension = /ogg/.test(blob.type) ? 'ogg' : /mp4|aac|m4a/.test(blob.type) ? 'm4a' : 'webm'
  const form = new FormData()
  form.append('submission_id', submissionId)
  form.append('duration_seconds', String(durationSeconds))
  form.append('file', blob, `miniapp-voice-proof.${extension}`)
  return workerApi('/api/homework/draft/proof', { method: 'POST', body: form })
}

async function reviewRequest(path, options) {
  return workerApi(path, {
    method: options?.method || 'GET',
    body: options?.body ? JSON.stringify(options.body) : undefined,
  })
}

export async function reviewSubmission(id, status, feedback) {
  assertConfigured()
  return reviewRequest('/api/homework/review', {
    method: 'POST',
    body: {
      submission_id: id,
      result: status === 'approved' ? 'done' : 'not_done',
      comment: String(feedback || '').trim(),
    },
  })
}

export async function fetchHomeworkBotLink(homeworkId) {
  const response = await fetch('/api/telegram/bot-info')
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || t('Telegram bot manzilini olib bo‘lmadi.'))
  return `https://t.me/${result.bot_username}?start=hw_${encodeURIComponent(homeworkId)}`
}

export async function declareHomeworkResult(submissionId, result, reason = '') {
  await workerApi('/api/homework/declaration', {
    method: 'POST',
    body: JSON.stringify({ submission_id: submissionId, result, reason }),
  })
}

export async function fetchHomeworkFileBlob(file) {
  const response = await authFetch(file.download_url)
  if (!response.ok) throw new Error(t('Faylni yuklab bo‘lmadi.'))
  // Yozilgan formatni saqlaymiz: Mini App ovozi webm/mp4, bot ovozi ogg bo‘ladi.
  const fallback = file.kind === 'voice' ? 'audio/ogg' : file.kind === 'video_note' ? 'video/mp4' : 'application/octet-stream'
  const stored = String(file.mime_type || '')
  const type = stored && stored !== 'application/octet-stream' ? stored : fallback
  return URL.createObjectURL(new Blob([await response.blob()], { type }))
}

export async function listQuestionTickets(status = '', search = '') {
  const query = new URLSearchParams()
  if (status) query.set('status', status)
  if (search) query.set('search', search)
  return workerApi(`/api/questions?${query}`)
}

export async function createQuestionTicket(text, groupId, file) {
  if (file && (file.size <= 0 || file.size > MAX_QUESTION_FILE_BYTES)) {
    throw new Error(t('Savolga biriktiriladigan fayl 20 MB dan oshmasligi kerak.'))
  }
  if (!file) return workerApi('/api/questions', {
    method: 'POST',
    body: JSON.stringify({ text, ...(groupId ? { group_id: groupId } : {}) }),
  })
  const form = new FormData()
  form.append('text', text)
  if (groupId) form.append('group_id', groupId)
  form.append('file', file)
  return workerApi('/api/questions', { method: 'POST', body: form })
}

export async function replyQuestionTicket(id, text) {
  return workerApi(`/api/questions/${encodeURIComponent(id)}/reply`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

export async function closeQuestionTicket(id) {
  return workerApi(`/api/questions/${encodeURIComponent(id)}/close`, { method: 'POST', body: JSON.stringify({}) })
}

export async function loadHomeworkHistory(homeworkId) {
  const query = new URLSearchParams({ homework_id: homeworkId })
  return workerApi(`/api/homework/history?${query}`)
}

export async function loadStudents(profile) {
  assertConfigured()
  const columns = profile?.role === 'teacher'
    ? 'id, name, phone'
    : profile?.role === 'owner' || profile?.role === 'reception'
      ? 'id, name, phone, parent_phone, monthly_fee, login, telegram_id'
      : 'id, name, phone, parent_phone, monthly_fee'
  const students = unwrap(await cloudflare.from('students').select(columns).order('name').all())
  if (!students.length) return students
  // A’zolik: guruh kartalaridagi o‘quvchi soni, davomat ro‘yxati va oylik to‘lov hisobi uchun kerak.
  const memberships = unwrap(await cloudflare.from('group_students').select('group_id, student_id').order('group_id').all())
  const groupIdsByStudent = new Map()
  for (const row of memberships) {
    const list = groupIdsByStudent.get(row.student_id) || []
    list.push(row.group_id)
    groupIdsByStudent.set(row.student_id, list)
  }
  const withGroups = students.map((item) => ({ ...item, group_ids: groupIdsByStudent.get(item.id) || [] }))
  if (profile?.role === 'teacher') return withGroups
  // Qabulxonada `profiles` jadvaliga ruxsat yo‘q — so‘rasa butun yuklash 403 bilan to‘xtardi.
  // Telegram holati: Mini App profili yoki bot orqali kod bilan ulanish (`telegram_links`).
  const studentIds = students.map((student) => student.id)
  const profiles = canAccessTable(profile?.role, 'profiles')
    ? unwrap(await cloudflare.from('profiles').select('id, student_id, telegram_id').in('student_id', studentIds).all())
    : []
  const links = canAccessTable(profile?.role, 'telegram_links')
    ? unwrap(await cloudflare.from('telegram_links').select('chat_id, student_id').order('student_id').all())
    : []
  const byStudent = new Map(profiles.map((item) => [item.student_id, item]))
  const linkByStudent = new Map(links.map((item) => [item.student_id, item.chat_id]))
  return withGroups.map((item) => ({
    ...item,
    profile_id: byStudent.get(item.id)?.id || null,
    telegram_id: byStudent.get(item.id)?.telegram_id || item.telegram_id || linkByStudent.get(item.id) || null,
  }))
}

export async function loadMonthlyReport() {
  assertConfigured()
  return unwrap(await cloudflare.from('monthly_homework_report')
    .select('student_id, student_name, month_start, assigned_count, submitted_on_time_count, late_count, not_done_count, bajardi_count, bajarmadi_count')
    .order('month_start', { ascending: false })
    .limit(500))
}
