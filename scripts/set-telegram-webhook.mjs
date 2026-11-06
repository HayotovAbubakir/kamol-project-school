import { BOT_COMMANDS } from '../bot/keyboard.mjs'

function required(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`Missing ${name}.`)
  return value
}

const token = required('TELEGRAM_BOT_TOKEN')
const baseUrl = required('CLOUDFLARE_API_URL').replace(/\/+$/, '')
const secret = required('TELEGRAM_WEBHOOK_SECRET')

if (!baseUrl.startsWith('https://')) {
  throw new Error('CLOUDFLARE_API_URL must be HTTPS.')
}
if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
  throw new Error('TELEGRAM_WEBHOOK_SECRET must be 1-256 characters using letters, numbers, underscores, or hyphens.')
}

async function telegram(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const result = await response.json()
  if (!response.ok || !result.ok) {
    throw new Error(`Telegram ${method} failed (HTTP ${response.status}).`)
  }
}

await telegram('setWebhook', {
  url: `${baseUrl}/api/telegram/webhook`,
  secret_token: secret,
  allowed_updates: ['message'],
  drop_pending_updates: false,
})
await telegram('setMyCommands', { commands: BOT_COMMANDS })
await telegram('setChatMenuButton', {
  menu_button: {
    type: 'web_app',
    text: 'Ilovani ochish',
    web_app: { url: process.env.TELEGRAM_WEBAPP_URL || `${baseUrl}/miniapp.html` },
  },
})

console.log('Telegram webhook, commands, and Mini App menu configured.')
