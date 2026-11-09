import { useCallback, useEffect, useRef, useState } from 'react'
import { Inbox } from 'lucide-react'
import { PageEnter } from '../components/motion/PageMotion'
import { PageHeader, StatusBadge } from '../components/ui'
import Select from '../components/Select'
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
  const loadVersion = useRef(0)

  const load = useCallback(async () => {
    const version = ++loadVersion.current
    setLoading(true)
    setError('')
    try {
      const { data } = await cloudflare.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new Error('Sessiya tugagan. Qayta kiring.')
      const params = new URLSearchParams()
      if (status) params.set('status', status)
      if (search.trim()) params.set('search', search.trim())
      const nextTickets = await questionRequest(`/api/questions?${params}`, token)
      if (version === loadVersion.current) setTickets(nextTickets)
    } catch (loadError) {
      if (version === loadVersion.current) setError(loadError.message || 'Savollarni yuklab bo‘lmadi.')
    } finally {
      if (version === loadVersion.current) setLoading(false)
    }
  }, [status, search])

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 250)
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
  const formatDate = (value) => new Intl.DateTimeFormat('uz-UZ', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Tashkent',
  }).format(new Date(value))
  const hasFilters = Boolean(status || search.trim())

  return (
    <PageEnter>
      <PageHeader title="Savollar" subtitle="O‘quvchilar yuborgan savollar va yozishmalar" />
      {error && (
        <div className="alert alert-error flex flex-wrap items-center justify-between gap-3" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-outline btn-sm" onClick={load} disabled={loading}>
            {loading ? 'Yuklanmoqda…' : 'Qayta urinish'}
          </button>
        </div>
      )}
      {notice && <div className="alert alert-success" role="status" aria-live="polite">{notice}</div>}
      <div className="card question-toolbar mb-4">
        <label className="field question-toolbar-field">
          <span>Holati</span>
          <Select
            aria-label="Holati"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            options={[
              { value: '', label: 'Barchasi' },
              { value: 'open', label: 'Ochiq' },
              { value: 'answered', label: 'Javob berilgan' },
              { value: 'closed', label: 'Yopilgan' },
            ]}
          />
        </label>
        <label className="field question-toolbar-search">
          <span>Qidirish</span>
          <input
            className="input"
            type="search"
            name="savollar-qidiruv"
            autoComplete="off"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="O‘quvchi yoki xabar matni…"
          />
        </label>
        <div className="question-toolbar-side">
          <span className="question-unread-chip">O‘qilmagan: <strong>{unreadTotal}</strong></span>
          {(status || search) ? (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => { setStatus(''); setSearch('') }}>Tozalash</button>
          ) : null}
        </div>
      </div>
      {loading ? <div className="grid gap-3" aria-busy="true" aria-label="Savollar yuklanmoqda">
        {[0, 1, 2].map((row) => <div key={row} className="card skeleton-row" />)}
      </div>
        : !tickets.length ? <div className="card empty-state">
          <Inbox size={30} aria-hidden="true" />
          <strong>{hasFilters ? 'Bu filtrga mos savol topilmadi' : 'Hozircha savollar yo‘q'}</strong>
          <span>{hasFilters ? 'Boshqa so‘z bilan qidiring yoki filtrlarni tozalang.' : 'O‘quvchilar yuborgan savollar shu yerda ko‘rinadi.'}</span>
          {hasFilters ? (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => { setStatus(''); setSearch('') }}>Filtrlarni tozalash</button>
          ) : null}
        </div>
          : <div className="grid gap-3">
            {tickets.map((ticket) => (
              <section key={ticket.id} className={`card p-4 question-ticket${Number(ticket.unread_count) > 0 ? ' is-unread' : ''}`}>
                <button type="button" className="flex w-full flex-wrap items-center justify-between gap-3 text-left" onClick={() => setExpanded(expanded === ticket.id ? null : ticket.id)}>
                  <span className="min-w-0">
                    <strong className="block truncate">{ticket.student_name}</strong>
                    <span className="text-sm text-muted">{formatDate(ticket.last_message_at)}</span>
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
                        <p className="text-xs text-muted">{message.actor_role === 'student' ? 'O‘quvchi' : message.actor_role === 'teacher' ? 'O‘qituvchi' : 'Qabulxona'} · {formatDate(message.created_at)}</p>
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
