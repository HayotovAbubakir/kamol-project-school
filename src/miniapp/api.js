import { cloudflare } from '../lib/cloudflare.js'

function assertConfigured() {
  if (!cloudflare) throw new Error('Cloudflare API sozlanmagan.')
}

function unwrap(result) {
  if (result.error) throw result.error
  return result.data || []
}

export async function fetchProfile(userId) {
  assertConfigured()
  const { data, error } = await cloudflare.auth.getUser()
  if (error) throw error
  if (!data.user || data.user.id !== userId) throw new Error('Foydalanuvchi profili topilmadi.')
  return { ...data.user, teacherId: data.user.teacher_id }
}

async function uploadFile(file, context) {
  if (!file) return null
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) {
    throw new Error('Fayl hajmi 10 MB dan oshmasligi kerak.')
  }
  if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/webm'].includes(file.type)) {
    throw new Error('Faqat PDF, rasm, video yoki ovozli fayl yuborish mumkin.')
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
    const memberships = unwrap(await cloudflare.from('group_students')
      .select('group_id')
      .eq('student_id', profile.student_id))
    const groupIds = memberships.map((row) => row.group_id)
    if (!groupIds.length) return []

    homeworks = unwrap(await cloudflare.from('homework')
      .select('id, group_id, teacher_id, title, description, file_url, due_at, groups(name)')
      .in('group_id', groupIds)
      .order('due_at', { ascending: true })
      .limit(100))
    if (!homeworks.length) return []
    const submissions = unwrap(await cloudflare.from('homework_submissions')
      .select('id, homework_id, content_text, file_url, video_note_url, voice_url, status, feedback, submitted_at')
      .eq('student_id', profile.student_id)
      .in('homework_id', homeworks.map((task) => task.id))
      .limit(500))
    const byHomework = new Map(submissions.map((submission) => [submission.homework_id, submission]))
    return homeworks.map((task) => ({ ...task, submission: byHomework.get(task.id) || null }))
  }

  let query = cloudflare.from('homework')
    .select('id, group_id, teacher_id, title, description, file_url, due_at, groups(name)')
    .order('due_at', { ascending: true })
    .limit(100)
  if (profile.role === 'teacher') query = query.eq('teacher_id', profile.teacher_id)
  homeworks = unwrap(await query)
  if (!homeworks.length) return []

  const submissions = unwrap(await cloudflare.from('homework_submissions')
    .select('id, homework_id, student_id, content_text, file_url, video_note_url, voice_url, status, feedback, submitted_at, students(name)')
    .in('homework_id', homeworks.map((task) => task.id))
    .order('submitted_at', { ascending: false })
    .limit(500))
  const byHomework = new Map()
  for (const submission of submissions) {
    const list = byHomework.get(submission.homework_id) || []
    list.push(submission)
    byHomework.set(submission.homework_id, list)
  }
  return homeworks.map((task) => ({ ...task, submissions: byHomework.get(task.id) || [] }))
}

export async function loadGroups(profile) {
  assertConfigured()
  const columns = profile?.role === 'teacher'
    ? 'id, name, teacher_id, schedule'
    : 'id, name, teacher_id, monthly_fee, schedule'
  return unwrap(await cloudflare.from('groups')
    .select(columns)
    .order('name')
    .limit(500))
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
  const fileUrl = await uploadFile(input.file, { homeworkId: homework.id })
  const videoUrl = await uploadFile(input.videoNote, { homeworkId: homework.id })
  const voiceUrl = await uploadFile(input.voice, { homeworkId: homework.id })
  const { error } = await cloudflare.from('homework_submissions').upsert({
    homework_id: homework.id,
    student_id: profile.student_id,
    content_text: input.text.trim(),
    text_answer: input.text.trim(),
    file_url: fileUrl || homework.submission?.file_url || null,
    video_note_url: videoUrl || homework.submission?.video_note_url || null,
    voice_url: voiceUrl || homework.submission?.voice_url || null,
    status: 'pending',
    feedback: '',
    review_note: '',
    reviewed_by: null,
    reviewed_at: null,
    submitted_at: new Date().toISOString(),
  }, { onConflict: 'homework_id,student_id' })
  if (error) throw error
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
    body: { submission_id: id, status, comment: String(feedback || '').trim() },
  })
}

export async function loadReviewHistory(submissionId) {
  assertConfigured()
  return reviewRequest(`/api/homework/history?submission_id=${encodeURIComponent(submissionId)}`)
}

export async function loadStudents(profile) {
  assertConfigured()
  const columns = profile?.role === 'teacher'
    ? 'id, name, phone'
    : 'id, name, phone, login, auth_user_id, parent_phone, monthly_fee'
  const students = unwrap(await cloudflare.from('students').select(columns).order('name').limit(500))
  if (profile?.role === 'teacher' || !students.length) return students
  const profiles = unwrap(await cloudflare.from('profiles')
    .select('id, student_id, telegram_id')
    .in('student_id', students.map((student) => student.id)))
  const byStudent = new Map(profiles.map((item) => [item.student_id, item]))
  return students.map((item) => ({
    ...item,
    profile_id: byStudent.get(item.id)?.id || item.auth_user_id || null,
    telegram_id: byStudent.get(item.id)?.telegram_id || null,
  }))
}

export async function loadMonthlyReport() {
  assertConfigured()
  return unwrap(await cloudflare.from('monthly_homework_report')
    .select('student_id, student_name, month_start, total_submissions, approved_count, rejected_count, pending_count')
    .order('month_start', { ascending: false })
    .limit(500))
}
