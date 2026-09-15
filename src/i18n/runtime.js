import { translations } from './translations'

export const LANGUAGE_LOCALES = {
  uz: 'uz-UZ',
  ru: 'ru-RU',
  en: 'en-US',
}

let activeLanguage = 'uz'

export function setRuntimeLanguage(language) {
  activeLanguage = translations[language] ? language : 'uz'
}

export function getRuntimeLanguage() {
  return activeLanguage
}

export function getRuntimeLocale() {
  return LANGUAGE_LOCALES[activeLanguage] || LANGUAGE_LOCALES.uz
}

export function translate(key, params = {}, language = activeLanguage) {
  const dictionary = translations[language] || translations.uz
  const template = dictionary[key] || translations.uz[key] || key

  return String(template).replace(/\{\{(\w+)\}\}/g, (_, name) => {
    return params[name] == null ? '' : String(params[name])
  })
}
