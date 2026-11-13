import { translate } from '../i18n/runtime'

export const DEFAULT_LIVE_WALLPAPERS = {
  light: 'light-plain',
  dark: 'dark-plain',
}

export const LIVE_WALLPAPERS = {
  light: [
    { id: 'light-plain', get name() { return translate('domain.wallpaper.plain') } },
    { id: 'light-dawn', get name() { return translate('domain.wallpaper.lightDawn') } },
    { id: 'light-mint', get name() { return translate('domain.wallpaper.lightMint') } },
    { id: 'light-sky', get name() { return translate('domain.wallpaper.lightSky') } },
  ],
  dark: [
    { id: 'dark-plain', get name() { return translate('domain.wallpaper.plain') } },
    { id: 'dark-aurora', get name() { return translate('domain.wallpaper.darkAurora') } },
    { id: 'dark-nebula', get name() { return translate('domain.wallpaper.darkNebula') } },
    { id: 'dark-ember', get name() { return translate('domain.wallpaper.darkEmber') } },
  ],
}

export function isLiveWallpaper(theme, id) {
  return LIVE_WALLPAPERS[theme]?.some((item) => item.id === id) ?? false
}
