import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { cloudflare } from '../lib/cloudflare'

export default function PasswordResetGate() {
  const { user, setUser, logout } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!user?.mustResetPassword) return null

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Yangi parol kamida 8 ta belgidan iborat bo‘lsin.')
      return
    }
    if (password !== confirmation) {
      setError('Parollar mos kelmadi.')
      return
    }
    setBusy(true)
    const result = await cloudflare.auth.updateUser({ password })
    setBusy(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    setUser({ ...user, mustResetPassword: false })
  }

  return (
    <main className="fixed inset-0 z-[100] grid min-h-screen place-items-center bg-slate-950 px-4 py-10 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl">
        <p className="text-sm font-semibold text-blue-300">Kamol School</p>
        <h1 className="mt-3 text-2xl font-bold">Yangi parol o‘rnating</h1>
        <p className="mt-2 text-sm text-slate-300">
          Vaqtinchalik parol bilan kirdingiz. Davom etish uchun yangi parol tanlang.
        </p>
        <form className="mt-6 grid gap-4" onSubmit={submit}>
          <label className="grid gap-2 text-sm">
            Yangi parol
            <input
              autoComplete="new-password"
              className="rounded-xl border border-white/15 bg-slate-900 px-4 py-3 text-white outline-none focus:border-blue-400"
              type="password"
              minLength={8}
              maxLength={128}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm">
            Parolni takrorlang
            <input
              autoComplete="new-password"
              className="rounded-xl border border-white/15 bg-slate-900 px-4 py-3 text-white outline-none focus:border-blue-400"
              type="password"
              minLength={8}
              maxLength={128}
              required
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
          <button
            className="rounded-xl bg-blue-500 px-4 py-3 font-semibold transition hover:bg-blue-400 disabled:opacity-50"
            type="submit"
            disabled={busy}
          >
            {busy ? 'Saqlanmoqda…' : 'Parolni saqlash'}
          </button>
        </form>
        <button className="mt-4 text-sm text-slate-300 underline" type="button" onClick={logout}>
          Chiqish
        </button>
      </section>
    </main>
  )
}
