import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  LogOut,
  Plus,
  Receipt,
  RefreshCw,
  Users,
  Wallet,
} from 'lucide-react'
import {
  auth,
  attendance as attendanceData,
  expenses as expenseData,
  finance,
  groups as groupData,
  groupManagement,
  homework as homeworkData,
  payments as paymentData,
  reports as homeworkReports,
  salaryPayments as salaryPaymentData,
  students as studentData,
  teachers as teacherData,
  telegram,
} from '../lib/data/index.js'

const roleLabels = {
  student: 'O‘quvchi',
  teacher: 'O‘qituvchi',
  admin: 'Qabulxona',
  reception: 'Qabulxona',
  owner: 'Ega',
}

const monthLabels = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr',
]

const navItems = [
  { id: 'dashboard', label: 'Bosh sahifa', icon: BookOpen },
  { id: 'homework', label: 'Uy vazifalari', icon: ClipboardCheck },
  { id: 'payments', label: 'To‘lovlar', icon: Receipt },
  { id: 'attendance', label: 'Davomat', icon: CalendarDays },
  { id: 'management', label: 'Boshqaruv', icon: Users, staff: true },
  { id: 'reports', label: 'Hisobotlar', icon: CheckCircle2, staff: true },
  { id: 'finance', label: 'Moliya', icon: Wallet, owner: true },
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
    timeZone: 'Asia/Tashkent',
  }).format(date)
}

function tashkentDateRange() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).map(({ type, value }) => [type, value]))
  return {
    from: `${parts.year}-${parts.month}-01`,
    to: `${parts.year}-${parts.month}-${parts.day}`,
  }
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('uz-UZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Tashkent',
  }).format(date)
}

function Panel({ children, className = '' }) {
  return <section className={`mini-panel rounded-3xl border p-4 ${className}`}>{children}</section>
}

