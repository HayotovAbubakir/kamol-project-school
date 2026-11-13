#!/usr/bin/env node
/**
 * Kamol School ↔ Hikvision Face ID (DS-K1T) ko‘prigi.
 *
 * Maktabdagi kompyuterda (terminal bilan bir LAN tarmog‘ida) ishlaydi, chunki Cloudflare Worker
 * LAN dagi qurilmaga ulana olmaydi. Vazifalari:
 *   1) Worker'dan navbatdagi o‘quvchi rasmlarini oladi va ISAPI orqali terminalga yozadi;
 *   2) terminaldagi yuz tasdiqlash hodisalarini (major 5, minor 75) o‘qib, Worker'ga uzatadi.
 *
 * Sozlash (env yoki JSON fayl: `node scripts/hikvision-bridge.mjs --config bridge.json`):
 *   HIK_HOST=192.168.1.64  HIK_USER=admin  HIK_PASSWORD=...  [HIK_PROTOCOL=http]
 *   WORKER_URL=https://kamol.example.com  DEVICE_TOKEN=kfd_...
 *   [POLL_SECONDS=10] [STATE_FILE=.hikvision-bridge-state.json] [FD_LIB_ID=1] [HIK_TZ_OFFSET=+05:00]
 * Buyruqlar: `--check` (ulanishni tekshirish), `--once` (bitta sikl).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const CONFIG_KEYS = {
  host: 'HIK_HOST',
  user: 'HIK_USER',
  password: 'HIK_PASSWORD',
  protocol: 'HIK_PROTOCOL',
  workerUrl: 'WORKER_URL',
  deviceToken: 'DEVICE_TOKEN',
  pollSeconds: 'POLL_SECONDS',
  stateFile: 'STATE_FILE',
  fdLibId: 'FD_LIB_ID',
  tzOffset: 'HIK_TZ_OFFSET',
}

export function loadConfig(env = process.env, fileConfig = {}) {
  const config = {}
  for (const [key, envName] of Object.entries(CONFIG_KEYS)) config[key] = fileConfig[key] ?? env[envName]
  config.protocol ||= 'http'
  config.pollSeconds = Math.max(3, Number(config.pollSeconds) || 10)
  config.stateFile ||= '.hikvision-bridge-state.json'
  config.fdLibId = String(config.fdLibId || '1')
  config.tzOffset ||= '+05:00'
  config.workerUrl = String(config.workerUrl || '').replace(/\/+$/, '')
  const missing = ['host', 'user', 'password', 'workerUrl', 'deviceToken'].filter((key) => !config[key])
  if (missing.length) throw new Error(`Sozlama yetishmaydi: ${missing.map((key) => CONFIG_KEYS[key]).join(', ')}`)
  return config
}

export function parseDigestChallenge(header) {
  const value = String(header || '')
  if (!/^Digest\s/i.test(value)) return null
  const params = {}
  for (const match of value.slice(7).matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)) params[match[1].toLowerCase()] = match[2] ?? match[3]
  return params
}

function hashHex(algorithm, value) {
  return createHash(/sha-?256/i.test(algorithm || '') ? 'sha256' : 'md5').update(value).digest('hex')
}

export function digestAuthorization({ challenge, user, password, method, uri, nc = 1, cnonce = randomBytes(8).toString('hex') }) {
  const algorithm = challenge.algorithm || 'MD5'
  const ha1 = hashHex(algorithm, `${user}:${challenge.realm}:${password}`)
  const ha2 = hashHex(algorithm, `${method}:${uri}`)
  const qop = (challenge.qop || '').split(',').map((item) => item.trim()).includes('auth') ? 'auth' : ''
  const count = nc.toString(16).padStart(8, '0')
  const response = qop
    ? hashHex(algorithm, `${ha1}:${challenge.nonce}:${count}:${cnonce}:${qop}:${ha2}`)
    : hashHex(algorithm, `${ha1}:${challenge.nonce}:${ha2}`)
  const parts = [
    `username="${user}"`, `realm="${challenge.realm}"`, `nonce="${challenge.nonce}"`, `uri="${uri}"`,
    `algorithm=${algorithm}`, `response="${response}"`,
  ]
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`)
  if (qop) parts.push(`qop=${qop}`, `nc=${count}`, `cnonce="${cnonce}"`)
  return `Digest ${parts.join(', ')}`
}

export function buildMultipart(parts, boundary = `----kamol${randomBytes(8).toString('hex')}`) {
  const chunks = []
  for (const part of parts) {
    const disposition = `form-data; name="${part.name}"${part.filename ? `; filename="${part.filename}"` : ''}`
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: ${disposition}\r\nContent-Type: ${part.contentType}\r\n`
      + `Content-Length: ${Buffer.byteLength(part.body)}\r\n\r\n`))
    chunks.push(Buffer.isBuffer(part.body) ? part.body : Buffer.from(part.body))
    chunks.push(Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}

/** Qurilma vaqt formati: 2026-11-13T14:05:00+05:00 (maktab vaqt zonasi). */
export function formatDeviceTime(date, tzOffset = '+05:00') {
  const sign = tzOffset.startsWith('-') ? -1 : 1
  const [hours, minutes] = tzOffset.replace(/^[+-]/, '').split(':').map(Number)
  const shifted = new Date(date.getTime() + sign * ((hours || 0) * 60 + (minutes || 0)) * 60000)
  return `${shifted.toISOString().slice(0, 19)}${tzOffset}`
}

