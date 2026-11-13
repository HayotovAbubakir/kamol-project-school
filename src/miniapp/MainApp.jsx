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
  Trash2,
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
import { canAccessEndpoint, canAccessPage, canAccessTable } from '../../shared/role-permissions.js'
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
import DebtorsScreen from './screens/DebtorsScreen.jsx'
import StudentPaymentsScreen from './screens/StudentPaymentsScreen.jsx'
import AbsentTodayScreen from './screens/AbsentTodayScreen.jsx'
import WeekScheduleScreen from './screens/WeekScheduleScreen.jsx'
import PaymentForm from './screens/PaymentForm.jsx'
import FaceCapture from '../components/face/FaceCapture.jsx'
import FacePhotosPanel from '../components/face/FacePhotosPanel.jsx'
import AttendanceSourceTag from '../components/face/AttendanceSourceTag.jsx'
import { buildFaceLabels } from '../components/face/faceLabels.js'
import { faceApi, isFaceLockedError } from '../lib/faceApi.js'
import { MINI_LANGUAGES, getMiniLanguage, setMiniLanguage, t } from './i18n.js'
import { debtorsFor, displayIsoDate, formatDate, money, monthName, paymentMethodLabel, weekdayShort } from './format.js'

const roleLabels = {
  student: 'O‘quvchi',
  teacher: 'O‘qituvchi',
  reception: 'Qabulxona',
  owner: 'Egasi',
}

const expenseCategoryOptions = ['Operatsion', 'Ijara', 'Kommunal', 'Reklama', 'Jihozlar', 'Boshqa']

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
  debtors: 'Qarzdorlar',
  studentPayments: 'To‘lovlar tarixi',
  absent: 'Bugun kelmaganlar',
  schedule: 'Haftalik jadval',
}

function isStaff(role) {
  return canAccessPage(role, 'students') && canAccessPage(role, 'groups')
}

function formatDeadline(value) {
  if (!value) return t('Muddat belgilanmagan')
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
  if (!value) return t('Muddat belgilanmagan')
  const remaining = new Date(value).getTime() - now
  if (!Number.isFinite(remaining)) return formatDeadline(value)
  if (remaining <= 0) return t('Muddat o‘tgan · {v0}', { v0: formatDeadline(value) })
  const minutes = Math.floor(remaining / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60
  const countdown = days ? t('{days} kun {hours} soat', { days, hours }) : hours ? t('{hours} soat {rest} daqiqa', { hours, rest }) : `${Math.max(1, rest)} daqiqa`
  return t('{v0} · {countdown} qoldi', { v0: formatDeadline(value), countdown })
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

function Panel({ children, className = '' }) {
  return <UiCard className={className}>{children}</UiCard>
}

function StatTile({ label, value, sub, tone = '', onClick }) {
  return (
    <button type="button" className="mini-panel mini-pressable w-full rounded-3xl border p-4 text-left" onClick={onClick}>
      <p className="text-xs font-semibold text-[var(--mini-muted)]">{label}</p>
      <p className={`mt-1 truncate text-2xl font-extrabold ${tone}`}>{value}</p>
      {sub && <p className="mt-1 truncate text-xs text-[var(--mini-muted)]">{sub}</p>}
    </button>
  )
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
      if (active) setFileError(error.message || t('Media yuklanmadi.'))
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
      setFileError(error.message || t('Faylni yuklab bo‘lmadi.'))
    }
  }
  return (
    <div className="mt-3 grid gap-2">
      {proof ? file.kind === 'voice'
        ? objectUrl ? <audio controls src={objectUrl} className="w-full" /> : <p className="text-xs text-[var(--mini-muted)]">{t('Ovoz yuklanmoqda…')}</p>
        : objectUrl ? <video controls playsInline src={objectUrl} className="max-h-64 w-full rounded-xl" /> : <p className="text-xs text-[var(--mini-muted)]">{t('Video yuklanmoqda…')}</p>
        : <button type="button" className="mini-link break-all text-left" onClick={download}>{file.original_name || t('Fayl')} {t('· yuklab olish')}</button>}
      {fileError && <p role="alert" className="text-xs text-rose-300">{fileError}</p>}
    </div>
  )
}

