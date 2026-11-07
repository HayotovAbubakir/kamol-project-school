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

async function installMocks(page, role, scheme = 'light', { signedIn = true } = {}) {
  const profile = profileFor(role)
  const group = {
    id: 'group-1',
    name: 'A1 boshlang‘ich',
    teacher_id: 'teacher-1',
    monthly_fee: 350000,
    schedule: [{ day: 0, startTime: '09:00', endTime: '10:00', teacherId: 'teacher-1' }],
  }
  const student = {
    id: 'student-1',
    name: 'Ali Valiyev',
    phone: '+998901234567',
    parent_phone: '+998909876543',
    login: 'ali.valiyev',
    monthly_fee: 350000,
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
    if (pathname === `/api/students/${student.id}/telegram/unlink`) {
      records.profiles[0].telegram_id = null
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
      return json({ data: { homeworks: records.homework, payments: records.payments, attendance: records.attendance, groups: [group] } })
    }
    if (pathname === '/api/homework/review') return json({ data: { submissions: [], not_submitted: [] } })
    if (pathname.startsWith('/api/homework/history')) return json({ data: { events: [], submissions: [] } })
    if (pathname === '/api/questions') return json({ data: [] })
    if (pathname === '/api/staff') return json({ data: [] })
    if (pathname === '/api/finance/summary') return json({ income: 12_000_000, salary_cost: 4_300_000, expense_cost: 1_100_000, net: 6_600_000 })
    if (pathname === '/api/telegram/bot-info') return json({ bot_username: 'kamol_project_school_bot' })
    return json({ data: [] })
  })

  return {
    profile,
    getCreatedStudent: () => createdStudent,
    getCreatedHomework: () => createdHomework,
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
    { role: 'teacher', extra: ['questions'], detail: true },
    { role: 'reception', extra: ['homework', 'attendance', 'profile'] },
    { role: 'owner', extra: ['homework', 'payments', 'attendance', 'questions', 'reports', 'settings'] },
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

          await page.getByRole('button', { name: 'Ko‘proq menyu' }).click()
          await assertNoHorizontalOverflow(page)
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
      const passwordInput = page.getByLabel('O‘quvchi paroli (kamida 6 belgi)')
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
      await page.getByRole('button', { name: 'O‘quvchini yaratish' }).click()
      await expect(page.getByText('Login: abdulloh.ziyayev')).toBeVisible()
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
      await expect(page.getByText('Shu oy moliyasi')).toBeVisible()
      await expect(page.getByText(/6[,\s\u00a0\u202f]600[,\s\u00a0\u202f]000 so‘m/)).toBeVisible()
      await assertNoHorizontalOverflow(page)
    })
  }

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
})