function eventKey(event) {
  return `${new Date(event.time).getTime()}:${String(Number(event.serialNo) || 0).padStart(12, '0')}`
}

/** Kursordan keyingi yangi hodisalar (vaqt, serialNo bo‘yicha tartiblangan). */
export function newEventsSince(events, cursor) {
  const last = cursor?.lastKey || ''
  return events
    .filter((event) => event && event.time && !Number.isNaN(new Date(event.time).getTime()))
    .map((event) => ({ event, key: eventKey(event) }))
    .filter(({ key }) => key > last)
    .sort((left, right) => left.key.localeCompare(right.key))
}

export function isIsapiOk(status, payload) {
  if (payload && typeof payload === 'object' && 'statusCode' in payload) return Number(payload.statusCode) === 1
  return status >= 200 && status < 300
}

export class HikvisionClient {
  constructor({ host, user, password, protocol = 'http' }, fetchImpl = fetch) {
    this.base = `${protocol}://${host}`
    this.user = user
    this.password = password
    this.fetch = fetchImpl
    this.challenge = null
    this.nc = 0
  }

  async request(method, uri, { body, contentType } = {}) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const headers = {}
      if (contentType) headers['Content-Type'] = contentType
      if (this.challenge) {
        this.nc += 1
        headers.Authorization = digestAuthorization({ challenge: this.challenge, user: this.user, password: this.password, method, uri, nc: this.nc })
      }
      const response = await this.fetch(`${this.base}${uri}`, { method, headers, body })
      if (response.status === 401) {
        const challenge = parseDigestChallenge(response.headers.get('www-authenticate'))
        if (!challenge || attempt === 1) throw new Error(`Qurilma login/parolni qabul qilmadi (${uri}).`)
        this.challenge = challenge
        this.nc = 0
        continue
      }
      const text = await response.text()
      let payload = null
      try { payload = text ? JSON.parse(text) : null } catch { payload = text }
      return { status: response.status, payload }
    }
    throw new Error(`ISAPI so‘rovi bajarilmadi: ${uri}`)
  }

  async json(method, uri, data) {
    return this.request(method, uri, { body: JSON.stringify(data), contentType: 'application/json' })
  }

  async deviceInfo() {
    const { status, payload } = await this.request('GET', '/ISAPI/System/deviceInfo')
    if (status !== 200) throw new Error(`deviceInfo javobi: HTTP ${status}`)
    const text = String(payload)
    const pick = (tag) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(text)?.[1] || ''
    return { model: pick('model'), serial: pick('serialNumber'), firmware: pick('firmwareVersion'), name: pick('deviceName') }
  }

  async upsertUser({ employeeNo, name }) {
    const UserInfo = {
      employeeNo,
      name: String(name || employeeNo).slice(0, 32),
      userType: 'normal',
      Valid: { enable: true, beginTime: '2020-01-01T00:00:00', endTime: '2037-12-31T23:59:59', timeType: 'local' },
      doorRight: '1',
      RightPlan: [{ doorNo: 1, planTemplateNo: '1' }],
    }
    const setUp = await this.json('PUT', '/ISAPI/AccessControl/UserInfo/SetUp?format=json', { UserInfo })
    if (isIsapiOk(setUp.status, setUp.payload)) return
    const record = await this.json('POST', '/ISAPI/AccessControl/UserInfo/Record?format=json', { UserInfo })
    if (isIsapiOk(record.status, record.payload)) return
    const modify = await this.json('PUT', '/ISAPI/AccessControl/UserInfo/Modify?format=json', { UserInfo })
    if (isIsapiOk(modify.status, modify.payload)) return
    throw new Error(`Foydalanuvchini yozib bo‘lmadi: ${describeIsapi(modify.payload ?? record.payload)}`)
  }

  async upsertFace({ employeeNo, image, fdLibId = '1' }) {
    const meta = JSON.stringify({ faceLibType: 'blackFD', FDID: fdLibId, FPID: employeeNo })
    const multipart = () => buildMultipart([
      { name: 'FaceDataRecord', contentType: 'application/json', body: meta },
      { name: 'img', filename: 'facePic.jpg', contentType: 'image/jpeg', body: image },
    ])
    // FDSetUp yaratadi yoki almashtiradi; eski proshivkalarda faqat FaceDataRecord bor.
    const setUp = multipart()
    const first = await this.request('PUT', '/ISAPI/Intelligent/FDLib/FDSetUp?format=json', setUp)
    if (isIsapiOk(first.status, first.payload)) return
    const record = multipart()
    const second = await this.request('POST', '/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json', record)
    if (isIsapiOk(second.status, second.payload)) return
    throw new Error(`Yuz rasmini yozib bo‘lmadi: ${describeIsapi(second.payload ?? first.payload)}`)
  }

  async deleteUser(employeeNo) {
    const result = await this.json('PUT', '/ISAPI/AccessControl/UserInfo/Delete?format=json', {
      UserInfoDelCond: { EmployeeNoList: [{ employeeNo }] },
    })
    if (!isIsapiOk(result.status, result.payload) && !/notExist|noUser/i.test(describeIsapi(result.payload))) {
      throw new Error(`Foydalanuvchini o‘chirib bo‘lmadi: ${describeIsapi(result.payload)}`)
    }
  }

  async searchFaceEvents({ startTime, endTime, position = 0, maxResults = 30 }) {
    const { status, payload } = await this.json('POST', '/ISAPI/AccessControl/AcsEvent?format=json', {
      AcsEventCond: { searchID: randomUUID(), searchResultPosition: position, maxResults, major: 5, minor: 75, startTime, endTime },
    })
    if (status !== 200 || !payload?.AcsEvent) throw new Error(`AcsEvent javobi: HTTP ${status} ${describeIsapi(payload)}`)
    return payload.AcsEvent
  }
}

