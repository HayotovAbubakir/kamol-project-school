import { describe, expect, it, vi } from 'vitest'
import { registerHandlers, splitTelegramText } from '../bot/handlers.mjs'
import { BTN, keyboardForRole } from '../bot/keyboard.mjs'

const dbMocks = vi.hoisted(() => ({
  getLinkByChat: vi.fn(),
}))

vi.mock('../bot/db.mjs', () => ({
  findStudentByCode: vi.fn(),
  getAttendanceForStudent: vi.fn(),
  getLinkByChat: dbMocks.getLinkByChat,
  getMonthPaid: vi.fn(),
  getPaymentsForStudent: vi.fn(),
  getStudentGroups: vi.fn(),
  linkChatToStudent: vi.fn(),
  unlinkChat: vi.fn(),
}))

function createBotStub() {
  const commands = new Map()
  const handlers = new Map()
  return {
    commands,
    handlers,
    command(name, handler) {
      commands.set(name, handler)
    },
    callbackQuery(pattern, handler) {
      handlers.set(String(pattern), handler)
    },
    on(filter, handler) {
      handlers.set(filter, handler)
    },
  }
}

describe('Telegram bot role menus', () => {
  it('shows only the Mini App action to staff instead of student commands', () => {
    const markup = keyboardForRole('teacher', 'https://school.example/miniapp')
    const labels = markup.keyboard.flat().map((button) => button.text)
    expect(labels).toEqual(['Ilovani ochish'])
    expect(markup.keyboard.flat()[0].web_app.url).toBe('https://school.example/miniapp')

    const studentLabels = keyboardForRole('student', 'https://school.example/miniapp')
      .keyboard.flat().map((button) => button.text)
    expect(studentLabels).toContain(BTN.jadval)
    expect(studentLabels).toContain(BTN.unlink)
  })

  it('does not send staff into student-only schedule commands', async () => {
    const bot = createBotStub()
    const getStudentSchedule = vi.fn()
    dbMocks.getLinkByChat.mockResolvedValue(null)
    const db = {
      getProfileByTelegram: vi.fn().mockResolvedValue({ name: 'Dilshod', role: 'teacher' }),
      getStudentSchedule,
    }
    registerHandlers(bot, db, 'https://school.example/miniapp', 'test-token')
    const replies = []
    const ctx = {
      chat: { id: 123, type: 'private' },
      from: { id: 123 },
      match: '',
      reply: vi.fn(async (...args) => replies.push(args)),
    }

    await bot.commands.get('jadval')(ctx)

    expect(getStudentSchedule).not.toHaveBeenCalled()
    expect(replies[0][0]).toContain('bu buyruq')
    expect(replies[0][1].reply_markup.keyboard.flat().map((button) => button.text))
      .toEqual(['Ilovani ochish'])
  })
})

describe('Telegram long-message handling', () => {
  it('splits long text without exceeding limits or breaking emoji', () => {
    const source = `${'📚 jadval satri\n'.repeat(20)}yakun`
    const chunks = splitTelegramText(source, 32)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.length <= 32)).toBe(true)
    for (const chunk of chunks) {
      const first = chunk.charCodeAt(0)
      const last = chunk.charCodeAt(chunk.length - 1)
      expect(first < 0xDC00 || first > 0xDFFF).toBe(true)
      expect(last < 0xD800 || last > 0xDBFF).toBe(true)
    }
    expect(chunks.join('\n')).toContain('yakun')
  })

  it('rejects invalid Telegram chunk sizes', () => {
    expect(() => splitTelegramText('matn', 0)).toThrow(RangeError)
  })
})
