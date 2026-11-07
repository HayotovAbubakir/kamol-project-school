import { cloudflare } from '../lib/cloudflare.js'

function assertConfigured() {
  if (!cloudflare) throw new Error('Cloudflare API sozlanmagan.')
}

function unwrap(result) {
  if (result.error) throw result.error
  return result.data || []
}

async function workerApi(path, options = {}) {
  const { data: sessionData } = await cloudflare.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error('Sessiya tugagan. Telegram ilovasini qayta oching.')
  const response = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'So‘rovni bajarib bo‘lmadi.')
  return result.data
}

export async function fetchProfile(userId) {
  assertConfigured()
  const { data, error } = await cloudflare.auth.getUser()
  if (error) throw error
  if (!data.user || data.user.id !== userId) throw new Error('Foydalanuvchi profili topilmadi.')
  return { ...data.user, teacherId: data.user.teacher_id }
}

export async function loadStudentMiniAppOverview() {
  return workerApi('/api/miniapp/student/overview')
}

async function uploadFile(file, context) {
  if (!file) return null
  if (file.size <= 0 || file.size > 100 * 1024 * 1024) {
    throw new Error('Har bir fayl hajmi 100 MB dan oshmasligi kerak.')
  }
  const { data: sessionData } = await cloudflare.auth.getSession()
  if (!sessionData.session?.access_token) throw new Error('Fayl yuklash uchun tizimga kiring.')
  const form = new FormData()
  form.append('file', file)
  form.append('homework_id', context.homeworkId || '')
  form.append('group_id', context.groupId || '')
  const response = await fetch('/api/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
    body: form,
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || `Cloudflare R2 yuklash xatosi (${response.status}).`)
  return result.file_url
}

export async function loadHomeworks(profile) {
  assertConfigured()
  let homeworks

  if (profile.role === 'student') {
    return (await loadStudentMiniAppOverview()).homeworks
  }

  let query = cloudflare.from('homework')
    .select('id, group_id, teacher_id, title, description, file_url, due_at, groups(name)')
    .order('due_at', { ascending: true })
    .limit(100)
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
    .limit(500))
  return rows.map((group) => ({
    ...group,
    schedule: Array.isArray(group.schedule) ? group.schedule : JSON.parse(group.schedule || '[]'),
  }))
}

export async function createHomework(profile, input) {
  assertConfigured()
  if (!profile.teacher_id) throw new Error('O‘qituvchi profili guruhga bog‘lanmagan.')
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
  if (!profile.student_id) throw new Error('O‘quvchi profili bazaga bog‘lanmagan.')
  const submission = await workerApi('/api/homework/draft', {
    method: 'POST',
    body: JSON.stringify({ homework_id: homework.id, text: input.text.trim() }),
  })
  const files = input.files || (input.file ? [input.file] : [])
  for (const file of files) {
    const form = new FormData()
    form.append('submission_id', submission.id)
    form.append('file', file)
    await workerApi('/api/homework/draft/file', { method: 'POST', body: form })
  }
  return submission
}

export async function uploadHomeworkDraftProof(submissionId, blob, durationSeconds) {
  const form = new FormData()
  form.append('submission_id', submissionId)
  form.append('duration_seconds', String(durationSeconds))
  form.append('file', blob, 'miniapp-voice-proof.webm')
  return workerApi('/api/homework/draft/proof', { method: 'POST', body: form })
}

async function reviewRequest(path, options) {
  const { data: sessionData } = await cloudflare.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error('Davom etish uchun tizimga kiring.')
  const response = await fetch(path, {
    method: options?.method || 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'So‘rovni bajarib bo‘lmadi.')
  return result.data
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
  if (!response.ok) throw new Error(result.error || 'Telegram bot manzilini olib bo‘lmadi.')
  return `https://t.me/${result.bot_username}?start=hw_${encodeURIComponent(homeworkId)}`
}

export async function declareHomeworkResult(submissionId, result, reason = '') {
  await workerApi('/api/homework/declaration', {
    method: 'POST',
    body: JSON.stringify({ submission_id: submissionId, result, reason }),
  })
}

export async function fetchHomeworkFileBlob(file) {
  const { data: sessionData } = await cloudflare.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error('Sessiya tugagan. Telegram ilovasini qayta oching.')
  const response = await fetch(file.download_url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error('Faylni yuklab bo‘lmadi.')
  const type = file.kind === 'voice' ? 'audio/ogg' : file.kind === 'video_note' ? 'video/mp4' : 'application/octet-stream'
  return URL.createObjectURL(new Blob([await response.blob()], { type }))
}

export async function listQuestionTickets(status = '', search = '') {
  const query = new URLSearchParams()
  if (status) query.set('status', status)
  if (search) query.set('search', search)
  return workerApi(`/api/questions?${query}`)
}

export async function createQuestionTicket(text, groupId, file) {
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
      ? 'id, name, phone, parent_phone, monthly_fee, login'
      : 'id, name, phone, parent_phone, monthly_fee'
  const students = unwrap(await cloudflare.from('students').select(columns).order('name').limit(500))
  if (profile?.role === 'teacher' || !students.length) return students
  const profiles = unwrap(await cloudflare.from('profiles')
    .select('id, student_id, telegram_id')
    .in('student_id', students.map((student) => student.id)))
  const byStudent = new Map(profiles.map((item) => [item.student_id, item]))
  return students.map((item) => ({
    ...item,
    profile_id: byStudent.get(item.id)?.id || null,
    telegram_id: byStudent.get(item.id)?.telegram_id || null,
  }))
}

export async function loadMonthlyReport() {
  assertConfigured()
  return unwrap(await cloudflare.from('monthly_homework_report')
    .select('student_id, student_name, month_start, assigned_count, submitted_on_time_count, late_count, not_done_count, bajardi_count, bajarmadi_count')
    .order('month_start', { ascending: false })
    .limit(500))
}
