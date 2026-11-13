import { useMemo } from 'react'
import { useLanguage } from '../../context/LanguageContext'
import { buildFaceLabels } from './faceLabels.js'

export function useSiteFaceLabels() {
  const { t } = useLanguage()
  return useMemo(() => buildFaceLabels(t, 'key'), [t])
}
