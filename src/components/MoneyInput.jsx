import { formatMoneyDigits, parseMoneyDigits } from '../lib/utils'
import { translate } from '../i18n/runtime'

export default function MoneyInput({
  value = '',
  onChange,
  id,
  name,
  className = '',
  placeholder = '',
  required = false,
  disabled = false,
  autoFocus = false,
}) {
  const display = formatMoneyDigits(value)
  const placeholderText = placeholder ? formatMoneyDigits(placeholder) || String(placeholder) : ''

  return (
    <div className={`money-input${className ? ` ${className}` : ''}`}>
      <input
        id={id}
        name={name}
        className="input money-input-field"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={display}
        placeholder={placeholderText}
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => onChange?.(parseMoneyDigits(e.target.value))}
      />
      <span className="money-input-suffix" aria-hidden>
        {translate('domain.currencySuffix')}
      </span>
    </div>
  )
}
