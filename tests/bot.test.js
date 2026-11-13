import { describe, expect, it, vi } from 'vitest'
import { normalizeStudentCode, registerHandlers, splitTelegramText } from '../bot/handlers.mjs'
import { BTN, keyboardForRole } from '../bot/keyboard.mjs'
import { paymentsText, scheduleText } from '../bot/messages.mjs'

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
  const middlewares = []
  return {
    commands,
    handlers,
    middlewares,
    use(handler) {
      middlewares.push(handler)
    },
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

describe('Student ID parsing', () => {
  it('accepts the generated KS-XXXXXX format with common typing variations', () => {
    expect(normalizeStudentCode('KS-A7F2C9')).toBe('KS-A7F2C9')
    expect(normalizeStudentCode('ks a7f2c9')).toBe('KS-A7F2C9')
    expect(normalizeStudentCode('KSA7F2C9')).toBe('KS-A7F2C9')
    expect(normalizeStudentCode('KS - A7F2 C9')).toBe('KS-A7F2C9')
    expect(normalizeStudentCode('a7f2c9')).toBe('KS-A7F2C9')
  })

  it('does not treat ordinary words as student IDs', () => {
    expect(normalizeStudentCode('RAHMAT')).toBeNull()
    expect(normalizeStudentCode('salom')).toBeNull()
    expect(normalizeStudentCode('KS-A7F2K9')).toBeNull()
    expect(normalizeStudentCode('')).toBeNull()
  })
})

describe('Telegram bot privacy and callbacks', () => {
  it('ignores non-command messages in group chats and warns on commands', async () => {
    const bot = createBotStub()
    registerHandlers(bot, { getProfileByTelegram: vi.fn() }, 'https://school.example/miniapp', 'test-token')
    const [guard] = bot.middlewares
    const next = vi.fn()
    const reply = vi.fn()

    await guard({ chat: { type: 'group' }, message: { text: 'KS-A7F2C9' }, reply }, next)
    expect(next).not.toHaveBeenCalled()
    expect(reply).not.toHaveBeenCalled()

    await guard({ chat: { type: 'supergroup' }, message: { text: '/holat' }, reply }, next)
    expect(next).not.toHaveBeenCalled()
    expect(reply).toHaveBeenCalledOnce()

    await guard({ chat: { type: 'private' }, message: { text: '/holat' }, reply }, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('answers the callback query and shows the Worker error when selecting fails', async () => {
    const bot = createBotStub()
    const db = {
      selectHomework: vi.fn().mockRejectedValue(new Error('Vazifa topilmadi yoki sizga tegishli emas.')),
    }
    registerHandlers(bot, db, 'https://school.example/miniapp', 'test-token')
    const handler = [...bot.handlers.entries()].find(([key]) => key.includes('homework:'))[1]
    const ctx = {
      chat: { id: 5, type: 'private' },
      match: [null, '11111111-1111-1111-1111-111111111111'],
      callbackQuery: { id: 'q1' },
      answerCallbackQuery: vi.fn(),
      reply: vi.fn(),
    }

    await handler(ctx)

    expect(ctx.answerCallbackQuery).toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledWith('Vazifa topilmadi yoki sizga tegishli emas.')
  })
})

describe('Telegram bot message texts', () => {
  it('lists payments without inventing per-group splits', () => {
    const text = paymentsText([{ amount: 500000, month: 3, year: 2026, paid_at: '2026-03-05T07:00:00Z', method: 'cash' }])
    expect(text).toContain('500')
    expect(text).toContain('03.2026')
    expect(text).not.toContain('Guruhlar bo‘yicha')
  })

  it('shows a moved lesson on its original day', () => {
    const text = scheduleText([{ date: '2026-03-02', startTime: '10:00', endTime: '11:30', groupName: 'IELTS', status: 'rescheduled', newDate: '2026-03-04' }])
    expect(text).toContain('KO‘CHIRILDI → 04.03.2026')
  })
})
