import { adminTranslations } from './adminTranslations'
import { commonTranslations } from './commonTranslations'
import { domainTranslations } from './domainTranslations'
import { faceTranslations } from './faceTranslations'
import { ownerTranslations } from './ownerTranslations'
import { phraseTranslations } from './phraseTranslations'
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
  phraseTranslations,
  commonTranslations,
  sharedTranslations,
  adminTranslations,
  ownerTranslations,
  teacherTranslations,
  domainTranslations,
  faceTranslations,
)
