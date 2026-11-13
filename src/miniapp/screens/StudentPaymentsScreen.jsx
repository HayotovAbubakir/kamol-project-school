import { useState } from 'react'
import { Button, Card, EmptyState } from '../ui.jsx'
import { formatDate, money, monthName, paidForMonth, paymentMethodLabel, studentFee, tashkentMonthYear } from '../format.js'
import { t } from '../i18n.js'

const METHODS = ['cash', 'card', 'transfer']

export default function StudentPaymentsScreen({ student, groups, payments, busy, canAcceptPayment, canEdit, onAcceptPayment, onVoid, onCorrect }) {
  const [editing, setEditing] = useState(null)
  const [voiding, setVoiding] = useState(null)
  const { month, year } = tashkentMonthYear()

  if (!student) return <section className="mt-7"><EmptyState title={t('O‘quvchi topilmadi')} /></section>

  const rows = payments
    .filter((item) => item.student_id === student.id)
    .sort((left, right) => String(right.paid_at || '').localeCompare(String(left.paid_at || '')))
  const fee = studentFee(student, groups, month, year)
  const paid = paidForMonth(payments, student.id, month, year)
  const remaining = Math.max(0, fee - paid)

  async function submitEdit(event) {
    event.preventDefault()
    const ok = await onCorrect(editing.payment, {
      amount: editing.amount, month: editing.month, year: editing.year, method: editing.method, reason: editing.reason,
    })
    if (ok) setEditing(null)
  }

  async function submitVoid(event) {
    event.preventDefault()
    const ok = await onVoid(voiding.payment, voiding.reason)
    if (ok) setVoiding(null)
  }

  return (
    <section className="mt-7 grid gap-3">
      <Card>
        <h2 className="text-lg font-extrabold">{student.name}</h2>
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <p><span className="block text-xs text-[var(--mini-muted)]">{t('Oylik')}</span><strong>{money(fee)}</strong></p>
          <p><span className="block text-xs text-[var(--mini-muted)]">{t('To‘langan')}</span><strong>{money(paid)}</strong></p>
          <p><span className="block text-xs text-[var(--mini-muted)]">{t('Qarz')}</span><strong className={remaining ? 'text-rose-400' : ''}>{money(remaining)}</strong></p>
        </div>
        {canAcceptPayment && (
          <Button className="mt-4 w-full" onClick={() => onAcceptPayment({ studentId: student.id, amount: remaining || '', month, year })}>
            {t('To‘lov qabul qilish')}
          </Button>
        )}
      </Card>

      {rows.map((payment) => {
        const voided = Boolean(payment.voided_at)
        return (
          <Card key={payment.id} className={voided ? 'opacity-60' : ''}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold">{monthName(payment.month)} {payment.year}</p>
                <p className="mt-1 text-xs text-[var(--mini-muted)]">
                  {formatDate(payment.paid_at)}{payment.method ? ` · ${paymentMethodLabel(payment.method)}` : ''}
                </p>
                {voided && <span className="mini-badge mini-badge-muted mt-2 inline-block">{t('Bekor qilingan')}</span>}
              </div>
              <strong className={`shrink-0${voided ? ' line-through' : ''}`}>{money(payment.amount)}</strong>
            </div>

            {canEdit && !voided && editing?.payment.id !== payment.id && voiding?.payment.id !== payment.id && (
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" className="min-h-11 flex-1 px-3 text-xs" disabled={busy}
                  onClick={() => { setVoiding(null); setEditing({ payment, amount: String(payment.amount), month: String(payment.month), year: String(payment.year), method: payment.method || 'cash', reason: '' }) }}>
                  {t('Tuzatish')}
                </Button>
                <Button variant="danger" className="min-h-11 flex-1 px-3 text-xs" disabled={busy}
                  onClick={() => { setEditing(null); setVoiding({ payment, reason: '' }) }}>
                  {t('Bekor qilish')}
                </Button>
              </div>
            )}

            {editing?.payment.id === payment.id && (
              <form className="mt-3 grid gap-2" onSubmit={submitEdit}>
                <label className="mini-field"><span>{t('Miqdor (so‘m)')}</span>
                  <input type="number" inputMode="numeric" min="1" value={editing.amount} onChange={(event) => setEditing({ ...editing, amount: event.target.value })} required />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="mini-field"><span>{t('Oy')}</span>
                    <select value={editing.month} onChange={(event) => setEditing({ ...editing, month: event.target.value })}>
                      {Array.from({ length: 12 }, (_, index) => <option key={index} value={index + 1}>{monthName(index + 1)}</option>)}
                    </select>
                  </label>
                  <label className="mini-field"><span>{t('Yil')}</span>
                    <input type="number" min="2000" max="2100" value={editing.year} onChange={(event) => setEditing({ ...editing, year: event.target.value })} required />
                  </label>
                </div>
                <label className="mini-field"><span>{t('To‘lov turi')}</span>
                  <select value={editing.method} onChange={(event) => setEditing({ ...editing, method: event.target.value })}>
                    {METHODS.map((method) => <option key={method} value={method}>{paymentMethodLabel(method)}</option>)}
                  </select>
                </label>
                <label className="mini-field"><span>{t('Sabab')}</span>
                  <input value={editing.reason} maxLength={500} onChange={(event) => setEditing({ ...editing, reason: event.target.value })} />
                </label>
                <div className="flex gap-2">
                  <Button type="submit" className="flex-1" disabled={busy}>{busy ? t('Saqlanmoqda…') : t('Saqlash')}</Button>
                  <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => setEditing(null)}>{t('Yopish')}</Button>
                </div>
              </form>
            )}

            {voiding?.payment.id === payment.id && (
              <form className="mt-3 grid gap-2" onSubmit={submitVoid}>
                <label className="mini-field"><span>{t('Bekor qilish sababi')}</span>
                  <input value={voiding.reason} minLength={3} maxLength={500} onChange={(event) => setVoiding({ ...voiding, reason: event.target.value })} required autoFocus />
                </label>
                <div className="flex gap-2">
                  <Button type="submit" variant="danger" className="flex-1" disabled={busy || voiding.reason.trim().length < 3}>{t('Bekor qilish')}</Button>
                  <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => setVoiding(null)}>{t('Yopish')}</Button>
                </div>
              </form>
            )}
          </Card>
        )
      })}
      {!rows.length && <EmptyState title={t('To‘lov yo‘q')} />}
    </section>
  )
}
