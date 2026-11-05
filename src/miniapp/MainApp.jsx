import { useEffect, useState } from 'react'
import {
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCheck,
  ClipboardCheck,
  Clock3,
  GraduationCap,
  Sparkles,
} from 'lucide-react'

const STUDENT_TASKS = [
  {
    subject: 'Matematika',
    title: 'Kvadrat tenglamalar',
    detail: '12-bet, 4–8-mashqlar',
    due: 'Bugun, 18:00',
    status: 'Yangi',
    tone: 'violet',
  },
  {
    subject: 'Ingliz tili',
    title: 'Unit 5 — My daily routine',
    detail: 'Workbook, 26-bet',
    due: 'Ertaga, 12:00',
    status: 'Jarayonda',
    tone: 'blue',
  },
  {
    subject: 'Fizika',
    title: 'Bosim va uning birliklari',
    detail: 'Mavzuni o‘qib, 3 ta masala yeching',
    due: '7-noyabr',
    status: 'Yangi',
    tone: 'amber',
  },
]

const REVIEW_TASKS = [
  {
    subject: 'Matematika',
    title: 'Kvadrat tenglamalar',
    group: 'Algebra · 8-A guruh',
    count: 8,
    due: 'Bugun, 18:00',
    tone: 'violet',
  },
  {
    subject: 'Ingliz tili',
    title: 'Unit 5 — My daily routine',
    group: 'Ingliz tili · Beginner',
    count: 4,
    due: 'Ertaga, 12:00',
    tone: 'blue',
  },
  {
    subject: 'Fizika',
    title: 'Bosim va uning birliklari',
    group: 'Fizika · 9-B guruh',
    count: 2,
    due: '7-noyabr',
    tone: 'amber',
  },
]

const ROLES = [
  { id: 'student', label: 'O‘quvchi', icon: BookOpen },
  { id: 'teacher', label: 'O‘qituvchi', icon: GraduationCap },
]

function getTelegramApp() {
  return typeof window !== 'undefined' ? window.Telegram?.WebApp : null
}

