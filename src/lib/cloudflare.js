const SESSION_KEY = 'kamol-cloudflare-session'
const LEGACY_AUTH_KEYS = ['kamol-auth-v2', 'kamol-auth', 'supabase.auth.token', 'sb-access-token', 'sb-refresh-token']
const memoryListeners = new Set()
const memoryStorage = new Map()

function clearLegacyAuthStorage() {
  if (typeof window === 'undefined') return
  for (const key of LEGACY_AUTH_KEYS) {
    try {
      window.localStorage.removeItem(key)
      window.sessionStorage.removeItem(key)
    } catch {
      return
    }
  }
}

clearLegacyAuthStorage()

function readSession() {
  try {
    const stored = typeof window === 'undefined' ? null : window.sessionStorage.getItem(SESSION_KEY)
    return stored ? JSON.parse(stored) : memoryStorage.get(SESSION_KEY) || null
  } catch {
    return memoryStorage.get(SESSION_KEY) || null
  }
}

function writeSession(session) {
  if (session) memoryStorage.set(SESSION_KEY, session)
  else memoryStorage.delete(SESSION_KEY)
  try {
    if (typeof window !== 'undefined') {
      if (session) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
      else window.sessionStorage.removeItem(SESSION_KEY)
    }
  } catch {
    if (!session) memoryStorage.delete(SESSION_KEY)
  }
}

function emitAuth(event, session) {
  for (const listener of memoryListeners) listener(event, session)
}

async function request(path, options = {}, canRefresh = true) {
  const { method = 'POST', body, token, headers = {} } = options
  let response
  try {
    response = await fetch(path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error('Cloudflare Worker bilan bog‘lanib bo‘lmadi.')
  }
  let result
  try {
    result = await response.json()
  } catch {
    throw new Error(`Cloudflare API noto‘g‘ri javob berdi (${response.status}).`)
  }
  const session = readSession()
  if (
    response.status === 401
    && canRefresh
    && token
    && token === session?.access_token
    && Boolean(session?.refresh_token)
    && path !== '/api/auth/login'
    && path !== '/api/auth/refresh'
  ) {
    const refreshed = await request('/api/auth/refresh', {
      body: { refresh_token: session.refresh_token },
    }, false)
    if (refreshed.response.ok && refreshed.result.session) {
      writeSession(refreshed.result.session)
      emitAuth('TOKEN_REFRESHED', refreshed.result.session)
      return request(path, { ...options, token: refreshed.result.session.access_token }, false)
    }
    writeSession(null)
    emitAuth('SIGNED_OUT', null)
  }
  return { response, result }
}

class Query {
  constructor(table, client) {
    this.client = client
    this.body = { table, action: 'select', filters: [], columns: '*' }
    this.singleMode = false
  }

  select(columns = '*') {
    this.body.columns = columns
    if (this.body.action !== 'select') this.body.returning = true
    return this
  }

  insert(values) {
    this.body.action = 'insert'
    this.body.values = values
    return this
  }

  upsert(values, options = {}) {
    this.body.action = 'upsert'
    this.body.values = values
    this.body.conflict = options.onConflict || ''
    return this
  }

  update(values) {
    this.body.action = 'update'
    this.body.values = values
    return this
  }

  delete() {
    this.body.action = 'delete'
    return this
  }

  eq(column, value) { return this.addFilter('eq', column, value) }
  neq(column, value) { return this.addFilter('neq', column, value) }
  gte(column, value) { return this.addFilter('gte', column, value) }
  lte(column, value) { return this.addFilter('lte', column, value) }
  in(column, value) { return this.addFilter('in', column, value) }

  addFilter(op, column, value) {
    this.body.filters.push({ op, column, value })
    return this
  }

  order(column, options = {}) {
    this.body.order = { column, ascending: options.ascending !== false }
    return this
  }

  limit(count) {
    this.body.limit = count
    return this
  }

  single() {
    this.singleMode = true
    return this.execute()
  }

  maybeSingle() {
    this.singleMode = true
    this.body.maybeSingle = true
    return this.execute()
  }

  async execute() {
    const session = readSession()
    try {
      const { result } = await request('/api/db', { body: this.body, token: session?.access_token })
      if (result.error) return { data: null, error: result.error }
      let data = result.data
      if (this.singleMode) {
        if (Array.isArray(data)) {
          if (!data.length && this.body.maybeSingle) data = null
          else if (data.length !== 1) return { data: null, error: { message: 'Expected one row.' } }
          else [data] = data
        }
      }
      return { data, error: null }
    } catch (error) {
      return { data: null, error: { message: error.message } }
    }
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject)
  }
}

class CloudflareClient {
  from(table) {
    return new Query(table, this)
  }

  async rpc(name, args) {
    try {
      const session = readSession()
      const { result } = await request(`/api/rpc/${encodeURIComponent(name)}`, {
        body: args,
        token: session?.access_token,
      })
      return { data: result.data ?? null, error: result.error || null }
    } catch (error) {
      return { data: null, error: { message: error.message } }
    }
  }

  functions = {
    async invoke(name, options = {}) {
      try {
        const session = readSession()
        const { response, result } = await request(`/api/${name}`, {
          body: options.body,
          token: session?.access_token,
        })
        return { data: result, error: response.ok ? null : { message: result.error || 'Cloudflare API xatosi.' } }
      } catch (error) {
        return { data: null, error }
      }
    },
  }

