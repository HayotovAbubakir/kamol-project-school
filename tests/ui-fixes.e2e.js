import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { expect, test } from '@playwright/test'
import { installMocks } from './support/uiMocks.js'

const SHOTS = join(process.cwd(), 'test-results', 'ui-audit')
mkdirSync(SHOTS, { recursive: true })

async function openSite(page, { role = 'owner', theme = 'dark', width = 1280, height = 800, path = 'students' } = {}) {
  await page.setViewportSize({ width, height })
  await installMocks(page, role, theme)
  await page.goto(`/${role}/${path}`)
  await page.locator('.content-area').waitFor({ state: 'visible', timeout: 15_000 })
  await page.locator('.app-loader').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
}

const isNeutral = (color) => {
  const [r, g, b] = (color.match(/\d+(\.\d+)?/g) || []).map(Number)
  return Math.max(r, g, b) - Math.min(r, g, b) <= 6
}

test.describe('UI fixes', () => {
  for (const theme of ['dark', 'light']) {
    for (const width of [1280, 390]) {
      test(`student card is compact and has no Telegram invite UI (${theme}, ${width}px)`, async ({ page }) => {
        await openSite(page, { theme, width, height: width > 500 ? 800 : 844 })
        const card = page.locator('.student-card')
        await expect(card).toBeVisible()
        await expect(card.getByRole('heading', { name: 'Ali Valiyev' })).toBeVisible()

        const actions = card.locator('.student-card-actions')
        await expect(actions.getByRole('button', { name: /To.lov qo.shish/ })).toBeVisible()
        await expect(actions.getByRole('button', { name: /Tahrirlash/ })).toBeVisible()
        await expect(actions.getByRole('button', { name: /Login \/ parol/ })).toBeVisible()
        await expect(actions.getByRole('button', { name: /O.chirish/ })).toBeVisible()
        await expect(page.getByText(/Telegram ulash|Telegram ulan|Havolani ochish|Telegramdan uzish/)).toHaveCount(0)

        await card.getByRole('button', { name: /Parolni ko.rsatish/ }).click()
        await expect(card.getByText('Parol2026')).toBeVisible()

        // Action buttons share one row height and none is clipped.
        const heights = await actions.locator('button').evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().height)))
        expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1)
        expect(await page.evaluate(() => document.querySelector('.content-area').scrollWidth <= document.querySelector('.content-area').clientWidth + 1)).toBe(true)

        await page.screenshot({ path: join(SHOTS, `fix-student-card-${theme}-${width}.png`) })
        await page.evaluate(() => { document.querySelector('.content-area').scrollTop = 99999 })
        await page.waitForTimeout(150)
        await page.screenshot({ path: join(SHOTS, `fix-student-card-${theme}-${width}-bottom.png`) })
      })
    }

    test(`backgrounds are neutral, not tinted (${theme})`, async ({ page }) => {
      await openSite(page, { theme, path: '' })
      const colors = await page.evaluate(() => {
        const read = (selector) => {
          const node = document.querySelector(selector)
          if (!node) return null
          const style = getComputedStyle(node)
          return { color: style.backgroundColor, image: style.backgroundImage }
        }
        return { wallpaper: read('.live-bg'), body: getComputedStyle(document.body).backgroundColor, html: getComputedStyle(document.documentElement).backgroundColor }
      })
      expect(colors.wallpaper.image).toBe('none')
      expect(isNeutral(colors.wallpaper.color), JSON.stringify(colors)).toBe(true)
      expect(isNeutral(colors.html), JSON.stringify(colors)).toBe(true)
      await page.screenshot({ path: join(SHOTS, `fix-background-${theme}.png`) })
    })
  }

  test('mouse wheel over the student list scrolls the page once the list reaches its end', async ({ page }) => {
    await openSite(page, { theme: 'dark' })
    await expect(page.locator('.student-card')).toBeVisible()
    await page.waitForTimeout(300)
    const list = page.locator('.master-list')
    const box = await list.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height - 20, 300))
    for (let step = 0; step < 8; step += 1) {
      await page.mouse.wheel(0, 500)
      await page.waitForTimeout(120)
    }
    const state = await page.evaluate(() => ({
      page: document.querySelector('.content-area').scrollTop,
      list: document.querySelector('.master-list').scrollTop,
    }))
    expect(state.list).toBeGreaterThan(0)
    expect(state.page).toBeGreaterThan(0)
    // The list stays on screen next to the long detail card.
    const listBox = await page.locator('.master-list-shell').boundingBox()
    expect(listBox.y + listBox.height).toBeGreaterThan(200)
    expect(listBox.y).toBeLessThan(800)
  })

  for (const theme of ['dark', 'light']) {
    test(`schedule change dialog uses themed dropdowns above the modal (${theme})`, async ({ page }) => {
      await openSite(page, { theme, path: 'groups' })
      await page.getByRole('button', { name: /O‘zgartirish/ }).first().click()
      const modal = page.locator('.modal-panel')
      await expect(modal).toBeVisible()
      await expect(modal.locator('select')).toHaveCount(0)

      const trigger = modal.locator('label', { hasText: 'Amal' }).locator('.ui-select-trigger')
      await trigger.click()
      const menu = page.locator('.ui-select-menu')
      await expect(menu).toBeVisible()
      const option = menu.getByRole('option', { name: 'Darsni bekor qilish' })
      const probe = await option.evaluate((node) => {
        const rect = node.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        return {
          onTop: node === hit || node.contains(hit),
          menuBg: getComputedStyle(node.closest('.ui-select-menu')).backgroundColor,
        }
      })
      expect(probe.onTop).toBe(true)
      const [r, g, b] = probe.menuBg.match(/\d+/g).map(Number)
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      if (theme === 'dark') expect(luminance).toBeLessThan(0.25)
      else expect(luminance).toBeGreaterThan(0.9)
      await page.screenshot({ path: join(SHOTS, `fix-schedule-select-${theme}.png`) })
      await option.click()
      await expect(trigger).toContainText('Darsni bekor qilish')
    })
  }

  test('attendance toolbar keeps the finalize button aligned with the date field', async ({ page }) => {
    await openSite(page, { theme: 'light', path: 'attendance' })
    const input = await page.locator('#attendance-date').boundingBox()
    const button = await page.locator('.page-toolbar-btn').boundingBox()
    expect(Math.abs((input.y + input.height) - (button.y + button.height))).toBeLessThanOrEqual(1)
    expect(Math.abs(input.height - button.height)).toBeLessThanOrEqual(2)
    await page.screenshot({ path: join(SHOTS, 'fix-attendance-toolbar.png') })
  })
})
