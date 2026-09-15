import { translate } from '../i18n/runtime'

const DB_NAME = 'kamol-school'
const STORE = 'wallpaper'
const KEY = 'current'
export const WALLPAPER_MAX_BYTES = 80 * 1024 * 1024

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function wallpaperKind(type = '') {
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('image/')) return 'image'
  return 'none'
}

export async function loadWallpaperRecord() {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(KEY)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
}

export async function saveWallpaperFile(file) {
  if (!file) throw new Error(translate('domain.error.fileNotSelected'))
  if (file.size > WALLPAPER_MAX_BYTES) {
    throw new Error(translate('domain.error.fileTooLarge'))
  }
  const kind = wallpaperKind(file.type)
  if (kind === 'none') throw new Error(translate('domain.error.fileTypeInvalid'))

  const db = await openDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(
      { blob: file, type: file.type, name: file.name },
      KEY,
    )
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
  return { kind, name: file.name }
}

export async function clearWallpaperRecord() {
  const db = await openDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(KEY)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}
