import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { expect, test } from '@playwright/test'
import { installMocks } from './support/uiMocks.js'

/*
 * UI overlap / clickability audit for the website and the Telegram Mini App.
 * Every visible control is scrolled into view and hit-tested with elementFromPoint;
 * fixed bars, horizontal overflow, clipped modals, cut-off time inputs and
 * truncated button labels are reported. Screenshots: test-results/ui-audit/.
 */

const AUDIT_DIR = join(process.cwd(), 'test-results', 'ui-audit')
mkdirSync(AUDIT_DIR, { recursive: true })

const VIEWPORTS = [
  { width: 390, height: 844, theme: 'dark' },
  { width: 360, height: 740, theme: 'light' },
  { width: 1280, height: 800, theme: 'light' },
  { width: 1280, height: 800, theme: 'dark' },
]

/* ------------------------------------------------------------------ */
/* In-page audit                                                       */
/* ------------------------------------------------------------------ */

function inPageAudit({ scope, surface }) {
  const issues = []
  const vw = window.innerWidth
  const vh = window.innerHeight
  const describe = (el) => {
    if (!el) return 'null'
    const tag = el.tagName.toLowerCase()
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.') : ''
    const text = (el.getAttribute?.('aria-label') || el.innerText || el.value || el.getAttribute?.('placeholder') || '')
      .trim().replace(/\s+/g, ' ').slice(0, 40)
    return `${tag}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}${text ? ` "${text}"` : ''}`
  }
  const root = scope ? [...document.querySelectorAll(scope)].at(-1) : document.body
  if (!root) return [{ type: 'scope-missing', element: scope }]

  const isVisible = (el) => {
    if (el.closest('[inert], [aria-hidden="true"]')) return false
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false
    const rect = el.getBoundingClientRect()
    return rect.width > 1 && rect.height > 1
  }
  const closedDrawer = (el) => {
    const sidebar = el.closest('.sidebar')
    return sidebar && !sidebar.classList.contains('sidebar-open') && vw <= 1024
  }
  const controls = [...root.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="option"]')]
    .filter((el) => isVisible(el) && !closedDrawer(el))

  const fixedBars = (surface === 'site' ? ['.mobile-bottom-nav', '.topbar'] : ['.mini-bottom-nav', '.mini-app-bar'])
    .map((selector) => document.querySelector(selector)).filter(Boolean)

  const canvas = document.createElement('canvas').getContext('2d')
  const textWidth = (text, style) => {
    canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    return canvas.measureText(text).width
  }

  for (const el of controls) {
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
    const rect = el.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const description = describe(el)
    if (cx < 0 || cy < 0 || cx > vw || cy > vh) {
      issues.push({ type: 'offscreen', element: description, rect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)] })
      continue
    }
    const hit = document.elementFromPoint(cx, cy)
    const labelOk = hit && (hit.closest('label')?.contains(el) || [...(el.labels || [])].some((label) => label.contains(hit)))
    const ok = hit && (hit === el || el.contains(hit) || labelOk)
    if (!ok) {
      const bar = fixedBars.find((candidate) => candidate.contains(hit) && !candidate.contains(el))
      issues.push({ type: bar ? 'under-fixed-bar' : 'covered', element: description, coveredBy: describe(hit) })
    }

    if (el.matches('button, a, [role="button"], [role="tab"]') && (el.innerText || '').trim()) {
      // Action buttons / tabs must show their whole label; card-like buttons (headings, paragraphs) may ellipsize secondary text.
      const cardLike = el.querySelector('h1, h2, h3, h4, p')
      const truncated = !cardLike && [el, ...el.querySelectorAll('*')].find((node) => node.clientWidth
        && getComputedStyle(node).textOverflow === 'ellipsis' && node.scrollWidth > node.clientWidth + 1)
      if (truncated && !el.matches('.ui-select-trigger, .master-list-item')) {
        issues.push({ type: 'text-truncated', element: description })
      } else if (!truncated) {
        // Text spilling out of the button box (absolutely positioned badges are ignored).
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        const range = document.createRange()
        let spill = 0
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent.trim()) continue
          let skip = false
          for (let ancestor = node.parentElement; ancestor && ancestor !== el; ancestor = ancestor.parentElement) {
            const ancestorStyle = getComputedStyle(ancestor)
            if (ancestorStyle.position === 'absolute' || ancestorStyle.overflowX !== 'visible') skip = true
          }
          if (skip) continue
          range.selectNodeContents(node)
          for (const box of range.getClientRects()) {
            spill = Math.max(spill, rect.left - box.left, box.right - rect.right, rect.top - box.top, box.bottom - rect.bottom)
          }
        }
        if (spill > 2) issues.push({ type: 'text-overflow', element: description, spill: Math.round(spill) })
      }
    }

    if (el.matches('input[type="time"], input[type="date"], input[type="month"]')) {
      const style = getComputedStyle(el)
      const sample = el.type === 'time' ? '00:00 AM' : el.type === 'date' ? '00/00/0000' : 'September 0000'
      // Chromium draws the picker icon (~20px) plus inner field spacing next to the text.
      const needed = textWidth(sample, style) + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 40
      if (el.clientWidth < needed) {
        issues.push({ type: 'input-cut-off', element: description, clientWidth: el.clientWidth, needed: Math.ceil(needed) })
      }
    }
  }

  const containers = ['html', 'body', '.app-layout', '.main-area', '.content-area', '.modal-panel', '.modal-body', '.sidebar', '.miniapp', '.mini-app-content', '.mini-sheet', '.mini-modal', '.mini-more-menu']
  for (const selector of containers) {
    for (const container of document.querySelectorAll(selector)) {
      if (!isVisible(container) && selector !== 'html' && selector !== 'body') continue
      if (container.scrollWidth > container.clientWidth + 1) {
        const box = container.getBoundingClientRect()
        const offenders = [...container.querySelectorAll('*')]
          .filter((node) => {
            const nodeRect = node.getBoundingClientRect()
            return nodeRect.width > 0 && nodeRect.right > box.right + 1 && !node.closest('.table-wrap, .mini-tabs, [style*="overflow"]')
          })
          .filter((node, _, list) => !list.some((other) => other !== node && node.contains(other)))
          .slice(0, 3)
          .map(describe)
        issues.push({ type: 'h-overflow', element: selector, scrollWidth: container.scrollWidth, clientWidth: container.clientWidth, offenders })
      }
    }
  }

  for (const panel of document.querySelectorAll('.modal-panel, .mini-modal, .mini-sheet')) {
    const box = panel.getBoundingClientRect()
    if (box.top < -1 || box.bottom > vh + 1) issues.push({ type: 'modal-clipped', element: describe(panel), top: Math.round(box.top), bottom: Math.round(box.bottom) })
    for (const bar of fixedBars) {
      const barRect = bar.getBoundingClientRect()
      if (!bar.checkVisibility() || barRect.height === 0) continue
      const overlapTop = Math.max(box.top, barRect.top)
      const overlapBottom = Math.min(box.bottom, barRect.bottom)
      if (overlapBottom - overlapTop > 1 && !panel.contains(bar)) {
        const hit = document.elementFromPoint(box.left + box.width / 2, (overlapTop + overlapBottom) / 2)
        if (hit && bar.contains(hit)) issues.push({ type: 'modal-under-bar', element: describe(panel), bar: describe(bar) })
      }
    }
  }

  return issues
}