  auth = {
    async signInWithTelegram() {
      const initData = typeof window === 'undefined' ? '' : window.Telegram?.WebApp?.initData
      if (!initData) return { data: { user: null, session: null }, error: new Error('Mini App’ni Telegram ichidan oching.') }
      try {
        const { response, result } = await request('/api/auth/telegram', { body: { initData } })
        if (!response.ok) {
          const error = new Error(result.error || 'Telegram orqali kirib bo‘lmadi.')
          error.code = result.code
          return { data: { user: null, session: null }, error }
        }
        writeSession(result.session)
        emitAuth('SIGNED_IN', result.session)
        return { data: result, error: null }
      } catch (error) {
        return { data: { user: null, session: null }, error }
      }
    },

    async signInWithTelegramCredentials({ username, password }) {
      const initData = typeof window === 'undefined' ? '' : window.Telegram?.WebApp?.initData
      if (!initData) return { data: { user: null, session: null }, error: new Error('Mini App’ni Telegram ichidan oching.') }
      try {
        const { response, result } = await request('/api/auth/telegram/password', {
          body: { initData, username, password },
        })
        if (!response.ok) return { data: { user: null, session: null }, error: new Error(result.error || 'Login yoki parol noto‘g‘ri.') }
        writeSession(result.session)
        emitAuth('SIGNED_IN', result.session)
        return { data: result, error: null }
      } catch (error) {
        return { data: { user: null, session: null }, error }
      }
    },

    async getSession() {
      const session = readSession()
      if (!session?.access_token) return { data: { session: null }, error: null }
      try {
        const { response, result } = await request('/api/auth/me', { token: session.access_token })
        if (!response.ok) {
          writeSession(null)
          return { data: { session: null }, error: null }
        }
        const next = { ...session, user: result.user }
        writeSession(next)
        return { data: { session: next }, error: null }
      } catch (error) {
        return { data: { session: null }, error }
      }
    },

    async getUser() {
      const session = readSession()
      if (!session?.access_token) return { data: { user: null }, error: new Error('Login required.') }
      try {
        const { response, result } = await request('/api/auth/me', { token: session.access_token })
        if (!response.ok) return { data: { user: null }, error: new Error(result.error || 'Session expired.') }
        return { data: { user: result.user }, error: null }
      } catch (error) {
        return { data: { user: null }, error }
      }
    },

    async signInWithPassword({ email, username, password }) {
      try {
        const { response, result } = await request('/api/auth/login', {
          body: { username: username || email, password },
        })
        if (!response.ok) return { data: { user: null, session: null }, error: new Error(result.error || 'Login yoki parol noto‘g‘ri.') }
        writeSession(result.session)
        emitAuth('SIGNED_IN', result.session)
        return { data: result, error: null }
      } catch (error) {
        return { data: { user: null, session: null }, error }
      }
    },

    async signUp({ email, password, options }) {
      try {
        const { response, result } = await request('/api/auth/signup', {
          body: { email, password, options },
          token: readSession()?.access_token,
        })
        if (!response.ok) return { data: { user: null, session: null }, error: new Error(result.error || 'Akkaunt yaratilmadi.') }
        return { data: { user: result.user, session: result.session || {} }, error: null }
      } catch (error) {
        return { data: { user: null, session: null }, error }
      }
    },

    async signOut() {
      const session = readSession()
      try {
        if (session?.access_token) await request('/api/auth/logout', { token: session.access_token }, false)
      } finally {
      writeSession(null)
      emitAuth('SIGNED_OUT', null)
      }
      return { error: null }
    },

    async setSession(session) {
      const current = readSession() || {}
      const next = { ...current, ...session, access_token: session.access_token }
      writeSession(next)
      return { data: { session: next }, error: null }
    },

    async updateUser({ password }) {
      try {
        const { response, result } = await request('/api/auth/update', {
          body: { password },
          token: readSession()?.access_token,
        })
        if (!response.ok) return { data: null, error: new Error(result.error || 'Password update failed.') }
        writeSession(result.session)
        emitAuth('USER_UPDATED', result.session)
        return { data: { user: result.user }, error: null }
      } catch (error) {
        return { data: null, error }
      }
    },

    onAuthStateChange(callback) {
      memoryListeners.add(callback)
      return {
        data: {
          subscription: {
            unsubscribe() {
              memoryListeners.delete(callback)
            },
          },
        },
      }
    },
  }
}

export const cloudflare = new CloudflareClient()
export const isBackendConfigured = true
export const AUTH_STORAGE_KEY = SESSION_KEY
export const LEGACY_AUTH_EMAIL_DOMAIN = 'kamol.school'
export const MIN_PASSWORD_LENGTH = 12

export function normalizeUsername(username) {
  const raw = String(username || '').trim().toLowerCase()
  return (raw.includes('@') ? raw.split('@')[0] : raw).replace(/[^a-z0-9._-]/g, '')
}

export function usernameToEmail(username) {
  const login = normalizeUsername(username)
  return login ? `${login}@${LEGACY_AUTH_EMAIL_DOMAIN}` : ''
}

export function usernameToEmailCandidates(username) {
  const login = normalizeUsername(username)
  return login ? [usernameToEmail(login)] : []
}

export function clearAuthStorage() {
  writeSession(null)
  clearLegacyAuthStorage()
}

export { readSession }
