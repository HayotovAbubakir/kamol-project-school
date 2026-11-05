import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  LogOut,
  Plus,
  Users,
} from 'lucide-react'
import { addStudent } from '../lib/api.js'
import { isSupabaseConfigured, supabase, usernameToEmailCandidates } from '../lib/supabase.js'
import {
  createHomework,
  fetchProfile,
  loadGroups,
  loadHomeworks,
  loadMonthlyReport,
  loadStudents,
  reviewSubmission,
  submitHomework,
} from './api.js'

const roleLabels = {
  student: 'O‘quvchi',
  teacher: 'O‘qituvchi',
  admin: 'Qabulxona',
  reception: 'Qabulxona',
  owner: 'Ega',
}

const navItems = [
  { id: 'dashboard', label: 'Bosh sahifa', icon: BookOpen },
  { id: 'homework', label: 'Uy vazifalari', icon: ClipboardCheck },
  { id: 'management', label: 'Boshqaruv', icon: Users, staff: true },
  { id: 'reports', label: 'Hisobotlar', icon: CheckCircle2, staff: true },
]

function isStaff(role) {
  return ['admin', 'reception', 'owner'].includes(role)
}

function formatDeadline(value) {
  if (!value) return 'Muddat belgilanmagan'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('uz-UZ', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function Panel({ children, className = '' }) {
  return <section className={`mini-panel rounded-3xl border p-4 ${className}`}>{children}</section>
}

function ActionButton({ children, className = '', ...props }) {
  return (
    <button
      type={props.type || 'button'}
      className={`mini-action flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

function TaskCard({ task, teacher, onClick }) {
  const submissions = task.submissions || []
  const status = task.submission?.status
  const statusText = status === 'approved' ? 'Qabul qilingan' : status === 'rejected' ? 'Qayta ishlash kerak' : status === 'pending' ? 'Tekshirilmoqda' : 'Yangi'

  return (
    <button type="button" className="task-card w-full rounded-3xl border p-4 text-left" onClick={onClick}>
      <div className="flex items-start gap-3">
        <div className="subject-icon grid size-11 shrink-0 place-items-center rounded-2xl">
          {teacher ? <ClipboardCheck size={19} /> : <BookOpen size={19} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-[var(--mini-muted)]">{task.groups?.name || 'Uy vazifasi'}</p>
          <h2 className="mt-1 text-[15px] font-bold leading-snug">{task.title}</h2>
          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-[var(--mini-muted)]">{task.description || 'Izoh berilmagan.'}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-[var(--mini-border)] pt-3 text-xs">
        <span className="text-[var(--mini-muted)]">{formatDeadline(task.due_at)}</span>
        <span className="font-semibold text-[var(--mini-accent)]">
          {teacher ? `${submissions.filter((item) => item.status === 'pending').length} ta tekshirilmagan` : statusText}
        </span>
      </div>
    </button>
  )
}

export default function MainApp() {
  const [user, setUser] = useState(null)
  const [page, setPage] = useState('dashboard')
  const [selectedId, setSelectedId] = useState(null)
  const [homeworks, setHomeworks] = useState([])
  const [groups, setGroups] = useState([])
  const [students, setStudents] = useState([])
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [createForm, setCreateForm] = useState({ groupId: '', title: '', description: '', deadline: '', file: null })
  const [submissionForm, setSubmissionForm] = useState({ text: '', file: null })
  const [studentForm, setStudentForm] = useState({ name: '', phone: '', groupId: '' })
  const [credentials, setCredentials] = useState(null)
  const [feedbacks, setFeedbacks] = useState({})
  const [copied, setCopied] = useState(false)

  const role = user?.role
  const teacher = role === 'teacher'
  const student = role === 'student'
  const privileged = isStaff(role)
  const selectedHomework = homeworks.find((item) => item.id === selectedId) || null
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const thisMonthSubmissions = homeworks.filter((task) => (
    task.submission?.submitted_at && new Date(task.submission.submitted_at) >= monthStart
  ))

  const refresh = useCallback(async (profile) => {
    if (!profile) return
    setLoading(true)
    setError('')
    try {
      const tasks = await loadHomeworks(profile)
      setHomeworks(tasks)
      if (profile.role === 'teacher' || isStaff(profile.role)) {
        setGroups(await loadGroups())
      }
      if (isStaff(profile.role)) {
        setStudents(await loadStudents())
        setReports(await loadMonthlyReport())
      }
    } catch (loadError) {
      setError(loadError.message || 'Ma’lumotlarni yuklashda xatolik.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!supabase) return
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session?.user) return
      try {
        const profile = await fetchProfile(data.session.user.id)
        if (active) {
          setUser(profile)
          await refresh(profile)
        }
      } catch {
        await supabase.auth.signOut({ scope: 'local' })
      }
    })
    return () => { active = false }
  }, [refresh])

  useEffect(() => {
    const app = window.Telegram?.WebApp
    app?.ready()
    app?.expand()
    const params = app?.themeParams || {}
    if (app) {
      const root = document.documentElement
      root.style.setProperty('--mini-bg', params.bg_color || '#101a2b')
      root.style.setProperty('--mini-card', params.secondary_bg_color || '#17243a')
      root.style.setProperty('--mini-text', params.text_color || '#f4f7fb')
      root.style.setProperty('--mini-muted', params.hint_color || '#a3b2c7')
      root.style.setProperty('--mini-accent', params.button_color || '#4b9cf5')
      root.style.setProperty('--mini-accent-text', params.button_text_color || '#ffffff')
    }
  }, [])

  const visibleNav = useMemo(
    () => navItems.filter((item) => !item.staff || privileged),
    [privileged],
  )

  async function handleLogin(event) {
    event.preventDefault()
    if (!isSupabaseConfigured || !supabase) {
      setError('Supabase manzili yoki public key sozlanmagan.')
      return
    }
    setBusy(true)
    setError('')
    try {
      let authUser = null
      let lastError = null
      for (const email of usernameToEmailCandidates(login)) {
        const result = await supabase.auth.signInWithPassword({ email, password })
        if (!result.error && result.data.user) {
          authUser = result.data.user
          break
        }
        lastError = result.error
      }
      if (!authUser) throw lastError || new Error('Login yoki parol noto‘g‘ri.')
      const profile = await fetchProfile(authUser.id)
      setUser(profile)
      await refresh(profile)
      setPage('dashboard')
      setPassword('')
    } catch (loginError) {
      await supabase.auth.signOut({ scope: 'local' })
      setError(/invalid login|invalid credentials/i.test(loginError.message)
        ? 'Login yoki parol noto‘g‘ri.'
        : loginError.message || 'Tizimga kirishda xatolik.')
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    await supabase?.auth.signOut({ scope: 'local' })
    setUser(null)
    setHomeworks([])
    setPage('dashboard')
    setError('')
  }

  async function saveHomework(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await createHomework(user, createForm)
      setCreateForm({ groupId: '', title: '', description: '', deadline: '', file: null })
      setNotice('Uy vazifasi guruhga yuborildi.')
      await refresh(user)
    } catch (saveError) {
      setError(saveError.message || 'Vazifani saqlab bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  async function saveSubmission(event) {
    event.preventDefault()
    if (!selectedHomework) return
    setBusy(true)
    setError('')
    try {
      await submitHomework(user, selectedHomework, submissionForm)
      setSubmissionForm({ text: '', file: null })
      setNotice('Vazifa muvaffaqiyatli topshirildi.')
      await refresh(user)
    } catch (submitError) {
      setError(submitError.message || 'Vazifani topshirib bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  async function saveReview(submission, status) {
    setBusy(true)
    setError('')
    try {
      await reviewSubmission(submission.id, status, feedbacks[submission.id] || '', user.id)
      setNotice(status === 'approved' ? 'Topshiriq qabul qilindi.' : 'Topshiriq qaytarildi.')
      await refresh(user)
    } catch (reviewError) {
      setError(reviewError.message || 'Bahoni saqlab bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  async function saveStudent(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const created = await addStudent({
        name: studentForm.name,
        phone: studentForm.phone,
        groupIds: studentForm.groupId ? [studentForm.groupId] : [],
      })
      setCredentials(created.credentials)
      setStudentForm({ name: '', phone: '', groupId: '' })
      setNotice('O‘quvchi va uning akkaunti yaratildi.')
      await refresh(user)
    } catch (createError) {
      setError(createError.message || 'O‘quvchini yaratib bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  if (!user) {
    return (
      <main className="miniapp min-h-[100svh] px-4 py-10 text-[var(--mini-text)]">
        <div className="mx-auto max-w-sm">
          <header className="mb-8 text-center">
            <div className="brand-mark mx-auto grid size-14 place-items-center rounded-2xl text-xl font-black">K</div>
            <h1 className="mt-4 text-2xl font-extrabold">Kamol School</h1>
            <p className="mt-1 text-sm text-[var(--mini-muted)]">O‘quv markazi — shaxsiy kabinet</p>
          </header>
          <Panel>
            <h2 className="text-lg font-bold">Tizimga kirish</h2>
            <form className="mt-4 grid gap-3" onSubmit={handleLogin}>
              <label className="mini-field">
                <span>Login</span>
                <input autoComplete="username" value={login} onChange={(event) => setLogin(event.target.value)} required />
              </label>
              <label className="mini-field">
                <span>Parol</span>
                <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
              </label>
              {error && <p className="mini-error">{error}</p>}
              <ActionButton type="submit" className="w-full" disabled={busy}>{busy ? 'Kirilmoqda…' : 'Kirish'}</ActionButton>
            </form>
          </Panel>
          <p className="mt-4 text-center text-xs text-[var(--mini-muted)]">
            Login va parolni o‘quv markazi xodimidan oling.
          </p>
        </div>
      </main>
    )
  }

  const navTo = (nextPage) => {
    setError('')
    setNotice('')
    setPage(nextPage)
  }

  return (
    <main className="miniapp min-h-[100svh] px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))] text-[var(--mini-text)]">
      <div className="mx-auto w-full max-w-xl">
        <header className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {page !== 'dashboard' && (
              <button type="button" className="mini-icon-button" aria-label="Ortga" onClick={() => navTo('dashboard')}>
                <ArrowLeft size={18} />
              </button>
            )}
            <div className="brand-mark grid size-10 shrink-0 place-items-center rounded-2xl font-black">K</div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">Kamol School</p>
              <p className="truncate text-xs text-[var(--mini-muted)]">{roleLabels[role] || role} · {user.name}</p>
            </div>
          </div>
          <button type="button" className="mini-icon-button" onClick={logout} aria-label="Chiqish" title="Chiqish">
            <LogOut size={17} />
          </button>
        </header>

        <nav className="mini-nav mt-5 grid grid-cols-2 gap-1 rounded-2xl p-1 sm:grid-cols-4" aria-label="Asosiy menyu">
          {visibleNav.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => navTo(id)} aria-current={page === id ? 'page' : undefined}>
              <Icon size={15} /> <span>{label}</span>
            </button>
          ))}
        </nav>

        {error && <p role="alert" className="mini-error mt-4">{error}</p>}
        {notice && <p role="status" className="mini-notice mt-4">{notice}</p>}
        {loading && <p className="mt-4 text-sm text-[var(--mini-muted)]">Ma’lumotlar yuklanmoqda…</p>}

        {page === 'dashboard' && (
          <section className="mt-7">
            <p className="text-sm text-[var(--mini-muted)]">Xush kelibsiz, {user.name}!</p>
            <h1 className="mt-1 text-2xl font-extrabold">
              {student ? 'Mening o‘quv kabinetim' : teacher ? 'O‘qituvchi kabineti' : 'Boshqaruv paneli'}
            </h1>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Panel>
                <p className="text-sm text-[var(--mini-muted)]">{student ? 'Mening vazifalarim' : 'Uy vazifalari'}</p>
                <p className="mt-2 text-3xl font-extrabold">{homeworks.length}</p>
                <ActionButton className="mt-4 w-full" onClick={() => navTo('homework')}>Vazifalarni ochish</ActionButton>
              </Panel>
              {teacher && (
                <Panel>
                  <p className="text-sm text-[var(--mini-muted)]">Tekshirilmagan ishlar</p>
                  <p className="mt-2 text-3xl font-extrabold">{homeworks.reduce((sum, task) => sum + (task.submissions || []).filter((item) => item.status === 'pending').length, 0)}</p>
                  <ActionButton className="mt-4 w-full" onClick={() => navTo('homework')}>Tekshirish</ActionButton>
                </Panel>
              )}
              {student && (
                <Panel>
                  <p className="text-sm text-[var(--mini-muted)]">Shu oy topshirilgan</p>
                  <p className="mt-2 text-3xl font-extrabold">{thisMonthSubmissions.length}</p>
                  <p className="mt-1 text-xs text-[var(--mini-muted)]">
                    {thisMonthSubmissions.filter((task) => task.submission.status === 'approved').length} tasi to‘g‘ri baholangan
                  </p>
                  <ActionButton className="mt-4 w-full" onClick={() => navTo('homework')}>Natijalarni ko‘rish</ActionButton>
                </Panel>
              )}
              {privileged && (
                <>
                  <Panel>
                    <p className="text-sm text-[var(--mini-muted)]">O‘quvchilar</p>
                    <p className="mt-2 text-3xl font-extrabold">{students.length}</p>
                    <ActionButton className="mt-4 w-full" onClick={() => navTo('management')}>Boshqarish</ActionButton>
                  </Panel>
                  <Panel>
                    <p className="text-sm text-[var(--mini-muted)]">Oylik hisobotlar</p>
                    <p className="mt-2 text-3xl font-extrabold">{reports.length}</p>
                    <ActionButton className="mt-4 w-full" onClick={() => navTo('reports')}>Hisobotlarni ko‘rish</ActionButton>
                  </Panel>
                </>
              )}
            </div>
          </section>
        )}

        {page === 'homework' && (
          <section className="mt-7">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h1 className="text-xl font-extrabold">{student ? 'Mening vazifalarim' : 'Uy vazifalari'}</h1>
                <p className="mt-1 text-sm text-[var(--mini-muted)]">{homeworks.length} ta vazifa</p>
              </div>
              {teacher && <ActionButton onClick={() => setSelectedId('new')}><Plus size={16} /> Vazifa berish</ActionButton>}
            </div>
            {teacher && selectedId === 'new' && (
              <Panel className="mb-4">
                <h2 className="font-bold">Guruhga vazifa berish</h2>
                <form className="mt-4 grid gap-3" onSubmit={saveHomework}>
                  <label className="mini-field"><span>Guruh</span>
                    <select value={createForm.groupId} onChange={(event) => setCreateForm({ ...createForm, groupId: event.target.value })} required>
                      <option value="">Guruhni tanlang</option>
                      {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                    </select>
                  </label>
                  <label className="mini-field"><span>Sarlavha</span><input value={createForm.title} onChange={(event) => setCreateForm({ ...createForm, title: event.target.value })} required /></label>
                  <label className="mini-field"><span>Izoh</span><textarea rows="3" value={createForm.description} onChange={(event) => setCreateForm({ ...createForm, description: event.target.value })} /></label>
                  <label className="mini-field"><span>Muddat</span><input type="datetime-local" value={createForm.deadline} onChange={(event) => setCreateForm({ ...createForm, deadline: event.target.value })} /></label>
                  <label className="mini-field"><span>Fayl (PDF yoki rasm, 10 MB gacha)</span><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setCreateForm({ ...createForm, file: event.target.files?.[0] || null })} /></label>
                  <div className="flex gap-2">
                    <ActionButton type="submit" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'Vazifani yuborish'}</ActionButton>
                    <ActionButton className="mini-secondary" onClick={() => setSelectedId(null)}>Bekor</ActionButton>
                  </div>
                </form>
              </Panel>
            )}
            {homeworks.length ? (
              <div className="grid gap-3">
                {homeworks.map((task) => (
                  <TaskCard key={task.id} task={task} teacher={teacher} onClick={() => { setSelectedId(task.id); setPage('detail') }} />
                ))}
              </div>
            ) : !loading && <Panel>Hozircha uy vazifalari yo‘q.</Panel>}
          </section>
        )}

        {page === 'detail' && selectedHomework && (
          <section className="mt-7 grid gap-4">
            <Panel>
              <p className="text-sm text-[var(--mini-muted)]">{selectedHomework.groups?.name || 'Uy vazifasi'}</p>
              <h1 className="mt-1 text-xl font-extrabold">{selectedHomework.title}</h1>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{selectedHomework.description || 'Izoh berilmagan.'}</p>
              <p className="mt-3 text-xs text-[var(--mini-muted)]">Muddat: {formatDeadline(selectedHomework.due_at)}</p>
              {selectedHomework.file_url && <a className="mini-link mt-3 inline-block" href={selectedHomework.file_url} target="_blank" rel="noreferrer">Vazifa faylini ochish</a>}
            </Panel>
            {student && (
              <Panel>
                <h2 className="font-bold">Javobni topshirish</h2>
                {selectedHomework.submission?.status && (
                  <p className="mt-2 text-sm text-[var(--mini-muted)]">
                    Holati: {selectedHomework.submission.status === 'approved' ? 'Qabul qilingan' : selectedHomework.submission.status === 'rejected' ? 'Qaytarilgan' : 'Tekshirilmoqda'}
                  </p>
                )}
                {selectedHomework.submission?.feedback && <p className="mt-2 text-sm">Izoh: {selectedHomework.submission.feedback}</p>}
                <form className="mt-4 grid gap-3" onSubmit={saveSubmission}>
                  <label className="mini-field"><span>Matnli javob</span><textarea rows="4" value={submissionForm.text} onChange={(event) => setSubmissionForm({ ...submissionForm, text: event.target.value })} /></label>
                  <label className="mini-field"><span>Rasm yoki PDF (10 MB gacha)</span><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setSubmissionForm({ ...submissionForm, file: event.target.files?.[0] || null })} /></label>
                  <ActionButton type="submit" disabled={busy || (!submissionForm.text.trim() && !submissionForm.file)}>{busy ? 'Yuborilmoqda…' : 'Topshirish'}</ActionButton>
                </form>
              </Panel>
            )}
            {teacher && selectedHomework.submissions?.map((submission) => (
              <Panel key={submission.id}>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-bold">{submission.students?.name || 'O‘quvchi'}</h2>
                  <span className="text-xs text-[var(--mini-muted)]">{submission.status}</span>
                </div>
                {submission.content_text && <p className="mt-3 whitespace-pre-wrap text-sm">{submission.content_text}</p>}
                {submission.file_url && <a className="mini-link mt-3 inline-block" href={submission.file_url} target="_blank" rel="noreferrer">Yuborilgan faylni ochish</a>}
                <label className="mini-field mt-3"><span>O‘qituvchi izohi</span>
                  <textarea rows="2" value={feedbacks[submission.id] ?? submission.feedback ?? ''} onChange={(event) => setFeedbacks({ ...feedbacks, [submission.id]: event.target.value })} />
                </label>
                <div className="mt-3 flex gap-2">
                  <ActionButton disabled={busy} onClick={() => saveReview(submission, 'approved')}><Check size={15} /> Qabul qilish</ActionButton>
                  <ActionButton disabled={busy} className="mini-danger" onClick={() => saveReview(submission, 'rejected')}>Qaytarish</ActionButton>
                </div>
              </Panel>
            ))}
          </section>
        )}

        {page === 'management' && privileged && (
          <section className="mt-7 grid gap-4">
            <h1 className="text-xl font-extrabold">O‘quvchilar boshqaruvi</h1>
            <Panel>
              <h2 className="font-bold">Yangi o‘quvchi qo‘shish</h2>
              <form className="mt-4 grid gap-3" onSubmit={saveStudent}>
                <label className="mini-field"><span>Ism va familiya</span><input value={studentForm.name} onChange={(event) => setStudentForm({ ...studentForm, name: event.target.value })} required /></label>
                <label className="mini-field"><span>Telefon</span><input type="tel" value={studentForm.phone} onChange={(event) => setStudentForm({ ...studentForm, phone: event.target.value })} required /></label>
                <label className="mini-field"><span>Guruh</span>
                  <select value={studentForm.groupId} onChange={(event) => setStudentForm({ ...studentForm, groupId: event.target.value })}>
                    <option value="">Keyinroq biriktiraman</option>
                    {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                  </select>
                </label>
                <ActionButton type="submit" disabled={busy}><Plus size={16} /> {busy ? 'Saqlanmoqda…' : 'O‘quvchini yaratish'}</ActionButton>
              </form>
            </Panel>
            {credentials && (
              <Panel>
                <h2 className="font-bold">Yangi login va parol</h2>
                <p className="mt-1 text-xs text-[var(--mini-muted)]">Parol xavfsizlik uchun qayta ko‘rsatilmaydi. Hozir nusxalab o‘quvchiga yetkazing.</p>
                <p className="mt-3 text-sm">Login: <strong>{credentials.username}</strong></p>
                <p className="mt-1 text-sm">Parol: <strong>{credentials.password}</strong></p>
                <ActionButton className="mt-3" onClick={async () => { await navigator.clipboard.writeText(`${credentials.username}\n${credentials.password}`); setCopied(true) }}>
                  <Copy size={15} /> {copied ? 'Nusxalandi' : 'Nusxalash'}
                </ActionButton>
              </Panel>
            )}
            <Panel>
              <h2 className="font-bold">O‘quvchilar ro‘yxati</h2>
              <div className="mt-3 divide-y divide-[var(--mini-border)]">
                {students.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0"><p className="truncate text-sm font-semibold">{item.name}</p><p className="text-xs text-[var(--mini-muted)]">{item.phone || 'Telefon yo‘q'}</p></div>
                    <span className="shrink-0 rounded-full bg-[var(--mini-bg)] px-3 py-1 text-xs">{item.login || 'Login yo‘q'}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </section>
        )}

        {page === 'reports' && privileged && (
          <section className="mt-7">
            <h1 className="text-xl font-extrabold">Oylik hisobotlar</h1>
            <p className="mt-1 text-sm text-[var(--mini-muted)]">Topshirilgan va baholangan vazifalar</p>
            <div className="mt-4 grid gap-3">
              {reports.map((report) => (
                <Panel key={`${report.student_id}-${report.month_start}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div><h2 className="font-bold">{report.student_name}</h2><p className="mt-1 text-xs text-[var(--mini-muted)]">{report.month_start || 'Hali topshiriq yo‘q'}</p></div>
                    <span className="rounded-full bg-[var(--mini-bg)] px-3 py-1 text-xs">{report.total_submissions} ta</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                    <div><strong className="block text-base">{report.approved_count}</strong>To‘g‘ri</div>
                    <div><strong className="block text-base">{report.rejected_count}</strong>Qaytarilgan</div>
                    <div><strong className="block text-base">{report.pending_count}</strong>Kutilmoqda</div>
                  </div>
                </Panel>
              ))}
              {!reports.length && !loading && <Panel>Hisobot uchun ma’lumot topilmadi.</Panel>}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
