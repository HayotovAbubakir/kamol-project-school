import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { translations } from '../i18n/translations'
import {
  getRuntimeLocale,
  setRuntimeLanguage,
  translate,
} from '../i18n/runtime'

const STORAGE_KEY = 'kamol-language'
const LanguageContext = createContext(null)

function getInitialLanguage() {
  if (typeof window === 'undefined') return 'uz'
  const saved = localStorage.getItem(STORAGE_KEY)
  if (translations[saved]) return saved
  return 'uz'
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(getInitialLanguage)

  useEffect(() => {
    setRuntimeLanguage(language)
    localStorage.setItem(STORAGE_KEY, language)
    document.documentElement.lang = language
  }, [language])

  const value = useMemo(
    () => ({
      language,
      locale: getRuntimeLocale(),
      setLanguage: (next) => {
        if (!translations[next]) return
        setLanguageState(next)
      },
      t: (key, params) => translate(key, params, language),
    }),
    [language],
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) throw new Error(translate('domain.error.languageProviderRequired'))
  return context
}