/* ------------------------------------------------------------------ */
/* Collector helpers                                                   */
/* ------------------------------------------------------------------ */

function createCollector(name) {
  const findings = []
  return {
    findings,
    async check(page, state, { scope = null, surface = 'site', scroller = null } = {}) {
      await page.waitForTimeout(250)
      const safeState = state.replace(/[^a-z0-9-]+/gi, '_').slice(0, 80)
      await page.screenshot({ path: join(AUDIT_DIR, `${name}-${safeState}.png`) })
      // Toasts are transient: report when they sit on top of navigation bars, then hide them for the hit-test.
      const toastIssues = await page.evaluate(() => {
        const bars = [...document.querySelectorAll('.topbar, .mobile-bottom-nav, .mini-app-bar, .mini-bottom-nav')]
          .filter((bar) => bar.checkVisibility() && bar.getBoundingClientRect().height > 0)
        const found = []
        for (const toast of document.querySelectorAll('.notif-toast')) {
          const box = toast.getBoundingClientRect()
          for (const bar of bars) {
            const other = bar.getBoundingClientRect()
            if (box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top) {
              found.push({ type: 'toast-over-bar', element: 'notif-toast', bar: bar.className.split(' ')[0] })
            }
          }
        }
        document.querySelectorAll('.notif-toast-host').forEach((host) => { host.style.visibility = 'hidden' })
        return found
      })
      const issues = [...toastIssues, ...await page.evaluate(inPageAudit, { scope, surface })]
      await page.evaluate(() => document.querySelectorAll('.notif-toast-host').forEach((host) => { host.style.visibility = '' }))
      if (scroller) {
        await page.evaluate((selector) => {
          for (const node of document.querySelectorAll(selector)) node.scrollTop = node.scrollHeight
        }, scroller)
        await page.waitForTimeout(150)
        await page.screenshot({ path: join(AUDIT_DIR, `${name}-${safeState}-bottom.png`) })
      }
      for (const issue of issues) findings.push({ state, ...issue })
      this.save()
      return issues
    },
    save() {
      writeFileSync(join(AUDIT_DIR, `${name}.json`), JSON.stringify(findings, null, 2))
    },
  }
}

