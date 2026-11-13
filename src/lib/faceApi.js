import { authJson } from './cloudflare.js'

const studentPath = (studentId) => `/api/students/${encodeURIComponent(studentId)}/faces`

export const faceApi = {
  async overview() {
    return (await authJson('/api/face/overview')).data
  },
  async details(studentId) {
    return (await authJson(studentPath(studentId))).data
  },
  async upload(studentId, angle, blob) {
    const form = new FormData()
    form.set('angle', angle)
    form.set('file', new File([blob], `${angle}.jpg`, { type: 'image/jpeg' }))
    return (await authJson(studentPath(studentId), { method: 'POST', body: form, fallbackError: 'Rasmni yuklab bo‘lmadi.' })).data
  },
  /** Olingan barcha burchaklarni ketma-ket yuklaydi; oxirgi holatni qaytaradi. */
  async uploadShots(studentId, shots) {
    let details = null
    for (const [angle, shot] of Object.entries(shots || {})) {
      if (shot?.blob) details = await faceApi.upload(studentId, angle, shot.blob)
    }
    return details
  },
  async remove(studentId, photoId) {
    return (await authJson(`${studentPath(studentId)}/${encodeURIComponent(photoId)}`, { method: 'DELETE' })).data
  },
  async resync(studentId) {
    return (await authJson(`${studentPath(studentId)}/sync`, { method: 'POST', body: {} })).data
  },
  async finalize(date) {
    return (await authJson('/api/face/attendance/finalize', { method: 'POST', body: date ? { date } : {} })).data
  },
  devices: {
    async list() {
      return (await authJson('/api/face/devices')).data || []
    },
    async create(device) {
      return (await authJson('/api/face/devices', { method: 'POST', body: device, fallbackError: 'Qurilmani qo‘shib bo‘lmadi.' })).data
    },
    async action(id, action) {
      return (await authJson(`/api/face/devices/${encodeURIComponent(id)}`, { method: 'POST', body: { action } })).data
    },
  },
}

export function isFaceLockedError(error) {
  return /FACE_ID_LOCKED/.test(String(error?.message || error || ''))
}
