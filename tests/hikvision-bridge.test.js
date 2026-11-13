import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  HikvisionClient,
  buildMultipart,
  digestAuthorization,
  formatDeviceTime,
  isIsapiOk,
  loadConfig,
  newEventsSince,
  parseDigestChallenge,
} from '../scripts/hikvision-bridge.mjs'

describe('Hikvision bridge helpers', () => {
  it('builds an RFC 2617 digest response', () => {
    const challenge = parseDigestChallenge('Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"')
    expect(challenge.realm).toBe('testrealm@host.com')
    const header = digestAuthorization({
      challenge,
      user: 'Mufasa',
      password: 'Circle Of Life',
      method: 'GET',
      uri: '/dir/index.html',
      nc: 1,
      cnonce: '0a4f113b',
    })
    expect(header).toContain('response="6629fae49393a05397450978507c4ef1"')
    expect(header).toContain('nc=00000001')
    expect(header).toContain('opaque="5ccc069c403ebaf9f0171e9517f40e41"')
  })

  it('retries a request with digest auth after the 401 challenge', async () => {
    const calls = []
    const fakeFetch = async (url, init) => {
      calls.push({ url, init })
      if (!init.headers.Authorization) {
        return new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Digest realm="DS", nonce="abc", qop="auth"' } })
      }
      return new Response(JSON.stringify({ statusCode: 1, statusString: 'OK' }), { status: 200 })
    }
    const client = new HikvisionClient({ host: '192.168.1.64', user: 'admin', password: 'pw' }, fakeFetch)
    await client.upsertUser({ employeeNo: '1001', name: 'Ali Valiyev' })
    expect(calls).toHaveLength(2)
    expect(calls[1].url).toBe('http://192.168.1.64/ISAPI/AccessControl/UserInfo/SetUp?format=json')
    expect(calls[1].init.headers.Authorization).toMatch(/^Digest username="admin"/)
    expect(JSON.parse(calls[1].init.body).UserInfo).toMatchObject({ employeeNo: '1001', name: 'Ali Valiyev' })
  })

  it('falls back from FDSetUp to FaceDataRecord with a multipart image', async () => {
    const calls = []
    const fakeFetch = async (url, init) => {
      calls.push({ url, init })
      if (url.includes('FDSetUp')) return new Response(JSON.stringify({ statusCode: 4, subStatusCode: 'notSupport' }), { status: 400 })
      return new Response(JSON.stringify({ statusCode: 1 }), { status: 200 })
    }
    const client = new HikvisionClient({ host: 'h', user: 'u', password: 'p' }, fakeFetch)
    await client.upsertFace({ employeeNo: '1001', image: Buffer.from([0xff, 0xd8, 0xff]) })
    expect(calls.map((call) => call.init.method)).toEqual(['PUT', 'POST'])
    const body = calls[1].init.body.toString('latin1')
    expect(body).toContain('name="FaceDataRecord"')
    expect(body).toContain('"FPID":"1001"')
    expect(body).toContain('filename="facePic.jpg"')
  })

  it('formats device times, filters events after the cursor, and validates config', () => {
    expect(formatDeviceTime(new Date('2026-11-16T09:12:00Z'))).toBe('2026-11-16T14:12:00+05:00')
    const events = [
      { time: '2026-11-16T14:12:00+05:00', serialNo: 3 },
      { time: '2026-11-16T14:10:00+05:00', serialNo: 2 },
      { time: '2026-11-16T14:12:00+05:00', serialNo: 4 },
    ]
    const all = newEventsSince(events, {})
    expect(all.map(({ event }) => event.serialNo)).toEqual([2, 3, 4])
    expect(newEventsSince(events, { lastKey: all[1].key }).map(({ event }) => event.serialNo)).toEqual([4])
    const { body, contentType } = buildMultipart([{ name: 'a', contentType: 'text/plain', body: 'x' }], 'B')
    expect(contentType).toBe('multipart/form-data; boundary=B')
    expect(body.toString()).toBe('--B\r\nContent-Disposition: form-data; name="a"\r\nContent-Type: text/plain\r\nContent-Length: 1\r\n\r\nx\r\n--B--\r\n')
    expect(isIsapiOk(200, { statusCode: 6 })).toBe(false)
    expect(isIsapiOk(200, '<xml/>')).toBe(true)
    expect(() => loadConfig({})).toThrow(/HIK_HOST/)
    expect(loadConfig({ HIK_HOST: 'h', HIK_USER: 'u', HIK_PASSWORD: 'p', WORKER_URL: 'https://w/', DEVICE_TOKEN: 't' }))
      .toMatchObject({ workerUrl: 'https://w', pollSeconds: 10, fdLibId: '1', tzOffset: '+05:00' })
  })
})