function TaskCard({ task, teacher }) {
  const Icon = teacher ? ClipboardCheck : CalendarDays

  return (
    <article className="task-card rounded-3xl border p-4">
      <div className="flex items-start gap-3">
        <div className={`subject-icon subject-icon-${task.tone} grid size-11 shrink-0 place-items-center rounded-2xl`}>
          <BookOpen size={19} strokeWidth={1.9} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wide text-[var(--mini-muted)]">{task.subject}</p>
          <h2 className="mt-1 text-[15px] font-bold leading-snug text-[var(--mini-text)]">{task.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-[var(--mini-muted)]">
            {teacher ? task.group : task.detail}
          </p>
        </div>
        {teacher
          ? <span className="task-count shrink-0 rounded-full px-2.5 py-1 text-xs font-bold">{task.count}</span>
          : <ArrowUpRight className="mt-1 shrink-0 text-[var(--mini-muted)]" size={17} />}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-[var(--mini-border)] pt-3">
        <span className="flex items-center gap-1.5 text-xs text-[var(--mini-muted)]">
          {teacher ? <Icon size={14} /> : <Clock3 size={14} />}
          {teacher ? `${task.count} ta tekshirilmagan` : task.due}
        </span>
        {teacher
          ? <span className="flex items-center gap-1 text-xs font-semibold text-[var(--mini-accent)]">Ko‘rish <ArrowUpRight size={13} /></span>
          : <span className={`task-status task-status-${task.status === 'Yangi' ? 'new' : 'active'} rounded-full px-2.5 py-1 text-[11px] font-semibold`}>{task.status}</span>}
      </div>
    </article>
  )
}

export default function MainApp() {
  const [role, setRole] = useState('student')
  const [firstName] = useState(() => getTelegramApp()?.initDataUnsafe?.user?.first_name || '')
  const isTeacher = role === 'teacher'
  const tasks = isTeacher ? REVIEW_TASKS : STUDENT_TASKS
  const telegramApp = getTelegramApp()

  useEffect(() => {
    if (!telegramApp) return undefined

    telegramApp.ready()
    telegramApp.expand()

    const applyTheme = () => {
      const params = telegramApp.themeParams || {}
      const root = document.documentElement
      root.style.colorScheme = telegramApp.colorScheme || 'dark'
      root.style.setProperty('--mini-bg', params.bg_color || '#101a17')
      root.style.setProperty('--mini-card', params.secondary_bg_color || '#182522')
      root.style.setProperty('--mini-text', params.text_color || '#f4f7f5')
      root.style.setProperty('--mini-muted', params.hint_color || '#97a9a2')
      root.style.setProperty('--mini-accent', params.button_color || '#73b7a0')
      root.style.setProperty('--mini-accent-text', params.button_text_color || '#10211b')
    }

    applyTheme()
    telegramApp.onEvent('themeChanged', applyTheme)
    return () => telegramApp.offEvent('themeChanged', applyTheme)
  }, [telegramApp])

  return (
    <main className="miniapp min-h-[100svh] px-4 pb-8 pt-[max(1.25rem,env(safe-area-inset-top))] text-[var(--mini-text)]">
      <div className="mx-auto w-full max-w-md">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="brand-mark grid size-10 place-items-center rounded-2xl">
              <span className="text-sm font-black tracking-tight">K</span>
            </div>
            <div>
              <p className="text-sm font-bold tracking-tight">Kamol School</p>
              <p className="text-xs text-[var(--mini-muted)]">O‘quv markazi</p>
            </div>
          </div>
          <div className="app-badge rounded-full px-3 py-1.5 text-[10px] font-bold tracking-widest">
            MINI APP
          </div>
        </header>

        <section className="mt-8">
          <p className="flex items-center gap-1.5 text-sm text-[var(--mini-muted)]">
            <Sparkles size={15} className="text-[var(--mini-accent)]" />
            {firstName ? `Salom, ${firstName}!` : 'Xush kelibsiz!'}
          </p>
          <h1 className="mt-2 text-[26px] font-extrabold leading-tight tracking-tight">
            {isTeacher ? 'Topshiriqlarni tekshirish' : 'Mening uy vazifalarim'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[var(--mini-muted)]">
            {isTeacher
              ? 'O‘quvchilaringiz yuborgan ishlarni ko‘rib chiqing.'
              : 'Barcha vazifalaringiz bir joyda. Omad!'}
          </p>
        </section>

        <nav className="role-switch mt-6 grid grid-cols-2 gap-1 rounded-2xl p-1" aria-label="Ilova roli">
          {ROLES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setRole(id)}
              aria-pressed={role === id}
              className={`role-option flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors ${role === id ? 'role-option-active' : ''}`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>

        <section className="mt-7" aria-live="polite">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold">
              {isTeacher ? 'Tekshirish kutilmoqda' : 'Yaqin vazifalar'}
            </h2>
            <span className="text-xs text-[var(--mini-muted)]">{tasks.length} ta</span>
          </div>
          <div className="flex flex-col gap-3">
            {tasks.map((task) => <TaskCard key={task.title} task={task} teacher={isTeacher} />)}
          </div>
        </section>

        <footer className="mt-6 flex items-start gap-2 rounded-2xl border border-[var(--mini-border)] px-3.5 py-3 text-xs leading-relaxed text-[var(--mini-muted)]">
          {isTeacher ? <ClipboardCheck className="mt-0.5 shrink-0" size={15} /> : <CheckCheck className="mt-0.5 shrink-0" size={15} />}
          <span>
            <span className="font-semibold text-[var(--mini-text)]">Namuna ko‘rinishi.</span>
            {' '}Topshiriqlar hozircha demo ma’lumotlar bilan ko‘rsatilmoqda.
          </span>
          <Check className="ml-auto mt-0.5 shrink-0 text-[var(--mini-accent)]" size={15} />
        </footer>
      </div>
    </main>
  )
}
