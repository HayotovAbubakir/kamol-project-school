/**
 * Noutbukdagi PM2 bot + Windows Startup yozuvlarini olib tashlash.
 * Railway ga o‘tgandan keyin: npm run bot:uninstall-local
 */
import { spawnSync } from 'node:child_process'
import { existsSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pm2Bin = join(root, 'node_modules', 'pm2', 'bin', 'pm2')
const nodeExe = process.execPath

function runPm2(args) {
  if (!existsSync(pm2Bin)) return
  spawnSync(nodeExe, [pm2Bin, ...args], { cwd: root, stdio: 'inherit', shell: false })
}

runPm2(['stop', 'kamol-parent-bot'])
runPm2(['delete', 'kamol-parent-bot'])
runPm2(['save', '--force'])

const startupDir = join(
  process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'),
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
  'Startup',
)

for (const name of ['KamolSchoolTelegramBot.cmd', 'KamolSchoolTelegramBot.vbs']) {
  const p = join(startupDir, name)
  if (existsSync(p)) {
    unlinkSync(p)
    console.log('O‘chirildi:', p)
  }
}

try {
  spawnSync('schtasks.exe', ['/Delete', '/F', '/TN', 'KamolSchoolTelegramBot'], {
    stdio: 'ignore',
  })
} catch {
  /* ignore */
}

console.log('Noutbukdagi bot to‘xtatildi. Endi faqat Railway da ishlashi kerak.')
