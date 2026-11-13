// Shared mocked API + session for the UI audit specs (not a spec file itself).

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())
const [YEAR, MONTH] = today.split('-').map(Number)
const weekday = new Date(`${today}T12:00:00Z`).getUTCDay() || 7

export { today }

export function sampleData() {
  const teachers = [
    { id: 'teacher-1', name: 'Dilshod Karimov', phone: '+998901112233', monthly_salary: 4_000_000, created_at: '2026-01-01' },
    { id: 'teacher-2', name: 'Malika Abdurahmonova-Tursunboyeva', phone: '+998907654321', monthly_salary: 3_500_000, created_at: '2026-01-02' },
    { id: 'teacher-3', name: 'Sardor Rahimov', phone: '+998935551122', monthly_salary: 3_000_000, created_at: '2026-01-03' },
  ]
  const slot = (day, startTime, endTime, teacherId) => ({ slotId: `slot-${day}-${startTime}`, day, startTime, endTime, teacherId })
  const groups = [
    { id: 'group-1', name: 'A1 boshlang‘ich', teacher_id: 'teacher-1', monthly_fee: 350000, created_at: '2026-01-01',
      schedule: [slot(1, '09:00', '10:30', 'teacher-1'), slot(3, '09:00', '10:30', 'teacher-1'), slot(weekday, '14:00', '15:30', 'teacher-1')] },
    { id: 'group-2', name: 'IELTS intensiv kechki guruh (juda uzun nom bilan)', teacher_id: 'teacher-2', monthly_fee: 650000, created_at: '2026-01-02',
      schedule: [slot(2, '18:00', '19:30', 'teacher-2'), slot(4, '18:00', '19:30', 'teacher-2')] },
    { id: 'group-3', name: 'Matematika 7-sinf', teacher_id: 'teacher-3', monthly_fee: 400000, created_at: '2026-01-03',
      schedule: [slot(weekday, '11:00', '12:00', 'teacher-3')] },
    { id: 'group-4', name: 'Kids English', teacher_id: 'teacher-1', monthly_fee: 300000, created_at: '2026-01-04',
      schedule: [slot(5, '16:00', '17:00', 'teacher-1')] },
  ]
  const names = [
    'Ali Valiyev', 'Abduqahhor Nematov', 'Asror Yuldashev', 'Zarina Qodirova',
    'Muhammadamin Abdulazizov-Shukurullayev', 'Sevara Ergasheva', 'Jasur Tojiboyev', 'Nilufar Sobirova',
    'Bekzod Hamidov', 'Dilnoza Rasulova', 'Otabek Murodov', 'Shahzoda Karimova',
    'Sardor Aliyev', 'Madina Tursunova', 'Javohir Qosimov', 'Gulnoza Ahmedova',
  ]
  const students = names.map((name, index) => ({
    id: `student-${index + 1}`,
    name,
    phone: `+99890${String(1234560 + index).padStart(7, '0')}`,
    parent_phone: index % 3 === 0 ? '' : `+99891${String(7654320 + index).padStart(7, '0')}`,
    login: `${name.toLowerCase().split(' ')[0]}.${index + 1}`,
    username: `${name.toLowerCase().split(' ')[0]}.${index + 1}`,
    monthly_fee: 350000,
    telegram_id: index % 2 ? null : `tg-${index}`,
    joined_at: '2026-02-01',
    created_at: `2026-02-0${(index % 8) + 1}`,
  }))
  const groupStudents = students.map((student, index) => ({ group_id: groups[index % groups.length].id, student_id: student.id }))
  groupStudents.push({ group_id: 'group-2', student_id: 'student-1' })
  const payments = students.slice(0, 5).map((student, index) => ({
    id: `payment-${index + 1}`,
    student_id: student.id,
    student_name: student.name,
    amount: index === 2 ? 150000 : 350000,
    month: MONTH,
    year: YEAR,
    paid_at: `${today}T0${index}:30:00.000Z`,
    method: index % 2 ? 'card' : 'cash',
  }))
  payments.push({
    id: 'payment-void', student_id: 'student-1', student_name: 'Ali Valiyev', amount: 120000, month: MONTH, year: YEAR,
    paid_at: `${today}T09:00:00.000Z`, method: 'cash', voided_at: `${today}T10:00:00.000Z`, void_reason: 'Egasi tomonidan bekor qilindi.',
  })
  const attendance = students.slice(0, 6).map((student, index) => ({
    id: `att-${index}`,
    student_id: student.id,
    group_id: groupStudents[index].group_id,
    date: today,
    status: index % 3 === 0 ? 'absent' : 'present',
    source: index === 1 ? 'face' : 'manual',
    groups: { name: groups[index % groups.length].name },
  }))
  const profiles = [
    { id: 'owner-profile', username: 'owner.user', name: 'Owner user', role: 'owner', is_active: true, created_at: '2026-01-01' },
    { id: 'reception-profile', username: 'reception.user', name: 'Qabulxona Xodimi', role: 'reception', is_active: true, created_at: '2026-01-02' },
    { id: 'teacher-profile', username: 'teacher.user', name: 'Dilshod Karimov', role: 'teacher', teacher_id: 'teacher-1', is_active: true, created_at: '2026-01-03' },
    { id: 'student-profile', username: 'ali.valiyev', name: 'Ali Valiyev', role: 'student', student_id: 'student-1', telegram_id: 'tg-0', is_active: true, created_at: '2026-01-04' },
  ]
  const homework = [{
    id: 'homework-1', group_id: 'group-1', teacher_id: 'teacher-1', title: 'Kasrlarni qo‘shish',
    description: 'Uchta mashqni bajarib javob yuboring.', due_at: `${today}T14:00:00.000Z`,
    groups: { name: 'A1 boshlang‘ich' }, submissions: [], submission: null,
  }]
  return {
    teachers,
    groups,
    students,
    group_students: groupStudents,
    payments,
    attendance,
    profiles,
    homework,
    homework_submissions: [],
    monthly_homework_report: [],
    expenses: [
      { id: 'exp-1', title: 'Ijara', amount: 3_000_000, category: 'rent', date: today },
      { id: 'exp-2', title: 'Kommunal to‘lovlar', amount: 450_000, category: 'utilities', date: today },
    ],
    salary_payments: [{ id: 'sal-1', teacher_id: 'teacher-1', amount: 2_000_000, paid_at: `${today}T08:00:00.000Z`, teachers: { name: 'Dilshod Karimov' } }],
    group_fee_history: groups.map((group) => ({ group_id: group.id, monthly_fee: group.monthly_fee, valid_from: '2026-01-01' })),
    telegram_links: [],
  }
}

