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

async function getStudentHomework(db, studentId) {
  const { data: memberships, error: membershipError } = await db
    .from('group_students')
    .select('group_id')
    .eq('student_id', studentId)

  if (membershipError) throw membershipError
  const groupIds = (memberships || []).map((row) => row.group_id).filter(Boolean)
  if (!groupIds.length) return []

  const { data, error } = await db
    .from('homework')
    .select('*')
    .in('group_id', groupIds)
    .order('due_at', { ascending: true })

  if (error) throw error
  return data || []
}

async function saveHomeworkSubmission(db, studentId, homeworkId, payload) {
  const { data, error } = await db
    .from('homework_submissions')
    .upsert({
      homework_id: homeworkId,
      student_id: studentId,
      ...payload,
      status: 'pending',
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'homework_id,student_id' })
    .select()
    .single()

  if (error) throw error
  return data
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

  const homeworkList = await getStudentHomework(db, existing.students.id)
  if (homeworkList.length > 1) {
    await ctx.reply('Sizda bir nechta vazifa bor. Kerakli vazifani tanlab, faylni Mini App orqali yuboring.')
    return
  }
  const targetHomework = homeworkList[0] || null
  if (!targetHomework) {
    await ctx.reply('Hozircha sizga vazifa berilmagan. O‘qituvchi vazifa qo‘shguncha kuting.')
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

  await saveHomeworkSubmission(db, existing.students.id, targetHomework.id, {
    file_url: r2Result.url,
    text_answer: '',
    status: 'pending',
  })

  await ctx.reply(`Topshirish muvaffaqiyatli qabul qilindi.\nVazifa: ${targetHomework.title}\nFayl: ${r2Result.url}`)
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
      const link = await getLinkByChat(db, chatId)
      if (link?.students) {
        await ctx.reply(alreadyLinked(link.students), { reply_markup: mainKeyboard(webAppUrl) })
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
      const code = String(ctx.match || '').trim().toUpperCase()
      if (!code) {
        await ctx.reply('Foydalanuvchi kodini kiriting: /login KOD')
        return
      }

      const { data: staffCode, error } = await db
        .from('staff_codes')
        .select('id, code, role, user_id, is_active')
        .eq('code', code)
        .eq('is_active', true)
        .maybeSingle()

      if (error) throw error
      if (!staffCode) {
        await ctx.reply('Kiritilgan kod noto‘g‘ri yoki faol emas.')
        return
      }

      if (staffCode.user_id) {
        const { error: updateError } = await db
          .from('profiles')
          .update({ telegram_id: Number(ctx.from.id) })
          .eq('id', staffCode.user_id)
        if (updateError) throw updateError
      }

      await ctx.reply(`Login muvaffaqiyatli yakunlandi. Rol: ${staffCode.role}.\nEndi Mini App ochiladi.`)
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
