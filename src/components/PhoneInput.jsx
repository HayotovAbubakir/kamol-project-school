import { formatPhoneDisplay, normalizePhone, phoneFieldState } from '../lib/phone'

/**
 * +998 avtomatik; foydalanuvchi (XX) XXX-XX-XX uchun 9 raqam kiritadi.
 * value — saqlangan format (+998XXXXXXXXX yoki bo‘sh).
 */
export default function PhoneInput({
  value = '',
  onChange,
  className = '',
  id,
  name,
  required = false,
  disabled = false,
  autoComplete = 'tel',
  compact = true,
  invalid = false,
}) {
  const display = formatPhoneDisplay(value)
  const state = phoneFieldState(value)
  const showInvalid = invalid || state === 'incomplete'

  const handleChange = (event) => {
    const next = normalizePhone(event.target.value)
    onChange?.(next)
  }

  const handleKeyDown = (event) => {
    if (event.key !== 'Backspace') return
    const local = String(value || '').replace(/\D/g, '').replace(/^998/, '')
    if (local.length === 0) {
      event.preventDefault()
    }
  }

  return (
    <input
      id={id}
      name={name}
      type="tel"
      inputMode="numeric"
      autoComplete={autoComplete}
      className={[
        'input',
        compact ? 'input-phone' : '',
        showInvalid ? 'input-invalid' : '',
        className,
      ].filter(Boolean).join(' ')}
      value={display || '+998'}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onFocus={(event) => {
        const el = event.target
        requestAnimationFrame(() => {
          const len = el.value.length
          el.setSelectionRange(len, len)
        })
      }}
      required={required}
      disabled={disabled}
      aria-invalid={showInvalid || undefined}
      placeholder="+998 (XX) XXX-XX-XX"
    />
  )
}
