import { adminTranslations } from './adminTranslations'
import { commonTranslations } from './commonTranslations'
import { domainTranslations } from './domainTranslations'
import { ownerTranslations } from './ownerTranslations'
import { sharedTranslations } from './sharedTranslations'
import { teacherTranslations } from './teacherTranslations'

function mergeDictionaries(...dictionaries) {
  return ['uz', 'ru', 'en'].reduce((result, language) => {
    result[language] = Object.assign(
      {},
      ...dictionaries.map((dictionary) => dictionary[language] || {}),
    )
    return result
  }, {})
}

export const translations = mergeDictionaries(
  commonTranslations,
  sharedTranslations,
  adminTranslations,
  ownerTranslations,
  teacherTranslations,
  domainTranslations,
)
