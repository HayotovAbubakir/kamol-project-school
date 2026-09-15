import {
  findStudentByCode,
  getAttendanceForStudent,
  getLinkByChat,
  getMonthPaid,
  getPaymentsForStudent,
  getStudentGroups,
  linkChatToStudent,
  unlinkChat,
} from './db.mjs'
import { BTN, mainKeyboard, removeKeyboard } from './keyboard.mjs'
import {
  alreadyLinked,
  attendanceText,
  codeNotFound,
  linkedOk,
  menuText,
  needLink,
  paymentsText,
  statusText,
  unlinked,
  welcomeAskCode,
} from './messages.mjs'

function currentMonthYear() {
  const now = new Date()
  return { month: now.getMonth() + 1, year: now.getFullYear() }
}

function looksLikeCode(text) {
  const t = String(text || '').trim().toUpperCase()
  return /^KS-[A-Z0-9]{4,10}$/.test(t) || /^[A-Z0-9]{4,12}$/.test(t)
}

function normalizeCode(text) {
  let t = String(text || '').trim().toUpperCase().replace(/\s+/g, '')
  if (/^[A-Z0-9]{6}$/.test(t)) t = `KS-${t}`
  return t
}

function dbHint(err) {
  const msg = err?.message || String(err)
  if (/telegram_links/i.test(msg) || /public_code/i.test(msg) || /PGRST/i.test(msg) || /relation/i.test(msg)) {
    return 'Baza yangilanmagan ko‘rinadi. Supabase SQL Editor da schema.sql ni Run qiling.'
  }
  return 'Vaqtincha xato. Keyinroq qayta urinib ko‘ring.'
}

async function safeReply(ctx, fn) {
  try {
    await fn()
  } catch (err) {
    console.error('Handler error', err)
    try {
      await ctx.reply(dbHint(err))
    } catch {
      /* ignore */
    }
  }
}

async function requireStudent(db, chatId, ctx) {
  const link = await getLinkByChat(db, chatId)
  const student = link?.students
  if (!student) {
    await ctx.reply(needLink(), removeKeyboard())
    return null
  }
  return student
}

async function replyHolat(ctx, db, student) {
  const { month, year } = currentMonthYear()
  const groups = await getStudentGroups(db, student.id)
  const expected = groups.reduce((sum, g) => sum + (Number(g.monthly_fee) || 0), 0)
  const paid = await getMonthPaid(db, student.id, month, year)
  const remaining = Math.max(0, expected - paid)
  await ctx.reply(
    statusText({ student, groups, expected, paid, remaining, month, year }),
    { reply_markup: mainKeyboard() },
  )
}

async function replyDavomat(ctx, db, student) {
  const rows = await getAttendanceForStudent(db, student.id, 14)
  await ctx.reply(attendanceText(rows), { reply_markup: mainKeyboard() })
}

async function replyTolov(ctx, db, student) {
  const groups = await getStudentGroups(db, student.id)
  const rows = await getPaymentsForStudent(db, student.id, 50)
  await ctx.reply(paymentsText(rows, groups), { reply_markup: mainKeyboard() })
}

export function registerHandlers(bot, db) {
  bot.command('start', async (ctx) => {
    await safeReply(ctx, async () => {
      const chatId = ctx.chat.id
      const link = await getLinkByChat(db, chatId)
      if (link?.students) {
        await ctx.reply(alreadyLinked(link.students), { reply_markup: mainKeyboard() })
        return
      }
      await ctx.reply(welcomeAskCode(), removeKeyboard())
    })
  })

  bot.command('menu', async (ctx) => {
    await safeReply(ctx, async () => {
      const student = await requireStudent(db, ctx.chat.id, ctx)
      if (!student) return
      await ctx.reply(`${student.name}\n\n${menuText()}`, { reply_markup: mainKeyboard() })
    })
  })

  bot.command('holat', async (ctx) => {
    await safeReply(ctx, async () => {
      const student = await requireStudent(db, ctx.chat.id, ctx)
      if (!student) return
      await replyHolat(ctx, db, student)
    })
  })

  bot.command('davomat', async (ctx) => {
    await safeReply(ctx, async () => {
      const student = await requireStudent(db, ctx.chat.id, ctx)
      if (!student) return
      await replyDavomat(ctx, db, student)
    })
  })

  bot.command('tolov', async (ctx) => {
    await safeReply(ctx, async () => {
      const student = await requireStudent(db, ctx.chat.id, ctx)
      if (!student) return
      await replyTolov(ctx, db, student)
    })
  })

  bot.command('unlink', async (ctx) => {
    await safeReply(ctx, async () => {
      await unlinkChat(db, ctx.chat.id)
      await ctx.reply(unlinked(), removeKeyboard())
    })
  })

  bot.on('message:text', async (ctx) => {
    await safeReply(ctx, async () => {
      const text = (ctx.message.text || '').trim()
      if (text.startsWith('/')) return

      const chatId = ctx.chat.id
      const existing = await getLinkByChat(db, chatId)

      if (existing?.students) {
        const student = existing.students
        if (text === BTN.holat) {
          await replyHolat(ctx, db, student)
          return
        }
        if (text === BTN.davomat) {
          await replyDavomat(ctx, db, student)
          return
        }
        if (text === BTN.tolov) {
          await replyTolov(ctx, db, student)
          return
        }
        if (text === BTN.unlink) {
          await unlinkChat(db, chatId)
          await ctx.reply(unlinked(), removeKeyboard())
          return
        }
        await ctx.reply(menuText(), { reply_markup: mainKeyboard() })
        return
      }

      if (!looksLikeCode(text) && !String(text).toUpperCase().includes('KS-')) {
        await ctx.reply(welcomeAskCode(), removeKeyboard())
        return
      }

      const student = await findStudentByCode(db, normalizeCode(text))
      if (!student) {
        await ctx.reply(codeNotFound(), removeKeyboard())
        return
      }

      await linkChatToStudent(db, chatId, student.id)
      await ctx.reply(linkedOk(student), { reply_markup: mainKeyboard() })
    })
  })
}
