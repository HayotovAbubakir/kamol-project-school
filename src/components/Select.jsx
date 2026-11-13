import { ChevronDown } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/utils'

/**
 * Custom select — native OS popup o‘rniga app dizaynidagi menyu.
 * API: value, onChange({ target: { value } }), options: [{ value, label, disabled? }]
 */
export default function Select({
  value,
  onChange,
  options = [],
  disabled = false,
  className = '',
  placeholder = '',
  required = false,
  id,
  name,
  'aria-label': ariaLabel,
}) {
  const listId = useId()
  const rootRef = useRef(null)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState(null)

  const normalized = useMemo(
    () => options.map((opt) => ({
      value: String(opt.value),
      label: opt.label,
      disabled: Boolean(opt.disabled),
    })),
    [options],
  )

  const stringValue = value == null ? '' : String(value)
  const selected = normalized.find((opt) => opt.value === stringValue)
  const display = selected?.label ?? (placeholder || normalized.find((opt) => opt.value === '')?.label || '')

  const emit = (next) => {
    onChange?.({ target: { value: next, name } })
  }

  const updateMenuPosition = () => {
    const btn = buttonRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const viewportH = window.innerHeight
    const viewportW = document.documentElement.clientWidth
    const spaceBelow = viewportH - rect.bottom
    const openUp = spaceBelow < 220 && rect.top > spaceBelow
    const width = Math.min(Math.max(rect.width, 140), viewportW - 16)
    setMenuStyle({
      position: 'fixed',
      left: Math.max(8, Math.min(rect.left, viewportW - width - 8)),
      width,
      top: openUp ? undefined : rect.bottom + 6,
      bottom: openUp ? viewportH - rect.top + 6 : undefined,
      // Never taller than the room on that side, otherwise the last options sit off-screen.
      maxHeight: Math.max(120, Math.min(280, (openUp ? rect.top : spaceBelow) - 14)),
      zIndex: 1400,
    })
  }

  useEffect(() => {
    if (!open) return undefined

    updateMenuPosition()

    const onDoc = (e) => {
      const t = e.target
      if (rootRef.current?.contains(t)) return
      if (menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onReposition = () => updateMenuPosition()

    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open])

  return (
    <div
      ref={rootRef}
      className={cn('ui-select', disabled && 'is-disabled', open && 'is-open', className)}
    >
      <button
        ref={buttonRef}
        id={id}
        type="button"
        className="ui-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        aria-required={required || undefined}
        onClick={() => {
          if (disabled) return
          setOpen((v) => !v)
        }}
      >
        <span className={cn('ui-select-value', !selected && 'is-placeholder')}>{display || '—'}</span>
        <ChevronDown size={16} className="ui-select-chevron" aria-hidden />
      </button>

      {/* Form required / name uchun yashirin input */}
      {name ? (
        <input type="hidden" name={name} value={stringValue} required={required} />
      ) : null}

      {open && typeof document !== 'undefined'
        ? createPortal(
          <div
            ref={menuRef}
            id={listId}
            className="ui-select-menu"
            role="listbox"
            style={menuStyle || undefined}
          >
            {normalized.length === 0 ? (
              <div className="ui-select-empty">—</div>
            ) : (
              normalized.map((opt) => {
                const active = opt.value === stringValue
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={opt.disabled}
                    className={cn('ui-select-option', active && 'is-active')}
                    onClick={() => {
                      if (opt.disabled) return
                      emit(opt.value)
                      setOpen(false)
                    }}
                  >
                    {opt.label}
                  </button>
                )
              })
            )}
          </div>,
          document.body,
        )
        : null}
    </div>
  )
}