function describeIsapi(payload) {
  if (!payload) return 'javob yo‘q'
  if (typeof payload === 'string') return payload.slice(0, 200)
  return [payload.statusString, payload.subStatusCode, payload.errorMsg].filter(Boolean).join(' / ') || JSON.stringify(payload).slice(0, 200)
}

async function workerJson(config, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${config.workerUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.deviceToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Worker ${path}: HTTP ${response.status} ${result.error || ''}`)
  return result.data
}

async function readState(file) {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch { return {} }
}

async function syncPending(config, device) {
  const pending = await workerJson(config, '/api/face/device/pending')
  const results = []
  for (const item of pending.items || []) {
    try {
      if (item.action === 'delete') {
        await device.deleteUser(item.employee_no)
      } else {
        await device.upsertUser({ employeeNo: item.employee_no, name: item.name })
        let lastError = null
        let saved = false
        // Qurilma bitta yuz saqlaydi: avval old tomondan, sifat yetmasa yon rasmlar sinab ko‘riladi.
        for (const photo of item.photos || []) {
          try {
            const response = await fetch(photo.url)
            if (!response.ok) throw new Error(`rasm yuklanmadi (HTTP ${response.status})`)
            await device.upsertFace({ employeeNo: item.employee_no, image: Buffer.from(await response.arrayBuffer()), fdLibId: config.fdLibId })
            saved = true
            break
          } catch (error) {
            lastError = error
          }
        }
        if (!saved) throw lastError || new Error('Rasm topilmadi.')
      }
      results.push({ employee_no: item.employee_no, version: item.version, status: 'synced' })
      console.log(`[sync] ${item.action} ${item.employee_no} ${item.name || ''} — OK`)
    } catch (error) {
      results.push({ employee_no: item.employee_no, version: item.version, status: 'error', error: String(error.message || error).slice(0, 500) })
      console.error(`[sync] ${item.employee_no} — ${error.message || error}`)
    }
  }
  if (results.length) await workerJson(config, '/api/face/device/sync-result', { method: 'POST', body: { results } })
  return results.length
}

async function pollEvents(config, device, state) {
  const now = new Date()
  const cursor = state.events || {}
  // Kursordan 2 daqiqa oldindan so‘raladi: qurilma soati biroz farq qilsa ham hodisa yo‘qolmaydi (Worker dublikatni tashlaydi).
  const from = cursor.lastTime ? new Date(new Date(cursor.lastTime).getTime() - 120000) : new Date(now.getTime() - 12 * 3600000)
  const collected = []
  for (let position = 0, page = 0; page < 20; page += 1) {
    const result = await device.searchFaceEvents({
      startTime: formatDeviceTime(from, config.tzOffset),
      endTime: formatDeviceTime(new Date(now.getTime() + 60000), config.tzOffset),
      position,
    })
    const list = result.InfoList || []
    collected.push(...list)
    position += list.length
    if (result.responseStatusStrg !== 'MORE' || !list.length) break
  }
  const fresh = newEventsSince(collected, cursor)
  for (let index = 0; index < fresh.length; index += 50) {
    const batch = fresh.slice(index, index + 50).map(({ event }) => event)
    const summary = await workerJson(config, '/api/face/device/events', { method: 'POST', body: { AcsEvent: { InfoList: batch } } })
    console.log(`[events] ${batch.length} ta yuborildi: qabul ${summary.accepted}, dublikat ${summary.duplicates}, noma’lum ${summary.unknown}`)
  }
  if (fresh.length) {
    const last = fresh.at(-1)
    state.events = { lastKey: last.key, lastTime: new Date(last.event.time).toISOString() }
    await writeFile(config.stateFile, JSON.stringify(state, null, 2))
  }
  return fresh.length
}

async function main() {
  const args = process.argv.slice(2)
  const configIndex = args.indexOf('--config')
  const configPath = configIndex >= 0 ? args[configIndex + 1] : process.env.BRIDGE_CONFIG
  const fileConfig = configPath ? JSON.parse(await readFile(configPath, 'utf8')) : {}
  const config = loadConfig(process.env, fileConfig)
  const device = new HikvisionClient(config)

  if (args.includes('--check')) {
    console.log('Qurilma:', await device.deviceInfo())
    const pending = await workerJson(config, '/api/face/device/pending')
    console.log(`Worker: ulanish OK, qurilma "${pending.device?.name}", navbatda ${pending.items?.length || 0} ta o‘quvchi.`)
    return
  }

  const state = await readState(config.stateFile)
  const cycle = async () => {
    try { await syncPending(config, device) } catch (error) { console.error('[sync]', error.message || error) }
    try { await pollEvents(config, device, state) } catch (error) { console.error('[events]', error.message || error) }
  }
  if (args.includes('--once')) return cycle()
  console.log(`Bridge ishga tushdi: ${config.host} → ${config.workerUrl} (har ${config.pollSeconds} soniyada).`)
  for (;;) {
    await cycle()
    await new Promise((resolve) => setTimeout(resolve, config.pollSeconds * 1000))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message || error)
    process.exit(1)
  })
}
