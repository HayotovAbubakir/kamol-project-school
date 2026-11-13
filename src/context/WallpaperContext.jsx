import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  clearWallpaperRecord,
  loadWallpaperRecord,
  saveWallpaperFile,
  wallpaperKind,
} from '../lib/wallpaper'
import {
  DEFAULT_LIVE_WALLPAPERS,
  isLiveWallpaper,
} from '../lib/liveWallpapers'
import { useTheme } from './ThemeContext'

const WallpaperContext = createContext(null)
// v2: defaults switched to the neutral "plain" presets; earlier saves held the old tinted defaults.
const PRESET_STORAGE_KEY = 'kamol-live-wallpapers-v2'
const SOURCE_STORAGE_KEY = 'kamol-wallpaper-source'

function getInitialPresets() {
  if (typeof window === 'undefined') return { ...DEFAULT_LIVE_WALLPAPERS }
  try {
    const saved = JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY) || '{}')
    return {
      light: isLiveWallpaper('light', saved.light) ? saved.light : DEFAULT_LIVE_WALLPAPERS.light,
      dark: isLiveWallpaper('dark', saved.dark) ? saved.dark : DEFAULT_LIVE_WALLPAPERS.dark,
    }
  } catch {
    return { ...DEFAULT_LIVE_WALLPAPERS }
  }
}

export function WallpaperProvider({ children }) {
  const { theme } = useTheme()
  const [url, setUrl] = useState(null)
  const [kind, setKind] = useState('none')
  const [name, setName] = useState('')
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [presets, setPresets] = useState(getInitialPresets)
  const [customActive, setCustomActive] = useState(
    () => (typeof window === 'undefined' ? false : localStorage.getItem(SOURCE_STORAGE_KEY) !== 'preset'),
  )

  useEffect(() => {
    let cancelled = false
    let objectUrl = null

    loadWallpaperRecord()
      .then((record) => {
        if (!record?.blob) return
        const next = URL.createObjectURL(record.blob)
        if (cancelled) {
          URL.revokeObjectURL(next)
          return
        }
        objectUrl = next
        setUrl(next)
        setKind(wallpaperKind(record.type))
        setName(record.name || '')
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReady(true)
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [])

  const setWallpaper = useCallback(async (file) => {
    setBusy(true)
    try {
      await saveWallpaperFile(file)
      const next = URL.createObjectURL(file)
      setUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return next
      })
      setKind(wallpaperKind(file.type))
      setName(file.name || '')
      setCustomActive(true)
      localStorage.setItem(SOURCE_STORAGE_KEY, 'custom')
    } finally {
      setBusy(false)
    }
  }, [])

  const clearWallpaper = useCallback(async () => {
    setBusy(true)
    try {
      await clearWallpaperRecord()
      setUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      setKind('none')
      setName('')
      setCustomActive(false)
      localStorage.setItem(SOURCE_STORAGE_KEY, 'preset')
    } finally {
      setBusy(false)
    }
  }, [])

  const setPreset = useCallback((id, targetTheme = theme) => {
    const slot = targetTheme === 'light' ? 'light' : 'dark'
    if (!isLiveWallpaper(slot, id)) return
    setPresets((prev) => {
      const next = { ...prev, [slot]: id }
      localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(next))
      return next
    })
    setCustomActive(false)
    localStorage.setItem(SOURCE_STORAGE_KEY, 'preset')
  }, [theme])

  const activateCustom = useCallback(() => {
    if (!url) return
    setCustomActive(true)
    localStorage.setItem(SOURCE_STORAGE_KEY, 'custom')
  }, [url])

  const activePreset = presets[theme] || DEFAULT_LIVE_WALLPAPERS[theme]

  useEffect(() => {
    const root = document.documentElement
    const mode = customActive && url && kind !== 'none' ? kind : 'preset'
    root.dataset.wallpaper = mode
    return () => {
      delete root.dataset.wallpaper
    }
  }, [customActive, url, kind])

  const value = useMemo(
    () => ({
      url,
      kind,
      name,
      ready,
      busy,
      activePreset,
      customActive,
      presets,
      setPreset,
      activateCustom,
      setWallpaper,
      clearWallpaper,
    }),
    [
      url,
      kind,
      name,
      ready,
      busy,
      activePreset,
      customActive,
      presets,
      setPreset,
      activateCustom,
      setWallpaper,
      clearWallpaper,
    ],
  )

  return <WallpaperContext.Provider value={value}>{children}</WallpaperContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWallpaper() {
  const ctx = useContext(WallpaperContext)
  if (!ctx) throw new Error('useWallpaper must be used within WallpaperProvider')
  return ctx
}
