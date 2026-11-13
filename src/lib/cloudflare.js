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

function authStores() {
  if (typeof window === 'undefined') return []
  const stores = []
  try {
    if (window.localStorage) stores.push(window.localStorage)
  } catch { /* ignore */ }
  try {
    if (window.sessionStorage) stores.push(window.sessionStorage)
  } catch { /* ignore */ }
  return stores
}

function readSession() {
  const stores = authStores()
  for (const store of stores) {
    try {
      const stored = store.getItem(SESSION_KEY)
      if (!stored) continue
      const session = JSON.parse(stored)
      // Session used to live in sessionStorage, which Telegram clears on close.
      if (stores[0] === window.localStorage && store === window.sessionStorage) {
        try { window.localStorage.setItem(SESSION_KEY, stored) } catch { /* ignore */ }
      }
      return session
    } catch { /* ignore */ }
  }
  return memoryStorage.get(SESSION_KEY) || null
}

function writeSession(session) {
  if (session) memoryStorage.set(SESSION_KEY, session)
  else memoryStorage.delete(SESSION_KEY)
  for (const store of authStores()) {
    try {
      if (session) store.setItem(SESSION_KEY, JSON.stringify(session))
      else store.removeItem(SESSION_KEY)
    } catch {
      if (!session) memoryStorage.delete(SESSION_KEY)
    }
  }
}

function emitAuth(event, session) {
  for (const listener of memoryListeners) listener(event, session)
}

let refreshInFlight = null

/**
 * Refresh token bir martalik. Bir vaqtda kelgan bir nechta 401 bitta yangilashni
 * kutadi — aks holda ikkinchi so‘rov ishlatilgan token bilan foydalanuvchini chiqarib yuboradi.
 */
async function refreshSession(staleSession) {
  const current = readSession()
  if (current?.access_token && staleSession?.access_token && current.access_token !== staleSession.access_token) {
    return current
  }
  if (!current?.refresh_token) return null
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const response = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: current.refresh_token }),
        })
        const result = await response.json().catch(() => ({}))
        if (response.ok && result.session) {
          writeSession(result.session)
          emitAuth('TOKEN_REFRESHED', result.session)
          return result.session
        }
        if (response.status === 401 || response.status === 400) {
          writeSession(null)
          emitAuth('SIGNED_OUT', null)
        }
        return null
      } catch {
        return null
      } finally {
        setTimeout(() => { refreshInFlight = null }, 0)
      }
    })()
  }
  return refreshInFlight
}

/** Avtorizatsiyali fetch: token qo‘shadi, 401 bo‘lsa sessiyani bir marta yangilab qayta urinadi. */
export async function authFetch(path, init = {}) {
  const send = (token) => fetch(path, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  })
  const session = readSession()
  if (!session?.access_token) throw new Error('Sessiya tugagan. Qayta kiring.')
  let response
  try {
    response = await send(session.access_token)
  } catch {
    throw new Error('Server bilan bog‘lanib bo‘lmadi. Internetni tekshiring.')
  }
  if (response.status === 401) {
    const refreshed = await refreshSession(session)
    if (refreshed?.access_token) response = await send(refreshed.access_token)
  }
  return response
}

/** authFetch + JSON javob; xato bo‘lsa serverning o‘zbekcha xabari bilan Error tashlaydi. */
export async function authJson(path, { method = 'GET', body, fallbackError = 'So‘rovni bajarib bo‘lmadi.' } = {}) {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  const response = await authFetch(path, {
    method,
    headers: body === undefined || isForm ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  })
  let result = {}
  try { result = await response.json() } catch { /* bo‘sh javob */ }
  if (!response.ok) {
    const error = new Error(result.error || (response.status === 401 ? 'Sessiya tugagan. Qayta kiring.' : fallbackError))
    error.status = response.status
    throw error
  }
  return result
}

let bootstrapSupported = true

/**
 * Bir nechta select so‘rovini bitta `/api/bootstrap` chaqiruvida bajaradi (har biri `.all()` kabi).
 * Worker bu endpointni bilmasa (404) `null` qaytaradi — chaqiruvchi eski usulga o‘tadi.
 */
export async function batchSelect(queries, { schedule = false } = {}) {
  if (!bootstrapSupported) return null
  try {
    const result = await authJson('/api/bootstrap', {
      method: 'POST',
      body: {
        queries: Object.fromEntries(Object.entries(queries).map(([key, query]) => [key, query.batchSpec({ all: true })])),
        schedule,
      },
    })
    return { results: result.data.results, schedule: result.data.schedule }
  } catch (error) {
    if (error.status !== 404) throw error
    bootstrapSupported = false
    return null
  }
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
  if (
    response.status === 401
    && canRefresh
    && token
    && path !== '/api/auth/login'
    && path !== '/api/auth/refresh'
  ) {
    const refreshed = await refreshSession({ access_token: token })
    if (refreshed?.access_token) {
      return request(path, { ...options, token: refreshed.access_token }, false)
    }
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

  /**
   * Barcha qatorlar: yangi Worker’da bitta `/api/bootstrap` so‘rovi (sahifalar serverda yig‘iladi),
   * eski Worker’da esa 500 talik sahifalar ketma-ket yig‘iladi.
   */
  async all(pageSize = 500) {
    if (bootstrapSupported && readSession()?.access_token) {
      try {
        const batch = await batchSelect({ rows: this })
        if (batch) {
          const result = batch.results.rows
          return result.error ? { data: null, error: result.error } : { data: result.data || [], error: null }
        }
      } catch (error) {
        return { data: null, error: { message: error.message, status: error.status } }
      }
    }
    const rows = []
    for (let offset = 0; offset < 1_000_000; offset += pageSize) {
      this.body.limit = pageSize
      this.body.offset = offset
      const { data, error } = await this.execute()
      if (error) return { data: null, error }
      const page = Array.isArray(data) ? data : []
      rows.push(...page)
      if (page.length < pageSize) break
    }
    return { data: rows, error: null }
  }

  /** `/api/bootstrap` uchun so‘rov tavsifi; `all` bo‘lsa sahifalar serverda yig‘iladi. */
  batchSpec({ all = false } = {}) {
    return { ...this.body, ...(all ? { all: true } : {}) }
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
        // `request()` may have rotated the tokens on 401; keep the newest session.
        const latest = readSession()
        if (!latest?.access_token) return { data: { session: null }, error: null }
        const next = { ...latest, user: result.user }
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