const DESTRUCTIVE = /o‘chir|o'chir|chiqish|uzish|bekor qilish|delete|remove|logout|saqlash|yuborish|tasdiq|faolsiz|o‘chirish/i
const MODAL_TRIGGERS = /yangi|qo‘shish|qo'shish|ochish|tahrir|o‘zgartir|jadval|to‘lov|tolov|parol|tuzatish|tarix|xodim|kamera|rasm|maosh|xarajat/i

async function closeSiteModal(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!(await page.locator('.modal-backdrop').count())) return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
  }
}

async function auditSiteModals(page, collector, route) {
  const candidates = page.locator('.content-area button:visible')
  const total = Math.min(await candidates.count(), 40)
  const texts = []
  for (let index = 0; index < total; index += 1) {
    const text = ((await candidates.nth(index).innerText().catch(() => '')) || (await candidates.nth(index).getAttribute('aria-label')) || '').trim()
    if (text && MODAL_TRIGGERS.test(text) && !DESTRUCTIVE.test(text) && !texts.includes(text)) texts.push(text)
  }
  for (const text of texts.slice(0, 8)) {
    const button = page.locator('.content-area button:visible', { hasText: text }).first()
    if (!(await button.count()) || await button.isDisabled().catch(() => true)) continue
    await button.scrollIntoViewIfNeeded().catch(() => {})
    await button.click({ timeout: 3000 }).catch(() => {})
    const opened = await page.locator('.modal-backdrop .modal-panel').first().waitFor({ state: 'visible', timeout: 1200 }).then(() => true).catch(() => false)
    if (!opened) continue
    const state = `${route}-modal-${text}`
    await collector.check(page, state, { scope: '.modal-panel', scroller: '.modal-body' })
    const selectTrigger = page.locator('.modal-panel .ui-select-trigger:visible').first()
    if (await selectTrigger.count()) {
      await selectTrigger.click().catch(() => {})
      if (await page.locator('.ui-select-menu').count()) {
        await collector.check(page, `${state}-select`, { scope: '.ui-select-menu' })
        await page.keyboard.press('Escape')
      }
    }
    await closeSiteModal(page)
  }
  await closeSiteModal(page)
}