export function profileFor(role) {
  return {
    id: `${role}-profile`,
    username: role === 'student' ? 'ali.valiyev' : `${role}.user`,
    name: role === 'student' ? 'Ali Valiyev' : role === 'teacher' ? 'Dilshod Karimov' : `${role} user`,
    role,
    student_id: role === 'student' ? 'student-1' : null,
    teacher_id: role === 'teacher' ? 'teacher-1' : null,
    is_active: true,
  }
}

/**
 * Logs `role` in with a mocked session and answers every /api call locally.
 * Writes are acknowledged but never forwarded, so the audit cannot touch real data.
 */
export async function installMocks(page, role, theme) {
  const profile = profileFor(role)
  const records = sampleData()
  const staff = records.profiles.filter((row) => row.role === 'reception' || row.role === 'teacher')

  await page.emulateMedia({ colorScheme: theme })
  await page.addInitScript(({ sessionProfile, scheme }) => {
    const session = JSON.stringify({ access_token: 'audit-access', refresh_token: 'audit-refresh', user: sessionProfile })
    sessionStorage.setItem('kamol-cloudflare-session', session)
    localStorage.setItem('kamol-cloudflare-session', session)
    localStorage.setItem('kamol-theme', scheme)
    window.Telegram = {
      WebApp: {
        initData: 'query_id=mocked',
        colorScheme: scheme,
        themeParams: scheme === 'light'
          ? { bg_color: '#f3f5f8', secondary_bg_color: '#ffffff', text_color: '#17202a', hint_color: '#667085', button_color: '#087e8b', button_text_color: '#ffffff' }
          : { bg_color: '#101a2b', secondary_bg_color: '#17243a', text_color: '#f4f7fb', hint_color: '#a3b2c7', button_color: '#4b9cf5', button_text_color: '#ffffff' },
        ready() {},
        expand() {},
        isVersionAtLeast() { return true },
        openTelegramLink() {},
        HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        MainButton: { setText() {}, show() {}, hide() {}, onClick() {}, offClick() {}, enable() {}, disable() {}, showProgress() {}, hideProgress() {} },
      },
    }
  }, { sessionProfile: profile, scheme: theme })

  await page.route(/telegram\.org\/js\/telegram-web-app\.js/, (route) => route.fulfill({
    status: 200, contentType: 'application/javascript', body: '/* mocked */',
  }))

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const { pathname } = new URL(request.url())
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

    if (pathname === '/api/auth/me') return json({ user: profile })
    if (pathname === '/api/auth/refresh') return json({ session: { access_token: 'audit-access', refresh_token: 'audit-refresh', user: profile } })
    if (pathname === '/api/auth/logout') return json({ ok: true })
    // The client falls back to per-table /api/db reads when the batch endpoint is missing.
    if (pathname === '/api/bootstrap') return json({ error: 'Not found' }, 404)
    if (pathname === '/api/schedule/state') {
      return json({ data: { groups: records.groups.map((group) => ({ group_id: group.id, versions: [], overrides: [] })) } })
    }
    if (pathname === '/api/schedule/history') return json({ data: { events: [], deliveries: [] } })
    if (pathname === '/api/db') {
      const body = request.postDataJSON()
      const rows = records[body.table] || []
      if (body.action !== 'select') return json({ data: body.values ? [].concat(body.values) : [] })
      let result = rows
      for (const filter of body.filters || []) {
        if (filter.op === 'eq') result = result.filter((row) => row[filter.column] === undefined || String(row[filter.column]) === String(filter.value))
      }
      const offset = body.offset || 0
      return json({ data: result.slice(offset, offset + (body.limit || 500)) })
    }
    if (pathname === '/api/miniapp/student/overview') {
      return json({ data: {
        homeworks: records.homework,
        payments: records.payments.filter((row) => row.student_id === 'student-1'),
        attendance: records.attendance.filter((row) => row.student_id === 'student-1'),
        groups: records.groups.slice(0, 2).map((group) => ({ ...group, scheduleVersions: [], scheduleOverrides: [] })),
      } })
    }
    if (pathname === '/api/staff') return json({ data: staff })
    if (pathname === '/api/finance/summary') return json({ income: 12_000_000, salary_cost: 4_300_000, expense_cost: 1_100_000, net: 6_600_000 })
    if (pathname === '/api/telegram/bot-info') return json({ bot_username: 'kamol_project_school_bot' })
    if (pathname === '/api/homework/review') return json({ data: { submissions: [], not_submitted: [] } })
    if (pathname.startsWith('/api/homework/history')) return json({ data: { events: [], submissions: [] } })
    if (pathname === '/api/face/overview') return json({ data: { students: [], devices: [] } })
    if (/\/api\/students\/[^/]+\/faces/.test(pathname)) return json({ data: { photos: [], sync: [] } })
    if (/\/api\/students\/[^/]+\/password\/reveal/.test(pathname)) return json({ password: 'Parol2026' })
    if (pathname === '/api/payments/history') return json({ data: [] })
    return json({ data: [] })
  })
  return profile
}
