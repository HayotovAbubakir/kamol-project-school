import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS })
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function deriveTelegramSecret() {
  const keyMaterial = new TextEncoder().encode(`WebAppData${BOT_TOKEN}`)
  const secretDigest = await crypto.subtle.digest('SHA-256', keyMaterial)
  return new Uint8Array(secretDigest)
}

async function verifyTelegramInitData(initData: string) {
  if (!initData || !BOT_TOKEN) return null

  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  const authDate = Number(params.get('auth_date'))
  if (!hash || !Number.isFinite(authDate)) return null
  if (Math.abs(Date.now() / 1000 - authDate) > 86400) return null

  const entries = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b))

  const dataCheckString = entries
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const secret = await deriveTelegramSecret()
  const secretKey = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = await crypto.subtle.sign('HMAC', secretKey, new TextEncoder().encode(dataCheckString))
  return toHex(new Uint8Array(expected)).toLowerCase() === hash.toLowerCase()
}

function extractTelegramUserId(initData: string) {
  const params = new URLSearchParams(initData)
  const rawUser = params.get('user')
  if (!rawUser) return null

  try {
    const parsed = JSON.parse(rawUser)
    return parsed && Number.isFinite(Number(parsed.id)) ? Number(parsed.id) : null
  } catch {
    return null
  }
}

async function getTasks(supabase: ReturnType<typeof createClient>, role: string, user: Record<string, unknown>) {
  if (role === 'student') {
    const { data: memberships, error: membershipError } = await supabase
      .from('group_students')
      .select('group_id')
      .eq('student_id', user.id)
    if (membershipError) throw membershipError

    const groupIds = (memberships || []).map((membership) => membership.group_id)
    if (!groupIds.length) return []

    const { data: homework, error: homeworkError } = await supabase
      .from('homework')
      .select('id, title, description, due_at, groups(name)')
      .in('group_id', groupIds)
      .order('due_at', { ascending: true })
      .limit(5)
    if (homeworkError) throw homeworkError

    const homeworkIds = (homework || []).map((task) => task.id)
    const { data: submissions, error: submissionError } = homeworkIds.length
      ? await supabase
        .from('homework_submissions')
        .select('homework_id, status')
        .eq('student_id', user.id)
        .in('homework_id', homeworkIds)
      : { data: [], error: null }
    if (submissionError) throw submissionError

    const statusByHomework = new Map((submissions || []).map((submission) => [submission.homework_id, submission.status]))
    return (homework || []).map((task, index) => ({
      subject: task.groups?.name || `Guruh ${index + 1}`,
      title: task.title,
      detail: task.description || '',
      due: task.due_at || '',
      status: statusByHomework.has(task.id)
        ? statusByHomework.get(task.id) === 'pending' ? 'Jarayonda' : 'Tekshirildi'
        : 'Yangi',
      tone: index % 3 === 0 ? 'violet' : index % 3 === 1 ? 'blue' : 'amber',
    }))
  }

  if (role === 'teacher') {
    const { data: homework, error: homeworkError } = await supabase
      .from('homework')
      .select('id, title, description, due_at, groups(name)')
      .eq('teacher_id', user.teacher_id || user.id)
      .order('due_at', { ascending: true })
      .limit(5)
    if (homeworkError) throw homeworkError

    const homeworkIds = (homework || []).map((task) => task.id)
    const { data: submissions, error: submissionError } = homeworkIds.length
      ? await supabase
        .from('homework_submissions')
        .select('homework_id')
        .eq('status', 'pending')
        .in('homework_id', homeworkIds)
      : { data: [], error: null }
    if (submissionError) throw submissionError

    const counts = new Map()
    for (const submission of submissions || []) {
      counts.set(submission.homework_id, (counts.get(submission.homework_id) || 0) + 1)
    }

    return (homework || []).map((task, index) => ({
      subject: task.groups?.name || `Guruh ${index + 1}`,
      title: task.title,
      detail: task.description || '',
      due: task.due_at || '',
      group: task.groups?.name || 'Guruh',
      count: counts.get(task.id) || 0,
      tone: index % 3 === 0 ? 'violet' : index % 3 === 1 ? 'blue' : 'amber',
    }))
  }

  return []
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const { initData } = await req.json().catch(() => ({}))

    if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse({ error: 'Missing Telegram/Supabase env configuration' }, 500)
    }

    const rawInitData = typeof initData === 'string' ? initData : ''
    const verified = await verifyTelegramInitData(rawInitData)
    if (!verified) {
      return jsonResponse({ ok: false, message: 'Invalid Telegram initData' }, 401)
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const userId = extractTelegramUserId(rawInitData)

    if (!userId) {
      return jsonResponse({ ok: false, message: 'Missing telegram user id' }, 400)
    }

    const checks = [
      { table: 'students', role: 'student', columns: 'id, name, telegram_id' },
      { table: 'teachers', role: 'teacher', columns: 'id, name, telegram_id' },
      { table: 'profiles', role: null, columns: 'id, name, role, telegram_id, teacher_id' },
    ]

    for (const entry of checks) {
      const { data, error } = await supabase
        .from(entry.table)
        .select(entry.columns)
        .eq('telegram_id', userId)
        .maybeSingle()

      if (!error && data) {
        const role = entry.role || data.role
        if (!['student', 'teacher', 'reception', 'owner', 'admin'].includes(role)) continue
        const tasks = await getTasks(supabase, role, data)
        return jsonResponse({ ok: true, role, user: data, telegram_id: userId, tasks })
      }
    }

    return jsonResponse({ ok: false, message: 'Telegram user not linked to the school system' }, 401)
  } catch (error) {
    return jsonResponse({ error: String(error) }, 500)
  }
})