const SITE_ROUTES = {
  owner: ['', 'groups', 'teachers', 'students', 'schedule', 'attendance', 'attendance/absent-today', 'payments/debtors', 'finance', 'finance/paid', 'finance/debtors', 'notifications', 'questions', 'settings/fon', 'settings/account', 'settings/staff'],
  reception: ['', 'groups', 'teachers', 'students', 'schedule', 'attendance', 'attendance/absent-today', 'payments/debtors', 'questions', 'settings/fon'],
  teacher: ['', 'groups', 'attendance', 'schedule', 'settings/fon'],
}

test.describe('UI overlap audit — website', () => {
  test.use({ locale: 'en-US' })
  for (const role of Object.keys(SITE_ROUTES)) {
    for (const viewport of VIEWPORTS) {
      test(`site ${role} ${viewport.width}x${viewport.height} ${viewport.theme}`, async ({ page }) => {
        test.setTimeout(600_000)
        const name = `site-${role}-${viewport.width}-${viewport.theme}`
        const collector = createCollector(name)
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await installMocks(page, role, viewport.theme)

        for (const route of SITE_ROUTES[role]) {
          await page.goto(`/${role}${route ? `/${route}` : ''}`)
          await page.locator('.content-area').waitFor({ state: 'visible', timeout: 15_000 })
          await page.locator('.app-loader').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
          const routeName = route || 'home'
          await collector.check(page, routeName, { scroller: '.content-area' })
          await page.evaluate(() => { const node = document.querySelector('.content-area'); if (node) node.scrollTop = 0 })
          await auditSiteModals(page, collector, routeName)
        }

        if (viewport.width <= 1024) {
          await page.goto(`/${role}`)
          await page.locator('.topbar-hamburger').click()
          await expect(page.locator('.sidebar.sidebar-open')).toBeVisible()
          await page.waitForTimeout(400)
          await collector.check(page, 'sidebar-open', { scope: '.sidebar' })
          const outside = await page.evaluate(() => {
            const hit = document.elementFromPoint(window.innerWidth - 10, window.innerHeight - 30)
            return hit?.className || ''
          })
          if (!/sidebar-scrim/.test(String(outside))) collector.findings.push({ state: 'sidebar-open', type: 'scrim-not-on-top', coveredBy: String(outside) })
        }

        collector.save()
        expect(collector.findings, JSON.stringify(collector.findings, null, 2)).toEqual([])
      })
    }
  }
})

/* ------------------------------------------------------------------ */
/* Mini App                                                            */
/* ------------------------------------------------------------------ */

const MINI_CHECK = { surface: 'mini', scroller: '.mini-app-content' }
const MINI_OVERLAY_SCOPE = '.mini-modal-backdrop .mini-modal, .mini-modal-backdrop .mini-sheet, .mini-sheet-backdrop .mini-sheet, .mini-modal-backdrop > *'

async function openMiniOverlayAndAudit(page, collector, state) {
  const overlay = page.locator('.mini-modal-backdrop, .mini-sheet-backdrop').last()
  if (!(await overlay.isVisible().catch(() => false))) return false
  await collector.check(page, state, { scope: MINI_OVERLAY_SCOPE, surface: 'mini', scroller: '.mini-modal, .mini-sheet' })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  if (await overlay.isVisible().catch(() => false)) {
    const close = page.locator('.mini-modal-backdrop, .mini-sheet-backdrop').last().getByRole('button', { name: /Yopish|Bekor|×|Menyuni yopish/ }).first()
    await close.click({ timeout: 2000 }).catch(() => {})
  }
  return true
}

