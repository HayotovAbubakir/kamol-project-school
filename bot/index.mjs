import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bot } from 'grammy'
import { createDb, getChatsForStudent } from './db.mjs'
import { registerHandlers } from './handlers.mjs'
import { BOT_COMMANDS } from './keyboard.mjs'
import { attendancePush, paymentPush } from './messages.mjs'

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
  const value = process.env[name]
  if (!value || !String(value).trim()) {
    throw new Error(`Missing env: ${name}`)
  }
  return String(value).trim()
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
  const token = requireEnv('TELEGRAM_BOT_TOKEN')
  const db = createDb()
  const bot = new Bot(token)

  registerHandlers(bot, db)
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
