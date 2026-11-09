import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Bell,
  BookOpen,
  CalendarDays,
  CalendarCheck,
  Check,
  ClipboardCheck,
  CreditCard,
  Ellipsis,
  GraduationCap,
  Home,
  LogOut,
  Mic,
  MessageCircle,
  Plus,
  RefreshCw,
  Square,
  UserRound,
  UserCog,
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
  staff as staffData,
  students as studentData,
  teachers as teacherData,
  telegram,
} from '../lib/data/index.js'
import { Avatar, Button as UiButton, Card as UiCard, ConfirmDialog, EmptyState, Skeleton, Toast } from './ui.jsx'
import { parseParentPhones } from '../lib/phone.js'
import { loginBaseFromName } from '../../shared/account-credentials.js'
import { getEffectiveLesson, normalizeScheduleWeekdays } from '../../shared/schedule.js'
import { canAccessEndpoint, canAccessPage } from '../../shared/role-permissions.js'
import {
  closeQuestionTicket,
  createQuestionTicket,
  declareHomeworkResult,
  fetchHomeworkBotLink,
  fetchHomeworkFileBlob,
  loadHomeworkHistory,
  loadScheduleNotifications,
  loadStudentMiniAppOverview,
  listQuestionTickets,
  replyQuestionTicket,
  uploadHomeworkDraftProof,
} from './api.js'
import ScheduleChangeSheet from './ScheduleChangeSheet.jsx'

const roleLabels = {
  student: 'O‘quvchi',
  teacher: 'O‘qituvchi',
  reception: 'Qabulxona',
  owner: 'Egasi',
}

const monthLabels = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr',
]

const homeworkEventLabels = {
  draft_created: 'Qoralama yaratildi',
  file_added: 'Fayl yoki matn qo‘shildi',
  proof_added: 'Tasdiq yozuvi qo‘shildi',
  submitted: 'Yuborildi',
  student_done: 'O‘quvchi “Bajardim” deb belgiladi',
  student_not_done: 'O‘quvchi “Bajarolmadim” deb belgiladi',
  teacher_done: 'O‘qituvchi “Bajardi” deb baholadi',
  teacher_not_done: 'O‘qituvchi “Bajarmadi” deb baholadi',
  comment: 'Izoh qo‘shildi',
  resubmitted: 'Qayta topshirish boshlandi',
  expired: 'Qoralama muddati tugadi',
}

const roleNavItems = {
  student: [
    { id: 'dashboard', label: 'Bosh sahifa', icon: Home },
    { id: 'homework', label: 'Vazifalar', icon: ClipboardCheck },
    { id: 'attendance', label: 'Jadval', icon: CalendarDays },
    { id: 'questions', label: 'Savol', icon: MessageCircle },
    { id: 'profile', label: 'Profil', icon: UserRound },
  ],
  teacher: [
    { id: 'dashboard', label: 'Bosh sahifa', icon: Home },
    { id: 'groups', label: 'Guruhlar', icon: Users },
    { id: 'homework', label: 'Vazifalar', icon: ClipboardCheck },
    { id: 'attendance', label: 'Davomat', icon: CalendarCheck },
    { id: 'profile', label: 'Profil', icon: UserRound },
  ],
  reception: [
    { id: 'dashboard', label: 'Bosh sahifa', icon: Home },
    { id: 'management', label: 'O‘quvchilar', icon: GraduationCap },
    { id: 'groups', label: 'Guruhlar', icon: Users },
    { id: 'payments', label: 'To‘lovlar', icon: CreditCard },
    { id: 'questions', label: 'Savollar', icon: MessageCircle },
  ],
  owner: [
    { id: 'dashboard', label: 'Bosh sahifa', icon: Home },
    { id: 'management', label: 'O‘quvchilar', icon: GraduationCap },
    { id: 'groups', label: 'Guruhlar', icon: Users },
    { id: 'staff', label: 'Xodimlar', icon: UserCog },
    { id: 'finance', label: 'Moliya', icon: Wallet },
  ],
}

const pageTitles = {
  dashboard: 'Bosh sahifa',
  homework: 'Vazifalar',
  payments: 'To‘lovlar',
  attendance: 'Davomat',
  management: 'O‘quvchilar',
  groups: 'Guruhlar',
  staff: 'Xodimlar',
  reports: 'Hisobotlar',
  finance: 'Moliya',
  questions: 'Savollar',
  detail: 'Vazifa tafsilotlari',
  profile: 'Profil',
  settings: 'Sozlamalar',
  notifications: 'Bildirishnomalar',
}

function isStaff(role) {
  return canAccessPage(role, 'students') && canAccessPage(role, 'groups')
}

function formatDeadline(value) {
  if (!value) return 'Muddat belgilanmagan'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('uz-UZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tashkent',
  }).format(date)
}