// Qoralamalar ham `status: 'pending'` bo‘ladi; o‘qituvchini faqat bot orqali yuborilgan va hali baholanmaganlari kutadi.
function isAwaitingTeacherReview(submission) {
  return submission.state === 'submitted' && !submission.teacher_result
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
    ? t('Qoralama · tasdiq yozuvi kutilmoqda')
    : task.submission?.state === 'expired' && isPastDue ? t('Topshirilmadi')
      : task.submission?.state === 'expired' ? t('Qoralama muddati tugagan')
    : status === 'approved' ? t('Bajardi') : status === 'rejected' ? t('Qayta topshirish kerak')
      : status === 'pending' ? t('Tekshirilmoqda') : isPastDue ? t('Topshirilmadi') : t('Yangi')

  return (
    <button type="button" className="task-card w-full rounded-3xl border p-4 text-left" onClick={onClick}>
      <div className="flex items-start gap-3">
        <div className="subject-icon grid size-11 shrink-0 place-items-center rounded-2xl">
          {teacher ? <ClipboardCheck size={19} /> : <BookOpen size={19} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-[var(--mini-muted)]">{task.groups?.name || t('Uy vazifasi')}</p>
          <h2 className="mt-1 text-[15px] font-bold leading-snug">{task.title}</h2>
          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-[var(--mini-muted)]">{task.description || t('Izoh berilmagan.')}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-[var(--mini-border)] pt-3 text-xs">
        <span className="text-[var(--mini-muted)]">{formatCountdown(task.due_at, now)}</span>
        <span className="font-semibold text-[var(--mini-accent)]">
          {teacher ? t('{length} ta tekshirilmagan', { length: submissions.filter(isAwaitingTeacherReview).length }) : statusText}
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
  const [faceShots, setFaceShots] = useState({})
  const [faceCaptureKey, setFaceCaptureKey] = useState(0)
  const [faceStudentId, setFaceStudentId] = useState(null)
  const [manualAttendanceOpen, setManualAttendanceOpen] = useState(false)
  const faceLabels = buildFaceLabels(t)
  const confirmFaceAction = (text) => new Promise((resolve) => {
    setConfirmDialog({ title: text, description: '', onConfirm: () => resolve(true) })
  })
  const [studentPasswordForm, setStudentPasswordForm] = useState({ studentId: '', username: '', password: '' })
  const [revealedStudentPasswords, setRevealedStudentPasswords] = useState({})
  const studentPasswordTimers = useRef({})
  const [staffRows, setStaffRows] = useState([])
  const [staffForm, setStaffForm] = useState({ name: '', phone: '', role: 'reception', username: '', password: '' })
  const [editingStaffId, setEditingStaffId] = useState(null)
  const [staffUsernameAuto, setStaffUsernameAuto] = useState(true)
  const [staffFormOpen, setStaffFormOpen] = useState(false)
  const [teacherForm, setTeacherForm] = useState({ name: '', phone: '', monthlySalary: '', username: '', password: '', autoUsername: true })
  const [editingTeacherId, setEditingTeacherId] = useState(null)
  const [groupForm, setGroupForm] = useState({ name: '', teacherId: '', monthlyFee: '', schedule: [{ day: '1', startTime: '', endTime: '' }], scheduleReason: '' })
  const [editingGroupId, setEditingGroupId] = useState(null)
  const [paymentForm, setPaymentForm] = useState(() => {
    const [year, month] = tashkentDateRange().to.split('-').map(Number)
    return { studentId: '', amount: '', month, year, method: 'cash' }
  })
  const [paymentStudentId, setPaymentStudentId] = useState(null)
  const [absentRows, setAbsentRows] = useState([])
  const [absentLoading, setAbsentLoading] = useState(false)
  const [lang, setLang] = useState(getMiniLanguage)
  const [studentGroupsForm, setStudentGroupsForm] = useState([])
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
  const [moreOpen, setMoreOpen] = useState(false)
  const [questionStatus, setQuestionStatus] = useState('')
  const [questionSearch, setQuestionSearch] = useState('')
  const [questionText, setQuestionText] = useState('')
  const [questionFile, setQuestionFile] = useState(null)
  const [questionFileKey, setQuestionFileKey] = useState(0)
  const [questionGroupChoice, setQuestionGroupChoice] = useState(null)
  const [questionReply, setQuestionReply] = useState({})
  const [copied, setCopied] = useState(false)
  const touchStartY = useRef(null)
  const pageHistory = useRef([])
  const wasMoreOpen = useRef(false)
  const moreMenuRef = useRef(null)
  const moreButtonRef = useRef(null)
  const reviewLinkHandled = useRef(false)
  const manualLogout = useRef(false)
  const mediaRecorder = useRef(null)
  const recordingStream = useRef(null)
  const recordingStartedAt = useRef(0)
  const recordingChunks = useRef([])

  const role = user?.role
  const teacher = role === 'teacher'
  const student = role === 'student'
  const privileged = isStaff(role)
  const canMarkAttendance = canAccessEndpoint(role, 'attendance:mark')
  const canDeleteGroups = canAccessTable(role, 'groups', 'delete')
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
  // Saytdagi qoida bilan bir xil: oylik = a’zo guruhlar narxi (o‘sha oy narxida), bekor qilinganlar hisoblanmaydi.
  const currentDebtors = debtorsFor(students, groups, payments, currentMonth, currentYear)
  const debtorCount = currentDebtors.length
  const debtTotal = currentDebtors.reduce((sum, row) => sum + row.remaining, 0)
  const todayLessons = scheduleEntries.filter((lesson) => lesson.date === scheduleToday
    && !['cancelled', 'rescheduled'].includes(lesson.status))
  const todayLessonCount = todayLessons.length
  const filteredStudents = students.filter((item) => `${item.name} ${item.phone} ${item.login || ''}`.toLowerCase().includes(studentSearch.toLowerCase()))
  const visibleStudents = filteredStudents.slice(studentPage * 20, (studentPage + 1) * 20)
  const filteredPayments = payments.filter((item) => `${item.student_name || ''} ${item.amount || ''} ${item.month || ''}.${item.year || ''}`.toLowerCase().includes(paymentSearch.toLowerCase()))
  const visiblePayments = filteredPayments.slice(paymentPage * 20, (paymentPage + 1) * 20)
  const notificationCount = student
    ? homeworks.filter((task) => !task.submission).length
    : teacher
      ? homeworks.reduce((sum, task) => sum + (task.submissions || []).filter(isAwaitingTeacherReview).length, 0)
      : questionTickets.reduce((sum, ticket) => sum + Number(ticket.unread_count || 0), 0)
  // Bitta guruh bo‘lsa savol avtomatik o‘sha guruh o‘qituvchisiga ham ko‘rinadi.
  const questionGroupId = questionGroupChoice ?? (studentGroups.length === 1 ? studentGroups[0].id : '')
  const attendanceStudents = attendanceForm.groupId
    ? students.filter((person) => (person.group_ids || []).includes(attendanceForm.groupId))
    : []
  const unreadScheduleCount = scheduleNotifications.filter((item) => !readScheduleNotificationIds.includes(item.id)).length
  const goBack = useCallback(() => {
    if (moreOpen) {
      setMoreOpen(false)
      return
    }
    const previousPage = pageHistory.current.pop()
    setPage(previousPage || (page === 'detail' ? 'homework' : 'dashboard'))
    document.querySelector('.mini-app-content')?.scrollTo({ top: 0 })
  }, [moreOpen, page])

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
        // O‘qituvchida to‘lovlarga ruxsat yo‘q: so‘rov 403 qaytarib, butun yuklashni to‘xtatardi.
        const staffDataRows = await Promise.all([
          canAccessTable(profile.role, 'payments') ? paymentData.list(profile) : [],
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
        setAbsentRows(await attendanceData.forDate(tashkentDateRange().to))
        setReports(await homeworkReports.monthlyHomework())
        setTeachers(await teacherData.list(profile.role))
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
      setError(loadError.message || t('Ma’lumotlarni yuklashda xatolik.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!moreOpen) {
      if (wasMoreOpen.current) moreButtonRef.current?.focus()
      wasMoreOpen.current = false
      return undefined
    }
    wasMoreOpen.current = true
    const menu = moreMenuRef.current
    const focusable = () => [...(menu?.querySelectorAll('button:not(:disabled)') || [])]
    focusable()[0]?.focus()
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMoreOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [moreOpen])

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
              ? t('Telegram akkauntingiz ulanmagan. Login va parol bilan kiring.')
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
        if (active) setError(t('Telegram orqali tizimga ulanib bo‘lmadi. Internetni tekshirib, qayta urinib ko‘ring.'))
      } finally {
        if (active) setAuthLoading(false)
      }
    }
    authenticate()
    // Refresh token ham yaroqsiz bo‘lsa: Telegram initData orqali jimgina qayta kirishga urinamiz,
    // bo‘lmasa login formasi ko‘rsatiladi.
    let reauthenticating = false
    const { data: subscription } = auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT' || !active || reauthenticating || manualLogout.current) return
      reauthenticating = true
      setUser(null)
      setPage('dashboard')
      setAuthLoading(true)
      authenticate().finally(() => { reauthenticating = false })
    })
    return () => {
      active = false
      subscription?.subscription?.unsubscribe()
    }
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
      setError(loginError.message || t('Login yoki parol noto‘g‘ri.'))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const app = window.Telegram?.WebApp
    if (!app) return undefined
    app.ready()
    app.expand()
    const applyTheme = () => {
      const params = app.themeParams || {}
      const root = document.documentElement
      root.style.setProperty('--mini-bg', params.bg_color || '#101a2b')
      root.style.setProperty('--mini-card', params.secondary_bg_color || '#17243a')
      root.style.setProperty('--mini-text', params.text_color || '#f4f7fb')
      root.style.setProperty('--mini-muted', params.hint_color || '#a3b2c7')
      root.style.setProperty('--mini-accent', params.button_color || '#4b9cf5')
      root.style.setProperty('--mini-accent-text', params.button_text_color || '#ffffff')
      root.style.colorScheme = app.colorScheme || 'dark'
    }
    applyTheme()
    // Foydalanuvchi Telegram mavzusini (kun/tun) ilova ochiq turganda almashtirsa ham ranglar mos bo‘lsin.
    app.onEvent?.('themeChanged', applyTheme)
    return () => app.offEvent?.('themeChanged', applyTheme)
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
      if (active) setError(historyError.message || t('Vazifa tarixini yuklab bo‘lmadi.'))
    })
    return () => { active = false }
  }, [page, selectedHomework, user])

  useEffect(() => {
    const app = window.Telegram?.WebApp
    if (!app || !app.isVersionAtLeast?.('6.1')) return undefined
    const onBack = () => goBack()
    // Boshqaruv sahifasida bir nechta forma bor: MainButton faqat aniq tahrirlanayotgan formani yuboradi,
    // aks holda foydalanuvchi guruh formasini to‘ldirayotganda bo‘sh o‘quvchi formasi yuborilardi.
    const formId = moreOpen ? null
      : page === 'staff' && role === 'owner' && staffFormOpen ? 'mini-staff-form'
        : page === 'management'
          ? editingGroupId ? 'mini-group-form' : editingTeacherId ? 'mini-teacher-form' : editingStudentId ? 'mini-student-form' : null
          : page === 'homework' && teacher && selectedId === 'new' ? 'mini-homework-form'
            : page === 'questions' && student ? 'mini-question-form'
              : page === 'attendance' && canMarkAttendance && manualAttendanceOpen ? 'mini-attendance-form'
                : page === 'detail' && student && selectedHomework && !selectedHomeworkSubmissionLocked ? 'mini-submission-form'
                  : null
    const onMainClick = () => {
      if (busy) return
      document.getElementById(formId)?.requestSubmit()
    }
    if (page === 'dashboard' && !moreOpen) app.BackButton?.hide()
    else {
      app.BackButton?.show()
      app.BackButton?.onClick(onBack)
    }

    if (formId) {
      const mainButtonText = page === 'staff'
        ? editingStaffId ? t('Xodimni saqlash') : t('Xodim qo‘shish')
        : page === 'management'
          ? editingGroupId ? t('Guruhni saqlash') : editingTeacherId ? t('O‘qituvchini saqlash') : editingStudentId ? t('O‘quvchini saqlash') : t('O‘quvchini qo‘shish')
          : page === 'homework' ? t('Vazifani yuborish')
            : page === 'questions' ? t('Savol yuborish')
              : page === 'attendance' ? t('Davomatni saqlash')
                : t('Qoralamani saqlash')
      app.MainButton?.setText(mainButtonText)
      app.MainButton?.show()
      if (busy) {
        app.MainButton?.disable?.()
        app.MainButton?.showProgress?.(false)
      } else {
        app.MainButton?.hideProgress?.()
        app.MainButton?.enable?.()
      }
      app.MainButton?.onClick(onMainClick)
    } else app.MainButton?.hide()

    return () => {
      app.BackButton?.offClick(onBack)
      app.MainButton?.offClick(onMainClick)
      app.MainButton?.hide()
      app.BackButton?.hide()
    }
  }, [page, student, selectedHomework, selectedHomeworkSubmissionLocked, editingStudentId, editingTeacherId, editingGroupId, editingStaffId, staffFormOpen, role, teacher, canMarkAttendance, manualAttendanceOpen, selectedId, goBack, busy, moreOpen, lang])

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
      setError(loadError.message || t('Savollarni yuklab bo‘lmadi.'))
    }
  }, [page, questionStatus, questionSearch])

  useEffect(() => {
    if ((page === 'questions' || (page === 'dashboard' && privileged)) && user) queueMicrotask(() => refreshQuestions())
  }, [page, user, privileged, refreshQuestions])

  useEffect(() => {
    if (page !== 'absent' || !user) return undefined
    let active = true
    queueMicrotask(() => { if (active) setAbsentLoading(true) })
    attendanceData.forDate(tashkentDateRange().to)
      .then((rows) => { if (active) setAbsentRows(rows) })
      .catch((loadError) => { if (active) setError(loadError.message || t('Davomatni yuklab bo‘lmadi.')) })
      .finally(() => { if (active) setAbsentLoading(false) })
    return () => { active = false }
  }, [page, user, attendance])

  async function logout() {
    manualLogout.current = true
    try {
      await auth.signOut()
    } finally {
      manualLogout.current = false
    }
    setUser(null)
    setHomeworks([])
    setStudentGroups([])
    setPage('dashboard')
    setError('')
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(value)
      setNotice(t('Nusxalandi.'))
      window.setTimeout(() => setCopied((current) => (current === value ? false : current)), 2000)
    } catch {
      setError(t('Nusxa olish uchun brauzer ruxsatini tekshiring.'))
    }
  }

  async function saveHomework(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await homeworkData.create(user, createForm)
      setCreateForm({ groupId: '', title: '', description: '', deadline: '', file: null })
      setNotice(t('Uy vazifasi guruhga yuborildi.'))
      await refresh(user)
    } catch (saveError) {
      setError(saveError.message || t('Vazifani saqlab bo‘lmadi.'))
    } finally {
      setBusy(false)
    }
  }

  async function saveSubmission(event) {
    event.preventDefault()
    if (!selectedHomework) return
    setBusy(true)
    setError('')
    let draftSaved = false
    try {
      const draft = await homeworkData.submit(user, selectedHomework, submissionForm)
      draftSaved = true
      setSubmissionForm({ text: '', files: [] })
      const hadProof = Boolean(recordedProof)
      if (recordedProof) {
        try {
          await uploadHomeworkDraftProof(draft.id, recordedProof, recordedProofDuration)
          setRecordedProof(null)
          setRecordedProofDuration(0)
        } catch (proofError) {
          // Qoralama saqlandi — faqat ovoz yuklanmadi. Yozuvni saqlab qolamiz, qayta urinish mumkin.
          throw new Error(t('Qoralama saqlandi, lekin ovozli tasdiq yuklanmadi: {v0}. Qayta “Qoralamani saqlash”ni bosing yoki bot orqali yuboring.', { v0: proofError.message || 'xatolik' }), { cause: proofError })
        }
      }
      setSubmissionBotLink(await fetchHomeworkBotLink(selectedHomework.id).catch(() => ''))
      setNotice(hadProof
        ? t('Qoralama va ovozli tasdiq yozuvi saqlandi. Bot orqali “Yuborish”ni tasdiqlang.')
        : t('Qoralama saqlandi. Dumaloq video yoki ovozli xabar yuborib, bot orqali “Yuborish”ni tasdiqlang.'))
    } catch (submitError) {
      setError(submitError.message || t('Vazifani topshirib bo‘lmadi.'))
    } finally {
      setBusy(false)
      // Qisman muvaffaqiyatda ham holat yangilansin: qoralama endi serverda bor.
      if (draftSaved) await refresh(user)
    }
  }

  function chooseSubmissionFiles(files) {
    setError('')
    const selectedFiles = [...(files || [])]
    if (selectedFiles.some((file) => file.size <= 0 || file.size > 100 * 1024 * 1024)) {
      setError(t('Har bir fayl 100 MB dan oshmasligi kerak.'))
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
      setError(t('Bu qurilmada ilova ichida ovoz yozib bo‘lmaydi. Telegram bot orqali tasdiq yozuvini yuboring.'))
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
          setError(t('Ovozli tasdiq yozuvi kamida 3 soniya bo‘lishi kerak.'))
          return
        }
        setRecordedProof(new Blob(recordingChunks.current, { type: recorder.mimeType || 'audio/webm' }))
        setRecordedProofDuration(duration)
        setNotice(t('Ovozli tasdiq yozildi ({duration} soniya). Qoralamani saqlang.', { duration }))
      }
      mediaRecorder.current = recorder
      recorder.start()
      setRecording(true)
    } catch (recordError) {
      recordingStream.current?.getTracks().forEach((track) => track.stop())
      recordingStream.current = null
      setError(recordError.message || t('Mikrofonga ruxsat berilmadi. Telegram bot orqali tasdiq yozuvini yuboring.'))
    }
  }

  async function saveReview(submission, status) {
    setBusy(true)
    setError('')
    try {
      await homeworkData.review(submission.id, status, feedbacks[submission.id] || '', user.id)
      setNotice(status === 'approved' ? t('Topshiriq qabul qilindi.') : t('Topshiriq qaytarildi.'))
      await refresh(user)
    } catch (reviewError) {
      setError(reviewError.message || t('Bahoni saqlab bo‘lmadi.'))
    } finally {
      setBusy(false)
    }
  }

  async function markStudentResult(submissionId, result) {
    setBusy(true)
    setError('')
    try {
      await declareHomeworkResult(submissionId, result)
      setNotice(result === 'done' ? t('“Bajardim” belgisi saqlandi.') : t('“Bajarolmadim” belgisi saqlandi.'))
      await refresh(user)
    } catch (declarationError) {
      setError(declarationError.message || t('Natijani saqlab bo‘lmadi.'))
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
      await createQuestionTicket(questionText.trim(), questionGroupId, questionFile)
      setQuestionText('')
      setQuestionFile(null)
      setQuestionFileKey((key) => key + 1)
      setNotice(t('Savol yuborildi.'))
      await refreshQuestions()
    } catch (questionError) {
      setError(questionError.message || t('Savol yuborilmadi.'))
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
      setNotice(t('Javob o‘quvchiga yuborildi.'))
      await refreshQuestions()
    } catch (replyError) {
      setError(replyError.message || t('Javob yuborilmadi.'))
    } finally {
      setBusy(false)
    }
  }

  function confirmCloseQuestion(ticket) {
    setConfirmDialog({
      title: t('Savolni yopish'),
      description: t('{v0} savolini yopmoqchimisiz? Yopilgan savolga javob yozib bo‘lmaydi.', { v0: ticket.student_name || 'O‘quvchi' }),
      onConfirm: () => closeQuestion(ticket),
    })
  }

  async function closeQuestion(ticket) {
    setBusy(true)
    setError('')
    try {
      await closeQuestionTicket(ticket.id)
      setNotice(t('Savol yopildi.'))
      await refreshQuestions()
    } catch (closeError) {
      setError(closeError.message || t('Savolni yopib bo‘lmadi.'))
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
          groupIds: studentGroupsForm,
        })
        setEditingStudentId(null)
        setStudentGroupsForm([])
        setNotice(t('O‘quvchi ma’lumotlari yangilandi.'))
      } else {
        const created = await studentData.create({
          name: studentForm.name,
          phone: studentForm.phone,
          username: studentForm.username || loginBaseFromName(studentForm.name),
          autoUsername: studentForm.autoUsername,
          password: studentForm.password,
          fatherPhone: studentForm.fatherPhone,
          motherPhone: studentForm.motherPhone,
          groupIds: studentGroupsForm,
        })
        setStudentGroupsForm([])
        setNotice(t('O‘quvchi qo‘shildi.'))
        if (created?.id && Object.keys(faceShots).length) {
          try {
            await faceApi.uploadShots(created.id, faceShots)
          } catch (faceError) {
            setError(`${faceLabels.uploadFailed()}: ${faceError.message}`)
          }
        }
        setFaceShots({})
        setFaceCaptureKey((value) => value + 1)
      }
      setStudentForm({ name: '', phone: '', fatherPhone: '', motherPhone: '', groupId: '', username: '', password: '', autoUsername: true })
      await refresh(user)
    } catch (createError) {
      setError(createError.message || t('O‘quvchini yaratib bo‘lmadi.'))
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
      setError(revealError.message || t('Parolni ko‘rsatib bo‘lmadi.'))
    }
  }

  async function changeStudentCredentials(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await studentData.changePassword(studentPasswordForm.studentId, studentPasswordForm.password, studentPasswordForm.username)
      setStudentPasswordForm({ studentId: '', username: '', password: '' })
      setNotice(t('O‘quvchi login va paroli yangilandi.'))
      await refresh(user)
    } catch (passwordError) {
      setError(passwordError.message || t('Parolni o‘zgartirib bo‘lmadi.'))
    } finally {
      setBusy(false)
    }
  }

  async function unlinkStudent(item) {
    setBusy(true)
    setError('')
    try {
      await studentData.unlinkTelegram(item.id)
      setNotice(t('Telegram akkaunti uzildi.'))
      await refresh(user)
    } catch (unlinkError) {
      setError(unlinkError.message || t('Telegram akkauntini uzib bo‘lmadi.'))
    } finally {
      setBusy(false)
    }
  }

  function confirmUnlinkStudent(item) {
    setConfirmDialog({
      title: t('Telegram akkauntini uzish'),
      description: t('{name} o‘quvchisining Telegram akkauntini uzmoqchimisiz?', { name: item.name }),
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
          if (teacherForm.password.length < 12) throw new Error(t('Xodim paroli kamida 12 belgidan iborat bo‘lishi kerak.'))
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
        if (teacherForm.password.length < 12) throw new Error(t('Xodim paroli kamida 12 belgidan iborat bo‘lishi kerak.'))
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
      setNotice(editingTeacherId ? t('O‘qituvchi ma’lumotlari yangilandi.') : t('O‘qituvchi akkaunti yaratildi.'))
    } catch (createError) {
      setError(createError.message || t('O‘qituvchini qo‘shib bo‘lmadi.'))
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
        if (staffForm.password.length < 12) throw new Error(t('Xodim paroli kamida 12 belgidan iborat bo‘lishi kerak.'))
        await staffData.create({
          ...staffForm,
          auto_username: staffUsernameAuto,
        })
      }
      setStaffForm({ name: '', phone: '', role: 'reception', username: '', password: '' })
      setStaffUsernameAuto(true)
      setEditingStaffId(null)
      setStaffFormOpen(false)
      setStaffRows(await staffData.list())
      setNotice(t('Xodim akkaunti saqlandi.'))
    } catch (staffError) {
      setError(staffError.message || t('Xodim akkauntini saqlab bo‘lmadi.'))
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
      setError(staffError.message || t('Xodim holatini o‘zgartirib bo‘lmadi.'))
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
      title: t('Xodim akkauntini faolsizlantirish'),
      description: t('{name} akkauntiga kirishni to‘xtatmoqchimisiz?', { name: item.name }),
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
        setNotice(t('Guruh ma’lumotlari yangilandi.'))
      } else {
        await groupManagement.create(payload, groups)
        setNotice(t('Guruh yaratildi.'))
      }
      setGroupForm({ name: '', teacherId: '', monthlyFee: '', schedule: [{ day: '1', startTime: '', endTime: '' }], scheduleReason: '' })
      await refresh(user)
    } catch (createError) {
      setError(createError.message || t('Guruhni yaratib bo‘lmadi.'))
    } finally {
      setBusy(false)
    }
  }

  function editStudent(item) {
    const parentPhones = parseParentPhones(item.parent_phone)
    setEditingStudentId(item.id)
    setEditingTeacherId(null)
    setEditingGroupId(null)
    setStudentGroupsForm(item.group_ids || [])
    document.querySelector('.mini-app-content')?.scrollTo({ top: 0, behavior: 'smooth' })
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
      : [{ day: '1', startTime: '', endTime: '' }]
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
      setNotice(t('O‘qituvchi o‘chirildi.'))
      await refresh(user)
    } catch (removeError) {
      setError(removeError.message || t('O‘qituvchini o‘chirib bo‘lmadi.'))
    } finally {
      setBusy(false)
    }
  }

  function confirmRemoveTeacher(item) {
    setConfirmDialog({
      title: t('O‘qituvchini o‘chirish'),
      description: t('{name} o‘qituvchisini o‘chirmoqchimisiz?', { name: item.name }),
      onConfirm: () => removeTeacher(item),
    })
  }

  async function removeGroup(item) {
    setBusy(true)
    setError('')
    try {
      await groupManagement.remove(item.id)
      if (editingGroupId === item.id) setEditingGroupId(null)
      setNotice(t('Guruh o‘chirildi.'))
      await refresh(user)
    } catch (removeError) {
      setError(removeError.message || t('Guruhni o‘chirib bo‘lmadi.'))
    } finally {
      setBusy(false)
    }
  }

  function confirmRemoveGroup(item) {
    setConfirmDialog({
      title: t('Guruhni o‘chirish'),
      description: t('{name} guruhini o‘chirmoqchimisiz?', { name: item.name }),
      onConfirm: () => removeGroup(item),
    })
  }

  async function savePayment(event) {
    event.preventDefault()
    if (busy || !paymentForm.studentId) return
    setBusy(true)
    setError('')
    try {
      const student = students.find((item) => item.id === paymentForm.studentId)
      await paymentData.create({
        studentId: paymentForm.studentId,
        studentName: student?.name,
        amount: paymentForm.amount,
        month: paymentForm.month,
        year: paymentForm.year,
        method: paymentForm.method,
      })
      setPaymentForm((current) => ({ ...current, studentId: '', amount: '' }))
      setNotice(t('To‘lov saqlandi: {name}, {amount}', { name: student?.name || '', amount: money(paymentForm.amount) }))
      await refresh(user)
    } catch (saveError) {
      setError(saveError.message || t('To‘lovni saqlab bo‘lmadi.'))
    } finally {
      setBusy(false)
    }
  }

  function acceptPaymentFor({ studentId, amount, month, year }) {
    setPaymentForm((current) => ({ ...current, studentId, amount: amount ? String(amount) : '', month, year }))
    navTo('payments')
  }

  function openStudentPayments(student) {
    setPaymentStudentId(student.id)
    navTo('studentPayments')
  }

  async function voidPaymentRecord(payment, reason) {
    setBusy(true)
    setError('')
    try {
      await paymentData.void(payment.id, reason.trim())
      setNotice(t('To‘lov bekor qilindi.'))
      await refresh(user)
      return true
    } catch (voidError) {
      setError(voidError.message || t('To‘lovni bekor qilib bo‘lmadi.'))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function correctPaymentRecord(payment, patch) {
    setBusy(true)
    setError('')
    try {
      await paymentData.correct(payment.id, patch)
      setNotice(t('To‘lov tuzatildi.'))
      await refresh(user)
      return true
    } catch (correctError) {
      setError(correctError.message || t('To‘lovni tuzatib bo‘lmadi.'))
      return false
    } finally {
      setBusy(false)
    }
  }

  function changeLanguage(next) {
    setMiniLanguage(next)
    setLang(next)
  }

  async function removeStudent(item) {
    setBusy(true)
    setError('')
    try {
      await studentData.remove(item.id)
      if (editingStudentId === item.id) {
        setEditingStudentId(null)
        setStudentForm({ name: '', phone: '', fatherPhone: '', motherPhone: '', groupId: '', username: '', password: '', autoUsername: true })
      }
      setNotice(t('O‘quvchi o‘chirildi.'))
      await refresh(user)
    } catch (removeError) {
      setError(removeError.message || t('O‘quvchini o‘chirib bo‘lmadi.'))
    } finally {
      setBusy(false)
    }
  }

  function confirmRemoveStudent(item) {
    setConfirmDialog({
      title: t('O‘quvchini o‘chirish'),
      description: t('{name} o‘chirilsinmi? To‘lovlar tarixi saqlanadi.', { name: item.name }),
      onConfirm: () => removeStudent(item),
    })
  }

  async function saveAttendance(event, overrideFace = false) {
    event?.preventDefault()
    setBusy(true)
    setError('')
    try {
      await attendanceData.mark({
        studentId: attendanceForm.studentId,
        groupId: attendanceForm.groupId,
        status: attendanceForm.status,
        note: attendanceForm.note,
        markedBy: user.id,
        overrideFace,
      })
      // Guruh tanlovi qoladi — keyingi o‘quvchini tez belgilash uchun.
      setAttendanceForm((current) => ({ ...current, studentId: '', status: 'present', note: '' }))
      setNotice(t('Davomat saqlandi.'))
      await refresh(user)
    } catch (saveError) {
      if (!overrideFace && isFaceLockedError(saveError)) {
        setConfirmDialog({
          title: faceLabels.overrideAction(),
          description: faceLabels.overrideConfirm(),
          onConfirm: () => saveAttendance(null, true),
        })
      } else setError(saveError.message || t('Davomatni saqlab bo‘lmadi.'))
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
      setNotice(t('Xarajat qayd etildi.'))
      await refresh(user)
    } catch (saveError) {
      setError(saveError.message || t('Xarajatni qayd etib bo‘lmadi.'))
    } finally {
      setBusy(false)
    }
  }

  function confirmRemoveExpense(item) {
    setConfirmDialog({
      title: t('Xarajatni o‘chirish'),
      description: `${item.title} · ${money(item.amount)}`,
      onConfirm: async () => {
        setBusy(true)
        setError('')
        try {
          await expenseData.remove(item.id)
          setNotice(t('Xarajat o‘chirildi.'))
          await refresh(user)
        } catch (removeError) {
          setError(removeError.message || t('Xarajatni o‘chirib bo‘lmadi.'))
        } finally {
          setBusy(false)
        }
      },
    })
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
      setNotice(t('O‘qituvchi to‘lovi qayd etildi.'))
      await refresh(user)
    } catch (saveError) {
      setError(saveError.message || t('Ish haqini qayd etib bo‘lmadi.'))
    } finally {
      setBusy(false)
    }
  }

  async function createInvite(target) {
    const inviteTarget = typeof target === 'string' ? { profileId: target } : target
    if (!inviteTarget || (!inviteTarget.profileId && !inviteTarget.studentId)) {
      setError(t('Foydalanuvchi tanlanmagan.'))
      return
    }
    setBusy(true)
    setError('')
    try {
      const invite = await telegram.createInvite(inviteTarget.profileId || { studentId: inviteTarget.studentId })
      const key = inviteTarget.profileId || inviteTarget.studentId
      setInviteLinks((current) => ({ ...current, [key]: invite.invite_url }))
      setNotice(t('Telegram ulash havolasi 15 daqiqa davomida amal qiladi.'))
    } catch (inviteError) {
      setError(inviteError.message || t('Ulash havolasini yaratib bo‘lmadi.'))
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
          </header>
          <Panel>
            <h2 className="text-lg font-bold">{authLoading ? t('Telegram tekshirilmoqda…') : telegramLoginRequired ? t('Kirish') : t('Telegram orqali kirish')}</h2>
            {!authLoading && !telegramLoginRequired && <p className="mt-2 text-sm text-[var(--mini-muted)]">{t('Ilovani Telegram ichidan oching.')}</p>}
            {error && <p role="alert" className="mini-error mt-4">{error}</p>}
            {!authLoading && telegramLoginRequired && (
              <form className="mt-4 grid gap-3" onSubmit={loginWithTelegramPassword}>
                <label className="mini-field"><span>{t('Login')}</span><input autoComplete="username" value={telegramLoginForm.username} onChange={(event) => setTelegramLoginForm({ ...telegramLoginForm, username: event.target.value })} required /></label>
                <label className="mini-field"><span>{t('Parol')}</span><input type="password" autoComplete="current-password" value={telegramLoginForm.password} onChange={(event) => setTelegramLoginForm({ ...telegramLoginForm, password: event.target.value })} minLength={6} required /></label>
                <ActionButton type="submit" className="w-full" disabled={busy}>{busy ? t('Tekshirilmoqda…') : t('Kirish')}</ActionButton>
              </form>
            )}
            {!authLoading && !telegramLoginRequired && (
              <ActionButton className="mt-4 w-full" onClick={() => window.location.reload()}>
                {t('Qayta urinish')}
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
        setError(t('Bildirishnomalar holatini saqlab bo‘lmadi.'))
      }
    }
    // The page scrolls inside .mini-app-content, not the window: a new page must start at its top.
    document.querySelector('.mini-app-content')?.scrollTo({ top: 0 })
  }

  const morePages = (role === 'owner'
    ? ['payments', 'debtors', 'absent', 'schedule', 'homework', 'attendance', 'reports', 'questions', 'settings']
    : role === 'reception'
      ? ['debtors', 'absent', 'schedule', 'homework', 'attendance', 'reports', 'settings']
      : role === 'teacher'
        ? ['schedule', 'questions', 'reports', 'profile']
        : ['payments', 'settings'])
    .filter((id) => id === 'profile' || id === 'settings'
      || (id === 'payments' && student)
      || (id === 'debtors' && canAccessTable(role, 'payments'))
      || (id === 'absent' && privileged)
      || (id === 'schedule' && !student)
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
      <div className="mini-app-content mx-auto w-full max-w-xl" inert={moreOpen}>
        <header className="mini-app-bar flex min-h-14 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {page !== 'dashboard' && (
              <button type="button" className="mini-icon-button" aria-label={t('Ortga')} onClick={goBack}>
                <ArrowLeft size={18} />
              </button>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-lg font-extrabold">{pageTitles[page] ? t(pageTitles[page]) : 'Kamol School'}</h1>
              <p className="truncate text-xs text-[var(--mini-muted)]">{t(roleLabels[role] || role)} · {user.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="mini-icon-button mini-notification-button"
              onClick={() => navTo('notifications')}
              aria-label={t('Bildirishnomalar{v0}', { v0: notificationCount + unreadScheduleCount ? `, ${notificationCount + unreadScheduleCount} ta` : '' })}
              title={t('Bildirishnomalar')}
            >
              <Bell size={18} />
              {notificationCount + unreadScheduleCount > 0 && <span className="mini-notification-badge">{notificationCount + unreadScheduleCount > 9 ? '9+' : notificationCount + unreadScheduleCount}</span>}
            </button>
            <button ref={moreButtonRef} type="button" className="mini-icon-button" onClick={() => setMoreOpen((open) => !open)} aria-label={t('Ko‘proq menyu')} aria-expanded={moreOpen}>
              <Ellipsis size={19} />
            </button>
            <button type="button" className="mini-icon-button" onClick={() => refresh(user)} aria-label={t('Yangilash')} title={t('Yangilash')} disabled={loading}>
              <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </header>

        {error && (
          <div className="mt-4">
            <Toast kind="error">{error}</Toast>
            <ActionButton
              className="mini-secondary mt-2"
              onClick={() => user ? refresh(user) : window.location.reload()}
              disabled={loading}
            >
              {t('Qayta urinish')}
            </ActionButton>
          </div>
        )}
        {notice && <Toast>{notice}</Toast>}
        {loading && <Skeleton rows={2} />}

        {page === 'dashboard' && (
          <section className="mt-5 grid gap-3">
            {student && (
              <>
                <StatTile
                  label={t('Keyingi dars')}
                  value={nextLesson ? nextLesson.groupName : '—'}
                  sub={nextLesson ? `${nextLesson.date === scheduleToday ? t('Bugun') : displayIsoDate(nextLesson.date)} · ${nextLesson.startTime || ''}${nextLesson.status === 'changed' ? ` · ${t('O‘zgartirildi')}` : ''}` : t('Jadval bo‘sh')}
                  onClick={() => navTo('attendance')}
                />
                <div className="grid grid-cols-2 gap-3">
                  <StatTile label={t('Yangi vazifalar')} value={homeworks.filter((task) => !task.submission).length} onClick={() => navTo('homework')} />
                  <StatTile label={t('Shu oy topshirilgan')} value={thisMonthSubmissions.length} onClick={() => navTo('homework')} />
                  <StatTile label={t('Shu oy to‘langan')} value={money(payments.filter((item) => !item.voided_at && Number(item.month) === currentMonth && Number(item.year) === currentYear).reduce((sum, item) => sum + Number(item.amount || 0), 0))} onClick={() => navTo('payments')} />
                  <StatTile label={t('Shu oy kelmagan')} value={attendance.filter((item) => item.status === 'absent' && String(item.date).slice(0, 7) === scheduleToday.slice(0, 7)).length} onClick={() => navTo('attendance')} />
                </div>
              </>
            )}
            {teacher && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <StatTile label={t('Tekshirilmagan')} value={notificationCount} tone={notificationCount ? 'text-[var(--mini-accent)]' : ''} onClick={() => navTo('homework')} />
                  <StatTile label={t('Bugungi darslar')} value={todayLessonCount} onClick={() => navTo('schedule')} />
                </div>
                {!!todayLessons.length && (
                  <Panel>
                    {todayLessons.map((lesson) => (
                      <p key={`${lesson.groupId}-${lesson.slotId}`} className="flex justify-between gap-3 border-t border-[var(--mini-border)] py-2 text-sm first:border-t-0">
                        <span className="truncate font-semibold">{lesson.groupName}</span>
                        <span className="shrink-0 text-[var(--mini-muted)]">{lesson.startTime}{lesson.endTime ? `–${lesson.endTime}` : ''}</span>
                      </p>
                    ))}
                  </Panel>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <ActionButton onClick={() => navTo('attendance')}>{t('Davomat')}</ActionButton>
                  <ActionButton className="mini-secondary" onClick={() => { navTo('homework'); setSelectedId('new') }}>{t('Vazifa berish')}</ActionButton>
                </div>
              </>
            )}
            {privileged && (
              <>
                {role === 'owner' && (
                  <StatTile
                    label={t('Shu oy foyda')}
                    value={financeSummary ? money(financeSummary.net) : '…'}
                    sub={financeSummary ? `${t('Tushum')}: ${money(financeSummary.income)}` : ''}
                    onClick={() => navTo('finance')}
                  />
                )}
                <div className="grid grid-cols-2 gap-3">
                  {canAccessTable(role, 'payments') && (
                    <StatTile label={t('Qarzdorlar')} value={debtorCount} sub={debtorCount ? money(debtTotal) : ''} tone={debtorCount ? 'text-rose-400' : ''} onClick={() => navTo('debtors')} />
                  )}
                  <StatTile label={t('Bugun kelmadi')} value={absentRows.filter((row) => row.status === 'absent').length} onClick={() => navTo('absent')} />
                  <StatTile label={t('Bugungi darslar')} value={todayLessonCount} onClick={() => navTo('schedule')} />
                  <StatTile label={t('Yangi savollar')} value={questionTickets.length} onClick={() => navTo('questions')} />
                  <StatTile label={t('O‘quvchilar')} value={students.length} onClick={() => navTo('management')} />
                  <StatTile label={t('Guruhlar')} value={groups.length} onClick={() => navTo('groups')} />
                </div>
                {canAccessTable(role, 'payments', 'insert') && (
                  <ActionButton onClick={() => { setPaymentForm((current) => ({ ...current, studentId: '', amount: '' })); navTo('payments') }}>{t('To‘lov qabul qilish')}</ActionButton>
                )}
              </>
            )}
          </section>
        )}

        {page === 'groups' && (
          <section className="mt-7 grid gap-3">
            {canAccessTable(role, 'groups', 'insert') && (
              <ActionButton className="mini-secondary" onClick={() => navTo('management')}>{t('Guruhlarni boshqarish')}</ActionButton>
            )}
            {groups.map((group) => {
              const memberCount = students.filter((item) => (item.group_ids || []).includes(group.id)).length
              const changes = scheduleEntries.filter((lesson) => lesson.groupId === group.id
                && ['changed', 'cancelled', 'rescheduled'].includes(lesson.status)).slice(0, 3)
              return (
                <Panel key={group.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate font-bold">{group.name}</h2>
                      {!teacher && <p className="mt-1 truncate text-xs text-[var(--mini-muted)]">{teachers.find((item) => item.id === group.teacher_id)?.name || t('O‘qituvchi yo‘q')}</p>}
                    </div>
                    <span className="mini-badge shrink-0">{t('{count} o‘quvchi', { count: memberCount })}</span>
                  </div>
                  <p className="mt-2 text-sm text-[var(--mini-muted)]">
                    {normalizeScheduleWeekdays(group.schedule || []).map((slot) => `${weekdayShort(slot.day)} ${slot.startTime || ''}${slot.endTime ? `–${slot.endTime}` : ''}`).join(' · ') || t('Jadval yo‘q')}
                  </p>
                  {changes.map((lesson) => (
                    <p key={`${lesson.slotId}-${lesson.date}`} className="mt-1 text-xs font-semibold text-[var(--mini-accent)]">
                      {displayIsoDate(lesson.date)} · {lesson.status === 'cancelled' ? t('Bekor qilindi')
                        : lesson.status === 'rescheduled' ? `${t('Ko‘chirildi')} → ${displayIsoDate(lesson.newDate)}`
                          : `${t('O‘zgartirildi')} · ${lesson.startTime}–${lesson.endTime}`}
                    </p>
                  ))}
                  <ActionButton className="mini-secondary mt-3 min-h-11 w-full text-sm" onClick={() => setScheduleChangeGroup(group)}>{t('Jadvalni o‘zgartirish')}</ActionButton>
                </Panel>
              )
            })}
            {!groups.length && !loading && <EmptyState title={t('Guruh yo‘q')} />}
          </section>
        )}

        {page === 'staff' && role === 'owner' && (
          <section className="mt-7 grid gap-3">
            <Panel>
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-bold">{t('Xodimlar')}</h2>
                <ActionButton onClick={() => {
                  setEditingStaffId(null)
                  setStaffUsernameAuto(true)
                  setStaffForm({ name: '', phone: '', role: 'reception', username: '', password: '' })
                  setStaffFormOpen((open) => !open)
                }}><Plus size={16} /> {t('Xodim qo‘shish')}</ActionButton>
              </div>
              {staffFormOpen && (
                <form id="mini-staff-form" className="mt-4 grid gap-3 border-t border-[var(--mini-border)] pt-4" onSubmit={saveStaff}>
                  <h3 className="font-semibold">{editingStaffId ? t('Xodim ma’lumotlarini tahrirlash') : t('Yangi xodim akkaunti')}</h3>
                  <label className="mini-field"><span>{t('Ism va familiya')}</span><input value={staffForm.name} onChange={(event) => setStaffForm((current) => ({ ...current, name: event.target.value, username: staffUsernameAuto ? loginBaseFromName(event.target.value) : current.username }))} required /></label>
                  <label className="mini-field"><span>{t('Telefon')}</span><input type="tel" value={staffForm.phone} onChange={(event) => setStaffForm({ ...staffForm, phone: event.target.value })} /></label>
                  <label className="mini-field"><span>{t('Rol')}</span><select value={staffForm.role} onChange={(event) => setStaffForm({ ...staffForm, role: event.target.value })}><option value="reception">{t('Qabulxona')}</option><option value="teacher">{t('O‘qituvchi')}</option></select></label>
                  <label className="mini-field"><span>{t('Login')}</span><input value={staffForm.username} onChange={(event) => { setStaffUsernameAuto(false); setStaffForm({ ...staffForm, username: event.target.value }) }} required /></label>
                  <label className="mini-field"><span>{editingStaffId ? t('Yangi parol (ixtiyoriy)') : t('Parol (kamida 12 belgi)')}</span><input type="password" autoComplete="new-password" value={staffForm.password} onChange={(event) => setStaffForm({ ...staffForm, password: event.target.value })} minLength={staffForm.password ? 12 : undefined} required={!editingStaffId} /></label>
                  <div className="flex flex-wrap gap-2"><ActionButton type="submit" disabled={busy}>{busy ? t('Saqlanmoqda…') : editingStaffId ? t('Xodimni saqlash') : t('Xodim qo‘shish')}</ActionButton><ActionButton className="mini-secondary" disabled={busy} onClick={() => { setStaffFormOpen(false); setEditingStaffId(null); setStaffUsernameAuto(true) }}>{t('Bekor qilish')}</ActionButton></div>
                </form>
              )}
              <div className="mt-3 divide-y divide-[var(--mini-border)]">
                {staffRows.map((item) => (
                  <div key={item.id} className="flex min-h-14 items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{item.name}</p>
                      <p className="text-xs text-[var(--mini-muted)]">{item.role === 'reception' ? t('Qabulxona') : t('O‘qituvchi')} · {item.username}</p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      <span className={`mini-badge ${item.is_active ? 'mini-badge-success' : 'mini-badge-muted'}`}>
                        {item.is_active ? t('Faol') : t('Faol emas')}
                      </span>
                      <ActionButton className="mini-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => {
                        setEditingStaffId(item.id)
                        setStaffUsernameAuto(false)
                        setStaffForm({ name: item.name, phone: item.phone || '', role: item.role, username: item.username, password: '' })
                        setStaffFormOpen(true)
                      }}>{t('Tahrirlash / parol')}</ActionButton>
                      <ActionButton className="mini-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => requestStaffStatusChange(item)}>{item.is_active ? t('Faolsizlantirish') : t('Faollashtirish')}</ActionButton>
                    </div>
                  </div>
                ))}
                {!staffRows.length && !loading && <p className="py-3 text-sm text-[var(--mini-muted)]">{t('Xodimlar ro‘yxati bo‘sh.')}</p>}
              </div>
            </Panel>
            <Panel>
              <h2 className="font-bold">{t('O‘qituvchilar')}</h2>
              <div className="mt-2 divide-y divide-[var(--mini-border)]">
                {teachers.map((item) => <p key={item.id} className="py-3 text-sm">{item.name} · {item.phone || t('Telefon yo‘q')}</p>)}
                {!teachers.length && !loading && <p className="py-3 text-sm text-[var(--mini-muted)]">{t('O‘qituvchilar topilmadi.')}</p>}
              </div>
            </Panel>
          </section>
        )}

        {(page === 'profile' || page === 'settings') && (
          <section className="mt-5 grid gap-3">
            <Panel>
              <div className="flex items-center gap-3">
                <Avatar name={user.name} />
                <div className="min-w-0">
                  <h2 className="truncate font-bold">{user.name}</h2>
                  <p className="text-sm text-[var(--mini-muted)]">{t(roleLabels[role] || role)}</p>
                </div>
              </div>
              {(user.username || user.phone) && (
                <div className="mt-4 grid gap-1 text-sm">
                  {user.username && <p><span className="text-[var(--mini-muted)]">{t('Login')}: </span>{user.username}</p>}
                  {user.phone && <p><span className="text-[var(--mini-muted)]">{t('Telefon')}: </span>{user.phone}</p>}
                </div>
              )}
            </Panel>
            <Panel>
              <h2 className="font-bold">{t('Til')}</h2>
              <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('Til')}>
                {MINI_LANGUAGES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={lang === item.id}
                    className={`mini-chip justify-center${lang === item.id ? ' mini-chip-active' : ''}`}
                    onClick={() => changeLanguage(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </Panel>
            {student && (
              <Panel>
                <button type="button" className="mini-more-item" onClick={() => navTo('payments')}>{t('To‘lovlarim')} <ArrowLeft className="rotate-180" size={16} /></button>
                <button type="button" className="mini-more-item" onClick={() => navTo('attendance')}>{t('Davomatim')} <ArrowLeft className="rotate-180" size={16} /></button>
              </Panel>
            )}
            <ActionButton className="mini-secondary" onClick={logout}><LogOut size={16} /> {t('Chiqish')}</ActionButton>
          </section>
        )}

        {page === 'homework' && (
          <section className="mt-5">
            {teacher && selectedId !== 'new' && <ActionButton className="mb-4 w-full" onClick={() => setSelectedId('new')}><Plus size={16} /> {t('Vazifa berish')}</ActionButton>}
            {teacher && selectedId === 'new' && (
              <Panel className="mb-4">
                <h2 className="font-bold">{t('Guruhga vazifa berish')}</h2>
                <form id="mini-homework-form" className="mt-4 grid gap-3" onSubmit={saveHomework}>
                  <label className="mini-field"><span>{t('Guruh')}</span>
                    <select value={createForm.groupId} onChange={(event) => setCreateForm({ ...createForm, groupId: event.target.value })} required>
                      <option value="">{t('Guruhni tanlang')}</option>
                      {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                    </select>
                  </label>
                  <label className="mini-field"><span>{t('Sarlavha')}</span><input value={createForm.title} onChange={(event) => setCreateForm({ ...createForm, title: event.target.value })} required /></label>
                  <label className="mini-field"><span>{t('Izoh')}</span><textarea rows="3" value={createForm.description} onChange={(event) => setCreateForm({ ...createForm, description: event.target.value })} /></label>
                  <label className="mini-field"><span>{t('Muddat')}</span><input type="datetime-local" value={createForm.deadline} onChange={(event) => setCreateForm({ ...createForm, deadline: event.target.value })} /></label>
                  <label className="mini-field"><span>{t('Fayl')}</span><input type="file" onChange={(event) => setCreateForm({ ...createForm, file: event.target.files?.[0] || null })} /></label>
                  <div className="flex gap-2">
                    <ActionButton type="submit" disabled={busy}>{busy ? t('Saqlanmoqda…') : t('Vazifani yuborish')}</ActionButton>
                    <ActionButton className="mini-secondary" onClick={() => setSelectedId(null)}>{t('Bekor')}</ActionButton>
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
            ) : !loading && <EmptyState title={t('Hozircha vazifalar yo‘q')} />}
          </section>
        )}

        {page === 'questions' && (
          <section className="mt-5 grid gap-4">
            {student ? (
              <Panel>
                <h2 className="font-bold">{t('Savol yuborish')}</h2>
                <form id="mini-question-form" className="mt-3 grid gap-3" onSubmit={sendQuestion}>
                  <label className="mini-field"><span>{t('Savolingiz')}</span><textarea rows="4" maxLength="10000" value={questionText} onChange={(event) => setQuestionText(event.target.value)} required /></label>
                  {studentGroups.length > 1 && (
                    <label className="mini-field"><span>{t('Qaysi guruh bo‘yicha?')}</span>
                      <select value={questionGroupId} onChange={(event) => setQuestionGroupChoice(event.target.value)}>
                        <option value="">{t('Umumiy savol (qabulxonaga)')}</option>
                        {studentGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                      </select>
                    </label>
                  )}
                  <label className="mini-field"><span>{t('Fayl')}</span><input key={questionFileKey} type="file" onChange={(event) => {
                    const file = event.target.files?.[0] || null
                    if (file && file.size > 20 * 1024 * 1024) {
                      setError(t('Savolga biriktiriladigan fayl 20 MB dan oshmasligi kerak.'))
                      event.target.value = ''
                      setQuestionFile(null)
                      return
                    }
                    setError('')
                    setQuestionFile(file)
                  }} /></label>
                  <ActionButton type="submit" disabled={busy || !questionText.trim()}>{busy ? t('Yuborilmoqda…') : t('Savol yuborish')}</ActionButton>
                </form>
              </Panel>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="mini-field"><span>{t('Holati')}</span><select value={questionStatus} onChange={(event) => setQuestionStatus(event.target.value)}>
                  <option value="">{t('Barchasi')}</option><option value="open">{t('Ochiq')}</option><option value="answered">{t('Javob berilgan')}</option><option value="closed">{t('Yopilgan')}</option>
                </select></label>
                <label className="mini-field"><span>{t('Qidirish')}</span><input value={questionSearch} onChange={(event) => setQuestionSearch(event.target.value)} placeholder={t('O‘quvchi yoki matn')} /></label>
              </div>
            )}
            {questionTickets.map((ticket) => (
              <Panel key={ticket.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="break-words font-bold">{student ? t('Sizning savolingiz') : ticket.student_name}</h2>
                    <p className="text-xs text-[var(--mini-muted)]">{ticket.status === 'open' ? t('Ochiq') : ticket.status === 'answered' ? t('Javob berilgan') : t('Yopilgan')} · {formatDate(ticket.last_message_at)}</p>
                  </div>
                  {Number(ticket.unread_count) > 0 && <span className="rounded-full bg-[var(--mini-accent)] px-2 py-1 text-xs">{ticket.unread_count} yangi</span>}
                </div>
                <div className="mt-3 grid gap-3">
                  {ticket.messages?.map((message) => (
                    <div key={message.id} className="rounded-2xl bg-[var(--mini-bg)] p-3">
                      <p className="text-xs font-semibold text-[var(--mini-muted)]">{message.actor_role === 'student' ? t('O‘quvchi') : message.actor_role === 'teacher' ? t('O‘qituvchi') : t('Qabulxona')} · {formatDate(message.created_at)}</p>
                      {message.body && <p className="mt-1 whitespace-pre-wrap break-words text-sm">{message.body}</p>}
                      {message.file_url && <SubmissionFile file={{ kind: 'attachment', original_name: t('Ilova'), download_url: message.file_url }} />}
                    </div>
                  ))}
                </div>
                {!student && ticket.status !== 'closed' && (
                  <div className="mt-3 grid gap-2">
                    <label className="mini-field"><span>{t('Javob')}</span><textarea rows="2" value={questionReply[ticket.id] || ''} onChange={(event) => setQuestionReply((current) => ({ ...current, [ticket.id]: event.target.value }))} /></label>
                    <div className="flex flex-wrap gap-2">
                      <ActionButton disabled={busy || !String(questionReply[ticket.id] || '').trim()} onClick={() => sendQuestionReply(ticket)}>{t('Javob yuborish')}</ActionButton>
                      {['owner', 'reception'].includes(role) && <ActionButton className="mini-secondary" disabled={busy} onClick={() => confirmCloseQuestion(ticket)}>{t('Yopish')}</ActionButton>}
                    </div>
                  </div>
                )}
              </Panel>
            ))}
            {!questionTickets.length && <Panel>{loading ? t('Savollar yuklanmoqda…') : student ? t('Sizda savol yo‘q.') : t('Bu filtrda savol topilmadi.')}</Panel>}
          </section>
        )}

        {page === 'detail' && !selectedHomework && !loading && (
          <section className="mt-7">
            <EmptyState title={t('Vazifa topilmadi')} />
            <ActionButton className="mini-secondary mt-3 w-full" onClick={() => { setSelectedId(null); setPage('homework') }}>{t('Vazifalar ro‘yxatiga qaytish')}</ActionButton>
          </section>
        )}

        {page === 'detail' && selectedHomework && (
          <section className="mt-7 grid gap-4">
            <Panel>
              <p className="text-sm text-[var(--mini-muted)]">{selectedHomework.groups?.name || t('Uy vazifasi')}</p>
              <h1 className="mt-1 text-xl font-extrabold">{selectedHomework.title}</h1>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{selectedHomework.description || t('Izoh berilmagan.')}</p>
              <p className="mt-3 text-xs text-[var(--mini-muted)]">{t('Muddat')}: {formatCountdown(selectedHomework.due_at, now)}</p>
              {selectedHomework.file_url && <a className="mini-link mt-3 inline-block" href={selectedHomework.file_url} target="_blank" rel="noreferrer">{t('Vazifa faylini ochish')}</a>}
            </Panel>
            {student && (
              <Panel>
                <h2 className="font-bold">{t('Javobni topshirish')}</h2>
                {selectedHomework.submission?.state && (
                  <p className="mt-2 text-sm text-[var(--mini-muted)]">
                    Holati: {selectedHomework.submission.state === 'draft' ? t('Qoralama') : selectedHomework.submission.state === 'checked'
                      ? selectedHomework.submission.teacher_result === 'done' ? t('Bajardi') : t('Bajarmadi')
                      : selectedHomework.submission.state === 'expired' ? t('Qoralama muddati tugagan') : t('Topshirildi · tekshirilmoqda')}
                  </p>
                )}
                {selectedHomework.submission?.state === 'draft'
                  && !selectedHomework.submission?.files?.some((file) => ['voice', 'video_note'].includes(file.kind))
                  && <p className="mt-2 text-sm font-semibold text-amber-300">{t('Dumaloq video yoki ovozli xabar yuborilmagan.')}</p>}
                {selectedHomework.submission?.feedback && <p className="mt-2 text-sm">Izoh: {selectedHomework.submission.feedback}</p>}
                {selectedHomework.submission?.state === 'checked' && (
                  <p className="mt-2 text-sm">{t('O‘qituvchi bahosi:')} <strong>{selectedHomework.submission.teacher_result === 'done' ? t('Bajardi') : t('Bajarmadi')}</strong></p>
                )}
                {selectedHomework.submission?.files?.map((file) => <SubmissionFile key={file.id} file={file} />)}
                {['submitted', 'checked'].includes(selectedHomework.submission?.state) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <ActionButton disabled={busy} onClick={() => markStudentResult(selectedHomework.submission.id, 'done')}>{t('Bajardim')}</ActionButton>
                    <ActionButton disabled={busy} className="mini-secondary" onClick={() => markStudentResult(selectedHomework.submission.id, 'not_done')}>{t('Bajarolmadim')}</ActionButton>
                  </div>
                )}
                {!selectedHomeworkSubmissionLocked && <form id="mini-submission-form" className="mt-4 grid gap-3" onSubmit={saveSubmission}>
                  <label className="mini-field"><span>{t('Matnli javob')}</span><textarea rows="4" value={submissionForm.text} onChange={(event) => setSubmissionForm({ ...submissionForm, text: event.target.value })} /></label>
                  <label className="mini-field"><span>{t('Fayllar')}</span><input type="file" multiple onChange={(event) => chooseSubmissionFiles(event.target.files)} /></label>
                  {!!submissionForm.files.length && <ul className="grid gap-1 text-xs text-[var(--mini-muted)]">{submissionForm.files.map((file) => <li key={`${file.name}:${file.size}`}>{file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB</li>)}</ul>}
                  {!selectedHomeworkHasProof && typeof window.MediaRecorder === 'function' && navigator.mediaDevices?.getUserMedia && (
                    <div className="grid gap-2">
                      <ActionButton className={recording ? 'mini-danger' : 'mini-secondary'} disabled={busy} onClick={toggleVoiceRecording}>
                        {recording ? <><Square size={15} /> {t('Ovoz yozishni tugatish')}</> : <><Mic size={15} /> {t('Ilovada ovoz yozish')}</>}
                      </ActionButton>
                      {recordedProof && <p className="text-xs text-[var(--mini-muted)]">{t('Ovozli tasdiq tayyor:')} {recordedProofDuration} {t('soniya. Qoralamani saqlang.')}</p>}
                    </div>
                  )}
                  <ActionButton type="submit" disabled={busy || (!submissionForm.text.trim() && !submissionForm.files.length)}>{busy ? t('Saqlanmoqda…') : t('Qoralamani saqlash')}</ActionButton>
                </form>}
                <ActionButton className="mini-secondary mt-3 w-full" onClick={async () => {
                  try {
                    const link = submissionBotLink || await fetchHomeworkBotLink(selectedHomework.id)
                    setSubmissionBotLink(link)
                    window.Telegram?.WebApp?.openTelegramLink?.(link)
                    if (!window.Telegram?.WebApp?.openTelegramLink) window.open(link, '_blank', 'noopener,noreferrer')
                  } catch (linkError) {
                    setError(linkError.message || t('Bot havolasini ochib bo‘lmadi.'))
                  }
                }}>{t('Bot orqali tasdiq yozuvini yuborish')}</ActionButton>
              </Panel>
            )}
            {teacher && (
              <Panel className="grid gap-3 sm:grid-cols-2">
                <label className="mini-field"><span>{t('Tekshiruv holati')}</span>
                  <select value={reviewStatusFilter} onChange={(event) => setReviewStatusFilter(event.target.value)}>
                    <option value="all">{t('Barcha holatlar')}</option>
                    <option value="pending">{t('Tekshirilmagan')}</option>
                    <option value="done">{t('Bajardi')}</option>
                    <option value="not_done">{t('Bajarmadi')}</option>
                  </select>
                </label>
                <label className="mini-field"><span>{t('O‘quvchini qidirish')}</span>
                  <input value={reviewStudentFilter} onChange={(event) => setReviewStudentFilter(event.target.value)} placeholder={t('Ism bo‘yicha')} />
                </label>
              </Panel>
            )}
            {teacher && filteredReviewSubmissions.map((submission) => (
              <Panel key={submission.id}>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-bold">{submission.student_name || submission.students?.name || t('O‘quvchi')}</h2>
                  <span className="text-xs text-[var(--mini-muted)]">{t('Urinish')} {submission.attempt_number || 1} · {formatDate(submission.submitted_at)}</span>
                </div>
                {submission.content_text && <p className="mt-3 whitespace-pre-wrap text-sm">{submission.content_text}</p>}
                {submission.files?.map((file) => (
                  <div key={file.id} className="text-sm">
                    <SubmissionFile file={file} />
                    {isExecutableFile(file)
                      && <span className="ml-2 text-amber-300">{t('Xavfli fayl turi')}</span>}
                  </div>
                ))}
                <label className="mini-field mt-3"><span>{t('O‘qituvchi izohi')}</span>
                  <textarea rows="2" value={feedbacks[submission.id] ?? submission.feedback ?? ''} onChange={(event) => setFeedbacks({ ...feedbacks, [submission.id]: event.target.value })} />
                </label>
                <div className="mt-3 flex gap-2">
                  <ActionButton disabled={busy} onClick={() => saveReview(submission, 'approved')}><Check size={15} /> {t('Bajardi')}</ActionButton>
                  <ActionButton disabled={busy} className="mini-danger" onClick={() => saveReview(submission, 'rejected')}>{t('Bajarmadi')}</ActionButton>
                </div>
              </Panel>
            ))}
            {teacher && selectedHomework.notSubmitted?.length > 0 && (
              <Panel>
                <h2 className="font-bold">{t('Hali topshirmaganlar')}</h2>
                {selectedHomework.notSubmitted.map((person) => <p key={person.id} className="mt-2 text-sm">{person.name}</p>)}
              </Panel>
            )}
            <Panel>
              <h2 className="font-bold">{t('Topshiriq tarixi')}</h2>
              <div className="mt-3 grid gap-3">
                {homeworkHistory.submissions.map((attempt) => (
                  <div key={attempt.id} className="rounded-2xl bg-[var(--mini-bg)] p-3">
                    <p className="text-sm font-semibold">{t('Urinish')} {attempt.attempt_number} · {attempt.state === 'draft' ? t('Qoralama') : attempt.state === 'expired' ? t('Muddati tugagan') : attempt.state === 'checked' ? attempt.teacher_result === 'done' ? t('Bajardi') : t('Bajarmadi') : t('Topshirildi')}</p>
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
                      <p className="text-sm">{t(homeworkEventLabels[event.event_type] || event.event_type)}</p>
                      {detailText && <p className="mt-1 break-words text-xs text-[var(--mini-muted)]">{detailText}</p>}
                      <p className="mt-1 text-[11px] text-[var(--mini-muted)]">{formatDate(event.created_at)}</p>
                    </div>
                  )
                })}
                {!homeworkHistory.events.length && !homeworkHistory.submissions.length
                  && <p className="text-sm text-[var(--mini-muted)]">{t('Tarix hali mavjud emas.')}</p>}
              </div>
            </Panel>
          </section>
        )}

        {page === 'payments' && (
          <section className="mt-5 grid gap-3">
            {canAccessTable(role, 'payments', 'insert') && (
              <PaymentForm
                students={students}
                groups={groups}
                payments={payments}
                value={paymentForm}
                onChange={setPaymentForm}
                onSubmit={savePayment}
                busy={busy}
              />
            )}
            {!student && (
              <div className="grid grid-cols-2 gap-2">
                <ActionButton className="mini-secondary" onClick={() => navTo('debtors')}>{t('Qarzdorlar')} · {debtorCount}</ActionButton>
                <label className="mini-field">
                  <input type="search" aria-label={t('Qidirish')} placeholder={t('Qidirish')} value={paymentSearch} onChange={(event) => { setPaymentSearch(event.target.value); setPaymentPage(0) }} />
                </label>
              </div>
            )}
            {visiblePayments.map((item) => {
              const content = (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-bold">{student ? `${monthName(item.month)} ${item.year}` : item.student_name || t('O‘quvchi')}</h2>
                    <p className="mt-1 text-xs text-[var(--mini-muted)]">
                      {formatDate(item.paid_at)}{student ? '' : ` · ${monthName(item.month)} ${item.year}`}
                      {item.method ? ` · ${paymentMethodLabel(item.method)}` : ''}
                    </p>
                    {item.voided_at && <span className="mini-badge mini-badge-muted mt-2 inline-block">{t('Bekor qilingan')}</span>}
                  </div>
                  <strong className={`shrink-0 text-sm${item.voided_at ? ' line-through' : ''}`}>{money(item.amount)}</strong>
                </div>
              )
              return student ? (
                <Panel key={item.id} className={item.voided_at ? 'opacity-60' : ''}>{content}</Panel>
              ) : (
                <button key={item.id} type="button" className={`mini-panel mini-pressable w-full rounded-3xl border p-4 text-left${item.voided_at ? ' opacity-60' : ''}`} onClick={() => openStudentPayments({ id: item.student_id })}>{content}</button>
              )
            })}
            {!filteredPayments.length && !loading && <EmptyState title={t('To‘lov yo‘q')} />}
            {filteredPayments.length > 20 && (
              <div className="mini-pagination">
                <ActionButton className="mini-secondary" disabled={paymentPage === 0} onClick={() => setPaymentPage((current) => current - 1)}>{t('Oldingi')}</ActionButton>
                <span>{paymentPage + 1} / {Math.ceil(filteredPayments.length / 20)}</span>
                <ActionButton className="mini-secondary" disabled={(paymentPage + 1) * 20 >= filteredPayments.length} onClick={() => setPaymentPage((current) => current + 1)}>{t('Keyingi')}</ActionButton>
              </div>
            )}
          </section>
        )}

        {page === 'debtors' && canAccessTable(role, 'payments') && (
          <DebtorsScreen
            students={students}
            groups={groups}
            payments={payments}
            canAcceptPayment={canAccessTable(role, 'payments', 'insert')}
            onAcceptPayment={acceptPaymentFor}
            onOpenStudent={openStudentPayments}
          />
        )}

        {page === 'studentPayments' && canAccessTable(role, 'payments') && (
          <StudentPaymentsScreen
            student={students.find((item) => item.id === paymentStudentId)}
            groups={groups}
            payments={payments}
            busy={busy}
            canAcceptPayment={canAccessTable(role, 'payments', 'insert')}
            canEdit={privileged}
            onAcceptPayment={acceptPaymentFor}
            onVoid={voidPaymentRecord}
            onCorrect={correctPaymentRecord}
          />
        )}

        {page === 'absent' && privileged && (
          <AbsentTodayScreen rows={absentRows} loading={absentLoading} students={students} groups={groups} todayLessons={todayLessons} />
        )}

        {page === 'schedule' && !student && (
          <WeekScheduleScreen
            entries={scheduleEntries}
            teachers={teachers}
            showTeacher={privileged}
            onChangeGroup={(groupId) => {
              const group = groups.find((item) => item.id === groupId)
              if (group) setScheduleChangeGroup(group)
            }}
          />
        )}

        {page === 'attendance' && (
          <section className="mt-5">
            {student && (
              <Panel className="mt-4">
                <h2 className="font-bold">{t('Haftalik dars jadvali')}</h2>
                <div className="mt-3 grid gap-2">
                  {scheduleEntries.map((lesson) => (
                    <div key={`${lesson.groupId}-${lesson.slotId}-${lesson.date}`} className="rounded-2xl bg-[var(--mini-bg)] p-3">
                      <p className="font-semibold">{displayIsoDate(lesson.date)} · {lesson.groupName}</p>
                      <p className="mt-1 text-sm text-[var(--mini-muted)]">
                        {lesson.status === 'cancelled' ? t('Dars bekor qilingan')
                          : lesson.status === 'rescheduled' ? t('Dars {v0} sanasiga ko‘chirilgan', { v0: displayIsoDate(lesson.newDate) })
                            : `${lesson.startTime || t('Vaqt yo‘q')}${lesson.endTime ? `–${lesson.endTime}` : ''}${lesson.status === 'changed' ? t(' · O‘zgartirilgan') : ''}`}
                      </p>
                    </div>
                  ))}
                  {!scheduleEntries.length && <p className="text-sm text-[var(--mini-muted)]">{t('Sizga dars jadvali biriktirilmagan.')}</p>}
                </div>
              </Panel>
            )}
            {canMarkAttendance && (
              <Panel className="mt-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-bold">{faceLabels.manualTitle()}</h2>
                    <p className="mt-1 text-xs text-[var(--mini-muted)]">{faceLabels.manualHint()}</p>
                  </div>
                  <ActionButton className="mini-secondary min-h-9 shrink-0 px-3 text-xs" aria-expanded={manualAttendanceOpen} onClick={() => setManualAttendanceOpen((value) => !value)}>
                    {manualAttendanceOpen ? faceLabels.hideManual() : faceLabels.showManual()}
                  </ActionButton>
                </div>
                {manualAttendanceOpen && <form id="mini-attendance-form" className="mt-4 grid gap-3" onSubmit={saveAttendance}>
                  <label className="mini-field"><span>{t('Guruh')}</span><select value={attendanceForm.groupId} onChange={(event) => setAttendanceForm({ ...attendanceForm, groupId: event.target.value, studentId: '' })} required>
                    <option value="">{t('Guruhni tanlang')}</option>
                    {groups.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select></label>
                  <label className="mini-field"><span>{t('O‘quvchi')}</span><select value={attendanceForm.studentId} onChange={(event) => setAttendanceForm({ ...attendanceForm, studentId: event.target.value })} disabled={!attendanceForm.groupId} required>
                    <option value="">{attendanceForm.groupId ? attendanceStudents.length ? t('O‘quvchini tanlang') : t('Bu guruhda o‘quvchi yo‘q') : t('Avval guruhni tanlang')}</option>
                    {attendanceStudents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select></label>
                  <label className="mini-field"><span>{t('Holati')}</span><select value={attendanceForm.status} onChange={(event) => setAttendanceForm({ ...attendanceForm, status: event.target.value })}>
                    <option value="present">{t('Keldi')}</option><option value="late">{t('Kechikdi')}</option><option value="absent">{t('Kelmagan')}</option>
                  </select></label>
                  <label className="mini-field"><span>{t('Izoh')}</span><input value={attendanceForm.note} onChange={(event) => setAttendanceForm({ ...attendanceForm, note: event.target.value })} /></label>
                  <ActionButton type="submit" disabled={busy}>{busy ? t('Saqlanmoqda…') : t('Davomatni saqlash')}</ActionButton>
                </form>}
              </Panel>
            )}
            <div className="mt-4 grid gap-3">
              {attendance.map((item) => (
                <Panel key={item.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-bold">{student ? (item.groups?.name || t('Guruh')) : (students.find((person) => person.id === item.student_id)?.name || t('O‘quvchi'))}</h2>
                      <p className="mt-1 text-xs text-[var(--mini-muted)]">{formatDate(item.date)} · {item.groups?.name || t('Guruh')}</p>
                      {item.note && <p className="mt-2 text-sm">{item.note}</p>}
                      <p className="mt-2"><AttendanceSourceTag record={item} labels={faceLabels} /></p>
                    </div>
                    <span className="rounded-full bg-[var(--mini-bg)] px-3 py-1 text-xs">
                      {item.status === 'present' ? t('Keldi') : item.status === 'late' ? t('Kechikdi') : t('Kelmagan')}
                    </span>
                  </div>
                </Panel>
              ))}
              {!attendance.length && !loading && <Panel>{t('Davomat yozuvlari topilmadi.')}</Panel>}
            </div>
          </section>
        )}

        {page === 'finance' && canAccessPage(role, 'finance') && (
          <section className="mt-5 grid gap-4">
            <Panel>
              <p className="text-sm text-[var(--mini-muted)]">{monthName(currentMonth)} {currentYear}</p>
              <p className="mt-1 text-2xl font-extrabold">{money(financeSummary?.net || 0)}</p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <p className="text-[var(--mini-muted)]">{t('Tushum')}<strong className="mt-1 block text-sm text-[var(--mini-text)]">{money(financeSummary?.income || 0)}</strong></p>
                <p className="text-[var(--mini-muted)]">{t('Ish haqi')}<strong className="mt-1 block text-sm text-[var(--mini-text)]">{money(financeSummary?.salary_cost || 0)}</strong></p>
                <p className="text-[var(--mini-muted)]">{t('Xarajat')}<strong className="mt-1 block text-sm text-[var(--mini-text)]">{money(financeSummary?.expense_cost || 0)}</strong></p>
              </div>
            </Panel>
            <Panel>
              <h2 className="font-bold">{t('Xarajat qo‘shish')}</h2>
              <form className="mt-3 grid gap-3" onSubmit={saveExpense}>
                <label className="mini-field"><span>{t('Nomi')}</span><input value={expenseForm.title} onChange={(event) => setExpenseForm({ ...expenseForm, title: event.target.value })} required /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="mini-field"><span>{t('Miqdor')}</span><input type="number" inputMode="numeric" min="1" value={expenseForm.amount} onChange={(event) => setExpenseForm({ ...expenseForm, amount: event.target.value })} required /></label>
                  <label className="mini-field"><span>{t('Toifa')}</span>
                    <select value={expenseForm.category} onChange={(event) => setExpenseForm({ ...expenseForm, category: event.target.value })}>
                      {expenseCategoryOptions.map((category) => <option key={category} value={category}>{t(category)}</option>)}
                    </select>
                  </label>
                </div>
                <ActionButton type="submit" disabled={busy}>{busy ? t('Saqlanmoqda…') : t('Saqlash')}</ActionButton>
              </form>
            </Panel>
            <Panel>
              <h2 className="font-bold">{t('Xarajatlar')}</h2>
              <div className="mt-2 divide-y divide-[var(--mini-border)]">
                {expenses.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{item.title}</p>
                      <p className="text-xs text-[var(--mini-muted)]">{t(item.category || 'Operatsion')} · {formatDate(item.date)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <strong>{money(item.amount)}</strong>
                      <button type="button" className="mini-icon-button" aria-label={t('O‘chirish')} disabled={busy} onClick={() => confirmRemoveExpense(item)}><Trash2 size={16} /></button>
                    </div>
                  </div>
                ))}
                {!expenses.length && <p className="py-3 text-sm text-[var(--mini-muted)]">{t('Xarajat yo‘q')}</p>}
              </div>
            </Panel>
            <Panel>
              <h2 className="font-bold">{t('Ish haqi berish')}</h2>
              <form className="mt-3 grid gap-3" onSubmit={saveSalaryPayment}>
                <div className="grid grid-cols-2 gap-2">
                  <label className="mini-field"><span>{t('O‘qituvchi')}</span><select value={salaryForm.teacherId} onChange={(event) => setSalaryForm({ ...salaryForm, teacherId: event.target.value })} required>
                    <option value="">—</option>
                    {teachers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select></label>
                  <label className="mini-field"><span>{t('Miqdor')}</span><input type="number" inputMode="numeric" min="1" value={salaryForm.amount} onChange={(event) => setSalaryForm({ ...salaryForm, amount: event.target.value })} required /></label>
                </div>
                <ActionButton type="submit" disabled={busy}>{busy ? t('Saqlanmoqda…') : t('Saqlash')}</ActionButton>
              </form>
              <div className="mt-2 divide-y divide-[var(--mini-border)]">
                {salaryPayments.map((item) => <p key={item.id} className="flex justify-between gap-3 py-3 text-sm"><span className="truncate">{item.teachers?.name || t('O‘qituvchi')} · {formatDate(item.paid_at)}</span><strong className="shrink-0">{money(item.amount)}</strong></p>)}
              </div>
            </Panel>
          </section>
        )}

        {page === 'management' && privileged && (
          <section className="mt-5 grid gap-4">
            <Panel>
              <h2 className="font-bold">{editingStudentId ? t('O‘quvchini tahrirlash') : t('Yangi o‘quvchi')}</h2>
              <form id="mini-student-form" className="mt-3 grid gap-3" onSubmit={saveStudent}>
                <label className="mini-field"><span>{t('Ism va familiya')}</span><input value={studentForm.name} onChange={(event) => setStudentForm((current) => ({ ...current, name: event.target.value, username: current.autoUsername ? loginBaseFromName(event.target.value) : current.username }))} required /></label>
                <label className="mini-field"><span>{t('Telefon')}</span><input type="tel" value={studentForm.phone} onChange={(event) => setStudentForm({ ...studentForm, phone: event.target.value })} required /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="mini-field"><span>{t('Ota telefoni')}</span><input type="tel" value={studentForm.fatherPhone} onChange={(event) => setStudentForm({ ...studentForm, fatherPhone: event.target.value })} /></label>
                  <label className="mini-field"><span>{t('Ona telefoni')}</span><input type="tel" value={studentForm.motherPhone} onChange={(event) => setStudentForm({ ...studentForm, motherPhone: event.target.value })} /></label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="mini-field"><span>{t('Login')}</span><input value={studentForm.username} autoCapitalize="none" onChange={(event) => setStudentForm({ ...studentForm, username: event.target.value, autoUsername: false })} required /></label>
                  {!editingStudentId && <label className="mini-field"><span>{t('Parol')}</span><input type="password" autoComplete="new-password" value={studentForm.password} onChange={(event) => setStudentForm({ ...studentForm, password: event.target.value })} minLength={6} required /></label>}
                </div>
                {!!groups.length && (
                  <fieldset className="grid gap-2">
                    <legend className="mb-2 text-xs font-semibold text-[var(--mini-muted)]">{t('Guruhlar')}</legend>
                    <div className="flex flex-wrap gap-2">
                      {groups.map((group) => {
                        const checked = studentGroupsForm.includes(group.id)
                        return (
                          <label key={group.id} className={`mini-chip${checked ? ' mini-chip-active' : ''}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setStudentGroupsForm((current) => (current.includes(group.id)
                                ? current.filter((id) => id !== group.id)
                                : [...current, group.id]))}
                            />
                            {group.name}
                          </label>
                        )
                      })}
                    </div>
                  </fieldset>
                )}
                {!editingStudentId && <FaceCapture key={faceCaptureKey} labels={faceLabels} onChange={setFaceShots} disabled={busy} />}
                <div className="flex flex-wrap gap-2">
                  <ActionButton type="submit" disabled={busy}>{busy ? t('Saqlanmoqda…') : editingStudentId ? t('Saqlash') : t('Qo‘shish')}</ActionButton>
                  {editingStudentId && <ActionButton className="mini-secondary" disabled={busy} onClick={() => { setEditingStudentId(null); setStudentGroupsForm([]); setStudentForm({ name: '', phone: '', fatherPhone: '', motherPhone: '', groupId: '', username: '', password: '', autoUsername: true }) }}>{t('Bekor qilish')}</ActionButton>}
                </div>
              </form>
            </Panel>
            <Panel>
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-bold">{t('O‘quvchilar')} · {students.length}</h2>
              </div>
              <label className="mini-field mt-3">
                <input type="search" aria-label={t('Qidirish')} placeholder={t('Ism yoki telefon')} value={studentSearch} onChange={(event) => { setStudentSearch(event.target.value); setStudentPage(0) }} />
              </label>
              <div className="mt-1">
                {visibleStudents.map((item) => {
                  const memberGroups = groups.filter((group) => (item.group_ids || []).includes(group.id))
                  return (
                    <div key={item.id} className="border-t border-[var(--mini-border)] py-3 first:border-t-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{item.name}</p>
                          <p className="truncate text-xs text-[var(--mini-muted)]">
                            {[item.phone, memberGroups.map((group) => group.name).join(', ') || t('Guruhsiz')].filter(Boolean).join(' · ')}
                          </p>
                          <p className="mt-1 text-xs text-[var(--mini-muted)]">
                            {t('Login')}: <button type="button" className="mini-link inline-flex min-h-11 min-w-11 items-center" onClick={() => copyText(item.login)}>{item.login || '—'}</button>
                            {revealedStudentPasswords[item.id] && <> · {t('Parol')}: <strong>{revealedStudentPasswords[item.id]}</strong></>}
                          </p>
                        </div>
                        <span className={`mini-badge shrink-0 ${item.telegram_id ? 'mini-badge-success' : 'mini-badge-muted'}`}>{item.telegram_id ? t('Telegram ulangan') : t('Telegram ulanmagan')}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <ActionButton className="mini-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => editStudent(item)}>{t('Tahrirlash')}</ActionButton>
                        {canAccessTable(role, 'payments') && <ActionButton className="mini-secondary min-h-9 px-3 text-xs" onClick={() => openStudentPayments(item)}>{t('To‘lovlar')}</ActionButton>}
                        <ActionButton className="mini-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => revealStudentPassword(item)}>{t('Parolni ko‘rsatish')}</ActionButton>
                        <ActionButton className="mini-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => setStudentPasswordForm({ studentId: item.id, username: item.login || '', password: '' })}>{t('Parolni o‘zgartirish')}</ActionButton>
                        {item.telegram_id
                          ? <ActionButton className="mini-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => confirmUnlinkStudent(item)}>{t('Telegramdan uzish')}</ActionButton>
                          : <ActionButton className="mini-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => createInvite({ studentId: item.id })}>{t('Ulash')}</ActionButton>}
                        {inviteLinks[item.id] && <ActionButton className="mini-secondary min-h-9 px-3 text-xs" onClick={() => copyText(inviteLinks[item.id])}>{copied === inviteLinks[item.id] ? t('Nusxalandi ✓') : t('Havolani nusxalash')}</ActionButton>}
                        <ActionButton className="mini-secondary min-h-9 px-3 text-xs" aria-expanded={faceStudentId === item.id} onClick={() => setFaceStudentId((current) => (current === item.id ? null : item.id))}>{faceLabels.addOrUpdate()}</ActionButton>
                        <ActionButton className="mini-danger min-h-9 px-3 text-xs" disabled={busy} onClick={() => confirmRemoveStudent(item)}>{t('O‘chirish')}</ActionButton>
                      </div>
                      {faceStudentId === item.id && (
                        <div className="mt-3">
                          <FacePhotosPanel key={item.id} studentId={item.id} labels={faceLabels} confirm={confirmFaceAction} />
                        </div>
                      )}
                      {studentPasswordForm.studentId === item.id && (
                        <form className="mt-3 grid gap-2" onSubmit={changeStudentCredentials}>
                          <div className="grid grid-cols-2 gap-2">
                            <label className="mini-field"><span>{t('Login')}</span><input value={studentPasswordForm.username} autoCapitalize="none" onChange={(event) => setStudentPasswordForm({ ...studentPasswordForm, username: event.target.value })} required /></label>
                            <label className="mini-field"><span>{t('Yangi parol')}</span><input type="password" value={studentPasswordForm.password} onChange={(event) => setStudentPasswordForm({ ...studentPasswordForm, password: event.target.value })} minLength={6} autoComplete="new-password" required /></label>
                          </div>
                          <div className="flex gap-2"><ActionButton type="submit" disabled={busy}>{t('Saqlash')}</ActionButton><ActionButton className="mini-secondary" disabled={busy} onClick={() => setStudentPasswordForm({ studentId: '', username: '', password: '' })}>{t('Bekor qilish')}</ActionButton></div>
                        </form>
                      )}
                    </div>
                  )
                })}
                {!filteredStudents.length && <p className="py-4 text-sm text-[var(--mini-muted)]">{t('O‘quvchi topilmadi')}</p>}
              </div>
              {filteredStudents.length > 20 && (
                <div className="mini-pagination">
                  <ActionButton className="mini-secondary" disabled={studentPage === 0} onClick={() => setStudentPage((current) => current - 1)}>{t('Oldingi')}</ActionButton>
                  <span>{studentPage + 1} / {Math.ceil(filteredStudents.length / 20)}</span>
                  <ActionButton className="mini-secondary" disabled={(studentPage + 1) * 20 >= filteredStudents.length} onClick={() => setStudentPage((current) => current + 1)}>{t('Keyingi')}</ActionButton>
                </div>
              )}
            </Panel>
            <Panel>
              <h2 className="font-bold">{editingGroupId ? t('Guruhni tahrirlash') : t('Yangi guruh')}</h2>
              <form id="mini-group-form" className="mt-3 grid gap-3" onSubmit={saveGroup}>
                <label className="mini-field"><span>{t('Guruh nomi')}</span><input value={groupForm.name} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })} required /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="mini-field"><span>{t('O‘qituvchi')}</span>
                    <select value={groupForm.teacherId} onChange={(event) => setGroupForm({ ...groupForm, teacherId: event.target.value })}>
                      <option value="">—</option>
                      {teachers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </label>
                  <label className="mini-field"><span>{t('Oylik to‘lov')}</span><input type="number" inputMode="numeric" min="0" value={groupForm.monthlyFee} onChange={(event) => setGroupForm({ ...groupForm, monthlyFee: event.target.value })} /></label>
                </div>
                <p className="text-xs font-semibold text-[var(--mini-muted)]">{t('Dars vaqti')}</p>
                {groupForm.schedule.map((slot, index) => (
                  <div key={index} className="mini-slot-row">
                    <label className="mini-field"><span className="sr-only">{t('Hafta kuni')}</span><select aria-label={t('Hafta kuni')} value={slot.day} onChange={(event) => setGroupForm((current) => ({ ...current, schedule: current.schedule.map((item, slotIndex) => slotIndex === index ? { ...item, day: event.target.value } : item) }))}>
                      {[1, 2, 3, 4, 5, 6, 7].map((day) => <option key={day} value={day}>{weekdayShort(day)}</option>)}
                    </select></label>
                    <label className="mini-field"><span className="sr-only">{t('Boshlanish')}</span><input aria-label={t('Boshlanish')} type="time" value={slot.startTime} onChange={(event) => setGroupForm((current) => ({ ...current, schedule: current.schedule.map((item, slotIndex) => slotIndex === index ? { ...item, startTime: event.target.value } : item) }))} /></label>
                    <label className="mini-field"><span className="sr-only">{t('Tugash')}</span><input aria-label={t('Tugash')} type="time" value={slot.endTime} onChange={(event) => setGroupForm((current) => ({ ...current, schedule: current.schedule.map((item, slotIndex) => slotIndex === index ? { ...item, endTime: event.target.value } : item) }))} /></label>
                    <ActionButton className="mini-secondary mb-1 min-h-11 px-3" aria-label={t('Olib tashlash')} disabled={groupForm.schedule.length < 2} onClick={() => setGroupForm((current) => ({ ...current, schedule: current.schedule.filter((_, slotIndex) => slotIndex !== index) }))}>−</ActionButton>
                  </div>
                ))}
                <ActionButton className="mini-secondary" onClick={() => setGroupForm((current) => ({ ...current, schedule: [...current.schedule, { day: '1', startTime: '', endTime: '' }] }))}><Plus size={16} /> {t('Vaqt qo‘shish')}</ActionButton>
                {editingGroupId && <label className="mini-field"><span>{t('Jadval o‘zgarish sababi')}</span><input value={groupForm.scheduleReason} onChange={(event) => setGroupForm({ ...groupForm, scheduleReason: event.target.value })} maxLength={500} /></label>}
                <div className="flex flex-wrap gap-2">
                  <ActionButton type="submit" disabled={busy}>{busy ? t('Saqlanmoqda…') : editingGroupId ? t('Saqlash') : t('Qo‘shish')}</ActionButton>
                  {editingGroupId && <ActionButton className="mini-secondary" disabled={busy} onClick={() => { setEditingGroupId(null); setGroupForm({ name: '', teacherId: '', monthlyFee: '', schedule: [{ day: '1', startTime: '', endTime: '' }], scheduleReason: '' }) }}>{t('Bekor qilish')}</ActionButton>}
                </div>
              </form>
              <div className="mt-3">
                {groups.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-2 border-t border-[var(--mini-border)] py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{item.name}</p>
                      {item.monthly_fee !== undefined && item.monthly_fee !== null && <p className="text-xs text-[var(--mini-muted)]">{money(item.monthly_fee)}</p>}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <ActionButton className="mini-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => editGroup(item)}>{t('Tahrirlash')}</ActionButton>
                      {canDeleteGroups && <ActionButton className="mini-danger min-h-9 px-3 text-xs" disabled={busy} onClick={() => confirmRemoveGroup(item)}>{t('O‘chirish')}</ActionButton>}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel>
              <h2 className="font-bold">{t('O‘qituvchilar')}</h2>
              {canAccessEndpoint(role, 'staff:manage') && (
                <form id="mini-teacher-form" className="mt-3 grid gap-3" onSubmit={saveTeacher}>
                  <label className="mini-field"><span>{t('Ism va familiya')}</span><input value={teacherForm.name} onChange={(event) => setTeacherForm((current) => ({ ...current, name: event.target.value, username: current.autoUsername ? loginBaseFromName(event.target.value) : current.username }))} required /></label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="mini-field"><span>{t('Telefon')}</span><input type="tel" value={teacherForm.phone} onChange={(event) => setTeacherForm({ ...teacherForm, phone: event.target.value })} /></label>
                    <label className="mini-field"><span>{t('Oylik maosh')}</span><input type="number" inputMode="numeric" min="0" value={teacherForm.monthlySalary} onChange={(event) => setTeacherForm({ ...teacherForm, monthlySalary: event.target.value })} /></label>
                    <label className="mini-field"><span>{t('Login')}</span><input value={teacherForm.username} autoCapitalize="none" onChange={(event) => setTeacherForm({ ...teacherForm, username: event.target.value, autoUsername: false })} required /></label>
                    <label className="mini-field"><span>{editingTeacherId ? t('Yangi parol') : t('Parol')}</span><input type="password" autoComplete="new-password" value={teacherForm.password} onChange={(event) => setTeacherForm({ ...teacherForm, password: event.target.value })} minLength={teacherForm.password ? 12 : undefined} required={!editingTeacherId || !staffRows.some((row) => row.teacher_id === editingTeacherId)} /></label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <ActionButton type="submit" disabled={busy}>{busy ? t('Saqlanmoqda…') : editingTeacherId ? t('Saqlash') : t('Qo‘shish')}</ActionButton>
                    {editingTeacherId && <ActionButton className="mini-secondary" disabled={busy} onClick={() => { setEditingTeacherId(null); setTeacherForm({ name: '', phone: '', monthlySalary: '', username: '', password: '', autoUsername: true }) }}>{t('Bekor qilish')}</ActionButton>}
                  </div>
                </form>
              )}
              <div className="mt-3">
                {teachers.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--mini-border)] py-3">
                    <div className="min-w-0"><p className="truncate text-sm font-semibold">{item.name}</p><p className="text-xs text-[var(--mini-muted)]">{item.phone || '—'}</p></div>
                    {canAccessEndpoint(role, 'staff:manage') && (
                      <div className="flex flex-wrap items-center gap-1">
                        {item.telegram_id
                          ? <span className="mini-badge mini-badge-success">{t('Telegram ulangan')}</span>
                          : item.profile_id && <ActionButton className="mini-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => createInvite({ profileId: item.profile_id })}>{t('Ulash')}</ActionButton>}
                        <ActionButton className="mini-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => editTeacher(item)}>{t('Tahrirlash')}</ActionButton>
                        <ActionButton className="mini-danger min-h-9 px-3 text-xs" disabled={busy} onClick={() => confirmRemoveTeacher(item)}>{t('O‘chirish')}</ActionButton>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Panel>
          </section>
        )}

        {page === 'reports' && privileged && (
          <section className="mt-7">
            <div className="grid gap-3">
              {reports.map((report) => (
                <Panel key={`${report.student_id}-${report.month_start}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div><h2 className="font-bold">{report.student_name}</h2><p className="mt-1 text-xs text-[var(--mini-muted)]">{report.month_start || t('Hali topshiriq yo‘q')}</p></div>
                    <span className="rounded-full bg-[var(--mini-bg)] px-3 py-1 text-xs">{report.assigned_count} {t('ta berilgan')}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-3">
                    <div><strong className="block text-base">{report.submitted_on_time_count}</strong>{t('O‘z vaqtida')}</div>
                    <div><strong className="block text-base">{report.late_count}</strong>{t('Kechikkan')}</div>
                    <div><strong className="block text-base">{report.not_done_count}</strong>{t('Bajarolmagan')}</div>
                    <div><strong className="block text-base">{report.bajardi_count}</strong>{t('Bajardi')}</div>
                    <div><strong className="block text-base">{report.bajarmadi_count}</strong>{t('Bajarmadi')}</div>
                  </div>
                </Panel>
              ))}
              {!reports.length && !loading && <Panel>{t('Hisobot uchun ma’lumot topilmadi.')}</Panel>}
            </div>
          </section>
        )}
        {page === 'notifications' && (
          <section className="mt-7">
            <div className="grid gap-3">
              {scheduleNotifications.map((item) => (
                <Panel key={item.id}>
                  <p className="font-semibold">{item.group_name || t('Dars jadvali')}</p>
                  <p className="mt-2 whitespace-pre-line text-sm text-[var(--mini-muted)]">{item.message}</p>
                  <p className="mt-2 text-xs text-[var(--mini-muted)]">{new Intl.DateTimeFormat('uz-UZ', {
                    dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Tashkent',
                  }).format(new Date(item.scheduled_at))}</p>
                </Panel>
              ))}
              {!scheduleNotifications.length && !loading && <EmptyState title={t('Hozircha bildirishnoma yo‘q')} />}
            </div>
          </section>
        )}
      </div>
      {moreOpen && (
        <div
          className="mini-more-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setMoreOpen(false)
            }
          }}
        >
          <section ref={moreMenuRef} className="mini-more-menu" role="dialog" aria-modal="true" aria-label={t('Ko‘proq bo‘limlar')}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold">{t('Ko‘proq')}</h2>
              <button className="mini-icon-button" type="button" aria-label={t('Menyuni yopish')} onClick={() => {
                setMoreOpen(false)
              }}>×</button>
            </div>
            <div className="mt-2 grid gap-1">
              {morePages.map((id) => (
                <button key={id} type="button" className="mini-more-item" onClick={() => navTo(id)}>
                  <span>{t(pageTitles[id])}</span><ArrowLeft className="rotate-180" size={16} />
                </button>
              ))}
              <button type="button" className="mini-more-item mini-more-logout" onClick={logout}>
                <span>{t('Chiqish')}</span><LogOut size={16} />
              </button>
            </div>
          </section>
        </div>
      )}
      <nav className="mini-bottom-nav" aria-label={t('Asosiy menyu')} inert={moreOpen}>
        {visibleNav.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => navTo(id)} aria-current={page === id ? 'page' : undefined}>
            <Icon size={20} aria-hidden="true" />
            <span>{t(label)}</span>
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
