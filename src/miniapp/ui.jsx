import { useId } from 'react'
import { t } from './i18n.js'

// HapticFeedback Bot API 6.1 dan boshlab mavjud; eski Telegram mijozlarida chaqiruv xato/ogohlantirish beradi.
function lightHaptic() {
  const app = window.Telegram?.WebApp
  if (!app?.isVersionAtLeast?.('6.1')) return
  try {
    app.HapticFeedback?.impactOccurred?.('light')
  } catch {
    /* tebranish ixtiyoriy */
  }
}

export function Button({ children, variant = 'primary', className = '', type = 'button', ...props }) {
  const variantClass = variant === 'secondary' ? 'mini-secondary' : variant === 'danger' ? 'mini-danger' : 'mini-action'
  return (
    <button
      {...props}
      type={type}
      className={`${variantClass} flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      onClick={(event) => {
        lightHaptic()
        props.onClick?.(event)
      }}
    >
      {children}
    </button>
  )
}

export function Input({ label, error, id, ...props }) {
  const generatedId = useId()
  const inputId = id || generatedId
  return (
    <label className="mini-field" htmlFor={inputId}>
      <span>{label}</span>
      <input {...props} id={inputId} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? `${inputId}-error` : undefined} />
      {error && <span id={`${inputId}-error`} className="mini-inline-error">{error}</span>}
    </label>
  )
}

export function Select({ label, children, id, error, ...props }) {
  const generatedId = useId()
  const selectId = id || generatedId
  return (
    <label className="mini-field" htmlFor={selectId}>
      <span>{label}</span>
      <select {...props} id={selectId} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? `${selectId}-error` : undefined}>
        {children}
      </select>
      {error && <span id={`${selectId}-error`} className="mini-inline-error">{error}</span>}
    </label>
  )
}

export function Card({ children, className = '', ...props }) {
  return <section {...props} className={`mini-panel rounded-3xl border p-4 ${className}`}>{children}</section>
}

export function ListItem({ children, className = '', ...props }) {
  const Component = props.onClick ? 'button' : 'div'
  return <Component {...props} className={`mini-list-item ${className}`}>{children}</Component>
}

export function BottomSheet({ open, title, onClose, children }) {
  if (!open) return null
  return (
    <div className="mini-sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.() }}>
      <section className="mini-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="mini-sheet-handle" />
        <header className="mini-sheet-header"><h2>{title}</h2><button className="mini-icon-button" type="button" onClick={onClose} aria-label={t('Yopish')}>×</button></header>
        {children}
      </section>
    </div>
  )
}

export function Modal({ open, title, onClose, children }) {
  if (!open) return null
  return (
    <div className="mini-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.() }}>
      <section className="mini-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="mini-sheet-header"><h2>{title}</h2><button className="mini-icon-button" type="button" onClick={onClose} aria-label={t('Yopish')}>×</button></header>
        {children}
      </section>
    </div>
  )
}

export function Tabs({ items, value, onChange, label = t('Bo‘limlar') }) {
  return (
    <div className="mini-tabs" role="tablist" aria-label={label}>
      {items.map((item) => <button key={item.value} type="button" role="tab" aria-selected={value === item.value} onClick={() => onChange(item.value)}>{item.label}</button>)}
    </div>
  )
}

export function Toast({ children, kind = 'success' }) {
  return <p className={`mini-toast mini-toast-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</p>
}

export function Skeleton({ rows = 3 }) {
  return <div className="mini-skeleton-list" aria-label={t('Ma’lumotlar yuklanmoqda')} aria-busy="true">{Array.from({ length: rows }, (_, index) => <span key={index} />)}</div>
}

export function EmptyState({ title, description, action }) {
  return <div className="mini-empty-state"><p className="font-semibold">{title}</p>{description && <p className="mt-1 text-sm text-[var(--mini-muted)]">{description}</p>}{action}</div>
}

export function ErrorState({ title = t('Ma’lumot yuklanmadi'), onRetry }) {
  return <div className="mini-error-state" role="alert"><p>{title}</p>{onRetry && <Button variant="secondary" className="mt-3" onClick={onRetry}>{t('Qayta urinish')}</Button>}</div>
}

export function ConfirmDialog({ open, title, description, onCancel, onConfirm }) {
  if (!open) return null
  return (
    <Modal open title={title} onClose={onCancel}>
      <p className="mt-3 text-sm text-[var(--mini-muted)]">{description}</p>
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onCancel}>{t('Bekor qilish')}</Button><Button variant="danger" onClick={onConfirm}>{t('Tasdiqlash')}</Button></div>
    </Modal>
  )
}

export function SearchBar({ label = t('Qidirish'), ...props }) {
  return <Input label={label} type="search" {...props} />
}

export function Badge({ children, tone = 'default' }) {
  return <span className={`mini-badge mini-badge-${tone}`}>{children}</span>
}

export function Avatar({ name = '', className = '' }) {
  return <span className={`mini-avatar ${className}`} aria-hidden="true">{name.slice(0, 1).toUpperCase() || '?'}</span>
}
