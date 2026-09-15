import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/utils'
import { useLanguage } from '../context/LanguageContext'
import GlassPane from './GlassPane'

export function PageHeader({ title, badge, subtitle, actions }) {
  const hasLeft = badge || title || subtitle
  if (!hasLeft && !actions) return null
  return (
    <div className={`page-header${badge ? ' page-header-with-badge' : ''}`}>
      {hasLeft && (
        <div className="page-header-main">
          {badge && <span className="page-badge">{badge}</span>}
          {title && <h2 className="page-header-h2">{title}</h2>}
          {subtitle && <p className="page-header-subtitle">{subtitle}</p>}
        </div>
      )}
      {actions && <div className="page-header-actions">{actions}</div>}
    </div>
  )
}

const TONE_MAP = {
  default: { bg: 'var(--accent-soft)', color: 'var(--accent)' },
  success: { bg: 'var(--accent-soft)', color: 'var(--success)' },
  warning: { bg: 'rgba(184,134,11,0.12)', color: 'var(--warning)' },
  danger: { bg: 'rgba(192,57,43,0.12)', color: 'var(--danger)' },
  info: { bg: 'rgba(37,99,235,0.1)', color: 'var(--info)' },
}

/** Qiymat matni — dark mode'da yashil emas, oq/asosiy text */
function valueColor(tone, featured) {
  if (featured) return undefined
  if (tone === 'danger') return 'var(--danger)'
  if (tone === 'warning') return 'var(--warning)'
  return 'var(--text)'
}

function AnimatedValue({ value }) {
  const { locale, t } = useLanguage()
  const isMoney = typeof value === 'string' && /so['‘’]?m|сум|UZS/i.test(value)
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(/[^\d-]/g, ''))
  if (!Number.isFinite(numeric)) return value
  return isMoney
    ? `${new Intl.NumberFormat(locale).format(numeric)} ${t('shared.currency')}`
    : new Intl.NumberFormat(locale).format(numeric)
}

function isZeroValue(value) {
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(/[^\d-]/g, ''))
  return Number.isFinite(numeric) && numeric === 0
}

function MiniSparkline({ points = [] }) {
  if (!points.length || points.length < 2) return null
  const max = Math.max(...points, 1)
  const min = Math.min(...points, 0)
  const range = max - min || 1
  const w = 88
  const h = 28
  const poly = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w
      const y = h - ((p - min) / range) * (h - 6) - 3
      return `${x},${y}`
    })
    .join(' ')
  return (
    <svg className="stat-sparkline" viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline points={poly} fill="none" stroke="var(--chart-neon)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function MagneticCard({ children, className = '', onClick }) {
  return (
    <GlassPane
      className={cn('magnetic-card', className)}
      radius={22}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </GlassPane>
  )
}

export function Card({ children, className = '', style, ...props }) {
  return (
    <GlassPane className={cn('card', className)} style={style} {...props}>
      {children}
    </GlassPane>
  )
}

export function StatCard({
  label,
  value,
  tone = 'default',
  icon: Icon,
  featured = false,
  delta = null,
  sparkline,
  className = '',
  onClick,
}) {
  const colors = TONE_MAP[tone] || TONE_MAP.default
  const zero = isZeroValue(value)

  return (
    <MagneticCard
      className={cn(
        'stat-card',
        'stat-card-premium',
        featured && 'stat-card-featured',
        zero && 'stat-card-zero',
        onClick && 'stat-card-clickable',
        className,
      )}
      onClick={onClick}
    >
      <div className="stat-card-glow" aria-hidden />
      <div className="stat-card-top">
        {Icon && (
          <div className="stat-icon" style={{ background: colors.bg, color: colors.color }}>
            <Icon size={18} strokeWidth={2.2} />
          </div>
        )}
        {delta != null && (
          <span className={`stat-delta ${delta >= 0 ? 'up' : 'down'}`}>
            {delta > 0 ? '+' : ''}{delta}%
          </span>
        )}
      </div>
      <div className="stat-card-value" style={{ color: valueColor(tone, featured) }}>
        <AnimatedValue value={value} />
      </div>
      <div className="stat-card-label">{label}</div>
      {(sparkline?.length > 1) && (
        <div className="stat-card-row">
          <MiniSparkline points={sparkline} />
        </div>
      )}
    </MagneticCard>
  )
}

