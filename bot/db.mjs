import { createClient } from '@supabase/supabase-js'

function requireEnv(name, aliases = []) {
  const keys = [name, ...aliases]
  for (const key of keys) {
    let value = process.env[key]
    if (!value || !String(value).trim()) continue
    value = String(value).trim()
    // Railway/UI dan qo‘yilganda qo‘shtirnoq yopishib qolishi mumkin
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1).trim()
    }
    if (value) return value
  }
  throw new Error(`Missing env: ${keys.join(' yoki ')}`)
}

export function createDb() {
  const url = requireEnv('SUPABASE_URL', ['VITE_SUPABASE_URL']).replace(/\/$/, '')
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function findStudentByCode(db, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase()
  if (!code) return null
  const { data, error } = await db
    .from('students')
    .select('id, name, phone, parent_phone, public_code, monthly_fee')
    .eq('public_code', code)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function getLinkByChat(db, chatId) {
  const id = Number(chatId)
  const { data: link, error } = await db
    .from('telegram_links')
    .select('chat_id, student_id, linked_at')
    .eq('chat_id', id)
    .maybeSingle()
  if (error) throw error
  if (!link) return null

  const { data: student, error: studentError } = await db
    .from('students')
    .select('id, name, phone, parent_phone, public_code, monthly_fee')
    .eq('id', link.student_id)
    .maybeSingle()
  if (studentError) throw studentError

  return { ...link, students: student }
}

export async function linkChatToStudent(db, chatId, studentId) {
  const { error } = await db.from('telegram_links').upsert({
    chat_id: Number(chatId),
    student_id: studentId,
    linked_at: new Date().toISOString(),
  })
  if (error) throw error
}

export async function unlinkChat(db, chatId) {
  const { error } = await db.from('telegram_links').delete().eq('chat_id', Number(chatId))
  if (error) throw error
}

export async function getStudentGroups(db, studentId) {
  const { data, error } = await db
    .from('group_students')
    .select('group_id')
    .eq('student_id', studentId)
  if (error) throw error
  const ids = (data || []).map((row) => row.group_id).filter(Boolean)
  if (!ids.length) return []
  const { data: groups, error: groupsError } = await db
    .from('groups')
    .select('id, name, monthly_fee')
    .in('id', ids)
  if (groupsError) throw groupsError
  return groups || []
}

export async function getPaymentsForStudent(db, studentId, limit = 8) {
  const { data, error } = await db
    .from('payments')
    .select('amount, month, year, paid_at')
    .eq('student_id', studentId)
    .order('paid_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

export async function getAttendanceForStudent(db, studentId, days = 14) {
  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceIso = since.toISOString().slice(0, 10)
  const { data, error } = await db
    .from('attendance')
    .select('date, status, note, group_id')
    .eq('student_id', studentId)
    .gte('date', sinceIso)
    .order('date', { ascending: false })
  if (error) throw error
  const rows = data || []
  const groupIds = [...new Set(rows.map((r) => r.group_id).filter(Boolean))]
  let groupMap = {}
  if (groupIds.length) {
    const { data: groups, error: groupsError } = await db
      .from('groups')
      .select('id, name')
      .in('id', groupIds)
    if (groupsError) throw groupsError
    groupMap = Object.fromEntries((groups || []).map((g) => [g.id, g]))
  }
  return rows.map((row) => ({
    ...row,
    groups: groupMap[row.group_id] || null,
  }))
}

export async function getMonthPaid(db, studentId, month, year) {
  const { data, error } = await db
    .from('payments')
    .select('amount')
    .eq('student_id', studentId)
    .eq('month', month)
    .eq('year', year)
  if (error) throw error
  return (data || []).reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
}

export async function getChatsForStudent(db, studentId) {
  const { data, error } = await db
    .from('telegram_links')
    .select('chat_id')
    .eq('student_id', studentId)
  if (error) throw error
  return (data || []).map((row) => row.chat_id)
}
