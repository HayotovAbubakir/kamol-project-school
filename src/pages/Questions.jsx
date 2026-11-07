import { useCallback, useEffect, useState } from 'react'
import { PageEnter } from '../components/motion/PageMotion'
import { PageHeader, StatusBadge } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { cloudflare } from '../lib/cloudflare'

async function questionRequest(path, token, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'So‘rovni bajarib bo‘lmadi.')
  return result.data
}

export default function Questions() {
  const { user } = useAuth()
  const [tickets, setTickets] = useState([])
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [reply, setReply] = useState({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [expanded, setExpanded] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await cloudflare.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new Error('Sessiya tugagan. Qayta kiring.')
      const params = new URLSearchParams()
      if (status) params.set('status', status)
      if (search.trim()) params.set('search', search.trim())
      setTickets(await questionRequest(`/api/questions?${params}`, token))
    } catch (loadError) {
      setError(loadError.message || 'Savollarni yuklab bo‘lmadi.')
    } finally {
      setLoading(false)
    }
  }, [status, search])

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const sendReply = async (ticket) => {
    const text = String(reply[ticket.id] || '').trim()
    if (!text) return
    setBusy(true)
    setError('')
    try {
      const { data } = await cloudflare.auth.getSession()
      await questionRequest(`/api/questions/${encodeURIComponent(ticket.id)}/reply`, data.session?.access_token, {
        method: 'POST',
        body: JSON.stringify({ text }),
      })
      setReply((current) => ({ ...current, [ticket.id]: '' }))
      setNotice('Javob Telegram orqali o‘quvchiga yuborildi.')
      await load()
    } catch (sendError) {
      setError(sendError.message || 'Javob yuborilmadi.')
    } finally {
      setBusy(false)
    }
  }

  const closeTicket = async (ticket) => {
    setBusy(true)
    setError('')
    try {
      const { data } = await cloudflare.auth.getSession()
      await questionRequest(`/api/questions/${encodeURIComponent(ticket.id)}/close`, data.session?.access_token, {
        method: 'POST',
        body: JSON.stringify({}),
      })
      setNotice('Savol yopildi.')
      await load()
    } catch (closeError) {
      setError(closeError.message || 'Savolni yopib bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  const downloadAttachment = async (event, fileUrl) => {
    event.preventDefault()
    try {
      const { data } = await cloudflare.auth.getSession()
      const response = await fetch(fileUrl, { headers: { Authorization: `Bearer ${data.session?.access_token || ''}` } })
      if (!response.ok) throw new Error('Ilovani yuklab bo‘lmadi.')
      const objectUrl = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = 'savol-ilovasi'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch (downloadError) {
      setError(downloadError.message || 'Ilovani yuklab bo‘lmadi.')
    }
  }

  const unreadTotal = tickets.reduce((sum, ticket) => sum + Number(ticket.unread_count || 0), 0)
  return (
    <PageEnter>
      <PageHeader title="Savollar inboxi" subtitle="O‘quvchilar bilan yozishmalar va javoblar tarixi" />
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      <div className="card mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-[1fr_2fr_auto]">
        <label className="field">
          <span>Holati</span>
          <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Barchasi</option><option value="open">Ochiq</option><option value="answered">Javob berilgan</option><option value="closed">Yopilgan</option>
          </select>
        </label>
        <label className="field">
          <span>Qidirish</span>
          <input className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="O‘quvchi yoki xabar matni" />
        </label>
        <div className="self-end text-sm text-muted">O‘qilmagan: <strong>{unreadTotal}</strong></div>
      </div>
      {loading ? <div className="card p-6 text-muted">Savollar yuklanmoqda…</div>
        : !tickets.length ? <div className="card p-6 text-muted">Bu filtrda savol topilmadi.</div>
          : <div className="grid gap-3">
            {tickets.map((ticket) => (
              <section key={ticket.id} className="card p-4">
                <button type="button" className="flex w-full flex-wrap items-center justify-between gap-3 text-left" onClick={() => setExpanded(expanded === ticket.id ? null : ticket.id)}>
                  <span className="min-w-0">
                    <strong className="block truncate">{ticket.student_name}</strong>
                    <span className="text-sm text-muted">{new Date(ticket.last_message_at).toLocaleString('uz-UZ')}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {Number(ticket.unread_count) > 0 && <StatusBadge tone="warning">{ticket.unread_count} yangi</StatusBadge>}
                    <StatusBadge tone={ticket.status === 'open' ? 'warning' : ticket.status === 'answered' ? 'success' : 'default'}>
                      {ticket.status === 'open' ? 'Ochiq' : ticket.status === 'answered' ? 'Javob berilgan' : 'Yopilgan'}
                    </StatusBadge>
                  </span>
                </button>
                {expanded === ticket.id && (
                  <div className="mt-4 grid gap-3 border-t border-[var(--border)] pt-3">
                    {ticket.messages?.map((message) => (
                      <article key={message.id} className="rounded-xl bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-muted">{message.actor_role === 'student' ? 'O‘quvchi' : message.actor_role === 'teacher' ? 'O‘qituvchi' : 'Qabulxona'} · {new Date(message.created_at).toLocaleString('uz-UZ')}</p>
                        {message.body && <p className="mt-1 whitespace-pre-wrap break-words text-sm">{message.body}</p>}
                        {message.file_url && <a className="btn btn-outline btn-sm mt-2" href={message.file_url} onClick={(event) => downloadAttachment(event, message.file_url)}>Ilovani yuklab olish</a>}
                      </article>
                    ))}
                    {ticket.status !== 'closed' && (
                      <div className="grid gap-2">
                        <label className="field"><span>Javob</span><textarea className="input" rows="3" maxLength="10000" value={reply[ticket.id] || ''} onChange={(event) => setReply((current) => ({ ...current, [ticket.id]: event.target.value }))} /></label>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" className="btn btn-primary" disabled={busy || !String(reply[ticket.id] || '').trim()} onClick={() => sendReply(ticket)}>Javobni yuborish</button>
                          {user?.role === 'owner' || user?.role === 'reception'
                            ? <button type="button" className="btn btn-outline" disabled={busy} onClick={() => closeTicket(ticket)}>Yopish</button>
                            : null}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>
            ))}
          </div>}
    </PageEnter>
  )
}
