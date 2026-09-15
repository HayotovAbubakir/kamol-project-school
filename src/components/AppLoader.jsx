import BrandLogo from './BrandLogo'
import LiveBackground from './atmosphere/LiveBackground'
import GlassPane from './GlassPane'
import { useLanguage } from '../context/LanguageContext'

export default function AppLoader({ label }) {
  const { t } = useLanguage()
  const resolvedLabel = label || t('common.loading')

  return (
    <div className="app-loader" role="status" aria-live="polite">
      <LiveBackground />
      <GlassPane
        className="app-loader-card"
        radius={22}
        style={{ width: 'min(92vw, 260px)', minHeight: 240 }}
      >
        <div className="app-loader-logo-slot">
          <BrandLogo className="app-loader-logo" />
        </div>
        <div className="app-loader-spinner" aria-hidden />
        <p className="app-loader-label">{resolvedLabel}</p>
      </GlassPane>
    </div>
  )
}
