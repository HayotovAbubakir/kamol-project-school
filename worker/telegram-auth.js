const encoder = new TextEncoder()

export function constantTimeEqual(left, right) {
  const first = String(left || '')
  const second = String(right || '')
  let difference = first.length ^ second.length
  for (let index = 0; index < Math.max(first.length, second.length); index += 1) {
    difference |= (first.charCodeAt(index) || 0) ^ (second.charCodeAt(index) || 0)
  }
  return difference === 0
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export async function hashInviteCode(code) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(String(code || ''))))
}

export async function verifyTelegramInitData(initData, botToken, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof initData !== 'string' || !initData || initData.length > 16_384 || !botToken) return null

  const params = new URLSearchParams(initData)
  const suppliedHash = params.get('hash') || ''
  const authDate = Number(params.get('auth_date'))
  const userValue = params.get('user')
  if (!/^[a-f0-9]{64}$/i.test(suppliedHash) || !Number.isInteger(authDate) || authDate <= 0 || !userValue) return null
  if (authDate > nowSeconds + 60 || nowSeconds - authDate > 3600) return null

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secretKey = await crypto.subtle.sign(
    'HMAC',
    await crypto.subtle.importKey('raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    encoder.encode(botToken),
  )
  const signingKey = await crypto.subtle.importKey('raw', secretKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expectedHash = hex(await crypto.subtle.sign('HMAC', signingKey, encoder.encode(dataCheckString)))
  if (!constantTimeEqual(expectedHash, suppliedHash.toLowerCase())) return null

  try {
    const user = JSON.parse(userValue)
    if (!Number.isSafeInteger(user.id) || user.id <= 0) return null
    return { user, authDate }
  } catch {
    return null
  }
}
