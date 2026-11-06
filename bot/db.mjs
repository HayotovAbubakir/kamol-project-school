function requiredEnv(name, aliases = []) {
  for (const key of [name, ...aliases]) {
    const value = String(process.env[key] || '').trim().replace(/^['"]|['"]$/g, '')
    if (value) return value
  }
  throw new Error(`Missing env: ${[name, ...aliases].join(' yoki ')}`)
}

class BotQuery {
  constructor(db, table) {
    this.db = db
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
      const response = await fetch(`${this.db.url}/api/db`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Bot-Secret': this.db.secret,
        },
        body: JSON.stringify(this.body),
      })
      const result = await response.json()
      if (!response.ok || result.error) return { data: null, error: result.error || { message: `Cloudflare API returned ${response.status}` } }
      let data = result.data
      if (this.singleMode && Array.isArray(data)) {
        if (!data.length && this.body.maybeSingle) data = null
        else if (data.length !== 1) return { data: null, error: { message: 'Expected one row.' } }
        else [data] = data
      }
      return { data, error: null }
    } catch (error) {
      return { data: null, error: { message: error.message || 'Cloudflare API request failed' } }
    }
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject)
  }
}

export function createDb() {
  const rawUrl = requiredEnv('CLOUDFLARE_API_URL')
  const url = rawUrl.startsWith('http') ? new URL(rawUrl).origin : ''
  if (!url || !url.startsWith('https://')) throw new Error('CLOUDFLARE_API_URL must be a public HTTPS Worker URL.')
  return {
    url,
    secret: requiredEnv('BOT_API_SECRET'),
    from(table) { return new BotQuery(this, table) },
    async getEventsAfter(id) {
      const latest = id === 'latest'
      const response = await fetch(`${url}/api/bot/events?${latest ? 'latest=1' : `after=${encodeURIComponent(id)}`}`, {
        headers: { 'X-Bot-Secret': this.secret },
      })
      if (!response.ok) throw new Error(`Cloudflare events API returned ${response.status}`)
      return response.json()
    },
    async uploadToR2({ fileStream, fileName, mimeType }) {
      const form = new FormData()
      const bytes = Buffer.from(await new Response(fileStream).arrayBuffer())
      form.append('file', new Blob([bytes], { type: mimeType }), fileName)
      form.append('filename', fileName)
      const response = await fetch(`${url}/api/bot/upload`, {
        method: 'POST',
        headers: { 'X-Bot-Secret': this.secret },
        body: form,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || `Cloudflare R2 upload failed (${response.status})`)
      return { key: result.key, url: result.url, bucket: 'kamol-files' }
    },
  }
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
  const { data: link, error } = await db
    .from('telegram_links')
    .select('chat_id, student_id, linked_at')
    .eq('chat_id', Number(chatId))
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
  }, { onConflict: 'chat_id' })
  if (error) throw error
}

export async function unlinkChat(db, chatId) {
  const { error } = await db.from('telegram_links').delete().eq('chat_id', Number(chatId))
  if (error) throw error
}

export async function getStudentGroups(db, studentId) {
  const { data: memberships, error } = await db.from('group_students').select('group_id').eq('student_id', studentId)
  if (error) throw error
  const ids = (memberships || []).map((row) => row.group_id).filter(Boolean)
  if (!ids.length) return []
  const { data, error: groupsError } = await db.from('groups').select('id, name, monthly_fee').in('id', ids)
  if (groupsError) throw groupsError
  return data || []
}

export async function getPaymentsForStudent(db, studentId, limit = 8) {
  const { data, error } = await db.from('payments')
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
  const { data, error } = await db.from('attendance')
    .select('date, status, note, group_id, groups(name)')
    .eq('student_id', studentId)
    .gte('date', since.toISOString().slice(0, 10))
    .order('date', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getMonthPaid(db, studentId, month, year) {
  const { data, error } = await db.from('payments')
    .select('amount')
    .eq('student_id', studentId)
    .eq('month', month)
    .eq('year', year)
  if (error) throw error
  return (data || []).reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
}

export async function getChatsForStudent(db, studentId) {
  const query = db.from('telegram_links').select('chat_id')
  if (studentId) query.eq('student_id', studentId)
  const { data, error } = await query
  if (error) throw error
  return (data || []).map((row) => row.chat_id)
}
