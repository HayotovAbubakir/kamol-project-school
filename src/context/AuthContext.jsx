import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { fetchProfile } from '../lib/api'
import { clearAuthStorage, isSupabaseConfigured, supabase, usernameToEmailCandidates } from '../lib/supabase'
import { translate } from '../i18n/runtime'

const AuthContext = createContext(null)

function sameUser(a, b) {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.id === b.id
    && a.role === b.role
    && a.username === b.username
    && a.name === b.name
    && a.teacherId === b.teacherId
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)
  const [configErrorKey, setConfigErrorKey] = useState(null)
  const userRef = useRef(null)
  userRef.current = user

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setConfigErrorKey('domain.error.supabaseProjectNotConfigured')
      setReady(true)
      return undefined
    }

    let cancelled = false

    const applySession = async (session, { forceProfile = false } = {}) => {
      if (!session?.user) {
        if (!cancelled) setUser(null)
        return
      }

      // Tab qaytganda TOKEN_REFRESHED — profilni qayta so‘ramaymiz
      if (!forceProfile && userRef.current?.id === session.user.id) {
        return
      }

      try {
        const profile = await fetchProfile(session.user.id)
        if (cancelled) return
        const next = {
          id: profile.id,
          username: profile.username,
          name: profile.name,
          role: profile.role,
          teacherId: profile.teacherId,
        }
        setUser((prev) => (sameUser(prev, next) ? prev : next))
      } catch {
        if (!cancelled) setUser(null)
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      applySession(data.session, { forceProfile: true }).finally(() => {
        if (!cancelled) setReady(true)
      })
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        // Sessiya yangilandi — UI ni qayta yuklamaymiz
        return
      }
      if (event === 'SIGNED_OUT') {
        setUser(null)
        return
      }
      applySession(session, { forceProfile: event === 'SIGNED_IN' || event === 'INITIAL_SESSION' })
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo(
    () => {
      const contextValue = {
        user,
        ready,
        async login(username, password) {
          if (!supabase) throw new Error(translate('domain.error.supabaseNotConfigured'))

          const finishLogin = async (authUser) => {
            const profile = await fetchProfile(authUser.id)
            const next = {
              id: profile.id,
              username: profile.username,
              name: profile.name,
              role: profile.role,
              teacherId: profile.teacherId,
            }
            setUser(next)
            return next
          }

          const tryPassword = async (email) => {
            const { data, error } = await supabase.auth.signInWithPassword({ email, password })
            if (error) return { error }
            if (!data.user) return { error: new Error(translate('login.error.generic')) }
            return { user: data.user }
          }

          const failFriendly = (err) => {
            const msg = err?.message || ''
            if (/invalid login|invalid credentials|email not confirmed/i.test(msg)) {
              return new Error(translate('login.error.invalidCredentials'))
            }
            return err || new Error(translate('login.error.generic'))
          }

          // 1) DB dan aniq email — bitta urinish, console 400 spam yo‘q
          try {
            const { data: resolved, error: rpcError } = await supabase.rpc('lookup_login_email', {
              p_login: String(username || '').trim(),
            })
            if (!rpcError && resolved) {
              const result = await tryPassword(resolved)
              if (result.user) return finishLogin(result.user)
              throw failFriendly(result.error)
            }
          } catch (err) {
            if (err?.message === translate('login.error.invalidCredentials')) throw err
            if (err?.message && !/function|rpc|pgrst/i.test(err.message)) throw err
            /* RPC yo‘q — fallback */
          }

          // 2) Fallback (schema hali yangilanmagan bo‘lsa)
          let lastError = null
          for (const email of usernameToEmailCandidates(username)) {
            const result = await tryPassword(email)
            if (result.user) return finishLogin(result.user)
            lastError = result.error
          }
          throw failFriendly(lastError)
        },
        async logout() {
          try {
            if (supabase) await supabase.auth.signOut({ scope: 'global' })
          } catch {
            try {
              if (supabase) await supabase.auth.signOut({ scope: 'local' })
            } catch {
              /* ignore */
            }
          }
          clearAuthStorage()
          setUser(null)
        },
        setUser,
      }
      Object.defineProperty(contextValue, 'configError', {
        enumerable: true,
        get: () => (configErrorKey ? translate(configErrorKey) : null),
      })
      return contextValue
    },
    [user, ready, configErrorKey],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error(translate('domain.error.authProviderRequired'))
  return ctx
}
