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
import { InlineKeyboard } from 'grammy'

function currentMonthYear() {
  const now = new Date()
  return { month: now.getMonth() + 1, year: now.getFullYear() }
}

function roleLabel(role) {
  return ({
    student: 'o‘quvchi',
    teacher: 'o‘qituvchi',
    admin: 'qabulxona',
    reception: 'qabulxona',
    owner: 'ega',
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
    console.error('Telegram handler failed', err instanceof Error ? err.name : 'UnknownError')
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

async function saveHomeworkSubmission(db, studentId, homeworkId, payload) {
  await db.submitHomework({
    homework_id: homeworkId,
    student_id: studentId,
    ...payload,
    status: 'pending',
    submitted_at: new Date().toISOString(),
  })
}

async function handleUploadMessage(ctx, db, token) {
  const chatId = ctx.chat.id
  const existing = await getLinkByChat(db, chatId)
  if (!existing?.students) {
    await ctx.reply(needLink(), removeKeyboard())
    return
  }

  const file = ctx.message.document || ctx.message.photo?.at(-1)
  if (!file) {
    await ctx.reply('Rasm yoki PDF faylini yuboring.')
    return
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
      return
    }
    targetHomework = homeworkList[0] || null
    if (targetHomework) await db.selectHomework(chatId, targetHomework.id)
  }
  if (!targetHomework) {
    await ctx.reply('Hozir topshirish uchun ochiq vazifa yo‘q.')
    return
  }

  const fileName = ctx.message.document?.file_name || ''
  const inferredType = fileName.toLowerCase().endsWith('.pdf')
    ? 'application/pdf'
    : /\.(jpe?g)$/i.test(fileName)
      ? 'image/jpeg'
      : /\.png$/i.test(fileName)
        ? 'image/png'
        : /\.webp$/i.test(fileName)
          ? 'image/webp'
          : ''
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
  const documentType = ctx.message.document?.mime_type
  const contentType = ctx.message.photo
    ? 'image/jpeg'
    : allowedTypes.includes(documentType) ? documentType : inferredType
  if (!allowedTypes.includes(contentType)) {
    await ctx.reply('Faqat PDF yoki JPG, PNG, WebP rasm yuborish mumkin.')
    return
  }
  if (file.file_size > 10 * 1024 * 1024) {
    await ctx.reply('Fayl hajmi 10 MB dan oshmasligi kerak.')
    return
  }

  const fileId = file.file_id
  const fileInfo = await ctx.api.getFile(fileId)
  const remoteFile = fileInfo.file_path
  if (!remoteFile) throw new Error('Telegram fayl manzili topilmadi')
  const uploadName = fileName || remoteFile.split('/').pop() || `${Date.now()}.upload`
  const fileUrl = `https://api.telegram.org/file/bot${token}/${remoteFile}`
  const response = await fetch(fileUrl)
  if (!response.ok) {
    throw new Error('Telegram faylini yuklab olishda xatolik yuz berdi')
  }

  const r2Result = await db.uploadToR2({
    fileStream: response.body,
    fileName: uploadName,
    mimeType: contentType,
  })

  await saveHomeworkSubmission(db, existing.students.id, targetHomework.homework_id || targetHomework.id, {
    file_url: r2Result.url,
    text_answer: '',
    status: 'pending',
    chat_id: chatId,
  })

  await ctx.reply(`Topshirish muvaffaqiyatli qabul qilindi.\nVazifa: ${targetHomework.title}`)
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

  bot.callbackQuery(/^homework:([0-9a-f-]{36})$/, async (ctx) => {
    await safeReply(ctx, async () => {
      const homeworkId = ctx.match[1]
      await db.selectHomework(ctx.chat.id, homeworkId)
      await ctx.answerCallbackQuery({ text: 'Vazifa tanlandi.' })
      await ctx.editMessageText('Endi ushbu vazifa uchun rasm yoki PDF faylini yuboring.')
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
      await handleUploadMessage(ctx, db, token)
    })
  })

  bot.on('message:photo', async (ctx) => {
    await safeReply(ctx, async () => {
      await handleUploadMessage(ctx, db, token)
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
          await replyHolat(ctx, db, student, webAppUrl)
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
