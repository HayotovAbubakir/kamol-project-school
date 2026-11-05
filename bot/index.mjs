import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { Bot } from 'grammy'
import { createDb, getChatsForStudent } from './db.mjs'
import { registerHandlers } from './handlers.mjs'
import { BOT_COMMANDS } from './keyboard.mjs'
import { attendancePush, paymentPush } from './messages.mjs'

global.WebSocket = WebSocket

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return
  const raw = readFileSync(filePath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnvFile(resolve(root, '.env.local'))
loadEnvFile(resolve(root, '.env'))

function requireEnv(name) {
  let value = process.env[name]
  if (!value || !String(value).trim()) {
    throw new Error(`Missing env: ${name}`)
  }
  value = String(value).trim()
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim()
  }
  if (!value) throw new Error(`Missing env: ${name}`)
  return value
}

function getMiniAppUrl() {
  const rawUrl = process.env.TELEGRAM_WEBAPP_URL?.trim()
    || 'https://hayotovabubakir.github.io/kamol-project-school/miniapp.html'

  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('TELEGRAM_WEBAPP_URL yaroqli URL bo‘lishi kerak')
  }

  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('TELEGRAM_WEBAPP_URL HTTPS manzil bo‘lishi va login/parol saqlamasligi kerak')
  }

  if (url.pathname.endsWith('/')) url.pathname += 'miniapp.html'

  return url.toString()
}

async function notifyStudentChats(bot, db, studentId, text) {
  const chats = await getChatsForStudent(db, studentId)
  for (const chatId of chats) {
    try {
      await bot.api.sendMessage(chatId, text)
    } catch (err) {
      console.error('Telegram send failed', chatId, err.message || err)
    }
  }
}

async function resolveStudentName(db, studentId) {
  const { data } = await db.from('students').select('name').eq('id', studentId).maybeSingle()
  return data?.name || 'O‘quvchi'
}

function startRealtime(bot, db) {
  const channel = db
    .channel('parent-bot-alerts')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'attendance' },
      async (payload) => {
        try {
          const row = payload.new
          if (!row?.student_id) return
          const studentName = await resolveStudentName(db, row.student_id)
          let groupName = '—'
          if (row.group_id) {
            const { data: group } = await db.from('groups').select('name').eq('id', row.group_id).maybeSingle()
            groupName = group?.name || '—'
          }
          const text = attendancePush({
            studentName,
            groupName,
            status: row.status,
            date: row.date,
            note: row.note,
          })
          await notifyStudentChats(bot, db, row.student_id, text)
        } catch (err) {
          console.error('attendance notify error', err.message || err)
        }
      },
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'payments' },
      async (payload) => {
        try {
          const row = payload.new
          if (!row?.student_id) return
          const studentName = row.student_name || await resolveStudentName(db, row.student_id)
          const text = paymentPush({
            studentName,
            amount: row.amount,
            month: row.month,
            year: row.year,
          })
          await notifyStudentChats(bot, db, row.student_id, text)
        } catch (err) {
          console.error('payment notify error', err.message || err)
        }
      },
    )
    .subscribe((status) => {
      console.log('[realtime]', status)
    })

  return channel
}

async function main() {
  console.log('Env check:', {
    TELEGRAM_BOT_TOKEN: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    SUPABASE_URL: Boolean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL),
  })

  const token = requireEnv('TELEGRAM_BOT_TOKEN')
  const miniAppUrl = getMiniAppUrl()
  const db = createDb()

  // Deploy paytida bazani tekshiramiz — xato bo‘lsa logda aniq chiqadi
  const { error: pingError } = await db.from('students').select('id').limit(1)
  if (pingError) {
    console.error('Supabase ping failed:', pingError.message || pingError)
    throw new Error(`Supabase ulanmadi: ${pingError.message || pingError.code || 'unknown'}`)
  }
  console.log('Supabase OK')

  const bot = new Bot(token)

  registerHandlers(bot, db, miniAppUrl)
  if (miniAppUrl) {
    await bot.api.setChatMenuButton({
      menu_button: {
        type: 'web_app',
        text: 'Ilovani ochish',
        web_app: { url: miniAppUrl },
      },
    })
    console.log('Telegram Mini App menyu tugmasi sozlandi')
  }
  startRealtime(bot, db)

  bot.catch((err) => {
    console.error('Bot error', err.error || err)
  })

  console.log('Kamol School parent bot ishga tushdi (polling)...')
  // Webhook qolgan bo‘lsa polling xabar olmaydi
  await bot.api.deleteWebhook({ drop_pending_updates: false })
  await bot.api.setMyCommands(BOT_COMMANDS)
  await bot.start({
    onStart: (info) => {
      console.log(`@${info.username} tayyor — ota-ona botga /start yuboring`)
    },
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
