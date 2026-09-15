import { useRef, useState } from 'react'
import { ImagePlus, Languages, Moon, Sun } from 'lucide-react'
import { PageEnter } from '../../components/motion/PageMotion'
import { useLanguage } from '../../context/LanguageContext'
import { useTheme } from '../../context/ThemeContext'
import { useWallpaper } from '../../context/WallpaperContext'
import { LIVE_WALLPAPERS } from '../../lib/liveWallpapers'
import GlassPane from '../../components/GlassPane'

export default function AppearanceSettings() {
  const inputRef = useRef(null)
  const { language, setLanguage, t } = useLanguage()
  const { theme, setTheme } = useTheme()
  const {
    url,
    kind,
    name,
    busy,
    activePreset,
    customActive,
    setPreset,
    activateCustom,
    setWallpaper,
    clearWallpaper,
  } = useWallpaper()
  const [error, setError] = useState('')

  const onPick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    try {
      await setWallpaper(file)
    } catch (err) {
      setError(err?.message || t('appearance.uploadFailed'))
    }
  }

  return (
    <PageEnter>
      <GlassPane className="card wallpaper-card" radius={22}>
        <section className="appearance-section">
          <h2 className="appearance-title appearance-title-with-icon">
            <Languages size={18} />
            {t('language.title')}
          </h2>
          <div className="language-options" role="group" aria-label={t('language.title')}>
            {(['uz', 'ru', 'en']).map((item) => (
              <button
                key={item}
                type="button"
                className={`theme-option${language === item ? ' active' : ''}`}
                onClick={() => setLanguage(item)}
                aria-pressed={language === item}
              >
                {t(`language.${item}`)}
              </button>
            ))}
          </div>
        </section>

        <section className="appearance-section appearance-divider-section">
          <h2 className="appearance-title">{t('appearance.colorMode')}</h2>
          <div className="theme-options" role="group" aria-label={t('appearance.colorMode')}>
            <button
              type="button"
              className={`theme-option${theme === 'light' ? ' active' : ''}`}
              onClick={() => setTheme('light')}
              aria-pressed={theme === 'light'}
            >
              <Sun size={18} />
              {t('appearance.light')}
            </button>
            <button
              type="button"
              className={`theme-option${theme === 'dark' ? ' active' : ''}`}
              onClick={() => setTheme('dark')}
              aria-pressed={theme === 'dark'}
            >
              <Moon size={18} />
              {t('appearance.dark')}
            </button>
          </div>
        </section>

        <section className="appearance-section appearance-wallpaper-section">
          <h2 className="appearance-title">{t('appearance.liveWallpapers')}</h2>

          <div className="wallpaper-preset-grid">
            {LIVE_WALLPAPERS[theme].map((item) => (
              <button
                key={item.id}
                type="button"
                className={`wallpaper-preset${(!url || !customActive) && activePreset === item.id ? ' active' : ''}`}
                onClick={() => setPreset(item.id)}
                aria-pressed={activePreset === item.id}
              >
                <span className={`wallpaper-preset-art live-preview-${item.id}`} />
                <span>{item.name}</span>
              </button>
            ))}
          </div>

          <div className="wallpaper-custom-head">
            <h3>{t('appearance.customWallpaper')}</h3>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="image/*,video/*"
            hidden
            onChange={onPick}
          />

          {error ? <p className="wallpaper-error">{error}</p> : null}

          {url ? (
            <div className="wallpaper-preview">
              {kind === 'video' ? (
                <video
                  src={url}
                  muted
                  loop
                  playsInline
                  autoPlay
                  preload="metadata"
                  disablePictureInPicture
                />
              ) : (
                <img src={url} alt="" />
              )}
            </div>
          ) : (
            <div className={`wallpaper-preview wallpaper-preview-empty live-preview-${activePreset}`} />
          )}

          {name ? <p className="wallpaper-name">{name}</p> : null}

          <div className="wallpaper-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlus size={16} />
              {busy ? t('common.loading') : t('appearance.imageOrVideo')}
            </button>
            {url ? (
              <>
                {!customActive ? (
                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={busy}
                    onClick={activateCustom}
                  >
                    {t('appearance.use')}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={busy}
                  onClick={() => clearWallpaper()}
                >
                  {t('appearance.remove')}
                </button>
              </>
            ) : null}
          </div>
        </section>
      </GlassPane>
    </PageEnter>
  )
}
