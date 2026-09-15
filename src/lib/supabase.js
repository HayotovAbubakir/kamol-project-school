import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

/** Auth sessiya kaliti — parol emas, faqat JWT (sessionStorage da). */
export const AUTH_STORAGE_KEY = 'kamol-auth-v2'

const LEGACY_AUTH_KEYS = [
  'kamol-auth',
  'supabase.auth.token',
  'sb-access-token',
  'sb-refresh-token',
]

/**
 * Brauzerda parol saqlanmaydi.
 * Faqat Supabase sessiyasi (JWT) sessionStorage da turadi — tab yopilsa tozalanadi.
 * localStorage da login/parol yozilmaydi.
 */
function createSecureAuthStorage() {
  const memory = new Map()

  if (typeof window !== 'undefined') {
    try {
      for (const key of LEGACY_AUTH_KEYS) {
        window.localStorage.removeItem(key)
      }
      // Eski yoki xavfli kalitlarni tozalash (parol/credential nomli)
      const doomed = []
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i)
        if (key && /password|passwd|credential|secret|auth-token/i.test(key)) {
          doomed.push(key)
        }
      }
      doomed.forEach((key) => window.localStorage.removeItem(key))
    } catch {
      /* private mode */
    }
  }

  const store = typeof window !== 'undefined' ? window.sessionStorage : null

  return {
    getItem(key) {
      try {
        if (store) return store.getItem(key)
      } catch {
        /* ignore */
      }
      return memory.get(key) ?? null
    },
    setItem(key, value) {
      // Hech qachon parol yozilmasin
      if (/password|passwd/i.test(key) || /"password"\s*:/i.test(String(value))) {
        return
      }
      try {
        if (store) {
          store.setItem(key, value)
          return
        }
      } catch {
        /* ignore */
      }
      memory.set(key, value)
    },
    removeItem(key) {
      try {
        store?.removeItem(key)
      } catch {
        /* ignore */
      }
      memory.delete(key)
    },
  }
}

export function clearAuthStorage() {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(AUTH_STORAGE_KEY)
    for (const key of LEGACY_AUTH_KEYS) {
      window.localStorage.removeItem(key)
      window.sessionStorage.removeItem(key)
    }
  } catch {
    /* ignore */
  }
}

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storage: createSecureAuthStorage(),
        storageKey: AUTH_STORAGE_KEY,
      },
    })
  : null

/** UI login → Auth email (foydalanuvchi email yozmaydi). */
export const LEGACY_AUTH_EMAIL_DOMAIN = 'kamol.school'

/** Faqat login qismi: "cccr" yoki "cccr@..." → "cccr" */
export function normalizeUsername(username) {
  const raw = String(username || '').trim().toLowerCase()
  if (!raw) return ''
  const local = raw.includes('@') ? raw.split('@')[0] : raw
  return local.replace(/[^a-z0-9._-]/g, '')
}

function authEmailHost() {
  try {
    if (url) return new URL(url).hostname
  } catch {
    /* ignore */
  }
  return LEGACY_AUTH_EMAIL_DOMAIN
}

/** Map UI username to Auth email (ichki, ekranda ko‘rinmaydi). */
export function usernameToEmail(username) {
  const u = normalizeUsername(username)
  if (!u) return ''
  // project.supabase.co — format yaroqli; UI da faqat login
  return `${u}@${authEmailHost()}`
}

/** Fallback candidate lar (RPC yo‘q bo‘lsa). Legacy birinchi — owner/admin. */
export function usernameToEmailCandidates(username) {
  const raw = String(username || '').trim().toLowerCase()
  const u = normalizeUsername(username)
  const list = []
  if (u) {
    list.push(`${u}@${LEGACY_AUTH_EMAIL_DOMAIN}`)
    const host = authEmailHost()
    if (host !== LEGACY_AUTH_EMAIL_DOMAIN) list.push(`${u}@${host}`)
  }
  if (raw.includes('@')) list.push(raw)
  return [...new Set(list.filter(Boolean))]
}

/** Minimal parol talabi (Supabase Auth da hash bo‘lib saqlanadi). */
export const MIN_PASSWORD_LENGTH = 4
