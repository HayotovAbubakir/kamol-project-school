import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { fetchProfile } from '../lib/api'
import { clearAuthStorage, cloudflare } from '../lib/cloudflare'
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
    && a.mustResetPassword === b.mustResetPassword
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)
  const userRef = useRef(null)

  useEffect(() => {
    userRef.current = user
  }, [user])

  useEffect(() => {
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
          mustResetPassword: Boolean(session.user.must_reset_password),
        }
        setUser((prev) => (sameUser(prev, next) ? prev : next))
      } catch {
        if (!cancelled) setUser(null)
      }
    }

    cloudflare.auth.getSession().then(({ data }) => {
      applySession(data.session, { forceProfile: true }).finally(() => {
        if (!cancelled) setReady(true)
      })
    })

    const { data: sub } = cloudflare.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED') {
        return
      }
      if (event === 'USER_UPDATED') {
        setUser((previous) => previous ? { ...previous, mustResetPassword: false } : previous)
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
          const finishLogin = async (authUser) => {
            const profile = await fetchProfile(authUser.id)
            const next = {
              id: profile.id,
              username: profile.username,
              name: profile.name,
              role: profile.role,
              teacherId: profile.teacherId,
              mustResetPassword: Boolean(authUser.must_reset_password),
            }
            setUser(next)
            return next
          }

          const failFriendly = (err) => {
            const msg = err?.message || ''
            if (/invalid login|invalid credentials|email not confirmed|login yoki parol/i.test(msg)) {
              return new Error(translate('login.error.invalidCredentials'))
            }
            return err || new Error(translate('login.error.generic'))
          }

          const { data, error } = await cloudflare.auth.signInWithPassword({ username, password })
          if (error) throw failFriendly(error)
          if (!data.user) throw failFriendly(new Error(translate('login.error.generic')))
          return finishLogin(data.user)
        },
        async logout() {
          try {
            await cloudflare.auth.signOut({ scope: 'global' })
          } catch {
            try {
              await cloudflare.auth.signOut({ scope: 'local' })
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
        value: null,
      })
      return contextValue
    },
    [user, ready],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error(translate('domain.error.authProviderRequired'))
  return ctx
}
