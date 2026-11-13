import { expect, test } from '@playwright/test'

const task = {
  id: 'homework-1',
  group_id: 'group-1',
  teacher_id: 'teacher-1',
  title: 'Kasrlarni qo‘shish',
  description: 'Uchta mashqni bajarib javob yuboring.',
  due_at: '2026-11-08T14:00:00.000Z',
  groups: { name: 'A1 boshlang‘ich' },
  submissions: [],
  submission: null,
}

const roleTabs = {
  student: ['Bosh sahifa', 'Vazifalar', 'Jadval', 'Savol', 'Profil'],
  teacher: ['Bosh sahifa', 'Guruhlar', 'Vazifalar', 'Davomat', 'Profil'],
  reception: ['Bosh sahifa', 'O‘quvchilar', 'Guruhlar', 'To‘lovlar', 'Savollar'],
  owner: ['Bosh sahifa', 'O‘quvchilar', 'Guruhlar', 'Xodimlar', 'Moliya'],
}

const screenLabels = {
  dashboard: 'Bosh sahifa',
  homework: 'Vazifalar',
  attendance: 'Davomat',
  groups: 'Guruhlar',
  management: 'O‘quvchilar',
  payments: 'To‘lovlar',
  questions: 'Savollar',
  profile: 'Profil',
  staff: 'Xodimlar',
  finance: 'Moliya',
  reports: 'Hisobotlar',
  settings: 'Sozlamalar',
  debtors: 'Qarzdorlar',
  absent: 'Bugun kelmaganlar',
  schedule: 'Haftalik jadval',
}

function profileFor(role) {
  return {
    id: `${role}-profile`,
    username: role === 'student' ? 'ali.valiyev' : `${role}.user`,
    name: role === 'student' ? 'Ali Valiyev' : `${role} user`,
    role,
    student_id: role === 'student' ? 'student-1' : null,
    teacher_id: role === 'teacher' ? 'teacher-1' : null,
    is_active: true,
  }
}

