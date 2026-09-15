/**
 * Windows login paytida PM2 botni qayta tiklaydi (terminal ochiq bo‘lishi shart emas).
 * 1) Scheduled Task (admin bo‘lsa)
 * 2) Aks holda user Startup papkasi (admin shart emas)
 *
 * Ishga tushirish: npm run bot:startup
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const taskName = 'KamolSchoolTelegramBot'
const pm2Bin = join(root, 'node_modules', 'pm2', 'bin', 'pm2')
const nodeExe = process.execPath

if (!existsSync(pm2Bin)) {
  console.error('pm2 topilmadi. Avval: npm install')
  process.exit(1)
}

function runPm2(args) {
  return spawnSync(nodeExe, [pm2Bin, ...args], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  })
}

// Jarayon ro‘yxatini saqlaymiz
runPm2(['start', 'ecosystem.config.cjs'])
runPm2(['save'])

const tr = `"${nodeExe}" "${pm2Bin}" resurrect`
let scheduledOk = false

try {
  execFileSync(
    'schtasks.exe',
    ['/Create', '/F', '/TN', taskName, '/SC', 'ONLOGON', '/RL', 'LIMITED', '/TR', tr],
    { stdio: 'pipe' },
  )
  scheduledOk = true
  console.log(`Scheduled Task yaratildi: ${taskName}`)
} catch {
  console.log('Scheduled Task uchun admin kerak — Startup papkasidan foydalaniladi.')
}

const startupDir = join(
  process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'),
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
  'Startup',
)
mkdirSync(startupDir, { recursive: true })

const cmdPath = join(startupDir, 'KamolSchoolTelegramBot.cmd')
const vbsPath = join(startupDir, 'KamolSchoolTelegramBot.vbs')

const cmd = [
  '@echo off',
  `cd /d "${root}"`,
  `"${nodeExe}" "${pm2Bin}" resurrect`,
  '',
].join('\r\n')

writeFileSync(cmdPath, cmd, 'utf8')

// Konsol oynasisiz ishga tushirish
const vbs = [
  'Set WshShell = CreateObject("WScript.Shell")',
  `WshShell.Run """${cmdPath}""", 0, False`,
  '',
].join('\r\n')
writeFileSync(vbsPath, vbs, 'utf8')

console.log('')
console.log('Tayyor:')
console.log('- Bot PM2 da ishlaydi (terminal yopilsa ham)')
console.log(`- Windows kirganda avtomatik: ${vbsPath}`)
if (scheduledOk) console.log(`- Qo‘shimcha: Task Scheduler (${taskName})`)
console.log('')
console.log('Eslatma: kompyuter o‘chiq bo‘lsa bot ishlamaydi.')
console.log('Holat: npm run bot:status | Log: npm run bot:logs')
