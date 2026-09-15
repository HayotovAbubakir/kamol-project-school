import { useTheme } from '../context/ThemeContext'

/** Rasmiy logo — KAMOL PROJECT SCHOOL (shaffof PNG) */
export default function BrandLogo({ className = '' }) {
  const { isDark } = useTheme()
  return (
    <img
      src={isDark ? '/logo-dark.png?v=5' : '/logo.png?v=5'}
      alt="KAMOL PROJECT SCHOOL"
      className={`brand-logo${className ? ` ${className}` : ''}`}
      draggable={false}
    />
  )
}