export function Avatar({ name, size = 'md' }) {
  const initials = String(name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase() || '?'
  const cls = size === 'sm' ? 'avatar-sm' : 'avatar-ring'
  return <div className={cls}><span>{initials}</span></div>
}

export function StatusBadge({ children, tone = 'neutral' }) {
  return (
    <span className={`status-pill status-pill-${tone}`}>
      <span className="status-dot" />
      {children}
    </span>
  )
}

export function ListSearch({ value, onChange, placeholder, 'aria-label': ariaLabel }) {
  const { t } = useLanguage()
  const label = ariaLabel || placeholder || t('common.search')

  return (
    <div className="list-search">
      <Search className="list-search-icon" size={16} aria-hidden />
      <input
        type="search"
        className="list-search-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || t('common.search')}
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
      />
      {value ? (
        <button
          type="button"
          className="list-search-clear"
          onClick={() => onChange('')}
          aria-label={t('common.clearSearch')}
          title={t('common.clearSearch')}
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  )
}

export function MasterDetail({ list, detail }) {
  const shellRef = useRef(null)
  const panelRef = useRef(null)

  useEffect(() => {
    const shell = shellRef.current
    const panel = panelRef.current
    if (!shell || !panel) return undefined

    const syncHeight = () => {
      if (window.matchMedia('(max-width: 900px)').matches) {
        shell.style.height = ''
        return
      }
      const h = Math.ceil(panel.getBoundingClientRect().height)
      if (h > 0) shell.style.height = `${h}px`
    }

    syncHeight()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncHeight) : null
    ro?.observe(panel)
    window.addEventListener('resize', syncHeight)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', syncHeight)
    }
  }, [list, detail])

  return (
    <div className="master-detail">
      <div className="master-list-shell" ref={shellRef}>
        <div className="master-list">{list}</div>
      </div>
      <div className="master-detail-panel" ref={panelRef}>{detail}</div>
    </div>
  )
}

export function MasterListItem({ active, avatar, title, subtitle, badge, tone, onClick }) {
  return (
    <button
      type="button"
      className={`master-list-item${active ? ' active' : ''}${tone ? ` master-list-item-${tone}` : ''}`}
      onClick={onClick}
    >
      {avatar}
      <div className="master-list-copy">
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
      </div>
      {badge}
    </button>
  )
}

export function PersonCard({
  name,
  subtitle,
  meta = [],
  badge,
  badgeTone = 'neutral',
  actions,
}) {
  return (
    <MagneticCard className="person-card">
      <div className="person-top">
        <Avatar name={name} />
        <div className="person-copy">
          <h3>{name}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {badge && <Badge tone={badgeTone}>{badge}</Badge>}
      </div>
      {meta.length > 0 && (
        <div className="person-meta">
          {meta.map((item) => (
            <div key={item.label} className="meta-chip">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      )}
      {actions && <div className="person-actions">{actions}</div>}
    </MagneticCard>
  )
}

export function EmptyState({ title, description, action }) {
  if (!title && !description && !action) return null
  return (
    <div className={`empty-hero${title || description ? '' : ' empty-hero-quiet'}`}>
      {title ? <h3>{title}</h3> : null}
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  )
}

export function Modal({ open, title, children, onClose, actions, size = 'sm' }) {
  const bodyRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open || !bodyRef.current) return
    bodyRef.current.scrollTop = 0
  }, [open])

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose?.()
          }}
        >
          <motion.div
            className={`modal-panel${size === 'lg' ? ' modal-panel-lg' : ''}`}
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.18 }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {title && <h2 className="modal-title">{title}</h2>}
            <div className="modal-body" ref={bodyRef}>{children}</div>
            {actions && <div className="modal-actions">{actions}</div>}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}

export function Badge({ children, tone = 'neutral' }) {
  return <StatusBadge tone={tone}>{children}</StatusBadge>
}

const buttonVariants = cva('btn glow-btn', {
  variants: {
    variant: {
      primary: 'btn-primary',
      outline: 'btn-outline',
      danger: 'btn-danger',
      ghost: '',
    },
    size: {
      default: '',
      sm: 'btn-sm',
      lg: 'btn-lg',
    },
  },
  defaultVariants: {
    size: 'default',
  },
})

export function GlowButton({
  children,
  className = '',
  variant,
  size,
  asChild = false,
  ...props
}) {
  const Comp = asChild ? Slot : motion.button
  return (
    <Comp
      type={asChild ? undefined : 'button'}
      className={cn(buttonVariants({ variant, size }), className)}
      {...(!asChild ? { whileHover: { scale: 1.02 }, whileTap: { scale: 0.98 } } : {})}
      {...props}
    >
      {!asChild && <span className="glow-btn-shine" />}
      {children}
    </Comp>
  )
}