function ActionButton({ children, className = '', ...props }) {
  const { onClick, type, ...buttonProps } = props
  const handleClick = (event) => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('light')
    onClick?.(event)
  }
  return (
    <button
      type={type || 'button'}
      className={`mini-action flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...buttonProps}
      onClick={handleClick}
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
  const [teachers, setTeachers] = useState([])
  const [expenses, setExpenses] = useState([])
  const [salaryPayments, setSalaryPayments] = useState([])
  const [reports, setReports] = useState([])
  const [payments, setPayments] = useState([])
  const [attendance, setAttendance] = useState([])
  const [financeSummary, setFinanceSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [studentSearch, setStudentSearch] = useState('')
  const [authLoading, setAuthLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [createForm, setCreateForm] = useState({ groupId: '', title: '', description: '', deadline: '', file: null })
  const [submissionForm, setSubmissionForm] = useState({ text: '', file: null })
  const [submissionPreview, setSubmissionPreview] = useState('')
  const previewUrl = useRef('')
  const [studentForm, setStudentForm] = useState({ name: '', phone: '', groupId: '' })
  const [teacherForm, setTeacherForm] = useState({ name: '', phone: '', monthlySalary: '' })
  const [groupForm, setGroupForm] = useState({ name: '', teacherId: '', monthlyFee: '', day: '1', startTime: '', endTime: '' })
  const [paymentForm, setPaymentForm] = useState({ studentId: '', amount: '', month: String(new Date().getMonth() + 1), year: String(new Date().getFullYear()) })
  const [attendanceForm, setAttendanceForm] = useState({ studentId: '', groupId: '', status: 'present', note: '' })
  const [expenseForm, setExpenseForm] = useState({ title: '', amount: '', category: 'Operatsion' })
  const [salaryForm, setSalaryForm] = useState({ teacherId: '', amount: '' })
  const [credentials, setCredentials] = useState(null)
  const [inviteLinks, setInviteLinks] = useState({})
  const [feedbacks, setFeedbacks] = useState({})
  const [copied, setCopied] = useState(false)
  const touchStartY = useRef(null)

  const role = user?.role
  const teacher = role === 'teacher'
  const student = role === 'student'
  const privileged = isStaff(role)
  const selectedHomework = homeworks.find((item) => item.id === selectedId) || null
  const monthStart = new Date(`${tashkentDateRange().from}T00:00:00+05:00`)
  const thisMonthSubmissions = homeworks.filter((task) => (
    task.submission?.submitted_at && new Date(task.submission.submitted_at) >= monthStart
  ))

  const refresh = useCallback(async (profile) => {
    if (!profile) return
    setLoading(true)
    setError('')
    try {
      const tasks = await homeworkData.list(profile)
      setHomeworks(tasks)
      const [paymentRows, attendanceRows] = await Promise.all([
        paymentData.list(profile),
        attendanceData.list(profile),
      ])
      setPayments(paymentRows)
      setAttendance(attendanceRows)
      if (profile.role === 'teacher' || isStaff(profile.role)) {
        setGroups(await groupData.list(profile))
      }
      if (isStaff(profile.role) || profile.role === 'teacher') {
        setStudents(await studentData.list(profile))
      }
      if (isStaff(profile.role)) {
        setReports(await homeworkReports.monthlyHomework())
        setTeachers(await teacherData.list())
      }
      if (profile.role === 'owner') {
        const [expenseRows, salaryRows] = await Promise.all([
          expenseData.list(),
          salaryPaymentData.list(),
        ])
        setExpenses(expenseRows)
        setSalaryPayments(salaryRows)
        const { from, to } = tashkentDateRange()
        setFinanceSummary(await finance.summary(from, to))
      }
    } catch (loadError) {
      setError(loadError.message || 'Ma’lumotlarni yuklashda xatolik.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    async function authenticate() {
      try {
        const { data } = await auth.getSession()
        const result = data.session?.user
          ? { data: { user: data.session.user }, error: null }
          : await auth.signInWithTelegram()
        if (result.error) {
          if (active) setError(result.error.code === 'TELEGRAM_NOT_LINKED'
            ? 'Telegram akkauntingiz hali tizimga ulanmagan. Qabulxonadan bir martalik ulash havolasini oling.'
            : result.error.message)
          return
        }
        const profile = result.data.user
        const nextProfile = { ...profile, teacherId: profile.teacher_id, mustResetPassword: Boolean(profile.must_reset_password) }
        if (active) {
          setUser(nextProfile)
          await refresh(nextProfile)
        }
      } catch {
        if (active) setError('Telegram orqali tizimga ulanib bo‘lmadi. Internetni tekshirib, qayta urinib ko‘ring.')
      } finally {
        if (active) setAuthLoading(false)
      }
    }
    authenticate()
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
      root.style.colorScheme = app.colorScheme || 'dark'
    }
  }, [])

  useEffect(() => {
    const app = window.Telegram?.WebApp
    if (!app || !app.isVersionAtLeast?.('6.1')) return undefined
    const onBack = () => setPage('dashboard')
    const formId = page === 'management'
      ? 'mini-student-form'
      : page === 'homework' && student && selectedHomework && !['pending', 'approved'].includes(selectedHomework.submission?.status)
        ? 'mini-submission-form'
        : null
    const onMainClick = () => document.getElementById(formId)?.requestSubmit()
    if (page === 'dashboard') app.BackButton?.hide()
    else {
      app.BackButton?.show()
      app.BackButton?.onClick(onBack)
    }

    if (formId) {
      app.MainButton?.setText(page === 'management' ? 'O‘quvchini yaratish' : 'Vazifani topshirish')
      app.MainButton?.show()
      app.MainButton?.onClick(onMainClick)
    } else app.MainButton?.hide()

    return () => {
      app.BackButton?.offClick(onBack)
      app.MainButton?.offClick(onMainClick)
      app.MainButton?.hide()
    }
  }, [page, student, selectedHomework])

  useEffect(() => () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
  }, [])

  useEffect(() => {
    if (!user) return undefined
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh(user)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh, user])

  const visibleNav = useMemo(
    () => navItems.filter((item) => (!item.staff || privileged) && (!item.owner || role === 'owner')),
    [privileged, role],
  )

  async function logout() {
    await auth.signOut()
    setUser(null)
    setHomeworks([])
    setPage('dashboard')
    setError('')
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setNotice('Nusxalandi.')
    } catch {
      setError('Nusxa olish uchun brauzer ruxsatini tekshiring.')
    }
  }

  async function saveHomework(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await homeworkData.create(user, createForm)
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
      await homeworkData.submit(user, selectedHomework, submissionForm)
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
      previewUrl.current = ''
      setSubmissionPreview('')
      setSubmissionForm({ text: '', file: null })
      setNotice('Vazifa muvaffaqiyatli topshirildi.')
      await refresh(user)
    } catch (submitError) {
      setError(submitError.message || 'Vazifani topshirib bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  function chooseSubmissionFile(file) {
    setError('')
    if (!file) {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
      previewUrl.current = ''
      setSubmissionPreview('')
      setSubmissionForm((current) => ({ ...current, file: null }))
      return
    }
    if (file.size <= 0 || file.size > 10 * 1024 * 1024) {
      setError('Fayl hajmi 10 MB dan oshmasligi kerak.')
      return
    }
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Faqat PDF, JPG, PNG yoki WebP fayl yuborish mumkin.')
      return
    }
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    previewUrl.current = URL.createObjectURL(file)
    setSubmissionPreview(previewUrl.current)
    setSubmissionForm((current) => ({ ...current, file }))
  }

  async function saveReview(submission, status) {
    setBusy(true)
    setError('')
    try {
      await homeworkData.review(submission.id, status, feedbacks[submission.id] || '', user.id)
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
      const created = await studentData.create({
        name: studentForm.name,
        phone: studentForm.phone,
        groupIds: studentForm.groupId ? [studentForm.groupId] : [],
      })
      setCredentials(created.credentials)
      setInviteLinks({})
      setStudentForm({ name: '', phone: '', groupId: '' })
      setNotice('O‘quvchi va uning akkaunti yaratildi.')
      await refresh(user)
    } catch (createError) {
      setError(createError.message || 'O‘quvchini yaratib bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  async function saveTeacher(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const base = teacherForm.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24) || 'teacher'
      const suffix = [...crypto.getRandomValues(new Uint8Array(4))]
        .map((value) => value.toString(16).padStart(2, '0')).join('')
      const password = [...crypto.getRandomValues(new Uint8Array(16))]
        .map((value) => value.toString(16).padStart(2, '0')).join('')
      const created = await teacherData.create({
        ...teacherForm,
        username: `${base}${suffix}`,
        password,
      })
      if (created.loginError) throw new Error(created.loginError)
      setTeacherForm({ name: '', phone: '', monthlySalary: '' })
      await refresh(user)
      const linkedTeacher = (await teacherData.list()).find((item) => item.id === created.id)
      if (linkedTeacher?.profile_id) await createInvite(linkedTeacher.profile_id)
      setNotice('O‘qituvchi qo‘shildi. Telegram ulash havolasi yaratildi.')
    } catch (createError) {
      setError(createError.message || 'O‘qituvchini qo‘shib bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  async function saveGroup(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await groupManagement.create({
        name: groupForm.name,
        teacherId: groupForm.teacherId,
        monthlyFee: groupForm.monthlyFee,
        schedule: groupForm.startTime && groupForm.endTime
          ? [{ day: Number(groupForm.day), startTime: groupForm.startTime, endTime: groupForm.endTime, teacherId: groupForm.teacherId }]
          : [],
      }, groups)
      setGroupForm({ name: '', teacherId: '', monthlyFee: '', day: '1', startTime: '', endTime: '' })
      setNotice('Guruh yaratildi.')
      await refresh(user)
    } catch (createError) {
      setError(createError.message || 'Guruhni yaratib bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  async function savePayment(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await paymentData.create({
        studentId: paymentForm.studentId,
        amount: paymentForm.amount,
        month: paymentForm.month,
        year: paymentForm.year,
      })
      setPaymentForm({ ...paymentForm, amount: '' })
      setNotice('To‘lov qayd etildi.')
      await refresh(user)
    } catch (saveError) {
      setError(saveError.message || 'To‘lovni qayd etib bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  async function saveAttendance(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await attendanceData.mark({
        studentId: attendanceForm.studentId,
        groupId: attendanceForm.groupId,
        status: attendanceForm.status,
        note: attendanceForm.note,
        markedBy: user.id,
      })
      setNotice('Davomat saqlandi.')
      await refresh(user)
    } catch (saveError) {
      setError(saveError.message || 'Davomatni saqlab bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  async function saveExpense(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await expenseData.create({ ...expenseForm, recordedBy: user.id })
      setExpenseForm({ title: '', amount: '', category: 'Operatsion' })
      setNotice('Xarajat qayd etildi.')
      await refresh(user)
    } catch (saveError) {
      setError(saveError.message || 'Xarajatni qayd etib bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  async function saveSalaryPayment(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await salaryPaymentData.create({
        teacherId: salaryForm.teacherId,
        amount: salaryForm.amount,
      })
      setSalaryForm({ ...salaryForm, amount: '' })
      setNotice('O‘qituvchi to‘lovi qayd etildi.')
      await refresh(user)
    } catch (saveError) {
      setError(saveError.message || 'Ish haqini qayd etib bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  async function createInvite(profileId) {
    if (!profileId) {
      setError('Foydalanuvchi akkaunti topilmadi.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const invite = await telegram.createInvite(profileId)
      setInviteLinks((current) => ({ ...current, [profileId]: invite.invite_url }))
      setNotice('Telegram ulash havolasi 15 daqiqa davomida amal qiladi.')
    } catch (inviteError) {
      setError(inviteError.message || 'Ulash havolasini yaratib bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  if (!user) {
    return (
      <main className="miniapp min-h-[100svh] px-4 py-10 text-[var(--mini-text)]" aria-busy={authLoading}>
        <div className="mx-auto max-w-sm">
          <header className="mb-8 text-center">
            <div className="brand-mark mx-auto grid size-14 place-items-center rounded-2xl text-xl font-black">K</div>
            <h1 className="mt-4 text-2xl font-extrabold">Kamol School</h1>
            <p className="mt-1 text-sm text-[var(--mini-muted)]">O‘quv markazi — shaxsiy kabinet</p>
          </header>
          <Panel>
            <h2 className="text-lg font-bold">{authLoading ? 'Telegram tekshirilmoqda…' : 'Telegram orqali kirish'}</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--mini-muted)]">
              {authLoading
                ? 'Xavfsiz ulanish bir necha soniya olishi mumkin.'
                : 'Ushbu ilovani Telegram ichidan oching. Akkauntingiz ulanmagan bo‘lsa, qabulxonadan ulash havolasini oling.'}
            </p>
            {error && <p role="alert" className="mini-error mt-4">{error}</p>}
            {!authLoading && (
              <ActionButton className="mt-4 w-full" onClick={() => window.location.reload()}>
                Qayta urinish
              </ActionButton>
            )}
          </Panel>
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
    <main
      className="miniapp min-h-[100svh] px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] text-[var(--mini-text)]"
      onTouchStart={(event) => { touchStartY.current = window.scrollY === 0 ? event.touches[0].clientY : null }}
      onTouchEnd={(event) => {
        const start = touchStartY.current
        touchStartY.current = null
        if (start !== null && event.changedTouches[0].clientY - start > 90 && window.scrollY === 0 && user) refresh(user)
      }}
    >
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
          <div className="flex items-center gap-2">
            <button type="button" className="mini-icon-button" onClick={() => refresh(user)} aria-label="Yangilash" title="Yangilash" disabled={loading}>
              <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
            </button>
            <button type="button" className="mini-icon-button" onClick={logout} aria-label="Chiqish" title="Chiqish">
              <LogOut size={17} />
            </button>
          </div>
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
              {student && (
                <>
                  <Panel>
                    <p className="text-sm text-[var(--mini-muted)]">So‘nggi to‘lovlar</p>
                    <p className="mt-2 text-2xl font-extrabold">{payments.slice(0, 3).reduce((sum, item) => sum + Number(item.amount || 0), 0).toLocaleString('uz-UZ')} so‘m</p>
                    <p className="mt-1 text-xs text-[var(--mini-muted)]">{payments.length} ta to‘lov · {payments.slice(0, 3).map((item) => `${item.month}.${item.year}`).join(', ') || 'Ma’lumot yo‘q'}</p>
                  </Panel>
                  <Panel>
                    <p className="text-sm text-[var(--mini-muted)]">Davomat</p>
                    <p className="mt-2 text-2xl font-extrabold">{attendance.length} ta qayd</p>
                    <p className="mt-1 text-xs text-[var(--mini-muted)]">So‘nggi 100 ta davomat qaydi</p>
                  </Panel>
                </>
              )}
              {role === 'owner' && (
                <Panel>
                  <p className="text-sm text-[var(--mini-muted)]">Shu oy moliyasi</p>
                  {financeSummary
                    ? <p className="mt-2 text-2xl font-extrabold">{Number(financeSummary.net || 0).toLocaleString('uz-UZ')} so‘m</p>
                    : <p className="mt-2 text-sm text-[var(--mini-muted)]">Hisobot yuklanmoqda…</p>}
                  <p className="mt-1 text-xs text-[var(--mini-muted)]">Tushum, ish haqi va xarajatlar</p>
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
                <form id="mini-submission-form" className="mt-4 grid gap-3" onSubmit={saveSubmission}>
                  <label className="mini-field"><span>Matnli javob</span><textarea rows="4" value={submissionForm.text} onChange={(event) => setSubmissionForm({ ...submissionForm, text: event.target.value })} /></label>
                  <label className="mini-field"><span>Rasm yoki PDF (10 MB gacha)</span><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => chooseSubmissionFile(event.target.files?.[0] || null)} /></label>
                  {submissionPreview && (
                    submissionForm.file?.type.startsWith('image/')
                      ? <img className="max-h-64 w-full rounded-2xl object-contain" src={submissionPreview} alt="Yuboriladigan rasm ko‘rinishi" />
                      : <a className="mini-link break-all" href={submissionPreview} target="_blank" rel="noreferrer">PDF ko‘rinishini ochish · {submissionForm.file?.name}</a>
                  )}
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

        {page === 'payments' && (
          <section className="mt-7">
            <h1 className="text-xl font-extrabold">{student ? 'Mening to‘lovlarim' : 'To‘lovlar'}</h1>
            <p className="mt-1 text-sm text-[var(--mini-muted)]">So‘nggi 100 ta to‘lov</p>
            <div className="mt-4 grid gap-3">
              {payments.map((item) => (
                <Panel key={item.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate font-bold">{item.student_name || 'O‘quvchi'}</h2>
                      <p className="mt-1 text-xs text-[var(--mini-muted)]">{formatDate(item.paid_at)} · {item.month}.{item.year}</p>
                    </div>
                    <strong className="shrink-0 text-sm">{Number(item.amount).toLocaleString('uz-UZ')} so‘m</strong>
                  </div>
                </Panel>
              ))}
              {!payments.length && !loading && <Panel>To‘lovlar topilmadi.</Panel>}
            </div>
          </section>
        )}

        {page === 'attendance' && (
          <section className="mt-7">
            <h1 className="text-xl font-extrabold">{student ? 'Mening davomatim' : 'Davomat'}</h1>
            {(teacher || privileged) && (
              <Panel className="mt-4">
                <h2 className="font-bold">Davomat belgilash</h2>
                <form className="mt-4 grid gap-3" onSubmit={saveAttendance}>
                  <label className="mini-field"><span>Guruh</span><select value={attendanceForm.groupId} onChange={(event) => setAttendanceForm({ ...attendanceForm, groupId: event.target.value })} required>
                    <option value="">Guruhni tanlang</option>
                    {groups.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select></label>
                  <label className="mini-field"><span>O‘quvchi</span><select value={attendanceForm.studentId} onChange={(event) => setAttendanceForm({ ...attendanceForm, studentId: event.target.value })} required>
                    <option value="">O‘quvchini tanlang</option>
                    {students.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select></label>
                  <label className="mini-field"><span>Holati</span><select value={attendanceForm.status} onChange={(event) => setAttendanceForm({ ...attendanceForm, status: event.target.value })}>
                    <option value="present">Keldi</option><option value="late">Kechikdi</option><option value="absent">Kelmagan</option>
                  </select></label>
                  <label className="mini-field"><span>Izoh</span><input value={attendanceForm.note} onChange={(event) => setAttendanceForm({ ...attendanceForm, note: event.target.value })} /></label>
                  <ActionButton type="submit" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'Davomatni saqlash'}</ActionButton>
                </form>
              </Panel>
            )}
            <div className="mt-4 grid gap-3">
              {attendance.map((item) => (
                <Panel key={item.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-bold">{student ? (item.groups?.name || 'Guruh') : (students.find((person) => person.id === item.student_id)?.name || 'O‘quvchi')}</h2>
                      <p className="mt-1 text-xs text-[var(--mini-muted)]">{formatDate(item.date)} · {item.groups?.name || 'Guruh'}</p>
                      {item.note && <p className="mt-2 text-sm">{item.note}</p>}
                    </div>
                    <span className="rounded-full bg-[var(--mini-bg)] px-3 py-1 text-xs">
                      {item.status === 'present' ? 'Keldi' : item.status === 'late' ? 'Kechikdi' : 'Kelmagan'}
                    </span>
                  </div>
                </Panel>
              ))}
              {!attendance.length && !loading && <Panel>Davomat yozuvlari topilmadi.</Panel>}
            </div>
          </section>
        )}

        {page === 'finance' && role === 'owner' && (
          <section className="mt-7 grid gap-4">
            <h1 className="text-xl font-extrabold">Moliyaviy hisobot</h1>
            <Panel>
              <p className="text-sm text-[var(--mini-muted)]">Joriy oy</p>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <p>Tushum <strong className="mt-1 block">{Number(financeSummary?.income || 0).toLocaleString('uz-UZ')} so‘m</strong></p>
                <p>Ish haqi <strong className="mt-1 block">{Number(financeSummary?.salary_cost || 0).toLocaleString('uz-UZ')} so‘m</strong></p>
                <p>Xarajat <strong className="mt-1 block">{Number(financeSummary?.expense_cost || 0).toLocaleString('uz-UZ')} so‘m</strong></p>
                <p>Qoldiq <strong className="mt-1 block">{Number(financeSummary?.net || 0).toLocaleString('uz-UZ')} so‘m</strong></p>
              </div>
            </Panel>
            <Panel>
              <h2 className="font-bold">O‘qituvchi ish haqini qayd etish</h2>
              <form className="mt-4 grid gap-3" onSubmit={saveSalaryPayment}>
                <label className="mini-field"><span>O‘qituvchi</span><select value={salaryForm.teacherId} onChange={(event) => setSalaryForm({ ...salaryForm, teacherId: event.target.value })} required>
                  <option value="">O‘qituvchini tanlang</option>
                  {teachers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select></label>
                <label className="mini-field"><span>Miqdor (so‘m)</span><input type="number" min="1" value={salaryForm.amount} onChange={(event) => setSalaryForm({ ...salaryForm, amount: event.target.value })} required /></label>
                <ActionButton type="submit" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'Ish haqini saqlash'}</ActionButton>
              </form>
              <div className="mt-2 divide-y divide-[var(--mini-border)]">
                {salaryPayments.map((item) => <p key={item.id} className="flex justify-between gap-3 py-3 text-sm"><span>{item.teachers?.name || 'O‘qituvchi'} · {formatDate(item.paid_at)}</span><strong className="shrink-0">{Number(item.amount).toLocaleString('uz-UZ')} so‘m</strong></p>)}
              </div>
            </Panel>
            <Panel>
              <h2 className="font-bold">Xarajat qo‘shish</h2>
              <form className="mt-4 grid gap-3" onSubmit={saveExpense}>
                <label className="mini-field"><span>Nomi</span><input value={expenseForm.title} onChange={(event) => setExpenseForm({ ...expenseForm, title: event.target.value })} required /></label>
                <label className="mini-field"><span>Miqdor (so‘m)</span><input type="number" min="1" value={expenseForm.amount} onChange={(event) => setExpenseForm({ ...expenseForm, amount: event.target.value })} required /></label>
                <ActionButton type="submit" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'Xarajatni saqlash'}</ActionButton>
              </form>
            </Panel>
            <Panel>
              <h2 className="font-bold">So‘nggi xarajatlar</h2>
              <div className="mt-2 divide-y divide-[var(--mini-border)]">
                {expenses.map((item) => <p key={item.id} className="flex justify-between gap-3 py-3 text-sm"><span>{item.title} · {formatDate(item.date)}</span><strong className="shrink-0">{Number(item.amount).toLocaleString('uz-UZ')} so‘m</strong></p>)}
                {!expenses.length && <p className="py-3 text-sm text-[var(--mini-muted)]">Xarajat topilmadi.</p>}
              </div>
            </Panel>
          </section>
        )}

        {page === 'management' && privileged && (
          <section className="mt-7 grid gap-4">
            <h1 className="text-xl font-extrabold">O‘quvchilar boshqaruvi</h1>
            <Panel>
              <h2 className="font-bold">Yangi o‘quvchi qo‘shish</h2>
              <form id="mini-student-form" className="mt-4 grid gap-3" onSubmit={saveStudent}>
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
                <ActionButton className="mt-3" onClick={() => copyText(`${credentials.username}\n${credentials.password}`)}>
                  <Copy size={15} /> {copied ? 'Nusxalandi' : 'Nusxalash'}
                </ActionButton>
                <ActionButton className="mini-secondary mt-3 w-full" disabled={busy} onClick={() => createInvite(credentials.profileId)}>
                  Telegram akkauntni ulash
                </ActionButton>
                {inviteLinks[credentials.profileId] && (
                  <a className="mini-link mt-3 block break-all" href={inviteLinks[credentials.profileId]} target="_blank" rel="noreferrer">
                    Ulash havolasini ochish
                  </a>
                )}
              </Panel>
            )}
            <Panel>
              <h2 className="font-bold">O‘quvchilar ro‘yxati</h2>
              <label className="mini-field mt-3">
                <span>Ism yoki telefon bo‘yicha qidirish</span>
                <input type="search" value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} />
              </label>
              <div className="mt-3 divide-y divide-[var(--mini-border)]">
                {students.filter((item) => `${item.name} ${item.phone}`.toLowerCase().includes(studentSearch.toLowerCase())).map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0"><p className="truncate text-sm font-semibold">{item.name}</p><p className="text-xs text-[var(--mini-muted)]">{item.phone || 'Telefon yo‘q'}</p></div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="rounded-full bg-[var(--mini-bg)] px-3 py-1 text-xs">{item.login || 'Login yo‘q'}</span>
                      {item.telegram_id
                        ? <span className="text-[11px] text-[var(--mini-muted)]">Telegram ulangan</span>
                        : <ActionButton className="mini-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => createInvite(item.profile_id)}>Ulash</ActionButton>}
                      {inviteLinks[item.profile_id] && (
                        <button className="mini-link max-w-36 truncate text-xs" type="button" onClick={() => copyText(inviteLinks[item.profile_id])}>
                          Havolani nusxalash
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {!students.length && <p className="py-4 text-sm text-[var(--mini-muted)]">O‘quvchilar topilmadi.</p>}
              </div>
            </Panel>
            <Panel>
              <h2 className="font-bold">O‘qituvchi qo‘shish</h2>
              <p className="mt-1 text-xs text-[var(--mini-muted)]">Akkaunt yaratiladi va Telegram ulash havolasi tayyorlanadi.</p>
              <form className="mt-4 grid gap-3" onSubmit={saveTeacher}>
                <label className="mini-field"><span>Ism va familiya</span><input value={teacherForm.name} onChange={(event) => setTeacherForm({ ...teacherForm, name: event.target.value })} required /></label>
                <label className="mini-field"><span>Telefon</span><input type="tel" value={teacherForm.phone} onChange={(event) => setTeacherForm({ ...teacherForm, phone: event.target.value })} /></label>
                <label className="mini-field"><span>Oylik maosh (so‘m)</span><input type="number" min="0" value={teacherForm.monthlySalary} onChange={(event) => setTeacherForm({ ...teacherForm, monthlySalary: event.target.value })} /></label>
                <ActionButton type="submit" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'O‘qituvchini qo‘shish'}</ActionButton>
              </form>
              <div className="mt-3 divide-y divide-[var(--mini-border)]">
                {teachers.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-2 py-3">
                    <div className="min-w-0"><p className="truncate text-sm font-semibold">{item.name}</p><p className="text-xs text-[var(--mini-muted)]">{item.phone || 'Telefon yo‘q'}</p></div>
                    {item.telegram_id
                      ? <span className="text-xs text-[var(--mini-muted)]">Telegram ulangan</span>
                      : item.profile_id && <ActionButton className="mini-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => createInvite(item.profile_id)}>Ulash</ActionButton>}
                  </div>
                ))}
              </div>
            </Panel>
            <Panel>
              <h2 className="font-bold">Guruh yaratish</h2>
              <form className="mt-4 grid gap-3" onSubmit={saveGroup}>
                <label className="mini-field"><span>Guruh nomi</span><input value={groupForm.name} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })} required /></label>
                <label className="mini-field"><span>O‘qituvchi</span>
                  <select value={groupForm.teacherId} onChange={(event) => setGroupForm({ ...groupForm, teacherId: event.target.value })}>
                    <option value="">Tanlanmagan</option>
                    {teachers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <label className="mini-field"><span>Oylik to‘lov (so‘m)</span><input type="number" min="0" value={groupForm.monthlyFee} onChange={(event) => setGroupForm({ ...groupForm, monthlyFee: event.target.value })} /></label>
                <p className="text-xs font-semibold text-[var(--mini-muted)]">Dars vaqti — ixtiyoriy</p>
                <div className="grid grid-cols-3 gap-2">
                  <label className="mini-field"><span>Hafta kuni</span><select value={groupForm.day} onChange={(event) => setGroupForm({ ...groupForm, day: event.target.value })}>
                    {['Dush.', 'Sesh.', 'Chor.', 'Pay.', 'Juma', 'Shan.', 'Yak.'].map((day, index) => <option key={day} value={index}>{day}</option>)}
                  </select></label>
                  <label className="mini-field"><span>Boshlanish</span><input type="time" value={groupForm.startTime} onChange={(event) => setGroupForm({ ...groupForm, startTime: event.target.value })} /></label>
                  <label className="mini-field"><span>Tugash</span><input type="time" value={groupForm.endTime} onChange={(event) => setGroupForm({ ...groupForm, endTime: event.target.value })} /></label>
                </div>
                <ActionButton type="submit" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'Guruhni yaratish'}</ActionButton>
              </form>
              <div className="mt-3 divide-y divide-[var(--mini-border)]">
                {groups.map((item) => <p key={item.id} className="py-2 text-sm">{item.name}</p>)}
              </div>
            </Panel>
            <Panel>
              <h2 className="font-bold">To‘lov qayd etish</h2>
              <form className="mt-4 grid gap-3" onSubmit={savePayment}>
                <label className="mini-field"><span>O‘quvchi</span><select value={paymentForm.studentId} onChange={(event) => setPaymentForm({ ...paymentForm, studentId: event.target.value })} required>
                  <option value="">O‘quvchini tanlang</option>
                  {students.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select></label>
                <label className="mini-field"><span>Miqdor (so‘m)</span><input type="number" min="1" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} required /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="mini-field"><span>Oy</span><select value={paymentForm.month} onChange={(event) => setPaymentForm({ ...paymentForm, month: event.target.value })}>
                    {monthLabels.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
                  </select></label>
                  <label className="mini-field"><span>Yil</span><input type="number" min="2000" value={paymentForm.year} onChange={(event) => setPaymentForm({ ...paymentForm, year: event.target.value })} required /></label>
                </div>
                <ActionButton type="submit" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'To‘lovni saqlash'}</ActionButton>
              </form>
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