async function installMocks(page, role, scheme = 'light', { signedIn = true, scheduleScenario = null } = {}) {
  const profile = profileFor(role)
  const schedule = scheduleScenario
    ? [{ slotId: 'schedule-slot', day: scheduleScenario.weekday, startTime: '09:00', endTime: '10:00', teacherId: 'teacher-1' }]
    : [{ day: 0, startTime: '09:00', endTime: '10:00', teacherId: 'teacher-1' }]
  const group = {
    id: 'group-1',
    name: 'A1 boshlang‘ich',
    teacher_id: 'teacher-1',
    monthly_fee: 350000,
    schedule,
  }
  const student = {
    id: 'student-1',
    name: 'Ali Valiyev',
    phone: '+998901234567',
    parent_phone: '+998909876543',
    login: 'ali.valiyev',
    monthly_fee: 350000,
    telegram_id: 'telegram-student',
  }
  const records = {
    homework: [{ ...task }],
    homework_submissions: [],
    groups: [group],
    students: [student],
    group_students: [{ group_id: 'group-1', student_id: 'student-1' }],
    teachers: [{ id: 'teacher-1', name: 'Dilshod Karimov', phone: '+998901112233', monthly_salary: 4_000_000 }],
    profiles: [{ id: 'student-profile', student_id: 'student-1', telegram_id: 'telegram-student' }],
    payments: [],
    attendance: [],
    monthly_homework_report: [],
    expenses: [],
    salary_payments: [],
  }
  let createdStudent = null
  let createdHomework = null
  let createdStaff = null
  const staffRows = []

  await page.emulateMedia({ colorScheme: scheme })
  await page.addInitScript(({ sessionProfile, hasSession, theme }) => {
    if (hasSession) {
      sessionStorage.setItem('kamol-cloudflare-session', JSON.stringify({
        access_token: 'playwright-access-token',
        refresh_token: 'playwright-refresh-token',
        user: sessionProfile,
      }))
    }
    window.Telegram = {
      WebApp: {
        initData: 'query_id=mocked',
        colorScheme: theme,
        themeParams: theme === 'light'
          ? { bg_color: '#f3f5f8', secondary_bg_color: '#ffffff', text_color: '#17202a', hint_color: '#667085', button_color: '#087e8b', button_text_color: '#ffffff' }
          : { bg_color: '#101a2b', secondary_bg_color: '#17243a', text_color: '#f4f7fb', hint_color: '#a3b2c7', button_color: '#4b9cf5', button_text_color: '#ffffff' },
        ready() {},
        expand() {},
        isVersionAtLeast() { return true },
        openTelegramLink() {},
        HapticFeedback: { impactOccurred() {} },
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        MainButton: { setText() {}, show() {}, hide() {}, onClick() {}, offClick() {}, enable() {}, disable() {}, showProgress() {}, hideProgress() {} },
      },
    }
  }, { sessionProfile: profile, hasSession: signedIn, theme: scheme })

  await page.route(/telegram\.org\/js\/telegram-web-app\.js/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* Telegram WebApp is mocked for deterministic UI tests. */',
  }))

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const { pathname } = new URL(request.url())
    const json = (body, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })

    if (pathname === '/api/auth/me') return json({ user: profile })
    if (pathname === '/api/auth/telegram') return json({ error: 'Telegram akkaunti ulanmagan.', code: 'TELEGRAM_NOT_LINKED' }, 401)
    if (pathname === '/api/auth/telegram/password') {
      return json({
        session: { access_token: 'playwright-access-token', refresh_token: 'playwright-refresh-token', user: profile },
        user: profile,
      })
    }
    if (pathname === '/api/auth/logout') return json({ ok: true })
    if (pathname === '/api/schedule/state') {
      return json({ data: { groups: [{
        group_id: group.id,
        versions: [],
        overrides: scheduleScenario?.override ? [scheduleScenario.override] : [],
      }] } })
    }
    if (pathname === '/api/schedule/history') {
      return json({ data: {
        events: scheduleScenario?.events || [],
        deliveries: scheduleScenario?.deliveries || [],
      } })
    }
    if (pathname === '/api/schedule/preview' && scheduleScenario) {
      const body = request.postDataJSON()
      return json({ data: {
        notificationCount: 2,
        oldLesson: { date: body.originalDate, startTime: '09:00', endTime: '10:00' },
        newLesson: { date: body.newDate, newDate: body.newDate, startTime: body.startTime, endTime: body.endTime, status: 'changed' },
      } })
    }
    if (pathname === '/api/schedule/changes' && scheduleScenario) {
      const body = request.postDataJSON()
      const changeId = 'schedule-change-1'
      scheduleScenario.override = {
        group_id: group.id,
        slot_id: body.slotId,
        original_date: body.originalDate,
        action: 'change',
        original_start_time: '09:00',
        original_end_time: '10:00',
        new_start_time: body.startTime,
        new_end_time: body.endTime,
        new_date: body.newDate,
        reason: body.reason,
        change_id: changeId,
      }
      scheduleScenario.events = [{
        id: 'schedule-event-1',
        change_id: changeId,
        event_type: 'created',
        actor_name: profile.name,
        created_at: new Date().toISOString(),
        details: JSON.stringify({ reason: body.reason }),
      }]
      scheduleScenario.deliveries = ['teacher', 'student'].map((recipient, index) => ({
        id: `schedule-notice-${index}`,
        change_id: changeId,
        recipient_name: recipient === 'teacher' ? 'Dilshod Karimov' : 'Ali Valiyev',
        channel: 'in_app',
        notification_kind: 'change',
        status: 'sent',
      }))
      scheduleScenario.notifications = ['teacher', 'student'].map((recipient, index) => ({
        id: `schedule-notice-${index}`,
        group_name: group.name,
        message: `Dars jadvali o‘zgardi. Yangi vaqt: ${body.startTime}–${body.endTime}`,
        scheduled_at: new Date().toISOString(),
        recipient,
      }))
      return json({ data: { id: changeId, duplicate: false } }, 201)
    }
    if (pathname === '/api/notifications') {
      return json({ data: (scheduleScenario?.notifications || []).filter((item) => item.recipient === role) })
    }
    if (pathname === `/api/students/${student.id}/telegram/unlink`) {
      records.profiles[0].telegram_id = null
      student.telegram_id = null
      return json({ data: { ok: true } })
    }

    if (pathname === '/api/db') {
      const body = request.postDataJSON()
      if (body.table === 'homework' && body.action === 'insert') {
        createdHomework = {
          ...task,
          id: 'homework-created',
          title: body.values.title,
          description: body.values.description,
          group_id: body.values.group_id,
        }
        records.homework.push(createdHomework)
        return json({ data: [createdHomework] })
      }
      const rows = records[body.table] || []
      return json({ data: body.action === 'select' ? rows : [] })
    }

    if (pathname === '/api/students' && request.method() === 'POST') {
      const body = request.postDataJSON()
      createdStudent = {
        id: 'student-created',
        name: body.name,
        phone: body.phone,
        parent_phone: body.parent_phone,
        login: body.username,
        monthly_fee: 350000,
      }
      records.students.push(createdStudent)
      return json({ data: { ...createdStudent, username: createdStudent.login, group_ids: body.group_ids } })
    }
    if (pathname === '/api/miniapp/student/overview') {
      return json({ data: {
        homeworks: records.homework,
        payments: records.payments,
        attendance: records.attendance,
        groups: [{
          ...group,
          scheduleVersions: [],
          scheduleOverrides: scheduleScenario?.override ? [scheduleScenario.override] : [],
        }],
      } })
    }
    if (pathname === '/api/homework/review') return json({ data: { submissions: [], not_submitted: [] } })
    if (pathname.startsWith('/api/homework/history')) return json({ data: { events: [], submissions: [] } })
    if (pathname === '/api/questions') return json({ data: [] })
    if (pathname === '/api/staff' && request.method() === 'POST') {
      const body = request.postDataJSON()
      createdStaff = { ...body, id: 'staff-created', is_active: true }
      staffRows.push(createdStaff)
      return json({ data: createdStaff }, 201)
    }
    if (pathname === '/api/staff') return json({ data: staffRows })
    if (pathname === '/api/finance/summary') return json({ income: 12_000_000, salary_cost: 4_300_000, expense_cost: 1_100_000, net: 6_600_000 })
    if (pathname === '/api/telegram/bot-info') return json({ bot_username: 'kamol_project_school_bot' })
    return json({ data: [] })
  })

  return {
    profile,
    getCreatedStudent: () => createdStudent,
    getCreatedHomework: () => createdHomework,
    getCreatedStaff: () => createdStaff,
  }
}

