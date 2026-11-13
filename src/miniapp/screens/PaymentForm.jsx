import { useMemo, useState } from 'react'
import { Button, Card } from '../ui.jsx'
import { money, monthName, paidForMonth, paymentMethodLabel, studentFee } from '../format.js'
import { t } from '../i18n.js'

const METHODS = ['cash', 'card', 'transfer']

/** `value` — { studentId, amount, month, year, method }; ota komponent boshqaradi (qarzdorlar ekranidan oldindan to‘ldiriladi). */
export default function PaymentForm({ students, groups, payments, value, onChange, onSubmit, busy }) {
  const [search, setSearch] = useState('')
  const selected = students.find((student) => student.id === value.studentId) || null
  const fee = selected ? studentFee(selected, groups, value.month, value.year) : 0
  const paid = selected ? paidForMonth(payments, selected.id, value.month, value.year) : 0
  const remaining = Math.max(0, fee - paid)
  const query = search.trim().toLowerCase()
  const options = useMemo(() => {
    const list = query
      ? students.filter((student) => `${student.name} ${student.phone || ''}`.toLowerCase().includes(query))
      : students
    return list.slice(0, 50)
  }, [students, query])

  function pickStudent(studentId) {
    const student = students.find((item) => item.id === studentId)
    const due = student
      ? Math.max(0, studentFee(student, groups, value.month, value.year) - paidForMonth(payments, student.id, value.month, value.year))
      : 0
    onChange({ ...value, studentId, amount: due ? String(due) : '' })
    setSearch('')
  }

  return (
    <Card>
      <h2 className="font-bold">{t('To‘lov qabul qilish')}</h2>
      <form id="mini-payment-form" className="mt-4 grid gap-3" onSubmit={onSubmit}>
        {selected ? (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-[var(--mini-bg)] p-3">
            <div className="min-w-0">
              <p className="truncate font-semibold">{selected.name}</p>
              <p className="text-xs text-[var(--mini-muted)]">
                {fee ? `${t('Qarz')}: ${money(remaining)} / ${money(fee)}` : t('Guruhga biriktirilmagan')}
              </p>
            </div>
            <button type="button" className="mini-link inline-flex min-h-11 min-w-11 shrink-0 items-center text-xs" onClick={() => onChange({ ...value, studentId: '', amount: '' })}>{t('O‘zgartirish')}</button>
          </div>
        ) : (
          <>
            <label className="mini-field"><span>{t('O‘quvchi')}</span>
              <input type="search" value={search} placeholder={t('Ism yoki telefon')} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <div className="grid max-h-56 gap-1 overflow-y-auto" role="listbox" aria-label={t('O‘quvchi')}>
              {options.map((student) => (
                <button key={student.id} type="button" role="option" aria-selected="false" className="mini-more-item" onClick={() => pickStudent(student.id)}>
                  <span className="truncate">{student.name}</span>
                </button>
              ))}
              {!options.length && <p className="py-2 text-sm text-[var(--mini-muted)]">{t('Topilmadi')}</p>}
            </div>
          </>
        )}
        <label className="mini-field"><span>{t('Miqdor (so‘m)')}</span>
          <input type="number" inputMode="numeric" min="1" value={value.amount} onChange={(event) => onChange({ ...value, amount: event.target.value })} required />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="mini-field"><span>{t('Oy')}</span>
            <select value={value.month} onChange={(event) => onChange({ ...value, month: Number(event.target.value) })}>
              {Array.from({ length: 12 }, (_, index) => <option key={index} value={index + 1}>{monthName(index + 1)}</option>)}
            </select>
          </label>
          <label className="mini-field"><span>{t('Yil')}</span>
            <input type="number" min="2000" max="2100" value={value.year} onChange={(event) => onChange({ ...value, year: Number(event.target.value) })} required />
          </label>
        </div>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('To‘lov turi')}>
          {METHODS.map((method) => (
            <button key={method} type="button" role="radio" aria-checked={value.method === method}
              className={`mini-secondary min-h-11 rounded-2xl text-sm font-semibold ${value.method === method ? 'ring-2 ring-[var(--mini-accent)]' : ''}`}
              onClick={() => onChange({ ...value, method })}>
              {paymentMethodLabel(method)}
            </button>
          ))}
        </div>
        <Button type="submit" disabled={busy || !selected}>{busy ? t('Saqlanmoqda…') : t('To‘lovni saqlash')}</Button>
      </form>
    </Card>
  )
}