test.describe('UI overlap audit — Mini App', () => {
  test.use({ locale: 'en-US' })
  for (const role of ['owner', 'reception', 'teacher', 'student']) {
    for (const viewport of VIEWPORTS) {
      test(`mini ${role} ${viewport.width}x${viewport.height} ${viewport.theme}`, async ({ page }) => {
        test.setTimeout(600_000)
        const name = `mini-${role}-${viewport.width}-${viewport.theme}`
        const collector = createCollector(name)
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await installMocks(page, role, viewport.theme)
        await page.goto('/miniapp.html')
        const nav = page.getByRole('navigation', { name: 'Asosiy menyu' })
        await expect(nav).toBeVisible({ timeout: 15_000 })
        await page.locator('.app-loader').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})

        const tabs = await nav.getByRole('button').allInnerTexts()
        for (const label of tabs) {
          await nav.getByRole('button', { name: label.trim(), exact: true }).click()
          await page.waitForTimeout(200)
          await collector.check(page, `tab-${label.trim()}`, MINI_CHECK)
        }

        const moreButton = page.getByRole('button', { name: 'Ko‘proq menyu' })
        await moreButton.click()
        const moreDialog = page.getByRole('dialog', { name: 'Ko‘proq bo‘limlar' })
        await expect(moreDialog).toBeVisible()
        await collector.check(page, 'more-menu', { scope: '.mini-more-menu', surface: 'mini' })
        const moreItems = (await moreDialog.locator('.mini-more-item:not(.mini-more-logout)').allInnerTexts()).map((text) => text.trim())
        await page.keyboard.press('Escape')

        for (const label of moreItems) {
          await moreButton.click()
          await moreDialog.getByRole('button', { name: label, exact: true }).click()
          await page.waitForTimeout(250)
          await collector.check(page, `more-${label}`, MINI_CHECK)

          if (/Qarzdorlar/.test(label)) {
            const student = page.locator('.mini-app-content button.w-full.text-left').first()
            if (await student.count()) {
              await student.click()
              await page.waitForTimeout(250)
              await collector.check(page, 'studentPayments', MINI_CHECK)
              const edit = page.locator('.mini-app-content').getByRole('button', { name: /Tahrirlash|Tuzatish/ }).first()
              if (await edit.count()) {
                await edit.click()
                await page.waitForTimeout(200)
                await collector.check(page, 'studentPayments-edit', MINI_CHECK)
              }
            }
          }
        }

        if (role !== 'student') {
          const groupsTab = nav.getByRole('button', { name: 'Guruhlar', exact: true })
          if (await groupsTab.count()) {
            await groupsTab.click()
            const change = page.locator('.mini-app-content').getByRole('button', { name: /Jadvalni o‘zgartirish|O‘zgartirish/ }).first()
            if (await change.count()) {
              await change.click()
              await openMiniOverlayAndAudit(page, collector, 'schedule-sheet')
            }
          }
        }

        if (role === 'reception' || role === 'owner') {
          await nav.getByRole('button', { name: 'O‘quvchilar', exact: true }).click()
          const remove = page.locator('.mini-app-content').getByRole('button', { name: 'O‘chirish', exact: true }).first()
          if (await remove.count()) {
            await remove.click()
            await openMiniOverlayAndAudit(page, collector, 'confirm-dialog')
          }
        }

        if (role === 'teacher') {
          await nav.getByRole('button', { name: 'Vazifalar', exact: true }).click()
          const create = page.getByRole('button', { name: 'Vazifa berish' })
          if (await create.count()) {
            await create.click()
            await collector.check(page, 'homework-form', MINI_CHECK)
          }
        }

        if (role === 'owner') {
          await nav.getByRole('button', { name: 'Xodimlar', exact: true }).click()
          const add = page.getByRole('button', { name: 'Xodim qo‘shish' }).first()
          if (await add.count()) {
            await add.click()
            await collector.check(page, 'staff-form', MINI_CHECK)
          }
        }

        collector.save()
        expect(collector.findings, JSON.stringify(collector.findings, null, 2)).toEqual([])
      })
    }
  }
})