async function openMiniApp(page, role, scheme = 'light', options) {
  const fixtures = await installMocks(page, role, scheme, options)
  await page.goto('/miniapp.html')
  await expect(page.getByRole('navigation', { name: 'Asosiy menyu' })).toBeVisible()
  return fixtures
}

async function openMorePage(page, title) {
  await page.getByRole('button', { name: 'Ko‘proq menyu' }).click()
  await page.getByRole('dialog', { name: 'Ko‘proq bo‘limlar' }).getByRole('button', { name: title, exact: true }).click()
}

async function assertNoHorizontalOverflow(page) {
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  expect(hasOverflow, 'Mini App should not scroll horizontally').toBe(false)
  const undersizedControls = await page.evaluate(() => [...document.querySelectorAll('button, input, select, textarea')]
    .filter((element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width && rect.height
        && (rect.width < 44 || rect.height < 44)
    })
    .map((element) => ({ tag: element.tagName, text: element.innerText || element.getAttribute('aria-label') || element.type })))
  expect(undersizedControls, 'Visible controls should have at least 44px touch targets').toEqual([])
}

test.describe('Mini App screens and visual overflow', () => {
  const widths = [
    { width: 360, height: 640 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]
  const roles = [
    { role: 'student', extra: ['payments', 'settings'], detail: true },
    { role: 'teacher', extra: ['questions', 'schedule'], detail: true },
    { role: 'reception', extra: ['debtors', 'absent', 'schedule', 'homework', 'attendance', 'settings'] },
    { role: 'owner', extra: ['debtors', 'absent', 'schedule', 'homework', 'payments', 'attendance', 'questions', 'reports', 'settings'] },
  ]

  for (const { role, extra, detail } of roles) {
    for (const viewport of widths) {
      for (const scheme of ['light', 'dark']) {
        test(`${role} screens at ${viewport.width}x${viewport.height} (${scheme})`, async ({ page }, testInfo) => {
          await page.setViewportSize(viewport)
          await page.emulateMedia({ colorScheme: scheme })
          await openMiniApp(page, role, scheme)

          const targets = [
            ...roleTabs[role].map((label) => [label, label === 'Bosh sahifa' ? 'dashboard'
              : label === 'Vazifalar' ? 'homework'
                : label === 'Jadval' || label === 'Davomat' ? 'attendance'
                  : label === 'Savol' || label === 'Savollar' ? 'questions'
                    : label === 'Profil' ? 'profile'
                      : label === 'O‘quvchilar' ? 'management'
                        : label === 'To‘lovlar' ? 'payments'
                          : label === 'Guruhlar' ? 'groups'
                            : label === 'Xodimlar' ? 'staff'
                              : 'finance']),
            ...extra.map((id) => [screenLabels[id], id]),
          ]

          const moreButton = page.getByRole('button', { name: 'Ko‘proq menyu' })
          await moreButton.click()
          const moreDialog = page.getByRole('dialog', { name: 'Ko‘proq bo‘limlar' })
          await expect(moreDialog).toBeVisible()
          await expect(moreDialog).toHaveAttribute('aria-modal', 'true')
          await expect(page.locator('.mini-app-content')).toHaveJSProperty('inert', true)
          await expect(page.locator('.mini-more-overlay')).toHaveCSS('background-color', 'rgba(3, 8, 16, 0.76)')
          await assertNoHorizontalOverflow(page)
          await page.keyboard.press('Escape')
          await expect(moreDialog).toBeHidden()
          await expect(page.locator('.mini-app-content')).toHaveJSProperty('inert', false)
          await expect(moreButton).toBeFocused()
          await moreButton.click()
          await page.screenshot({
            path: testInfo.outputPath(`${role}-${viewport.width}x${viewport.height}-${scheme}-more-menu.png`),
            fullPage: true,
          })
          await page.getByRole('button', { name: 'Menyuni yopish' }).click()

          for (const [label, screenId] of targets) {
            if (extra.includes(screenId)) await openMorePage(page, label)
            else await page.getByRole('navigation', { name: 'Asosiy menyu' }).getByRole('button', { name: label, exact: true }).click()
            await page.waitForTimeout(70)
            await assertNoHorizontalOverflow(page)
            await page.screenshot({
              path: testInfo.outputPath(`${role}-${viewport.width}x${viewport.height}-${scheme}-${screenId}.png`),
              fullPage: true,
            })
          }

          if (detail) {
            await page.getByRole('navigation', { name: 'Asosiy menyu' }).getByRole('button', { name: 'Vazifalar', exact: true }).click()
            await page.getByRole('button', { name: /Kasrlarni qo‘shish/ }).click()
            await expect(page.getByRole('heading', { name: 'Vazifa tafsilotlari' })).toBeVisible()
            await assertNoHorizontalOverflow(page)
            await page.screenshot({
              path: testInfo.outputPath(`${role}-${viewport.width}x${viewport.height}-${scheme}-detail.png`),
              fullPage: true,
            })
          }
        })
      }
    }
  }
})

test.describe('Mini App role flows', () => {
  for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 430, height: 932 }]) {
    test(`reception creates a student at ${viewport.width}px`, async ({ page }, testInfo) => {
      const fixtures = await installMocks(page, 'reception')
      await page.setViewportSize(viewport)
      await page.goto('/miniapp.html')
      await page.getByRole('navigation', { name: 'Asosiy menyu' }).getByRole('button', { name: 'O‘quvchilar', exact: true }).click()
      await page.screenshot({ path: testInfo.outputPath(`reception-${viewport.width}x${viewport.height}-student-form.png`), fullPage: true })
      await page.getByLabel('Ism va familiya').fill('Abdulloh Ziyayev')
      await page.getByLabel('Telefon', { exact: true }).fill('+998901112233')
      const passwordInput = page.getByLabel('Parol', { exact: true })
      await passwordInput.focus()
      await expect(page.locator('main.miniapp')).toHaveClass(/mini-keyboard-open/)
      await expect.poll(async () => {
        const navBox = await page.getByRole('navigation', { name: 'Asosiy menyu' }).boundingBox()
        return navBox && navBox.y >= viewport.height
      }).toBe(true)
      await expect.poll(() => passwordInput.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return rect.top >= 0 && rect.bottom <= window.innerHeight
      })).toBe(true)
      await passwordInput.fill('Kamol2026!')
      await page.locator('#mini-student-form').getByRole('button', { name: 'Qo‘shish', exact: true }).click()
      await expect(page.getByRole('button', { name: 'abdulloh.ziyayev' })).toBeVisible()
      expect(fixtures.getCreatedStudent()?.login).toBe('abdulloh.ziyayev')
      await assertNoHorizontalOverflow(page)
    })

    test(`teacher creates homework at ${viewport.width}px`, async ({ page }, testInfo) => {
      const fixtures = await installMocks(page, 'teacher')
      await page.setViewportSize(viewport)
      await page.goto('/miniapp.html')
      await page.getByRole('navigation', { name: 'Asosiy menyu' }).getByRole('button', { name: 'Vazifalar', exact: true }).click()
      await page.getByRole('button', { name: 'Vazifa berish' }).click()
      await page.screenshot({ path: testInfo.outputPath(`teacher-${viewport.width}x${viewport.height}-homework-form.png`), fullPage: true })
      await page.getByLabel('Guruh').selectOption('group-1')
      await page.getByLabel('Sarlavha').fill('Yangi uy vazifasi')
      await page.getByLabel('Izoh').fill('Mashqlarni bajaring.')
      await page.getByRole('button', { name: 'Vazifani yuborish' }).click()
      await expect(page.getByText('Uy vazifasi guruhga yuborildi.')).toBeVisible()
      expect(fixtures.getCreatedHomework()?.title).toBe('Yangi uy vazifasi')
      await assertNoHorizontalOverflow(page)
    })

    test(`student logs in and opens homework at ${viewport.width}px`, async ({ page }, testInfo) => {
      await installMocks(page, 'student', 'light', { signedIn: false })
      await page.setViewportSize(viewport)
      await page.goto('/miniapp.html')
      await expect(page.getByRole('heading', { name: 'Kirish' })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath(`student-${viewport.width}x${viewport.height}-login.png`), fullPage: true })
      await page.getByLabel('Login').fill('ali.valiyev')
      await page.getByLabel('Parol').fill('Oquvchi2026')
      await page.getByRole('button', { name: 'Kirish' }).click()
      await page.getByRole('navigation', { name: 'Asosiy menyu' }).getByRole('button', { name: 'Vazifalar', exact: true }).click()
      await expect(page.getByRole('button', { name: /Kasrlarni qo‘shish/ })).toBeVisible()
      await assertNoHorizontalOverflow(page)
    })

    test(`owner sees finance summary at ${viewport.width}px`, async ({ page }) => {
      await installMocks(page, 'owner')
      await page.setViewportSize(viewport)
      await page.goto('/miniapp.html')
      await expect(page.getByText('Shu oy foyda')).toBeVisible()
      await expect(page.getByText(/6[,\s\u00a0\u202f]600[,\s\u00a0\u202f]000 so‘m/)).toBeVisible()
      await assertNoHorizontalOverflow(page)
    })
  }

  test('owner creates a reception account directly from the Xodimlar tab', async ({ page }) => {
    const fixtures = await openMiniApp(page, 'owner')
    await page.getByRole('navigation', { name: 'Asosiy menyu' }).getByRole('button', { name: 'Xodimlar', exact: true }).click()
    await page.getByRole('button', { name: 'Xodim qo‘shish' }).click()
    await page.getByLabel('Ism va familiya').fill('Malika Qodirova')
    await page.getByLabel('Telefon').fill('+998901112244')
    await page.locator('#mini-staff-form select').selectOption('reception')
    await page.getByLabel('Login').fill('malika.qodirova')
    await page.getByLabel('Parol (kamida 12 belgi)').fill('MalikaStrong2026')
    await page.getByRole('button', { name: 'Xodim qo‘shish' }).last().click()

    await expect(page.getByText('Xodim akkaunti saqlandi.')).toBeVisible()
    await expect(page.getByText('Qabulxona · malika.qodirova')).toBeVisible()
    expect(fixtures.getCreatedStaff()).toMatchObject({
      name: 'Malika Qodirova',
      role: 'reception',
      username: 'malika.qodirova',
    })
  })

  test('website owner adds a reception account and the open menu covers the bottom tabs', async ({ page }) => {
    const fixtures = await installMocks(page, 'owner')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/owner/settings/staff')

    await expect(page.getByRole('heading', { name: 'Xodimlar' })).toBeVisible()
    await page.getByRole('button', { name: 'Xodim qo‘shish' }).click()
    const form = page.locator('#reception-form')
    await form.locator('input').nth(0).fill('Dilnoza Rahimova')
    await form.locator('input').nth(1).fill('+998901112255')
    await form.locator('select').selectOption('reception')
    await form.locator('input').nth(2).fill('dilnoza.rahimova')
    await form.locator('input[type="password"]').fill('DilnozaStrong2026')
    await page.getByRole('button', { name: 'Saqlash' }).click()

    await expect(page.getByText('@dilnoza.rahimova')).toBeVisible()
    expect(fixtures.getCreatedStaff()).toMatchObject({
      name: 'Dilnoza Rahimova',
      role: 'reception',
      username: 'dilnoza.rahimova',
    })

    await page.locator('.topbar-hamburger-mobile').click()
    await expect(page.locator('.sidebar.sidebar-open')).toBeVisible()
    await expect.poll(() => page.locator('.mobile-bottom-nav').evaluate((nav) => getComputedStyle(nav).display)).toBe('none')
    expect(await page.locator('.sidebar.sidebar-open').evaluate((sidebar) => Number(getComputedStyle(sidebar).zIndex))).toBeGreaterThan(400)
  })

  test('reception confirms before unlinking a student Telegram account', async ({ page }) => {
    await openMiniApp(page, 'reception')
    await page.getByRole('navigation', { name: 'Asosiy menyu' }).getByRole('button', { name: 'O‘quvchilar', exact: true }).click()
    await page.getByRole('button', { name: 'Telegramdan uzish' }).click()

    const dialog = page.getByRole('dialog', { name: 'Telegram akkauntini uzish' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Bekor qilish' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('button', { name: 'Telegramdan uzish' })).toBeVisible()

    await page.getByRole('button', { name: 'Telegramdan uzish' }).click()
    await page.getByRole('dialog', { name: 'Telegram akkauntini uzish' }).getByRole('button', { name: 'Tasdiqlash' }).click()
    await expect(page.getByText('Telegram akkaunti uzildi.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Telegramdan uzish' })).toHaveCount(0)
  })

  test('reception reschedules tomorrow and teacher/student see the changed lesson and notification', async ({ page, browser }) => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())
    const tomorrowDate = new Date(`${today}T12:00:00Z`)
    tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1)
    const tomorrow = tomorrowDate.toISOString().slice(0, 10)
    const weekday = new Date(`${tomorrow}T12:00:00Z`).getUTCDay() || 7
    const scheduleScenario = { weekday, override: null, events: [], deliveries: [], notifications: [] }

    await page.setViewportSize({ width: 390, height: 844 })
    await installMocks(page, 'reception', 'light', { scheduleScenario })
    await page.goto('/miniapp.html')
    await page.getByRole('navigation', { name: 'Asosiy menyu' }).getByRole('button', { name: 'Guruhlar', exact: true }).click()
    await page.getByRole('button', { name: 'O‘zgartirish' }).click()
    const sheet = page.getByRole('dialog', { name: /Dars jadvali/ })
    await sheet.locator('select').first().selectOption('schedule-slot')
    await sheet.getByLabel('Yangi sana').fill(new Date(new Date(`${tomorrow}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10))
    await sheet.getByLabel('Boshlanish vaqti').fill('11:00')
    await sheet.getByLabel('Tugash vaqti').fill('12:00')
    await sheet.getByLabel('Sabab').fill('Xona band bo‘lgani uchun')
    await sheet.getByRole('button', { name: 'Tekshirish' }).click()
    await expect(sheet.getByText('Xabarnoma oluvchilar:')).toBeVisible()
    await sheet.getByRole('button', { name: 'Saqlash' }).click()
    await expect(sheet).toBeHidden()

    const teacherPage = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await installMocks(teacherPage, 'teacher', 'light', { scheduleScenario })
    await teacherPage.goto('/miniapp.html')
    await teacherPage.getByRole('navigation', { name: 'Asosiy menyu' }).getByRole('button', { name: 'Guruhlar', exact: true }).click()
    await expect(teacherPage.getByText(/O‘zgartirildi/)).toBeVisible()
    await expect(teacherPage.getByText(/11:00–12:00/)).toBeVisible()
    await teacherPage.getByRole('button', { name: /Bildirishnomalar/ }).click()
    await expect(teacherPage.getByText(/Yangi vaqt: 11:00–12:00/)).toBeVisible()

    const studentPage = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await installMocks(studentPage, 'student', 'light', { scheduleScenario })
    await studentPage.goto('/miniapp.html')
    await studentPage.getByRole('navigation', { name: 'Asosiy menyu' }).getByRole('button', { name: 'Jadval', exact: true }).click()
    await expect(studentPage.getByText(/O‘zgartirilgan/)).toBeVisible()
    await studentPage.getByRole('button', { name: /Bildirishnomalar/ }).click()
    await expect(studentPage.getByText(/Yangi vaqt: 11:00–12:00/)).toBeVisible()
    await assertNoHorizontalOverflow(studentPage)
    await teacherPage.close()
    await studentPage.close()
  })
})
