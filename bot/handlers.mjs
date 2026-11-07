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
  scheduleText,
  statusText,
  unlinked,
  welcomeAskCode,
} from './messages.mjs'
import { InlineKeyboard } from 'grammy'

function currentMonthYear() {
  const now = new Date()
  return { month: now.getMonth() + 1, year: now.getFullYear() }
}

function roleLabel(role) {
  return ({
    student: 'o‘quvchi',
    teacher: 'o‘qituvchi',
    reception: 'qabulxona',
    owner: 'egasi',
  })[role] || 'foydalanuvchi'
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
  const message = err instanceof Error ? err.message : ''
  if (/R2|file content/i.test(message)) return 'Faylni xavfsiz saqlab bo‘lmadi. PDF yoki rasm yuboring.'
  return 'So‘rovni bajarishda xatolik yuz berdi. Keyinroq qayta urinib ko‘ring.'
}

async function safeReply(ctx, fn) {
  try {
    await fn()
  } catch (err) {
    console.error('Telegram handler failed', {
      name: err instanceof Error ? err.name : 'UnknownError',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? String(err.stack || '').split('\n').slice(0, 5).join(' | ') : '',
    })
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

async function selectedHomework(ctx, db) {
  const chatId = ctx.chat.id
  const existing = await getLinkByChat(db, chatId)
  if (!existing?.students) {
    await ctx.reply(needLink(), removeKeyboard())
    return null
  }

  let targetHomework = await db.getPendingHomework(chatId)
  if (!targetHomework) {
    const homeworkList = await db.getStudentHomework(chatId)
    if (homeworkList.length > 1) {
      const keyboard = new InlineKeyboard()
      for (const homework of homeworkList.slice(0, 20)) {
        keyboard.text(homework.title.slice(0, 48), `homework:${homework.id}`).row()
      }
      await ctx.reply('Fayl qaysi vazifa uchun? Tanlang:', { reply_markup: keyboard })
      return null
    }
    targetHomework = homeworkList[0] || null
    if (targetHomework) await db.selectHomework(chatId, targetHomework.id)
  }
  if (!targetHomework) {
    await ctx.reply('Hozir topshirish uchun ochiq vazifa yo‘q.')
    return null
  }
  return targetHomework
}

async function replyDraftStatus(ctx, db, homeworkId, title) {
  const draft = await db.getHomeworkDraftState(ctx.chat.id, homeworkId)
  if (!draft) throw new Error('Vazifa draftini topib bo‘lmadi.')
  const hasContent = Boolean(String(draft.content_text || draft.text_answer || '').trim())
    || draft.files?.some((file) => file.kind === 'attachment')
  const proof = draft.files?.find((file) => file.kind === 'voice' || file.kind === 'video_note')
  if (hasContent && proof) {
    const keyboard = new InlineKeyboard().text('Yuborish', `submit-homework:${homeworkId}`)
    await ctx.reply(`“${title}” uchun material va ${proof.kind === 'voice' ? 'ovozli xabar' : 'dumaloq video'} tayyor. Yuborishni tasdiqlang.`, {
      reply_markup: keyboard,
    })
  } else {
    const missing = [
      !hasContent ? 'kamida bitta fayl yoki matn' : '',
      !proof ? 'kamida 3 soniyalik bitta dumaloq video yoki ovozli xabar' : '',
    ].filter(Boolean).join(' va ')
    await ctx.reply(`Draft saqlandi. Yuborish uchun ${missing} kerak.`)
  }
}

async function handleUploadMessage(ctx, db) {
  const targetHomework = await selectedHomework(ctx, db)
  if (!targetHomework) return
  const file = ctx.message.document || ctx.message.photo?.at(-1)
  if (!file) return
  if (file.file_size > 20 * 1024 * 1024) {
    await ctx.reply('Telegram bot orqali yuboriladigan fayl 20 MB dan oshmasligi kerak. Mini App’dan 100 MB gacha yuklang.')
    return
  }
  await db.addTelegramHomeworkFile(ctx.chat.id, targetHomework.homework_id || targetHomework.id, file.file_id, {
    name: ctx.message.document?.file_name || 'telegram-rasm.jpg',
    mimeType: ctx.message.document?.mime_type || 'image/jpeg',
    telegramChatId: ctx.chat.id,
    telegramMessageId: ctx.message.message_id,
  })
  await replyDraftStatus(ctx, db, targetHomework.homework_id || targetHomework.id, targetHomework.title)
}

async function replyHolat(ctx, db, student, webAppUrl) {
  const { month, year } = currentMonthYear()
  const groups = await getStudentGroups(db, student.id)
  const expected = groups.reduce((sum, g) => sum + (Number(g.monthly_fee) || 0), 0)
  const paid = await getMonthPaid(db, student.id, month, year)
  const remaining = Math.max(0, expected - paid)
  await ctx.reply(
    statusText({ student, groups, expected, paid, remaining, month, year }),
    { reply_markup: mainKeyboard(webAppUrl) },
  )
}

async function replyDavomat(ctx, db, student, webAppUrl) {
  const rows = await getAttendanceForStudent(db, student.id, 14)
  await ctx.reply(attendanceText(rows), { reply_markup: mainKeyboard(webAppUrl) })
}

async function replyJadval(ctx, db, student, webAppUrl) {
  const rows = await db.getStudentSchedule(student.id)
  await ctx.reply(scheduleText(rows), { reply_markup: mainKeyboard(webAppUrl) })
}

async function replyTolov(ctx, db, student, webAppUrl) {
  const groups = await getStudentGroups(db, student.id)
  const rows = await getPaymentsForStudent(db, student.id, 50)
  await ctx.reply(paymentsText(rows, groups), { reply_markup: mainKeyboard(webAppUrl) })
}

export function registerHandlers(bot, db, webAppUrl, token) {
  if (!token) throw new Error('Telegram bot token is required.')
  async function setPrivateChatMenuButton(ctx) {
    if (ctx.chat?.type !== 'private' || !webAppUrl) return

    await ctx.api.setChatMenuButton({
      chat_id: ctx.chat.id,
      menu_button: {
        type: 'web_app',
        text: 'Ilovani ochish',
        web_app: { url: webAppUrl },
      },
    })
  }

  bot.command('start', async (ctx) => {
    if (ctx.chat.type !== 'private') {
      await ctx.reply('Bu buyruq faqat shaxsiy chatda ishlaydi.')
      return
    }

    await safeReply(ctx, async () => {
      await setPrivateChatMenuButton(ctx)
      const chatId = ctx.chat.id
      const payload = String(ctx.match || '').trim()
      if (payload.startsWith('hw_')) {
        const homeworkId = payload.slice(3)
        const student = await requireStudent(db, chatId, ctx)
        if (!student) return
        const homework = await db.selectHomework(chatId, homeworkId)
        if (!homework?.title) {
          await ctx.reply('Uy vazifasi topilmadi yoki sizga biriktirilmagan.')
          return
        }
        await ctx.reply(`“${homework.title}” uchun draft boshlandi.\nFayl yoki matn yuboring, so‘ng bitta kamida 3 soniyalik dumaloq video yoki ovozli xabar yuboring. Yakunda “Yuborish”ni bosing.`)
        return
      }
      if (payload) {
        const staff = payload.startsWith('login_')
        const code = staff ? payload.slice(6) : payload
        const profile = await db.consumeInvite(code, Number(ctx.from.id), staff)
        await ctx.reply(`Telegram akkaunt ulandi, ${profile.name} (${roleLabel(profile.role)}).`, {
          reply_markup: mainKeyboard(webAppUrl),
        })
        return
      }
      const link = await getLinkByChat(db, chatId)
      if (link?.students) {
        await ctx.reply(alreadyLinked(link.students), { reply_markup: mainKeyboard(webAppUrl) })
        return
      }
      const profile = await db.getProfileByTelegram(Number(ctx.from.id))
      if (profile) {
        await ctx.reply(`Xush kelibsiz, ${profile.name}! Mini App orqali davom eting.`, {
          reply_markup: mainKeyboard(webAppUrl),
        })
        return
      }
      await ctx.reply(welcomeAskCode(), removeKeyboard())
    })
  })

  bot.command('login', async (ctx) => {
    if (ctx.chat.type !== 'private') {
      await ctx.reply('Login faqat shaxsiy chatda ishlaydi.')
      return
    }

    await safeReply(ctx, async () => {
      await setPrivateChatMenuButton(ctx)
      const code = String(ctx.match || '').trim()
      if (!code) {
        await ctx.reply('Foydalanuvchi kodini kiriting: /login KOD')
        return
      }
      const profile = await db.consumeInvite(code, Number(ctx.from.id), true)
      await ctx.reply(`Login muvaffaqiyatli yakunlandi. Rol: ${roleLabel(profile.role)}.\nMini App’ni ochishingiz mumkin.`, {
        reply_markup: mainKeyboard(webAppUrl),
      })
    })
  })

  bot.command('savol', async (ctx) => {
    await safeReply(ctx, async () => {
      const student = await requireStudent(db, ctx.chat.id, ctx)
      if (!student) return
      const text = String(ctx.match || '').trim()
      if (!text) {
        await ctx.reply('Savolingizni shunday yuboring: /savol Savol matni. Fayl yoki ovozni /savol matni bilan izoh sifatida birga yuborishingiz mumkin.')
        return
      }
      await db.createQuestion(ctx.chat.id, text)
      await ctx.reply('Savolingiz qabulxonaga yuborildi. Javob shu chatga keladi.')
    })
  })

  bot.callbackQuery(/^homework:([0-9a-f-]{36})$/, async (ctx) => {
    await safeReply(ctx, async () => {
      const homeworkId = ctx.match[1]
      await db.selectHomework(ctx.chat.id, homeworkId)
      await ctx.answerCallbackQuery({ text: 'Vazifa tanlandi.' })
      await ctx.editMessageText('Endi ushbu vazifa uchun istalgan fayl, matn, keyin esa kamida 3 soniyalik dumaloq video yoki ovozli xabar yuboring.')
    })
  })

  bot.callbackQuery(/^submit-homework:([0-9a-f-]{36})$/, async (ctx) => {
    await safeReply(ctx, async () => {
      await db.confirmHomework(ctx.chat.id, ctx.match[1])
      await ctx.answerCallbackQuery({ text: 'Topshiriq yuborildi.' })
      await ctx.editMessageText('Uy vazifasi o‘qituvchiga yuborildi. Rahmat!')
    })
  })

  bot.command('menu', async (ctx) => {
    await safeReply(ctx, async () => {
      const student = await requireStudent(db, ctx.chat.id, ctx)
      if (!student) return
      await ctx.reply(`${student.name}\n\n${menuText()}`, { reply_markup: mainKeyboard(webAppUrl) })
    })
  })

  bot.command('holat', async (ctx) => {
    await safeReply(ctx, async () => {
      const student = await requireStudent(db, ctx.chat.id, ctx)
      if (!student) return
      await replyHolat(ctx, db, student, webAppUrl)
    })
  })

  bot.command('jadval', async (ctx) => {
    await safeReply(ctx, async () => {
      const student = await requireStudent(db, ctx.chat.id, ctx)
      if (!student) return
      await replyJadval(ctx, db, student, webAppUrl)
    })
  })

  bot.command('davomat', async (ctx) => {
    await safeReply(ctx, async () => {
      const student = await requireStudent(db, ctx.chat.id, ctx)
      if (!student) return
      await replyDavomat(ctx, db, student, webAppUrl)
    })
  })

  bot.command('tolov', async (ctx) => {
    await safeReply(ctx, async () => {
      const student = await requireStudent(db, ctx.chat.id, ctx)
      if (!student) return
      await replyTolov(ctx, db, student, webAppUrl)
    })
  })

  bot.command('unlink', async (ctx) => {
    await safeReply(ctx, async () => {
      await unlinkChat(db, ctx.chat.id)
      await ctx.reply(unlinked(), removeKeyboard())
    })
  })

  bot.on('message:document', async (ctx) => {
    await safeReply(ctx, async () => {
      const caption = String(ctx.message.caption || '')
      if (/^\/savol(?:@\w+)?\s+/i.test(caption)) {
        const student = await requireStudent(db, ctx.chat.id, ctx)
        if (!student) return
        await db.createQuestion(ctx.chat.id, caption.replace(/^\/savol(?:@\w+)?\s+/i, '').trim(), {
          file_id: ctx.message.document.file_id,
          file_name: ctx.message.document.file_name || 'savol-fayli',
          file_kind: 'attachment',
        })
        await ctx.reply('Savolingiz va faylingiz qabulxonaga yuborildi.')
        return
      }
      await handleUploadMessage(ctx, db)
    })
  })

  bot.on('message:photo', async (ctx) => {
    await safeReply(ctx, async () => {
      const caption = String(ctx.message.caption || '')
      if (/^\/savol(?:@\w+)?\s+/i.test(caption)) {
        const student = await requireStudent(db, ctx.chat.id, ctx)
        if (!student) return
        const photo = ctx.message.photo.at(-1)
        await db.createQuestion(ctx.chat.id, caption.replace(/^\/savol(?:@\w+)?\s+/i, '').trim(), {
          file_id: photo.file_id,
          file_name: 'savol-rasmi.jpg',
          file_kind: 'attachment',
        })
        await ctx.reply('Savolingiz va rasmingiz qabulxonaga yuborildi.')
        return
      }
      await handleUploadMessage(ctx, db)
    })
  })

  for (const [messageType, proofKind] of [['voice', 'voice'], ['video_note', 'video_note']]) {
    bot.on(`message:${messageType}`, async (ctx) => {
      await safeReply(ctx, async () => {
        const caption = String(ctx.message.caption || '')
        if (proofKind === 'voice' && /^\/savol(?:@\w+)?\s+/i.test(caption)) {
          const student = await requireStudent(db, ctx.chat.id, ctx)
          if (!student) return
          await db.createQuestion(ctx.chat.id, caption.replace(/^\/savol(?:@\w+)?\s+/i, '').trim(), {
            file_id: ctx.message.voice.file_id,
            file_name: 'savol-ovoz.ogg',
            file_kind: 'voice',
          })
          await ctx.reply('Savolingiz va ovozli xabaringiz qabulxonaga yuborildi.')
          return
        }
        const targetHomework = await selectedHomework(ctx, db)
        if (!targetHomework) return
        const proof = ctx.message[messageType]
        if (!proof || Number(proof.duration || 0) < 3) {
          await ctx.reply('Proof kamida 3 soniya bo‘lishi kerak. Boshqa ovozli xabar yoki dumaloq video yuboring.')
          return
        }
        await db.addTelegramHomeworkFile(ctx.chat.id, targetHomework.homework_id || targetHomework.id, proof.file_id, {
          kind: proofKind,
          duration: proof.duration,
          mimeType: proofKind === 'voice' ? 'audio/ogg' : 'video/mp4',
          telegramChatId: ctx.chat.id,
          telegramMessageId: ctx.message.message_id,
        })
        await replyDraftStatus(ctx, db, targetHomework.homework_id || targetHomework.id, targetHomework.title)
      })
    })
  }

  bot.on('message:text', async (ctx) => {
    await safeReply(ctx, async () => {
      const text = (ctx.message.text || '').trim()
      if (text.startsWith('/')) return

      const chatId = ctx.chat.id
      const existing = await getLinkByChat(db, chatId)

      if (existing?.students) {
        const student = existing.students
        if (text === BTN.holat) {
          await replyHolat(ctx, db, student, webAppUrl)
          return
        }
        if (text === BTN.jadval) {
          await replyJadval(ctx, db, student, webAppUrl)
          return
        }
        if (text === BTN.davomat) {
          await replyDavomat(ctx, db, student, webAppUrl)
          return
        }
        if (text === BTN.tolov) {
          await replyTolov(ctx, db, student, webAppUrl)
          return
        }
        if (text === BTN.unlink) {
          await unlinkChat(db, chatId)
          await ctx.reply(unlinked(), removeKeyboard())
          return
        }
        const pending = await db.getPendingHomework(chatId)
        if (pending) {
          await db.addHomeworkText(chatId, pending.homework_id, text)
          await replyDraftStatus(ctx, db, pending.homework_id, pending.title)
          return
        }
        await ctx.reply(menuText(), { reply_markup: mainKeyboard(webAppUrl) })
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
      await ctx.reply(linkedOk(student), { reply_markup: mainKeyboard(webAppUrl) })
    })
  })
}
