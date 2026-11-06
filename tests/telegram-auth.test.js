import { describe, expect, it } from 'vitest'
import { hashInviteCode, verifyTelegramInitData } from '../worker/telegram-auth.js'

const botToken = '123456:telegram-test-token'
const user = { id: 12345, first_name: 'Ali', username: 'ali' }

async function signedInitData(authDate) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: 'AAEAA',
    user: JSON.stringify(user),
  })
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secret = await crypto.subtle.sign(
    'HMAC',
    await crypto.subtle.importKey('raw', new TextEncoder().encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    new TextEncoder().encode(botToken),
  )
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(dataCheckString))
  const hash = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  params.set('hash', hash)
  return params.toString()
}

describe('Telegram Mini App authentication data', () => {
  it('accepts a valid signature and returns the Telegram user', async () => {
    const now = 1_800_000_000
    const result = await verifyTelegramInitData(await signedInitData(now), botToken, now)
    expect(result).toEqual({ user, authDate: now })
  })

  it('rejects tampered, expired, and future initData', async () => {
    const now = 1_800_000_000
    const valid = await signedInitData(now)
    expect(await verifyTelegramInitData(`${valid}&user=%7B%7D`, botToken, now)).toBeNull()
    expect(await verifyTelegramInitData(await signedInitData(now - 3601), botToken, now)).toBeNull()
    expect(await verifyTelegramInitData(await signedInitData(now + 61), botToken, now)).toBeNull()
  })

  it('stores invite codes as one-way hashes', async () => {
    const code = 'a'.repeat(48)
    const hash = await hashInviteCode(code)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hash).not.toContain(code)
  })
})
