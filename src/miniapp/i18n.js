// Mini App tili. Kalit — o‘zbekcha asl matn; tarjima topilmasa o‘zbekchasi ko‘rinadi.
import { MINI_TRANSLATIONS } from './translations.js'

export const MINI_LANGUAGES = [
  { id: 'uz', label: 'O‘zbekcha' },
  { id: 'ru', label: 'Русский' },
  { id: 'en', label: 'English' },
]

const STORAGE_KEY = 'kamol-mini-lang'
const LOCALES = { uz: 'uz-UZ', ru: 'ru-RU', en: 'en-GB' }

function detectLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (MINI_LANGUAGES.some((item) => item.id === saved)) return saved
  } catch {
    /* localStorage yopiq bo‘lishi mumkin */
  }
  const code = String(window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code || '').toLowerCase()
  if (code.startsWith('ru')) return 'ru'
  if (code.startsWith('en')) return 'en'
  return 'uz'
}

let current = typeof window === 'undefined' ? 'uz' : detectLanguage()

export function getMiniLanguage() {
  return current
}

export function setMiniLanguage(lang) {
  if (!MINI_LANGUAGES.some((item) => item.id === lang)) return
  current = lang
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    /* saqlab bo‘lmasa ham joriy sessiyada ishlaydi */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang
}

export function miniLocale() {
  return LOCALES[current] || LOCALES.uz
}

/** `t('{count} ta vazifa', { count: 3 })` */
export function t(text, vars) {
  const source = String(text ?? '')
  const translated = current === 'uz' ? source : MINI_TRANSLATIONS[current]?.[source] || source
  if (!vars) return translated
  return translated.replace(/\{(\w+)\}/g, (match, key) => (vars[key] === undefined ? match : String(vars[key])))
}
