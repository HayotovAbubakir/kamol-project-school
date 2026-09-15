import { spawn } from 'node:child_process'

const children = []

function run(script) {
  const child = spawn('npm', ['run', script], {
    stdio: 'inherit',
    shell: true,
    cwd: process.cwd(),
  })
  children.push(child)
  child.on('exit', (code, signal) => {
    if (signal) return
    console.log(`[${script}] exited with code ${code ?? 0}`)
  })
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill()
  }
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

console.log('Web (vite) + Telegram bot ishga tushmoqda...')
run('dev')
run('bot')