function formatCountdown(value, now) {
  if (!value) return 'Muddat belgilanmagan'
  const remaining = new Date(value).getTime() - now
  if (!Number.isFinite(remaining)) return formatDeadline(value)
  if (remaining <= 0) return `Muddat o‘tgan · ${formatDeadline(value)}`
  const minutes = Math.floor(remaining / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60
  const countdown = days ? `${days} kun ${hours} soat` : hours ? `${hours} soat ${rest} daqiqa` : `${Math.max(1, rest)} daqiqa`
  return `${formatDeadline(value)} · ${countdown} qoldi`
}

function isExecutableFile(file) {
  return /\.(exe|msi|bat|cmd|com|scr|ps1|sh|js|jar|apk|dll|so|dylib|bin|elf|vbs|vbe|wsf|hta|html?|svg)$/i.test(file.original_name || '')
    || /(?:executable|x-msdownload|javascript|text\/html|image\/svg\+xml)/i.test(file.mime_type || '')
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

function addIsoDays(value, days) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function displayIsoDate(value) {
  if (!value) return '—'
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}.${month}.${year}`
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
  return <UiCard className={className}>{children}</UiCard>
}

function SubmissionFile({ file }) {
  const [objectUrl, setObjectUrl] = useState('')
  const [fileError, setFileError] = useState('')
  const proof = file.kind === 'voice' || file.kind === 'video_note'
  useEffect(() => {
    if (!proof) return undefined
    let active = true
    let loadedUrl = ''
    fetchHomeworkFileBlob(file).then((url) => {
      loadedUrl = url
      if (active) setObjectUrl(url)
      else URL.revokeObjectURL(url)
    }).catch((error) => {
      if (active) setFileError(error.message || 'Media yuklanmadi.')
    })
    return () => {
      active = false
      if (loadedUrl) URL.revokeObjectURL(loadedUrl)
    }
  }, [file, proof])
  const download = async () => {
    try {
      const url = await fetchHomeworkFileBlob({ ...file, kind: 'attachment' })
      const link = document.createElement('a')
      link.href = url
      link.download = file.original_name || 'homework-file'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      setFileError(error.message || 'Faylni yuklab bo‘lmadi.')
    }
  }
  return (
    <div className="mt-3 grid gap-2">
      {proof ? file.kind === 'voice'
        ? objectUrl ? <audio controls src={objectUrl} className="w-full" /> : <p className="text-xs text-[var(--mini-muted)]">Ovoz yuklanmoqda…</p>
        : objectUrl ? <video controls playsInline src={objectUrl} className="max-h-64 w-full rounded-xl" /> : <p className="text-xs text-[var(--mini-muted)]">Video yuklanmoqda…</p>
        : <button type="button" className="mini-link break-all text-left" onClick={download}>{file.original_name || 'Fayl'} · yuklab olish</button>}
      {fileError && <p role="alert" className="text-xs text-rose-300">{fileError}</p>}
    </div>
  )
}

function ActionButton({ children, className = '', ...props }) {
  return (
    <UiButton className={className} {...props}>
      {children}
    </UiButton>
  )
}

function TaskCard({ task, teacher, now, onClick }) {
  const submissions = task.submissions || []
  const status = task.submission?.status
  const isPastDue = task.due_at && new Date(task.due_at).getTime() < now
  const statusText = task.submission?.state === 'draft'
    ? 'Qoralama · tasdiq yozuvi kutilmoqda'
    : task.submission?.state === 'expired' && isPastDue ? 'Topshirilmadi'
      : task.submission?.state === 'expired' ? 'Qoralama muddati tugagan'
    : status === 'approved' ? 'Bajardi' : status === 'rejected' ? 'Qayta topshirish kerak'
      : status === 'pending' ? 'Tekshirilmoqda' : isPastDue ? 'Topshirilmadi' : 'Yangi'

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
        <span className="text-[var(--mini-muted)]">{formatCountdown(task.due_at, now)}</span>
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
  const [homeworkHistory, setHomeworkHistory] = useState({ events: [], submissions: [] })
  const [groups, setGroups] = useState([])
  const [studentGroups, setStudentGroups] = useState([])
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
  const [studentPage, setStudentPage] = useState(0)
  const [paymentSearch, setPaymentSearch] = useState('')
  const [paymentPage, setPaymentPage] = useState(0)
  const [moreOpen, setMoreOpen] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [telegramLoginRequired, setTelegramLoginRequired] = useState(false)
  const [telegramLoginForm, setTelegramLoginForm] = useState({ username: '', password: '' })
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [createForm, setCreateForm] = useState({ groupId: '', title: '', description: '', deadline: '', file: null })
  const [submissionForm, setSubmissionForm] = useState({ text: '', files: [] })
  const [recording, setRecording] = useState(false)
  const [recordedProof, setRecordedProof] = useState(null)
  const [recordedProofDuration, setRecordedProofDuration] = useState(0)
  const [submissionBotLink, setSubmissionBotLink] = useState('')
  const [studentForm, setStudentForm] = useState({ name: '', phone: '', fatherPhone: '', motherPhone: '', groupId: '', username: '', password: '', autoUsername: true })
  const [editingStudentId, setEditingStudentId] = useState(null)
  const [studentPasswordForm, setStudentPasswordForm] = useState({ studentId: '', username: '', password: '' })
  const [revealedStudentPasswords, setRevealedStudentPasswords] = useState({})
  const studentPasswordTimers = useRef({})
  const [staffRows, setStaffRows] = useState([])
  const [staffForm, setStaffForm] = useState({ name: '', phone: '', role: 'reception', username: '', password: '' })
  const [editingStaffId, setEditingStaffId] = useState(null)
  const [staffUsernameAuto, setStaffUsernameAuto] = useState(true)
  const [teacherForm, setTeacherForm] = useState({ name: '', phone: '', monthlySalary: '', username: '', password: '', autoUsername: true })
  const [editingTeacherId, setEditingTeacherId] = useState(null)
  const [groupForm, setGroupForm] = useState({ name: '', teacherId: '', monthlyFee: '', schedule: [{ day: '1', startTime: '', endTime: '' }], scheduleReason: '' })
  const [editingGroupId, setEditingGroupId] = useState(null)
  const [paymentForm, setPaymentForm] = useState({ studentId: '', amount: '', month: String(new Date().getMonth() + 1), year: String(new Date().getFullYear()) })
  const [attendanceForm, setAttendanceForm] = useState({ studentId: '', groupId: '', status: 'present', note: '' })
  const [expenseForm, setExpenseForm] = useState({ title: '', amount: '', category: 'Operatsion' })
  const [salaryForm, setSalaryForm] = useState({ teacherId: '', amount: '' })
  const [inviteLinks, setInviteLinks] = useState({})
  const [feedbacks, setFeedbacks] = useState({})
  const [reviewStatusFilter, setReviewStatusFilter] = useState('all')
  const [reviewStudentFilter, setReviewStudentFilter] = useState('')
  const [questionTickets, setQuestionTickets] = useState([])
  const [scheduleNotifications, setScheduleNotifications] = useState([])
  const [readScheduleNotificationIds, setReadScheduleNotificationIds] = useState([])
  const [scheduleChangeGroup, setScheduleChangeGroup] = useState(null)
  const [questionStatus, setQuestionStatus] = useState('')
  const [questionSearch, setQuestionSearch] = useState('')
  const [questionText, setQuestionText] = useState('')
  const [questionFile, setQuestionFile] = useState(null)
  const [questionReply, setQuestionReply] = useState({})
  const [copied, setCopied] = useState(false)
  const touchStartY = useRef(null)
  const pageHistory = useRef([])
  const reviewLinkHandled = useRef(false)
  const mediaRecorder = useRef(null)
  const recordingStream = useRef(null)
  const recordingStartedAt = useRef(0)
  const recordingChunks = useRef([])

  const role = user?.role
  const teacher = role === 'teacher'
  const student = role === 'student'
  const privileged = isStaff(role)
  const selectedHomework = homeworks.find((item) => item.id === selectedId) || null
  const selectedHomeworkHasProof = selectedHomework?.submission?.files?.some((file) => ['voice', 'video_note'].includes(file.kind)) || false
  const selectedHomeworkSubmissionLocked = selectedHomework?.submission?.state === 'submitted'
    || (selectedHomework?.submission?.state === 'checked' && selectedHomework.submission.teacher_result === 'done')
  const filteredReviewSubmissions = (selectedHomework?.submissions || []).filter((submission) => {
    const matchesStatus = reviewStatusFilter === 'all'
      || (reviewStatusFilter === 'pending' && submission.state === 'submitted')
      || (reviewStatusFilter === 'done' && submission.teacher_result === 'done')
      || (reviewStatusFilter === 'not_done' && submission.teacher_result === 'not_done')
    const studentName = submission.student_name || submission.students?.name || ''
    return matchesStatus && studentName.toLowerCase().includes(reviewStudentFilter.trim().toLowerCase())
  })
  const monthStart = new Date(`${tashkentDateRange().from}T00:00:00+05:00`)
  const thisMonthSubmissions = homeworks.filter((task) => (
    task.submission?.submitted_at && new Date(task.submission.submitted_at) >= monthStart
  ))
  const scheduleGroups = student ? studentGroups : groups
  const scheduleToday = tashkentDateRange().to
  const scheduleEntries = scheduleGroups.flatMap((group) => Array.from({ length: 14 }, (_, offset) => (
    getEffectiveLesson(group.id, addIsoDays(scheduleToday, offset), {
      group,
      versions: group.scheduleVersions || [],
      overrides: group.scheduleOverrides || [],
    }).map((slot) => ({ ...slot, groupId: group.id, groupName: group.name }))
  )).flat())
  const [currentHour, currentMinute] = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Tashkent',
  }).format(new Date()).split(':').map(Number)
  const currentMinutes = currentHour * 60 + currentMinute
  const nextLesson = scheduleEntries
    .filter((item) => !['cancelled', 'rescheduled'].includes(item.status))
    .map((item) => {
      const [hour, minute] = String(item.startTime || '00:00').split(':').map(Number)
      const startMinutes = hour * 60 + minute
      const dayDistance = Math.round((new Date(`${item.date}T12:00:00Z`).getTime()
        - new Date(`${scheduleToday}T12:00:00Z`).getTime()) / 86_400_000)
      return { ...item, dayDistance, startMinutes }
    })
    .filter((item) => item.dayDistance > 0 || item.startMinutes >= currentMinutes)
    .sort((left, right) => left.dayDistance - right.dayDistance || left.startMinutes - right.startMinutes)[0]
  const [currentYear, currentMonth] = tashkentDateRange().to.slice(0, 7).split('-').map(Number)
  const currentMonthPayments = payments.filter((item) => Number(item.month) === currentMonth && Number(item.year) === currentYear)
  const debtorCount = students.filter((person) => Number(person.monthly_fee || 0) > 0
    && !currentMonthPayments.some((payment) => payment.student_id === person.id)).length
  const todayLessonCount = scheduleEntries.filter((lesson) => lesson.date === scheduleToday
    && !['cancelled', 'rescheduled'].includes(lesson.status)).length
  const filteredStudents = students.filter((item) => `${item.name} ${item.phone} ${item.login || ''}`.toLowerCase().includes(studentSearch.toLowerCase()))
  const visibleStudents = filteredStudents.slice(studentPage * 20, (studentPage + 1) * 20)
  const filteredPayments = payments.filter((item) => `${item.student_name || ''} ${item.amount || ''} ${item.month || ''}.${item.year || ''}`.toLowerCase().includes(paymentSearch.toLowerCase()))
  const visiblePayments = filteredPayments.slice(paymentPage * 20, (paymentPage + 1) * 20)
  const notificationCount = student
    ? homeworks.filter((task) => !task.submission).length
    : teacher
      ? homeworks.reduce((sum, task) => sum + (task.submissions || []).filter((item) => item.status === 'pending').length, 0)
      : questionTickets.reduce((sum, ticket) => sum + Number(ticket.unread_count || 0), 0)
  const unreadScheduleCount = scheduleNotifications.filter((item) => !readScheduleNotificationIds.includes(item.id)).length
  const goBack = useCallback(() => {
    const previousPage = pageHistory.current.pop()
    setPage(previousPage || (page === 'detail' ? 'homework' : 'dashboard'))
    setMoreOpen(false)
  }, [page])

  const refresh = useCallback(async (profile) => {
    if (!profile) return
    setLoading(true)
    setError('')
    setRevealedStudentPasswords({})
    Object.values(studentPasswordTimers.current).forEach((timer) => window.clearTimeout(timer))
    studentPasswordTimers.current = {}
    try {
      let tasks
      let paymentRows
      let attendanceRows
      if (profile.role === 'student') {
        const overview = await loadStudentMiniAppOverview()
        tasks = overview.homeworks
        paymentRows = overview.payments
        attendanceRows = overview.attendance
        setStudentGroups(overview.groups || [])
      } else {
        tasks = await homeworkData.list(profile)
        const staffDataRows = await Promise.all([
          paymentData.list(profile),
          attendanceData.list(profile),
        ])
        paymentRows = staffDataRows[0]
        attendanceRows = staffDataRows[1]
      }
      setHomeworks(tasks)
      setPayments(paymentRows)
      setAttendance(attendanceRows)
      setScheduleNotifications(await loadScheduleNotifications())
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
        setStaffRows(await staffData.list())
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
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => () => {
    if (mediaRecorder.current) {
      mediaRecorder.current.onstop = null
      if (mediaRecorder.current.state !== 'inactive') mediaRecorder.current.stop()
    }
    recordingStream.current?.getTracks().forEach((track) => track.stop())
  }, [])

  useEffect(() => () => {
    Object.values(studentPasswordTimers.current).forEach((timer) => window.clearTimeout(timer))
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
          if (active) {
            setTelegramLoginRequired(result.error.code === 'TELEGRAM_NOT_LINKED')
            setError(result.error.code === 'TELEGRAM_NOT_LINKED'
              ? 'Telegram akkauntingiz ulanmagan. Login va parol bilan kiring.'
              : result.error.message)
          }
          return
        }
        const profile = result.data.user
        const nextProfile = { ...profile, teacherId: profile.teacher_id, mustResetPassword: Boolean(profile.must_reset_password) }
        if (active) {
          setUser(nextProfile)
          try {
            setReadScheduleNotificationIds(JSON.parse(localStorage.getItem(`kamol-mini-schedule-read-${nextProfile.id}`) || '[]'))
          } catch {
            setReadScheduleNotificationIds([])
          }
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

  async function loginWithTelegramPassword(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await auth.signInWithTelegramCredentials(telegramLoginForm)
      if (result.error) throw result.error
      const profile = result.data.user
      const nextProfile = { ...profile, teacherId: profile.teacher_id, mustResetPassword: Boolean(profile.must_reset_password) }
      setTelegramLoginRequired(false)
      setTelegramLoginForm({ username: '', password: '' })
      setUser(nextProfile)
      await refresh(nextProfile)
    } catch (loginError) {
      setError(loginError.message || 'Login yoki parol noto‘g‘ri.')
    } finally {
      setBusy(false)
    }
  }

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
    if (!teacher || !homeworks.length || reviewLinkHandled.current) return
    const reviewId = new URLSearchParams(window.location.search).get('review')
    if (!reviewId) return
    const task = homeworks.find((item) => item.submissions?.some((submission) => submission.id === reviewId))
    if (!task) return
    queueMicrotask(() => {
      reviewLinkHandled.current = true
      setSelectedId(task.id)
      setPage('detail')
      const url = new URL(window.location.href)
      url.searchParams.delete('review')
      window.history.replaceState({}, '', url)
    })
  }, [teacher, homeworks])

  useEffect(() => {
    if (page !== 'detail' || !selectedHomework || !user) return
    let active = true
    loadHomeworkHistory(selectedHomework.id).then((history) => {
      if (active) setHomeworkHistory(history)
    }).catch((historyError) => {
      if (active) setError(historyError.message || 'Vazifa tarixini yuklab bo‘lmadi.')
    })
    return () => { active = false }
  }, [page, selectedHomework, user])

  useEffect(() => {
    const app = window.Telegram?.WebApp
    if (!app || !app.isVersionAtLeast?.('6.1')) return undefined
    const onBack = () => goBack()
    const formId = page === 'management'
      ? editingGroupId ? 'mini-group-form' : editingTeacherId ? 'mini-teacher-form' : 'mini-student-form'
      : page === 'homework' && teacher && selectedId === 'new'
        ? 'mini-homework-form'
        : page === 'questions' && student
          ? 'mini-question-form'
          : page === 'attendance' && (teacher || privileged)
            ? 'mini-attendance-form'
      : page === 'detail' && student && selectedHomework
        && !selectedHomeworkSubmissionLocked
        ? 'mini-submission-form'
        : null
    const onMainClick = () => document.getElementById(formId)?.requestSubmit()
    if (page === 'dashboard') app.BackButton?.hide()
    else {
      app.BackButton?.show()
      app.BackButton?.onClick(onBack)
    }

    if (formId) {
      const mainButtonText = page === 'management'
        ? editingGroupId ? 'Guruhni saqlash' : editingTeacherId ? 'O‘qituvchini saqlash' : editingStudentId ? 'O‘quvchini saqlash' : 'O‘quvchini yaratish'
        : page === 'homework' ? 'Vazifani yuborish'
          : page === 'questions' ? 'Savol yuborish'
            : page === 'attendance' ? 'Davomatni saqlash'
              : 'Vazifani topshirish'
      app.MainButton?.setText(mainButtonText)
      app.MainButton?.show()
      if (busy) app.MainButton?.showProgress?.()
      else {
        app.MainButton?.hideProgress?.()
        app.MainButton?.enable?.()
      }
      app.MainButton?.onClick(onMainClick)
    } else app.MainButton?.hide()

    return () => {
      app.BackButton?.offClick(onBack)
      app.MainButton?.offClick(onMainClick)
      app.MainButton?.hide()
    }
  }, [page, student, selectedHomework, selectedHomeworkSubmissionLocked, editingStudentId, editingTeacherId, editingGroupId, teacher, privileged, selectedId, goBack, busy])

  useEffect(() => {
    if (!user) return undefined
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh(user)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh, user])

  const visibleNav = roleNavItems[role] || []

  const refreshQuestions = useCallback(async () => {
    try {
      setError('')
      const onDashboard = page === 'dashboard'
      setQuestionTickets(await listQuestionTickets(onDashboard ? 'open' : questionStatus, onDashboard ? '' : questionSearch))
    } catch (loadError) {
      setError(loadError.message || 'Savollarni yuklab bo‘lmadi.')
    }
  }, [page, questionStatus, questionSearch])

  useEffect(() => {
    if ((page === 'questions' || (page === 'dashboard' && privileged)) && user) queueMicrotask(() => refreshQuestions())
  }, [page, user, privileged, refreshQuestions])

  async function logout() {
    await auth.signOut()
    setUser(null)
    setHomeworks([])
    setStudentGroups([])
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
      const draft = await homeworkData.submit(user, selectedHomework, submissionForm)
      if (recordedProof) {
        await uploadHomeworkDraftProof(draft.id, recordedProof, recordedProofDuration)
        setRecordedProof(null)
        setRecordedProofDuration(0)
      }
      setSubmissionBotLink(await fetchHomeworkBotLink(selectedHomework.id))
      setSubmissionForm({ text: '', files: [] })
      setNotice(recordedProof
        ? 'Qoralama va ovozli tasdiq yozuvi saqlandi. Bot orqali “Yuborish”ni tasdiqlang.'
        : 'Qoralama saqlandi. Dumaloq video yoki ovozli xabar yuborib, bot orqali “Yuborish”ni tasdiqlang.')
      await refresh(user)
    } catch (submitError) {
      setError(submitError.message || 'Vazifani topshirib bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  function chooseSubmissionFiles(files) {
    setError('')
    const selectedFiles = [...(files || [])]
    if (selectedFiles.some((file) => file.size <= 0 || file.size > 100 * 1024 * 1024)) {
      setError('Har bir fayl 100 MB dan oshmasligi kerak.')
      return
    }
    setSubmissionForm((current) => ({ ...current, files: selectedFiles }))
  }

  async function toggleVoiceRecording() {
    if (mediaRecorder.current?.state === 'recording') {
      mediaRecorder.current.stop()
      setRecording(false)
      return
    }
    if (typeof window.MediaRecorder !== 'function' || !navigator.mediaDevices?.getUserMedia) {
      setError('Bu qurilmada ilova ichida ovoz yozib bo‘lmaydi. Telegram bot orqali tasdiq yozuvini yuboring.')
      return
    }
    try {
      setError('')
      setRecordedProof(null)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new window.MediaRecorder(stream)
      recordingStream.current = stream
      recordingChunks.current = []
      recordingStartedAt.current = Date.now()
      recorder.ondataavailable = (event) => {
        if (event.data.size) recordingChunks.current.push(event.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        recordingStream.current = null
        mediaRecorder.current = null
        const duration = Math.floor((Date.now() - recordingStartedAt.current) / 1000)
        if (duration < 3) {
          setError('Ovozli tasdiq yozuvi kamida 3 soniya bo‘lishi kerak.')
          return
        }
        setRecordedProof(new Blob(recordingChunks.current, { type: recorder.mimeType || 'audio/webm' }))
        setRecordedProofDuration(duration)
        setNotice(`Ovozli tasdiq yozildi (${duration} soniya). Qoralamani saqlang.`)
      }
      mediaRecorder.current = recorder
      recorder.start()
      setRecording(true)
    } catch (recordError) {
      recordingStream.current?.getTracks().forEach((track) => track.stop())
      recordingStream.current = null
      setError(recordError.message || 'Mikrofonga ruxsat berilmadi. Telegram bot orqali tasdiq yozuvini yuboring.')
    }
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

  async function markStudentResult(submissionId, result) {
    setBusy(true)
    setError('')
    try {
      await declareHomeworkResult(submissionId, result)
      setNotice(result === 'done' ? '“Bajardim” belgisi saqlandi.' : '“Bajarolmadim” belgisi saqlandi.')
      await refresh(user)
    } catch (declarationError) {
      setError(declarationError.message || 'Natijani saqlab bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  async function sendQuestion(event) {
    event.preventDefault()
    if (!questionText.trim()) return
    setBusy(true)
    setError('')
    try {
      await createQuestionTicket(questionText.trim(), '', questionFile)
      setQuestionText('')
      setQuestionFile(null)
      setNotice('Savolingiz yuborildi. Javob Mini App va Telegram botga keladi.')
      await refreshQuestions()
    } catch (questionError) {
      setError(questionError.message || 'Savol yuborilmadi.')
    } finally {
      setBusy(false)
    }
  }

  async function sendQuestionReply(ticket) {
    const text = String(questionReply[ticket.id] || '').trim()
    if (!text) return
    setBusy(true)
    setError('')
    try {
      await replyQuestionTicket(ticket.id, text)
      setQuestionReply((current) => ({ ...current, [ticket.id]: '' }))
      setNotice('Javob o‘quvchiga yuborildi.')
      await refreshQuestions()
    } catch (replyError) {
      setError(replyError.message || 'Javob yuborilmadi.')
    } finally {
      setBusy(false)
    }
  }

  async function closeQuestion(ticket) {
    setBusy(true)
    setError('')
    try {
      await closeQuestionTicket(ticket.id)
      setNotice('Savol yopildi.')
      await refreshQuestions()
    } catch (closeError) {
      setError(closeError.message || 'Savolni yopib bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  async function saveStudent(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (editingStudentId) {
        await studentData.update(editingStudentId, {
          name: studentForm.name,
          phone: studentForm.phone,
          username: studentForm.username,
          fatherPhone: studentForm.fatherPhone,
          motherPhone: studentForm.motherPhone,
        })
        setEditingStudentId(null)
        setNotice('O‘quvchi ma’lumotlari yangilandi.')
      } else {
        await studentData.create({
          name: studentForm.name,
          phone: studentForm.phone,
          username: studentForm.username || loginBaseFromName(studentForm.name),
          autoUsername: studentForm.autoUsername,
          password: studentForm.password,
          fatherPhone: studentForm.fatherPhone,
          motherPhone: studentForm.motherPhone,
          groupIds: studentForm.groupId ? [studentForm.groupId] : [],
        })
        setInviteLinks({})
        setNotice('O‘quvchi Mini App akkaunti yaratildi.')
      }
      setStudentForm({ name: '', phone: '', fatherPhone: '', motherPhone: '', groupId: '', username: '', password: '', autoUsername: true })
      await refresh(user)
    } catch (createError) {
      setError(createError.message || 'O‘quvchini yaratib bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  async function revealStudentPassword(item) {
    try {
      const password = await studentData.revealPassword(item.id)
      setRevealedStudentPasswords((current) => ({ ...current, [item.id]: password }))
      if (studentPasswordTimers.current[item.id]) window.clearTimeout(studentPasswordTimers.current[item.id])
      studentPasswordTimers.current[item.id] = window.setTimeout(() => {
        setRevealedStudentPasswords((current) => {
          const next = { ...current }
          delete next[item.id]
          return next
        })
      }, 8000)
    } catch (revealError) {
      setError(revealError.message || 'Parolni ko‘rsatib bo‘lmadi.')
    }
  }

  async function changeStudentCredentials(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await studentData.changePassword(studentPasswordForm.studentId, studentPasswordForm.password, studentPasswordForm.username)
      setStudentPasswordForm({ studentId: '', username: '', password: '' })
      setNotice('O‘quvchi login va paroli yangilandi.')
      await refresh(user)
    } catch (passwordError) {
      setError(passwordError.message || 'Parolni o‘zgartirib bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  async function unlinkStudent(item) {
    setBusy(true)
    setError('')
    try {
      await studentData.unlinkTelegram(item.id)
      setNotice('Telegram akkaunti uzildi.')
      await refresh(user)
    } catch (unlinkError) {
      setError(unlinkError.message || 'Telegram akkauntini uzib bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  function confirmUnlinkStudent(item) {
    setConfirmDialog({
      title: 'Telegram akkauntini uzish',
      description: `${item.name} o‘quvchisining Telegram akkauntini uzmoqchimisiz?`,
      onConfirm: () => unlinkStudent(item),
    })
  }

  async function saveTeacher(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (editingTeacherId) {
        const account = staffRows.find((item) => item.teacher_id === editingTeacherId)
        if (account) {
          await staffData.update(account.id, {
            name: teacherForm.name,
            phone: teacherForm.phone,
            role: 'teacher',
            username: teacherForm.username,
            ...(teacherForm.password ? { password: teacherForm.password } : {}),
            monthly_salary: Number(teacherForm.monthlySalary || 0),
          })
        } else {
          if (teacherForm.password.length < 12) throw new Error('Xodim paroli kamida 12 belgidan iborat bo‘lishi kerak.')
          await staffData.create({
            name: teacherForm.name,
            phone: teacherForm.phone,
            role: 'teacher',
            teacher_id: editingTeacherId,
            username: teacherForm.username,
            auto_username: teacherForm.autoUsername,
            password: teacherForm.password,
            monthly_salary: Number(teacherForm.monthlySalary || 0),
          })
        }
        setEditingTeacherId(null)
      } else {
        if (teacherForm.password.length < 12) throw new Error('Xodim paroli kamida 12 belgidan iborat bo‘lishi kerak.')
        await staffData.create({
          name: teacherForm.name,
          phone: teacherForm.phone,
          role: 'teacher',
          username: teacherForm.username,
          auto_username: teacherForm.autoUsername,
          password: teacherForm.password,
          monthly_salary: Number(teacherForm.monthlySalary || 0),
        })
      }
      setTeacherForm({ name: '', phone: '', monthlySalary: '', username: '', password: '', autoUsername: true })
      setStaffRows(await staffData.list())
      await refresh(user)
      setNotice(editingTeacherId ? 'O‘qituvchi ma’lumotlari yangilandi.' : 'O‘qituvchi akkaunti yaratildi.')
    } catch (createError) {
      setError(createError.message || 'O‘qituvchini qo‘shib bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  async function saveStaff(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (editingStaffId) {
        await staffData.update(editingStaffId, {
          name: staffForm.name,
          phone: staffForm.phone,
          username: staffForm.username,
          role: staffForm.role,
          ...(staffForm.password ? { password: staffForm.password } : {}),
        })
      } else {
        if (staffForm.password.length < 12) throw new Error('Xodim paroli kamida 12 belgidan iborat bo‘lishi kerak.')
        await staffData.create({
          ...staffForm,
          auto_username: staffUsernameAuto,
        })
      }
      setStaffForm({ name: '', phone: '', role: 'reception', username: '', password: '' })
      setStaffUsernameAuto(true)
      setEditingStaffId(null)
      setStaffRows(await staffData.list())
      setNotice('Xodim akkaunti saqlandi.')
    } catch (staffError) {
      setError(staffError.message || 'Xodim akkauntini saqlab bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  async function toggleStaffActive(item) {
    setBusy(true)
    setError('')
    try {
      await staffData.update(item.id, { is_active: !item.is_active })
      setStaffRows(await staffData.list())
    } catch (staffError) {
      setError(staffError.message || 'Xodim holatini o‘zgartirib bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  function requestStaffStatusChange(item) {
    if (!item.is_active) {
      toggleStaffActive(item)
      return
    }
    setConfirmDialog({
      title: 'Xodim akkauntini faolsizlantirish',
      description: `${item.name} akkauntiga kirishni to‘xtatmoqchimisiz?`,
      onConfirm: () => toggleStaffActive(item),
    })
  }

  async function saveGroup(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const payload = {
        name: groupForm.name,
        teacherId: groupForm.teacherId,
        monthlyFee: groupForm.monthlyFee,
        scheduleReason: groupForm.scheduleReason,
        schedule: groupForm.schedule
          .filter((slot) => slot.startTime || slot.endTime)
          .map((slot) => ({ ...slot, day: Number(slot.day), teacherId: groupForm.teacherId })),
      }
      if (editingGroupId) {
        await groupManagement.update(editingGroupId, payload, groups)
        setEditingGroupId(null)
        setNotice('Guruh ma’lumotlari yangilandi.')
      } else {
        await groupManagement.create(payload, groups)
        setNotice('Guruh yaratildi.')
      }
      setGroupForm({ name: '', teacherId: '', monthlyFee: '', schedule: [{ day: '1', startTime: '', endTime: '' }], scheduleReason: '' })
      await refresh(user)
    } catch (createError) {
      setError(createError.message || 'Guruhni yaratib bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  function editStudent(item) {
    const parentPhones = parseParentPhones(item.parent_phone)
    setEditingStudentId(item.id)
    setEditingTeacherId(null)
    setEditingGroupId(null)
    setStudentForm({
      name: item.name || '',
      phone: item.phone || '',
      username: item.login || '',
      password: '',
      autoUsername: false,
      ...parentPhones,
      groupId: '',
    })
    setError('')
    setNotice('')
  }

  function editTeacher(item) {
    setEditingTeacherId(item.id)
    setEditingStudentId(null)
    setEditingGroupId(null)
    const account = staffRows.find((row) => row.teacher_id === item.id)
    setTeacherForm({
      name: item.name || '',
      phone: item.phone || '',
      monthlySalary: String(item.monthlySalary || ''),
      username: account?.username || loginBaseFromName(item.name),
      password: '',
      autoUsername: !account,
    })
    setError('')
    setNotice('')
  }

  function editGroup(item) {
    const schedule = Array.isArray(item.schedule) && item.schedule.length
      ? item.schedule.map((slot) => ({
        slotId: slot.slotId,
        day: String(slot.day),
        startTime: slot.startTime || '',
        endTime: slot.endTime || '',
      }))
      : [{ day: '0', startTime: '', endTime: '' }]
    setEditingGroupId(item.id)
    setEditingStudentId(null)
    setEditingTeacherId(null)
    setGroupForm({
      name: item.name || '',
      teacherId: item.teacher_id || '',
      monthlyFee: String(item.monthly_fee || ''),
      schedule,
      scheduleReason: '',
    })
    setError('')
    setNotice('')
  }

  async function removeTeacher(item) {
    setBusy(true)
    setError('')
    try {
      await teacherData.remove(item.id)
      if (editingTeacherId === item.id) setEditingTeacherId(null)
      setNotice('O‘qituvchi o‘chirildi.')
      await refresh(user)
    } catch (removeError) {
      setError(removeError.message || 'O‘qituvchini o‘chirib bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  function confirmRemoveTeacher(item) {
    setConfirmDialog({
      title: 'O‘qituvchini o‘chirish',
      description: `${item.name} o‘qituvchisini o‘chirmoqchimisiz?`,
      onConfirm: () => removeTeacher(item),
    })
  }

  async function removeGroup(item) {
    setBusy(true)
    setError('')
    try {
      await groupManagement.remove(item.id)
      if (editingGroupId === item.id) setEditingGroupId(null)
      setNotice('Guruh o‘chirildi.')
      await refresh(user)
    } catch (removeError) {
      setError(removeError.message || 'Guruhni o‘chirib bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  function confirmRemoveGroup(item) {
    setConfirmDialog({
      title: 'Guruhni o‘chirish',
      description: `${item.name} guruhini o‘chirmoqchimisiz?`,
      onConfirm: () => removeGroup(item),
    })
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

  async function createInvite(target) {
    const inviteTarget = typeof target === 'string' ? { profileId: target } : target
    if (!inviteTarget || (!inviteTarget.profileId && !inviteTarget.studentId)) {
      setError('Foydalanuvchi tanlanmagan.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const invite = await telegram.createInvite(inviteTarget.profileId || { studentId: inviteTarget.studentId })
      const key = inviteTarget.profileId || inviteTarget.studentId
      setInviteLinks((current) => ({ ...current, [key]: invite.invite_url }))
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
            <h2 className="text-lg font-bold">{authLoading ? 'Telegram tekshirilmoqda…' : telegramLoginRequired ? 'Kirish' : 'Telegram orqali kirish'}</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--mini-muted)]">
              {authLoading
                ? 'Xavfsiz ulanish bir necha soniya olishi mumkin.'
                : telegramLoginRequired
                  ? 'Telegram akkauntingizni login va parol orqali bir marta ulang. Keyingi safar avtomatik kirasiz.'
                  : 'Ushbu ilovani Telegram ichidan oching.'}
            </p>
            {error && <p role="alert" className="mini-error mt-4">{error}</p>}
            {!authLoading && telegramLoginRequired && (
              <form className="mt-4 grid gap-3" onSubmit={loginWithTelegramPassword}>
                <label className="mini-field"><span>Login</span><input autoComplete="username" value={telegramLoginForm.username} onChange={(event) => setTelegramLoginForm({ ...telegramLoginForm, username: event.target.value })} required /></label>
                <label className="mini-field"><span>Parol</span><input type="password" autoComplete="current-password" value={telegramLoginForm.password} onChange={(event) => setTelegramLoginForm({ ...telegramLoginForm, password: event.target.value })} minLength={6} required /></label>
                <ActionButton type="submit" className="w-full" disabled={busy}>{busy ? 'Tekshirilmoqda…' : 'Kirish'}</ActionButton>
              </form>
            )}
            {!authLoading && !telegramLoginRequired && (
              <ActionButton className="mt-4 w-full" onClick={() => window.location.reload()}>
                Qayta urinish
              </ActionButton>
            )}
          </Panel>
        </div>
      </main>
    )
  }

  function navTo(nextPage) {
    if (nextPage !== page) pageHistory.current.push(page)
    setError('')
    setNotice('')
    setMoreOpen(false)
    setRevealedStudentPasswords({})
    Object.values(studentPasswordTimers.current).forEach((timer) => window.clearTimeout(timer))
    studentPasswordTimers.current = {}
    setPage(nextPage)
    if (nextPage === 'notifications') {
      const ids = scheduleNotifications.map((item) => item.id)
      setReadScheduleNotificationIds((current) => [...new Set([...current, ...ids])])
      try {
        localStorage.setItem(`kamol-mini-schedule-read-${user?.id || 'guest'}`,
          JSON.stringify([...new Set([...readScheduleNotificationIds, ...ids])]))
      } catch {
        setError('Bildirishnomalar holatini saqlab bo‘lmadi.')
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const morePages = (role === 'owner'
    ? ['homework', 'payments', 'attendance', 'reports', 'questions', 'settings']
    : role === 'reception'
      ? ['homework', 'attendance', 'reports', 'profile']
      : role === 'teacher'
        ? ['payments', 'questions', 'reports', 'profile']
        : ['payments', 'settings'])
    .filter((id) => id === 'profile' || id === 'settings'
      || (id === 'payments' && student)
      || canAccessPage(role, id))

  return (
    <main
      className={`miniapp min-h-[100svh] px-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] text-[var(--mini-text)]${keyboardOpen ? ' mini-keyboard-open' : ''}`}
      onFocusCapture={(event) => {
        const target = event.target
        if (!(target instanceof HTMLElement) || !target.matches('input, textarea, select')) return
        setKeyboardOpen(true)
        window.setTimeout(() => target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250)
      }}
      onBlurCapture={() => window.setTimeout(() => {
        const active = document.activeElement
        setKeyboardOpen(active instanceof HTMLElement && active.matches('input, textarea, select'))
      }, 100)}
      onTouchStart={(event) => {
        const content = event.currentTarget.querySelector('.mini-app-content')
        touchStartY.current = content?.scrollTop === 0 ? event.touches[0].clientY : null
      }}
      onTouchEnd={(event) => {
        const start = touchStartY.current
        touchStartY.current = null
        const content = event.currentTarget.querySelector('.mini-app-content')
        if (start !== null && event.changedTouches[0].clientY - start > 90 && content?.scrollTop === 0 && user) refresh(user)
      }}
    >
      <div className="mini-app-content mx-auto w-full max-w-xl">
        <header className="mini-app-bar flex min-h-14 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {page !== 'dashboard' && (
              <button type="button" className="mini-icon-button" aria-label="Ortga" onClick={goBack}>
                <ArrowLeft size={18} />
              </button>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-lg font-extrabold">{pageTitles[page] || 'Kamol School'}</h1>
              <p className="truncate text-xs text-[var(--mini-muted)]">{roleLabels[role] || role} · {user.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="mini-icon-button mini-notification-button"
              onClick={() => navTo('notifications')}
              aria-label={`Bildirishnomalar${notificationCount + unreadScheduleCount ? `, ${notificationCount + unreadScheduleCount} ta` : ''}`}
              title="Bildirishnomalar"
            >
              <Bell size={18} />
              {notificationCount + unreadScheduleCount > 0 && <span className="mini-notification-badge">{notificationCount + unreadScheduleCount > 9 ? '9+' : notificationCount + unreadScheduleCount}</span>}
            </button>
            <button type="button" className="mini-icon-button" onClick={() => setMoreOpen((open) => !open)} aria-label="Ko‘proq menyu" aria-expanded={moreOpen}>
              <Ellipsis size={19} />
            </button>
            <button type="button" className="mini-icon-button" onClick={() => refresh(user)} aria-label="Yangilash" title="Yangilash" disabled={loading}>
              <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </header>

        {moreOpen && (
          <div className="mini-more-menu" role="dialog" aria-label="Ko‘proq bo‘limlar">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">Ko‘proq</h2>
              <button className="mini-icon-button" type="button" aria-label="Menyuni yopish" onClick={() => setMoreOpen(false)}>×</button>
            </div>
            <div className="mt-2 grid gap-1">
              {morePages.map((id) => (
                <button key={id} type="button" className="mini-more-item" onClick={() => navTo(id)}>
                  <span>{pageTitles[id]}</span><ArrowLeft className="rotate-180" size={16} />
                </button>
              ))}
              <button type="button" className="mini-more-item mini-more-logout" onClick={logout}>
                <span>Chiqish</span><LogOut size={16} />
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4">
            <Toast kind="error">{error}</Toast>
            <ActionButton
              className="mini-secondary mt-2"
              onClick={() => user ? refresh(user) : window.location.reload()}
              disabled={loading}
            >
              Qayta urinish
            </ActionButton>
          </div>
        )}
        {notice && <Toast>{notice}</Toast>}
        {loading && <Skeleton rows={2} />}

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
                    <p className="text-sm text-[var(--mini-muted)]">Keyingi dars</p>
                    {nextLesson
                      ? <><p className="mt-2 text-lg font-bold">{nextLesson.groupName}</p><p className="mt-1 text-sm text-[var(--mini-muted)]">{displayIsoDate(nextLesson.date)} · {nextLesson.startTime || 'Vaqt belgilanmagan'}{nextLesson.status === 'changed' ? ' · O‘zgartirilgan' : ''}</p></>
                      : <p className="mt-2 text-sm text-[var(--mini-muted)]">Dars jadvali kiritilmagan.</p>}
                  </Panel>
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
              {role === 'reception' && (
                <>
                  <Panel>
                    <p className="text-sm text-[var(--mini-muted)]">Yangi savollar</p>
                    <p className="mt-2 text-3xl font-extrabold">{questionTickets.length}</p>
                    <ActionButton className="mt-4 w-full" onClick={() => navTo('questions')}>Savollarni ochish</ActionButton>
                  </Panel>
                  <Panel>
                    <p className="text-sm text-[var(--mini-muted)]">Shu oy to‘lov qilmaganlar</p>
                    <p className="mt-2 text-3xl font-extrabold">{debtorCount}</p>
                    <ActionButton className="mt-4 w-full" onClick={() => navTo('payments')}>To‘lovlarni ko‘rish</ActionButton>
                  </Panel>
                  <Panel>
                    <p className="text-sm text-[var(--mini-muted)]">Bugungi darslar</p>
                    <p className="mt-2 text-3xl font-extrabold">{todayLessonCount}</p>
                    <ActionButton className="mt-4 w-full" onClick={() => navTo('groups')}>Jadvalni ko‘rish</ActionButton>
                  </Panel>
                </>
              )}
              {privileged && (
                <>
                  <Panel>
                    <p className="text-sm text-[var(--mini-muted)]">O‘quvchilar</p>
                    <p className="mt-2 text-3xl font-extrabold">{students.length}</p>
                    <ActionButton className="mt-4 w-full" onClick={() => navTo('management')}>Boshqarish</ActionButton>
                  </Panel>
                  {canAccessPage(role, 'reports') && <Panel>
                    <p className="text-sm text-[var(--mini-muted)]">Oylik hisobotlar</p>
                    <p className="mt-2 text-3xl font-extrabold">{reports.length}</p>
                    <ActionButton className="mt-4 w-full" onClick={() => navTo('reports')}>Hisobotlarni ko‘rish</ActionButton>
                  </Panel>}
                </>
              )}
            </div>
            {teacher && (
              <Panel className="mt-3">
                <h2 className="font-bold">Guruhlarim va o‘quvchilarim</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold text-[var(--mini-muted)]">Guruhlar</p>
                    {groups.map((group) => <p key={group.id} className="mt-2 text-sm">{group.name}</p>)}
                    {!groups.length && <p className="mt-2 text-sm text-[var(--mini-muted)]">Guruh biriktirilmagan.</p>}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[var(--mini-muted)]">O‘quvchilar</p>
                    {students.map((person) => <p key={person.id} className="mt-2 truncate text-sm">{person.name}</p>)}
                    {!students.length && <p className="mt-2 text-sm text-[var(--mini-muted)]">O‘quvchi topilmadi.</p>}
                  </div>
                </div>
              </Panel>
            )}
          </section>
        )}

        {page === 'groups' && (
          <section className="mt-7 grid gap-3">
            {teacher && (
              <Panel>
                <h2 className="font-bold">Guruhlarim</h2>
                <div className="mt-3 grid gap-2">
                  {groups.map((group) => (
                    <div key={group.id} className="rounded-2xl bg-[var(--mini-bg)] p-3">
                      <p className="font-semibold">{group.name}</p>
                      <p className="mt-1 text-sm text-[var(--mini-muted)]">
                        {normalizeScheduleWeekdays(group.schedule || []).map((slot) => `${['Dush.', 'Sesh.', 'Chor.', 'Pay.', 'Juma', 'Shan.', 'Yak.'][Number(slot.day) - 1] || ''} ${slot.startTime || ''}${slot.endTime ? `–${slot.endTime}` : ''}`).join(' · ') || 'Dars jadvali kiritilmagan'}
                      </p>
                      <p className="mt-1 text-xs text-[var(--mini-muted)]">
                        {students.filter((item) => item.group_id === group.id || item.groupId === group.id).length} nafar o‘quvchi
                      </p>
                      {scheduleEntries.filter((lesson) => lesson.groupId === group.id
                        && ['changed', 'cancelled', 'rescheduled'].includes(lesson.status)).slice(0, 3).map((lesson) => (
                          <p key={`${lesson.slotId}-${lesson.date}`} className="mt-2 text-xs font-semibold text-[var(--mini-accent)]">
                            {displayIsoDate(lesson.date)} · {lesson.status === 'cancelled' ? 'Bekor qilingan'
                              : lesson.status === 'rescheduled' ? `Ko‘chirildi: ${displayIsoDate(lesson.newDate)}`
                                : `O‘zgartirilgan · ${lesson.startTime}–${lesson.endTime}`}
                          </p>
                        ))}
                      <ActionButton className="mini-secondary mt-2 min-h-11 w-full" onClick={() => setScheduleChangeGroup(group)}>O‘zgartirish</ActionButton>
                    </div>
                  ))}
                  {!groups.length && !loading && <p className="text-sm text-[var(--mini-muted)]">Sizga guruh biriktirilmagan.</p>}
                </div>
              </Panel>
            )}
            {!teacher && (
              <Panel>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-bold">Guruhlar ro‘yxati</h2>
                  {canAccessPage(role, 'groups') && <ActionButton className="mini-secondary" onClick={() => navTo('management')}>Boshqarish</ActionButton>}
                </div>
                <div className="mt-3 grid gap-2">
                  {groups.map((group) => (
                    <div key={group.id} className="rounded-2xl bg-[var(--mini-bg)] p-3">
                      <p className="font-semibold">{group.name}</p>
                      <p className="mt-1 text-sm text-[var(--mini-muted)]">
                        {teachers.find((item) => item.id === group.teacher_id)?.name || 'O‘qituvchi biriktirilmagan'}
                      </p>
                      <p className="mt-1 text-xs text-[var(--mini-muted)]">
                        {normalizeScheduleWeekdays(group.schedule || []).map((slot) => `${['Dush.', 'Sesh.', 'Chor.', 'Pay.', 'Juma', 'Shan.', 'Yak.'][Number(slot.day) - 1] || ''} ${slot.startTime || ''}${slot.endTime ? `–${slot.endTime}` : ''}`).join(' · ') || 'Jadval kiritilmagan'}
                      </p>
                      {scheduleEntries.filter((lesson) => lesson.groupId === group.id
                        && ['changed', 'cancelled', 'rescheduled'].includes(lesson.status)).slice(0, 3).map((lesson) => (
                          <p key={`${lesson.slotId}-${lesson.date}`} className="mt-2 text-xs font-semibold text-[var(--mini-accent)]">
                            {displayIsoDate(lesson.date)} · {lesson.status === 'cancelled' ? 'Bekor qilingan'
                              : lesson.status === 'rescheduled' ? `Ko‘chirildi: ${displayIsoDate(lesson.newDate)}`
                                : `O‘zgartirilgan · ${lesson.startTime}–${lesson.endTime}`}
                          </p>
                        ))}
                      <ActionButton className="mini-secondary mt-2 min-h-11 w-full" onClick={() => setScheduleChangeGroup(group)}>O‘zgartirish</ActionButton>
                    </div>
                  ))}
                  {!groups.length && !loading && <p className="text-sm text-[var(--mini-muted)]">Guruhlar hali kiritilmagan.</p>}
                </div>
              </Panel>
            )}
          </section>
        )}

        {page === 'staff' && role === 'owner' && (
          <section className="mt-7 grid gap-3">
            <Panel>
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-bold">Xodimlar</h2>
                <ActionButton onClick={() => navTo('management')}><Plus size={16} /> Xodim qo‘shish</ActionButton>
              </div>
              <div className="mt-3 divide-y divide-[var(--mini-border)]">
                {staffRows.map((item) => (
                  <div key={item.id} className="flex min-h-14 items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{item.name}</p>
                      <p className="text-xs text-[var(--mini-muted)]">{item.role === 'reception' ? 'Qabulxona' : 'O‘qituvchi'} · {item.username}</p>
                    </div>
                    <span className={`mini-badge ${item.is_active ? 'mini-badge-success' : 'mini-badge-muted'}`}>
                      {item.is_active ? 'Faol' : 'Faol emas'}
                    </span>
                  </div>
                ))}
                {!staffRows.length && !loading && <p className="py-3 text-sm text-[var(--mini-muted)]">Xodimlar ro‘yxati bo‘sh.</p>}
              </div>
            </Panel>
            <Panel>
              <h2 className="font-bold">O‘qituvchilar</h2>
              <div className="mt-2 divide-y divide-[var(--mini-border)]">
                {teachers.map((item) => <p key={item.id} className="py-3 text-sm">{item.name} · {item.phone || 'Telefon yo‘q'}</p>)}
                {!teachers.length && !loading && <p className="py-3 text-sm text-[var(--mini-muted)]">O‘qituvchilar topilmadi.</p>}
              </div>
            </Panel>
          </section>
        )}

        {(page === 'profile' || page === 'settings') && (
          <section className="mt-7 grid gap-3">
            <Panel>
              <div className="flex items-center gap-3">
                <Avatar name={user.name} />
                <div className="min-w-0">
                  <h2 className="truncate font-bold">{user.name}</h2>
                  <p className="text-sm text-[var(--mini-muted)]">{roleLabels[role] || role}</p>
                </div>
              </div>
              <div className="mt-4 grid gap-2 text-sm">
                {user.username && <p><span className="text-[var(--mini-muted)]">Login: </span>{user.username}</p>}
                {user.phone && <p><span className="text-[var(--mini-muted)]">Telefon: </span>{user.phone}</p>}
              </div>
            </Panel>
            {student && (
              <Panel>
                <h2 className="font-bold">O‘quvchi ma’lumotlari</h2>
                <button type="button" className="mini-more-item mt-2" onClick={() => navTo('payments')}>To‘lovlarim <ArrowLeft className="rotate-180" size={16} /></button>
                <button type="button" className="mini-more-item" onClick={() => navTo('attendance')}>Davomatim <ArrowLeft className="rotate-180" size={16} /></button>
              </Panel>
            )}
            <ActionButton className="mini-secondary" onClick={logout}><LogOut size={16} /> Tizimdan chiqish</ActionButton>
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
                <form id="mini-homework-form" className="mt-4 grid gap-3" onSubmit={saveHomework}>
                  <label className="mini-field"><span>Guruh</span>
                    <select value={createForm.groupId} onChange={(event) => setCreateForm({ ...createForm, groupId: event.target.value })} required>
                      <option value="">Guruhni tanlang</option>
                      {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                    </select>
                  </label>
                  <label className="mini-field"><span>Sarlavha</span><input value={createForm.title} onChange={(event) => setCreateForm({ ...createForm, title: event.target.value })} required /></label>
                  <label className="mini-field"><span>Izoh</span><textarea rows="3" value={createForm.description} onChange={(event) => setCreateForm({ ...createForm, description: event.target.value })} /></label>
                  <label className="mini-field"><span>Muddat</span><input type="datetime-local" value={createForm.deadline} onChange={(event) => setCreateForm({ ...createForm, deadline: event.target.value })} /></label>
                  <label className="mini-field"><span>Fayl (har qanday tur, 100 MB gacha)</span><input type="file" onChange={(event) => setCreateForm({ ...createForm, file: event.target.files?.[0] || null })} /></label>
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
                  <TaskCard key={task.id} task={task} teacher={teacher} now={now} onClick={() => { setSelectedId(task.id); navTo('detail') }} />
                ))}
              </div>
            ) : !loading && <EmptyState title="Hozircha vazifalar yo‘q" description="Yangi vazifalar paydo bo‘lganda shu yerda ko‘rasiz." />}
          </section>
        )}

        {page === 'questions' && (
          <section className="mt-7 grid gap-4">
            <div>
              <h1 className="text-xl font-extrabold">{student ? 'Savollarim' : 'Savollar inboxi'}</h1>
              <p className="mt-1 text-sm text-[var(--mini-muted)]">Yozishmalar tarixda saqlanadi.</p>
            </div>
            {student ? (
              <Panel>
                <h2 className="font-bold">Savol yuborish</h2>
                <form id="mini-question-form" className="mt-3 grid gap-3" onSubmit={sendQuestion}>
                  <label className="mini-field"><span>Savolingiz</span><textarea rows="4" maxLength="10000" value={questionText} onChange={(event) => setQuestionText(event.target.value)} required /></label>
                  <label className="mini-field"><span>Fayl yoki ovoz (ixtiyoriy, 20 MB gacha)</span><input type="file" onChange={(event) => setQuestionFile(event.target.files?.[0] || null)} /></label>
                  <ActionButton type="submit" disabled={busy || !questionText.trim()}>{busy ? 'Yuborilmoqda…' : 'Savol yuborish'}</ActionButton>
                </form>
              </Panel>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="mini-field"><span>Holati</span><select value={questionStatus} onChange={(event) => setQuestionStatus(event.target.value)}>
                  <option value="">Barchasi</option><option value="open">Ochiq</option><option value="answered">Javob berilgan</option><option value="closed">Yopilgan</option>
                </select></label>
                <label className="mini-field"><span>Qidirish</span><input value={questionSearch} onChange={(event) => setQuestionSearch(event.target.value)} placeholder="O‘quvchi yoki matn" /></label>
              </div>
            )}
            {questionTickets.map((ticket) => (
              <Panel key={ticket.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="break-words font-bold">{student ? 'Sizning savolingiz' : ticket.student_name}</h2>
                    <p className="text-xs text-[var(--mini-muted)]">{ticket.status === 'open' ? 'Ochiq' : ticket.status === 'answered' ? 'Javob berilgan' : 'Yopilgan'} · {formatDate(ticket.last_message_at)}</p>
                  </div>
                  {Number(ticket.unread_count) > 0 && <span className="rounded-full bg-[var(--mini-accent)] px-2 py-1 text-xs">{ticket.unread_count} yangi</span>}
                </div>
                <div className="mt-3 grid gap-3">
                  {ticket.messages?.map((message) => (
                    <div key={message.id} className="rounded-2xl bg-[var(--mini-bg)] p-3">
                      <p className="text-xs font-semibold text-[var(--mini-muted)]">{message.actor_role === 'student' ? 'O‘quvchi' : message.actor_role === 'teacher' ? 'O‘qituvchi' : 'Qabulxona'} · {formatDate(message.created_at)}</p>
                      {message.body && <p className="mt-1 whitespace-pre-wrap break-words text-sm">{message.body}</p>}
                      {message.file_url && <SubmissionFile file={{ kind: 'attachment', original_name: 'Ilova', download_url: message.file_url }} />}
                    </div>
                  ))}
                </div>
                {!student && ticket.status !== 'closed' && (
                  <div className="mt-3 grid gap-2">
                    <label className="mini-field"><span>Javob</span><textarea rows="2" value={questionReply[ticket.id] || ''} onChange={(event) => setQuestionReply((current) => ({ ...current, [ticket.id]: event.target.value }))} /></label>
                    <div className="flex flex-wrap gap-2">
                      <ActionButton disabled={busy || !String(questionReply[ticket.id] || '').trim()} onClick={() => sendQuestionReply(ticket)}>Javob yuborish</ActionButton>
                      {['owner', 'reception'].includes(role) && <ActionButton className="mini-secondary" disabled={busy} onClick={() => closeQuestion(ticket)}>Yopish</ActionButton>}
                    </div>
                  </div>
                )}
              </Panel>
            ))}
            {!questionTickets.length && <Panel>{loading ? 'Savollar yuklanmoqda…' : student ? 'Sizda savol yo‘q.' : 'Bu filtrda savol topilmadi.'}</Panel>}
          </section>
        )}

        {page === 'detail' && selectedHomework && (
          <section className="mt-7 grid gap-4">
            <Panel>
              <p className="text-sm text-[var(--mini-muted)]">{selectedHomework.groups?.name || 'Uy vazifasi'}</p>
              <h1 className="mt-1 text-xl font-extrabold">{selectedHomework.title}</h1>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{selectedHomework.description || 'Izoh berilmagan.'}</p>
              <p className="mt-3 text-xs text-[var(--mini-muted)]">Muddat: {formatCountdown(selectedHomework.due_at, now)}</p>
              {selectedHomework.file_url && <a className="mini-link mt-3 inline-block" href={selectedHomework.file_url} target="_blank" rel="noreferrer">Vazifa faylini ochish</a>}
            </Panel>
            {student && (
              <Panel>
                <h2 className="font-bold">Javobni topshirish</h2>
                {selectedHomework.submission?.state && (
                  <p className="mt-2 text-sm text-[var(--mini-muted)]">
                    Holati: {selectedHomework.submission.state === 'draft' ? 'Qoralama' : selectedHomework.submission.state === 'checked'
                      ? selectedHomework.submission.teacher_result === 'done' ? 'Bajardi' : 'Bajarmadi'
                      : selectedHomework.submission.state === 'expired' ? 'Qoralama muddati tugagan' : 'Topshirildi · tekshirilmoqda'}
                  </p>
                )}
                {selectedHomework.submission?.state === 'draft'
                  && !selectedHomework.submission?.files?.some((file) => ['voice', 'video_note'].includes(file.kind))
                  && <p className="mt-2 text-sm font-semibold text-amber-300">Dumaloq video yoki ovozli xabar yuborilmagan.</p>}
                {selectedHomework.submission?.feedback && <p className="mt-2 text-sm">Izoh: {selectedHomework.submission.feedback}</p>}
                {selectedHomework.submission?.state === 'checked' && (
                  <p className="mt-2 text-sm">O‘qituvchi bahosi: <strong>{selectedHomework.submission.teacher_result === 'done' ? 'Bajardi' : 'Bajarmadi'}</strong></p>
                )}
                {selectedHomework.submission?.files?.map((file) => <SubmissionFile key={file.id} file={file} />)}
                {['submitted', 'checked'].includes(selectedHomework.submission?.state) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <ActionButton disabled={busy} onClick={() => markStudentResult(selectedHomework.submission.id, 'done')}>Bajardim</ActionButton>
                    <ActionButton disabled={busy} className="mini-secondary" onClick={() => markStudentResult(selectedHomework.submission.id, 'not_done')}>Bajarolmadim</ActionButton>
                  </div>
                )}
                {!selectedHomeworkSubmissionLocked && <form id="mini-submission-form" className="mt-4 grid gap-3" onSubmit={saveSubmission}>
                  <label className="mini-field"><span>Matnli javob</span><textarea rows="4" value={submissionForm.text} onChange={(event) => setSubmissionForm({ ...submissionForm, text: event.target.value })} /></label>
                  <label className="mini-field"><span>Fayllar (istalgan tur, har biri 100 MB gacha)</span><input type="file" multiple onChange={(event) => chooseSubmissionFiles(event.target.files)} /></label>
                  {!!submissionForm.files.length && <ul className="grid gap-1 text-xs text-[var(--mini-muted)]">{submissionForm.files.map((file) => <li key={`${file.name}:${file.size}`}>{file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB</li>)}</ul>}
                  {!selectedHomeworkHasProof && typeof window.MediaRecorder === 'function' && navigator.mediaDevices?.getUserMedia && (
                    <div className="grid gap-2">
                      <ActionButton className={recording ? 'mini-danger' : 'mini-secondary'} disabled={busy} onClick={toggleVoiceRecording}>
                        {recording ? <><Square size={15} /> Ovoz yozishni tugatish</> : <><Mic size={15} /> Ilovada ovoz yozish</>}
                      </ActionButton>
                      {recordedProof && <p className="text-xs text-[var(--mini-muted)]">Ovozli tasdiq tayyor: {recordedProofDuration} soniya. Qoralamani saqlang.</p>}
                    </div>
                  )}
                  {selectedHomework.submission?.state === 'draft' && <p className="text-xs text-[var(--mini-muted)]">Qoralama o‘qituvchiga ko‘rinmaydi. Kamida bitta fayl yoki matn va aynan bitta 3 soniyalik ovozli xabar yoki dumaloq video kerak. Ovoz yozish ishlamasa, bot orqali tasdiq yozuvini yuboring.</p>}
                  <ActionButton type="submit" disabled={busy || (!submissionForm.text.trim() && !submissionForm.files.length)}>{busy ? 'Saqlanmoqda…' : 'Qoralamani saqlash'}</ActionButton>
                </form>}
                <ActionButton className="mini-secondary mt-3 w-full" onClick={async () => {
                  try {
                    const link = submissionBotLink || await fetchHomeworkBotLink(selectedHomework.id)
                    setSubmissionBotLink(link)
                    window.Telegram?.WebApp?.openTelegramLink?.(link)
                    if (!window.Telegram?.WebApp?.openTelegramLink) window.open(link, '_blank', 'noopener,noreferrer')
                  } catch (linkError) {
                    setError(linkError.message || 'Bot havolasini ochib bo‘lmadi.')
                  }
                }}>Bot orqali tasdiq yozuvini yuborish</ActionButton>
              </Panel>
            )}
            {teacher && (
              <Panel className="grid gap-3 sm:grid-cols-2">
                <label className="mini-field"><span>Tekshiruv holati</span>
                  <select value={reviewStatusFilter} onChange={(event) => setReviewStatusFilter(event.target.value)}>
                    <option value="all">Barcha holatlar</option>
                    <option value="pending">Tekshirilmagan</option>
                    <option value="done">Bajardi</option>
                    <option value="not_done">Bajarmadi</option>
                  </select>
                </label>
                <label className="mini-field"><span>O‘quvchini qidirish</span>
                  <input value={reviewStudentFilter} onChange={(event) => setReviewStudentFilter(event.target.value)} placeholder="Ism bo‘yicha" />
                </label>
              </Panel>
            )}
            {teacher && filteredReviewSubmissions.map((submission) => (
              <Panel key={submission.id}>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-bold">{submission.student_name || submission.students?.name || 'O‘quvchi'}</h2>
                  <span className="text-xs text-[var(--mini-muted)]">Urinish {submission.attempt_number || 1} · {formatDate(submission.submitted_at)}</span>
                </div>
                {submission.content_text && <p className="mt-3 whitespace-pre-wrap text-sm">{submission.content_text}</p>}
                {submission.files?.map((file) => (
                  <div key={file.id} className="text-sm">
                    <SubmissionFile file={file} />
                    {isExecutableFile(file)
                      && <span className="ml-2 text-amber-300">Diqqat: bajariladigan fayl, faqat yuklab oling.</span>}
                  </div>
                ))}
                <label className="mini-field mt-3"><span>O‘qituvchi izohi</span>
                  <textarea rows="2" value={feedbacks[submission.id] ?? submission.feedback ?? ''} onChange={(event) => setFeedbacks({ ...feedbacks, [submission.id]: event.target.value })} />
                </label>
                <div className="mt-3 flex gap-2">
                  <ActionButton disabled={busy} onClick={() => saveReview(submission, 'approved')}><Check size={15} /> Bajardi</ActionButton>
                  <ActionButton disabled={busy} className="mini-danger" onClick={() => saveReview(submission, 'rejected')}>Bajarmadi</ActionButton>
                </div>
              </Panel>
            ))}
            {teacher && selectedHomework.notSubmitted?.length > 0 && (
              <Panel>
                <h2 className="font-bold">Hali topshirmaganlar</h2>
                {selectedHomework.notSubmitted.map((person) => <p key={person.id} className="mt-2 text-sm">{person.name}</p>)}
              </Panel>
            )}
            <Panel>
              <h2 className="font-bold">Topshiriq tarixi</h2>
              <div className="mt-3 grid gap-3">
                {homeworkHistory.submissions.map((attempt) => (
                  <div key={attempt.id} className="rounded-2xl bg-[var(--mini-bg)] p-3">
                    <p className="text-sm font-semibold">Urinish {attempt.attempt_number} · {attempt.state === 'draft' ? 'Qoralama' : attempt.state === 'expired' ? 'Muddati tugagan' : attempt.state === 'checked' ? attempt.teacher_result === 'done' ? 'Bajardi' : 'Bajarmadi' : 'Topshirildi'}</p>
                    <p className="mt-1 text-xs text-[var(--mini-muted)]">{attempt.student_name || formatDate(attempt.submitted_at || attempt.created_at)}</p>
                    {attempt.content_text && <p className="mt-2 whitespace-pre-wrap text-sm">{attempt.content_text}</p>}
                    {attempt.files.map((file) => <SubmissionFile key={file.id} file={file} />)}
                  </div>
                ))}
                {homeworkHistory.events.map((event) => {
                  const detailText = (() => {
                    try {
                    const details = JSON.parse(event.details || '{}')
                      return details.comment || details.reason || details.name || ''
                    } catch {
                      return ''
                    }
                  })()
                  return (
                    <div key={event.id} className="border-l-2 border-[var(--mini-accent)] pl-3">
                      <p className="text-sm">{homeworkEventLabels[event.event_type] || event.event_type}</p>
                      {detailText && <p className="mt-1 break-words text-xs text-[var(--mini-muted)]">{detailText}</p>}
                      <p className="mt-1 text-[11px] text-[var(--mini-muted)]">{formatDate(event.created_at)}</p>
                    </div>
                  )
                })}
                {!homeworkHistory.events.length && !homeworkHistory.submissions.length
                  && <p className="text-sm text-[var(--mini-muted)]">Tarix hali mavjud emas.</p>}
              </div>
            </Panel>
          </section>
        )}

        {page === 'payments' && (
          <section className="mt-7">
            <h1 className="text-xl font-extrabold">{student ? 'Mening to‘lovlarim' : 'To‘lovlar'}</h1>
            <p className="mt-1 text-sm text-[var(--mini-muted)]">So‘nggi 100 ta to‘lov</p>
            <label className="mini-field mt-3">
              <span>O‘quvchi yoki miqdor bo‘yicha qidirish</span>
              <input type="search" value={paymentSearch} onChange={(event) => { setPaymentSearch(event.target.value); setPaymentPage(0) }} />
            </label>
            <div className="mt-4 grid gap-3">
              {visiblePayments.map((item) => (
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
              {!filteredPayments.length && !loading && <EmptyState title="To‘lovlar topilmadi" description="Qidiruvni o‘zgartiring yoki yangi to‘lovlar kelishini kuting." />}
            </div>
            {filteredPayments.length > 20 && (
              <div className="mini-pagination">
                <ActionButton className="mini-secondary" disabled={paymentPage === 0} onClick={() => setPaymentPage((current) => current - 1)}>Oldingi</ActionButton>
                <span>{paymentPage + 1} / {Math.ceil(filteredPayments.length / 20)}</span>
                <ActionButton className="mini-secondary" disabled={(paymentPage + 1) * 20 >= filteredPayments.length} onClick={() => setPaymentPage((current) => current + 1)}>Keyingi</ActionButton>
              </div>
            )}
          </section>
        )}

        {page === 'attendance' && (
          <section className="mt-7">
            <h1 className="text-xl font-extrabold">{student ? 'Jadval va davomat' : 'Davomat'}</h1>
            {student && (
              <Panel className="mt-4">
                <h2 className="font-bold">Haftalik dars jadvali</h2>
                <div className="mt-3 grid gap-2">
                  {scheduleEntries.map((lesson) => (
                    <div key={`${lesson.groupId}-${lesson.slotId}-${lesson.date}`} className="rounded-2xl bg-[var(--mini-bg)] p-3">
                      <p className="font-semibold">{displayIsoDate(lesson.date)} · {lesson.groupName}</p>
                      <p className="mt-1 text-sm text-[var(--mini-muted)]">
                        {lesson.status === 'cancelled' ? 'Dars bekor qilingan'
                          : lesson.status === 'rescheduled' ? `Dars ${displayIsoDate(lesson.newDate)} sanasiga ko‘chirilgan`
                            : `${lesson.startTime || 'Vaqt yo‘q'}${lesson.endTime ? `–${lesson.endTime}` : ''}${lesson.status === 'changed' ? ' · O‘zgartirilgan' : ''}`}
                      </p>
                    </div>
                  ))}
                  {!scheduleEntries.length && <p className="text-sm text-[var(--mini-muted)]">Sizga dars jadvali biriktirilmagan.</p>}
                </div>
              </Panel>
            )}
            {(teacher || privileged) && (
              <Panel className="mt-4">
                <h2 className="font-bold">Davomat belgilash</h2>
                <form id="mini-attendance-form" className="mt-4 grid gap-3" onSubmit={saveAttendance}>
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

        {page === 'finance' && canAccessPage(role, 'finance') && (
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
              <h2 className="font-bold">{editingStudentId ? 'O‘quvchi ma’lumotlarini tahrirlash' : 'Yangi o‘quvchi qo‘shish'}</h2>
              <form id="mini-student-form" className="mt-4 grid gap-3" onSubmit={saveStudent}>
                <label className="mini-field"><span>Ism va familiya</span><input value={studentForm.name} onChange={(event) => setStudentForm((current) => ({ ...current, name: event.target.value, username: current.autoUsername ? loginBaseFromName(event.target.value) : current.username }))} required /></label>
                <label className="mini-field"><span>Telefon</span><input type="tel" value={studentForm.phone} onChange={(event) => setStudentForm({ ...studentForm, phone: event.target.value })} required /></label>
                <label className="mini-field"><span>Ota telefoni</span><input type="tel" value={studentForm.fatherPhone} onChange={(event) => setStudentForm({ ...studentForm, fatherPhone: event.target.value })} /></label>
                <label className="mini-field"><span>Ona telefoni</span><input type="tel" value={studentForm.motherPhone} onChange={(event) => setStudentForm({ ...studentForm, motherPhone: event.target.value })} /></label>
                <label className="mini-field"><span>Mini App login</span><input value={studentForm.username} onChange={(event) => setStudentForm({ ...studentForm, username: event.target.value, autoUsername: false })} required /><small>Ism.familiya; band bo‘lsa avtomatik raqam qo‘shiladi.</small></label>
                {!editingStudentId && <label className="mini-field"><span>O‘quvchi paroli (kamida 6 belgi)</span><input type="password" autoComplete="new-password" value={studentForm.password} onChange={(event) => setStudentForm({ ...studentForm, password: event.target.value })} minLength={6} required /><small>{studentForm.password.length < 6 ? 'Kuchsiz — kamida 6 belgi kiriting.' : studentForm.password.length < 10 ? 'O‘rtacha parol.' : 'Kuchli parol.'}</small></label>}
                {!editingStudentId && <label className="mini-field"><span>Guruh</span>
                  <select value={studentForm.groupId} onChange={(event) => setStudentForm({ ...studentForm, groupId: event.target.value })}>
                    <option value="">Keyinroq biriktiraman</option>
                    {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                  </select>
                </label>}
                <div className="flex flex-wrap gap-2">
                  <ActionButton type="submit" disabled={busy}><Plus size={16} /> {busy ? 'Saqlanmoqda…' : editingStudentId ? 'Saqlash' : 'O‘quvchini yaratish'}</ActionButton>
                  {editingStudentId && <ActionButton className="mini-secondary" disabled={busy} onClick={() => { setEditingStudentId(null); setStudentForm({ name: '', phone: '', fatherPhone: '', motherPhone: '', groupId: '', username: '', password: '', autoUsername: true }) }}>Bekor qilish</ActionButton>}
                </div>
              </form>
            </Panel>
            <Panel>
              <h2 className="font-bold">O‘quvchilar ro‘yxati</h2>
              <label className="mini-field mt-3">
                <span>Ism yoki telefon bo‘yicha qidirish</span>
                <input type="search" value={studentSearch} onChange={(event) => { setStudentSearch(event.target.value); setStudentPage(0) }} />
              </label>
              <div className="mt-3 divide-y divide-[var(--mini-border)]">
                {visibleStudents.map((item) => (
                  <Panel key={item.id} className="my-3">
                    <p className="truncate text-sm font-semibold">{item.name}</p>
                    <p className="text-xs text-[var(--mini-muted)]">{item.phone || 'Telefon yo‘q'}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                      <strong>Login: {item.login || '—'}</strong>
                      {item.login && <ActionButton className="mini-secondary min-h-9 px-3 text-xs" onClick={() => copyText(item.login)}>Loginni nusxalash</ActionButton>}
                    </div>
                    <p className="mt-2 text-xs text-[var(--mini-muted)]">{revealedStudentPasswords[item.id] ? `Parol: ${revealedStudentPasswords[item.id]}` : 'Parol yashirilgan'}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <ActionButton className="mini-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => revealStudentPassword(item)}>Parolni ko‘rsatish</ActionButton>
                      <ActionButton className="mini-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => setStudentPasswordForm({ studentId: item.id, username: item.login || '', password: '' })}>Parolni o‘zgartirish</ActionButton>
                      {item.telegram_id
                        ? <><span className="self-center text-xs text-[var(--mini-muted)]">Telegram ulangan</span><ActionButton className="mini-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => confirmUnlinkStudent(item)}>Telegramdan uzish</ActionButton></>
                        : <><span className="self-center text-xs text-[var(--mini-muted)]">Telegram ulanmagan</span><ActionButton className="mini-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => createInvite({ studentId: item.id })}>Ulash</ActionButton></>}
                      <ActionButton className="mini-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => editStudent(item)}>Tahrirlash</ActionButton>
                      {inviteLinks[item.id] && <button className="mini-link max-w-36 truncate text-xs" type="button" onClick={() => copyText(inviteLinks[item.id])}>{copied ? 'Nusxalandi' : 'Havolani nusxalash'}</button>}
                    </div>
                    {studentPasswordForm.studentId === item.id && (
                      <form className="mt-3 grid gap-2" onSubmit={changeStudentCredentials}>
                        <label className="mini-field"><span>Login</span><input value={studentPasswordForm.username} onChange={(event) => setStudentPasswordForm({ ...studentPasswordForm, username: event.target.value })} required /></label>
                        <label className="mini-field"><span>Yangi parol (kamida 6 belgi)</span><input type="password" value={studentPasswordForm.password} onChange={(event) => setStudentPasswordForm({ ...studentPasswordForm, password: event.target.value })} minLength={6} autoComplete="new-password" required /></label>
                        
                        <div className="flex gap-2"><ActionButton type="submit" disabled={busy}>Saqlash</ActionButton><ActionButton className="mini-secondary" disabled={busy} onClick={() => setStudentPasswordForm({ studentId: '', username: '', password: '' })}>Bekor qilish</ActionButton></div>
                      </form>
                    )}
                  </Panel>
                ))}
                {!filteredStudents.length && <p className="py-4 text-sm text-[var(--mini-muted)]">O‘quvchilar topilmadi.</p>}
              </div>
              {filteredStudents.length > 20 && (
                <div className="mini-pagination">
                  <ActionButton className="mini-secondary" disabled={studentPage === 0} onClick={() => setStudentPage((current) => current - 1)}>Oldingi</ActionButton>
                  <span>{studentPage + 1} / {Math.ceil(filteredStudents.length / 20)}</span>
                  <ActionButton className="mini-secondary" disabled={(studentPage + 1) * 20 >= filteredStudents.length} onClick={() => setStudentPage((current) => current + 1)}>Keyingi</ActionButton>
                </div>
              )}
            </Panel>
            {canAccessEndpoint(role, 'staff:manage') && (
              <Panel>
                <h2 className="font-bold">Xodim akkauntlari</h2>
                <form className="mt-4 grid gap-3" onSubmit={saveStaff}>
                  <label className="mini-field"><span>Ism va familiya</span><input value={staffForm.name} onChange={(event) => setStaffForm((current) => ({ ...current, name: event.target.value, username: staffUsernameAuto ? loginBaseFromName(event.target.value) : current.username }))} required /></label>
                  <label className="mini-field"><span>Telefon</span><input type="tel" value={staffForm.phone} onChange={(event) => setStaffForm({ ...staffForm, phone: event.target.value })} /></label>
                  <label className="mini-field"><span>Rol</span><select value={staffForm.role} onChange={(event) => setStaffForm({ ...staffForm, role: event.target.value })}><option value="reception">Qabulxona</option><option value="teacher">O‘qituvchi</option></select></label>
                  <label className="mini-field"><span>Login</span><input value={staffForm.username} onChange={(event) => { setStaffUsernameAuto(false); setStaffForm({ ...staffForm, username: event.target.value }) }} required /><small>Ism.familiya; band bo‘lsa avtomatik raqam qo‘shiladi.</small></label>
                  <label className="mini-field"><span>{editingStaffId ? 'Yangi parol (ixtiyoriy)' : 'Parol (kamida 12 belgi)'}</span><input type="password" autoComplete="new-password" value={staffForm.password} onChange={(event) => setStaffForm({ ...staffForm, password: event.target.value })} minLength={staffForm.password ? 12 : undefined} required={!editingStaffId} /></label>
                  <div className="flex flex-wrap gap-2"><ActionButton type="submit" disabled={busy}>{busy ? 'Saqlanmoqda…' : editingStaffId ? 'Xodimni saqlash' : 'Xodim qo‘shish'}</ActionButton>{editingStaffId && <ActionButton className="mini-secondary" disabled={busy} onClick={() => { setEditingStaffId(null); setStaffUsernameAuto(true); setStaffForm({ name: '', phone: '', role: 'reception', username: '', password: '' }) }}>Bekor qilish</ActionButton>}</div>
                </form>
                <div className="mt-3 divide-y divide-[var(--mini-border)]">
                  {staffRows.map((item) => (
                    <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                      <div><p className="text-sm font-semibold">{item.name}</p><p className="text-xs text-[var(--mini-muted)]">@{item.username} · {item.role === 'teacher' ? 'O‘qituvchi' : 'Qabulxona'} · {item.phone || 'Telefon yo‘q'}</p></div>
                      <div className="flex flex-wrap gap-1">
                        <ActionButton className="mini-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => { setEditingStaffId(item.id); setStaffUsernameAuto(false); setStaffForm({ name: item.name, phone: item.phone || '', role: item.role, username: item.username, password: '' }) }}>Tahrirlash / parolni tiklash</ActionButton>
                        <ActionButton className="mini-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => requestStaffStatusChange(item)}>{item.is_active ? 'Faolsizlantirish' : 'Faollashtirish'}</ActionButton>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            )}
            <Panel>
              <h2 className="font-bold">O‘qituvchilar</h2>
              {canAccessEndpoint(role, 'staff:manage') && (
                <>
                  <h3 className="mt-4 font-semibold">{editingTeacherId ? 'O‘qituvchi ma’lumotlarini tahrirlash' : 'O‘qituvchi qo‘shish'}</h3>
                  <form id="mini-teacher-form" className="mt-4 grid gap-3" onSubmit={saveTeacher}>
                    <label className="mini-field"><span>Ism va familiya</span><input value={teacherForm.name} onChange={(event) => setTeacherForm((current) => ({ ...current, name: event.target.value, username: current.autoUsername ? loginBaseFromName(event.target.value) : current.username }))} required /></label>
                    <label className="mini-field"><span>Telefon</span><input type="tel" value={teacherForm.phone} onChange={(event) => setTeacherForm({ ...teacherForm, phone: event.target.value })} /></label>
                    <label className="mini-field"><span>Oylik maosh (so‘m)</span><input type="number" min="0" value={teacherForm.monthlySalary} onChange={(event) => setTeacherForm({ ...teacherForm, monthlySalary: event.target.value })} /></label>
                    <label className="mini-field"><span>Login</span><input value={teacherForm.username} onChange={(event) => setTeacherForm({ ...teacherForm, username: event.target.value, autoUsername: false })} required /><small>Ism.familiya; band bo‘lsa avtomatik raqam qo‘shiladi.</small></label>
                    <label className="mini-field"><span>{editingTeacherId ? 'Yangi parol (ixtiyoriy)' : 'Parol (kamida 12 belgi)'}</span><input type="password" autoComplete="new-password" value={teacherForm.password} onChange={(event) => setTeacherForm({ ...teacherForm, password: event.target.value })} minLength={teacherForm.password ? 12 : undefined} required={!editingTeacherId || !staffRows.some((row) => row.teacher_id === editingTeacherId)} /></label>
                    <div className="flex flex-wrap gap-2">
                      <ActionButton type="submit" disabled={busy}>{busy ? 'Saqlanmoqda…' : editingTeacherId ? 'Saqlash' : 'O‘qituvchini qo‘shish'}</ActionButton>
                      {editingTeacherId && <ActionButton className="mini-secondary" disabled={busy} onClick={() => { setEditingTeacherId(null); setTeacherForm({ name: '', phone: '', monthlySalary: '', username: '', password: '', autoUsername: true }) }}>Bekor qilish</ActionButton>}
                    </div>
                  </form>
                </>
              )}
              <div className="mt-3 divide-y divide-[var(--mini-border)]">
                {teachers.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div className="min-w-0"><p className="truncate text-sm font-semibold">{item.name}</p><p className="text-xs text-[var(--mini-muted)]">{item.phone || 'Telefon yo‘q'}</p></div>
                    <div className="flex flex-wrap items-center gap-1">
                      {canAccessEndpoint(role, 'staff:manage') && (item.telegram_id
                        ? <span className="text-xs text-[var(--mini-muted)]">Telegram ulangan</span>
                        : item.profile_id && <ActionButton className="mini-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => createInvite({ profileId: item.profile_id })}>Ulash</ActionButton>)}
                      {canAccessEndpoint(role, 'staff:manage') && <ActionButton className="mini-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => editTeacher(item)}>Tahrirlash</ActionButton>}
                      {canAccessEndpoint(role, 'staff:manage') && <ActionButton className="mini-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => confirmRemoveTeacher(item)}>O‘chirish</ActionButton>}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel>
              <h2 className="font-bold">{editingGroupId ? 'Guruhni tahrirlash' : 'Guruh yaratish'}</h2>
              <form id="mini-group-form" className="mt-4 grid gap-3" onSubmit={saveGroup}>
                <label className="mini-field"><span>Guruh nomi</span><input value={groupForm.name} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })} required /></label>
                <label className="mini-field"><span>O‘qituvchi</span>
                  <select value={groupForm.teacherId} onChange={(event) => setGroupForm({ ...groupForm, teacherId: event.target.value })}>
                    <option value="">Tanlanmagan</option>
                    {teachers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <label className="mini-field"><span>Oylik to‘lov (so‘m)</span><input type="number" min="0" value={groupForm.monthlyFee} onChange={(event) => setGroupForm({ ...groupForm, monthlyFee: event.target.value })} /></label>
                <p className="text-xs font-semibold text-[var(--mini-muted)]">Dars vaqti — ixtiyoriy</p>
                {groupForm.schedule.map((slot, index) => (
                  <div key={index} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                    <label className="mini-field"><span>Hafta kuni</span><select value={slot.day} onChange={(event) => setGroupForm((current) => ({ ...current, schedule: current.schedule.map((item, slotIndex) => slotIndex === index ? { ...item, day: event.target.value } : item) }))}>
                      {['Dush.', 'Sesh.', 'Chor.', 'Pay.', 'Juma', 'Shan.', 'Yak.'].map((day, dayIndex) => <option key={day} value={dayIndex + 1}>{day}</option>)}
                    </select></label>
                    <label className="mini-field"><span>Boshlanish</span><input type="time" value={slot.startTime} onChange={(event) => setGroupForm((current) => ({ ...current, schedule: current.schedule.map((item, slotIndex) => slotIndex === index ? { ...item, startTime: event.target.value } : item) }))} /></label>
                    <label className="mini-field"><span>Tugash</span><input type="time" value={slot.endTime} onChange={(event) => setGroupForm((current) => ({ ...current, schedule: current.schedule.map((item, slotIndex) => slotIndex === index ? { ...item, endTime: event.target.value } : item) }))} /></label>
                    {groupForm.schedule.length > 1 && <ActionButton className="mini-secondary mb-1 min-h-11 px-2" aria-label="Dars vaqtini olib tashlash" onClick={() => setGroupForm((current) => ({ ...current, schedule: current.schedule.filter((_, slotIndex) => slotIndex !== index) }))}>−</ActionButton>}
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <ActionButton className="mini-secondary" onClick={() => setGroupForm((current) => ({ ...current, schedule: [...current.schedule, { day: '1', startTime: '', endTime: '' }] }))}>Vaqt qo‘shish</ActionButton>
                  {editingGroupId && <label className="mini-field"><span>Jadval o‘zgarish sababi</span><input value={groupForm.scheduleReason} onChange={(event) => setGroupForm({ ...groupForm, scheduleReason: event.target.value })} maxLength={500} placeholder="Sababini yozing" /></label>}
                  <ActionButton type="submit" disabled={busy}>{busy ? 'Saqlanmoqda…' : editingGroupId ? 'Guruhni saqlash' : 'Guruhni yaratish'}</ActionButton>
                  {editingGroupId && <ActionButton className="mini-secondary" disabled={busy} onClick={() => { setEditingGroupId(null); setGroupForm({ name: '', teacherId: '', monthlyFee: '', schedule: [{ day: '1', startTime: '', endTime: '' }], scheduleReason: '' }) }}>Bekor qilish</ActionButton>}
                </div>
              </form>
              <div className="mt-3 divide-y divide-[var(--mini-border)]">
                {groups.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <span className="text-sm">{item.name}</span>
                    <div className="flex gap-1">
                      <ActionButton className="mini-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => editGroup(item)}>Tahrirlash</ActionButton>
                      <ActionButton className="mini-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => confirmRemoveGroup(item)}>O‘chirish</ActionButton>
                    </div>
                  </div>
                ))}
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
            <p className="mt-1 text-sm text-[var(--mini-muted)]">Oy bo‘yicha berilgan va bajarilgan vazifalar</p>
            <div className="mt-4 grid gap-3">
              {reports.map((report) => (
                <Panel key={`${report.student_id}-${report.month_start}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div><h2 className="font-bold">{report.student_name}</h2><p className="mt-1 text-xs text-[var(--mini-muted)]">{report.month_start || 'Hali topshiriq yo‘q'}</p></div>
                    <span className="rounded-full bg-[var(--mini-bg)] px-3 py-1 text-xs">{report.assigned_count} ta berilgan</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-3">
                    <div><strong className="block text-base">{report.submitted_on_time_count}</strong>O‘z vaqtida</div>
                    <div><strong className="block text-base">{report.late_count}</strong>Kechikkan</div>
                    <div><strong className="block text-base">{report.not_done_count}</strong>Bajarolmagan</div>
                    <div><strong className="block text-base">{report.bajardi_count}</strong>Bajardi</div>
                    <div><strong className="block text-base">{report.bajarmadi_count}</strong>Bajarmadi</div>
                  </div>
                </Panel>
              ))}
              {!reports.length && !loading && <Panel>Hisobot uchun ma’lumot topilmadi.</Panel>}
            </div>
          </section>
        )}
        {page === 'notifications' && (
          <section className="mt-7">
            <h1 className="text-xl font-extrabold">Bildirishnomalar</h1>
            <div className="mt-4 grid gap-3">
              {scheduleNotifications.map((item) => (
                <Panel key={item.id}>
                  <p className="font-semibold">{item.group_name || 'Dars jadvali'}</p>
                  <p className="mt-2 whitespace-pre-line text-sm text-[var(--mini-muted)]">{item.message}</p>
                  <p className="mt-2 text-xs text-[var(--mini-muted)]">{new Intl.DateTimeFormat('uz-UZ', {
                    dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Tashkent',
                  }).format(new Date(item.scheduled_at))}</p>
                </Panel>
              ))}
              {!scheduleNotifications.length && !loading && <EmptyState title="Hozircha bildirishnoma yo‘q" description="Jadval o‘zgarishlari haqida xabarlar shu yerda ko‘rinadi." />}
            </div>
          </section>
        )}
      </div>
      <nav className="mini-bottom-nav" aria-label="Asosiy menyu">
        {visibleNav.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => navTo(id)} aria-current={page === id ? 'page' : undefined}>
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {scheduleChangeGroup && (
        <ScheduleChangeSheet
          group={scheduleChangeGroup}
          role={role}
          onClose={() => setScheduleChangeGroup(null)}
          onSaved={() => refresh(user)}
        />
      )}
      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title}
        description={confirmDialog?.description}
        onCancel={() => setConfirmDialog(null)}
        onConfirm={() => {
          const action = confirmDialog?.onConfirm
          setConfirmDialog(null)
          action?.()
        }}
      />
    </main>
  )
}
