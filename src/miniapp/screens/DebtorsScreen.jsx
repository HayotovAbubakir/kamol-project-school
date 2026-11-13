import { useMemo, useState } from 'react'
import { Phone } from 'lucide-react'
import { Button, Card, EmptyState } from '../ui.jsx'
import { parseParentPhones } from '../../lib/phone.js'
import { debtorsFor, money, monthName, tashkentMonthYear, telLink } from '../format.js'
import { t } from '../i18n.js'

function shiftMonth({ month, year }, delta) {
  const index = year * 12 + (month - 1) + delta
  return { month: (index % 12) + 1, year: Math.floor(index / 12) }
}

export default function DebtorsScreen({ students, groups, payments, canAcceptPayment, onAcceptPayment, onOpenStudent }) {
  const [period, setPeriod] = useState(tashkentMonthYear)
  const [search, setSearch] = useState('')
  const current = tashkentMonthYear()
  const isCurrent = period.month === current.month && period.year === current.year
  const groupNames = useMemo(() => new Map(groups.map((group) => [group.id, group.name])), [groups])
  const rows = useMemo(
    () => debtorsFor(students, groups, payments, period.month, period.year),
    [students, groups, payments, period],
  )
  const query = search.trim().toLowerCase()
  const visible = query
    ? rows.filter(({ student }) => `${student.name} ${student.phone || ''}`.toLowerCase().includes(query))
    : rows
  const total = rows.reduce((sum, row) => sum + row.remaining, 0)

  return (
    <section className="mt-7 grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <Button variant="secondary" className="min-h-11 min-w-11 px-3" aria-label={t('Oldingi oy')} onClick={() => setPeriod((value) => shiftMonth(value, -1))}>‹</Button>
        <p className="text-center font-bold">{monthName(period.month)} {period.year}</p>
        <Button variant="secondary" className="min-h-11 min-w-11 px-3" aria-label={t('Keyingi oy')} disabled={isCurrent} onClick={() => setPeriod((value) => shiftMonth(value, 1))}>›</Button>
      </div>
      <Card>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-[var(--mini-muted)]">{t('Qarzdorlar')}</p>
            <p className="mt-1 text-2xl font-extrabold">{rows.length}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--mini-muted)]">{t('Jami qarz')}</p>
            <p className="mt-1 text-lg font-extrabold">{money(total)}</p>
          </div>
        </div>
      </Card>
      {rows.length > 5 && (
        <label className="mini-field">
          <span>{t('Qidirish')}</span>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
      )}
      {visible.map(({ student, fee, paid, remaining }) => {
        const phones = parseParentPhones(student.parent_phone)
        const callTo = telLink(phones.fatherPhone || phones.motherPhone || student.phone)
        return (
          <Card key={student.id}>
            <button type="button" className="w-full text-left" onClick={() => onOpenStudent(student)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-bold">{student.name}</h2>
                  <p className="mt-1 truncate text-xs text-[var(--mini-muted)]">
                    {(student.group_ids || []).map((id) => groupNames.get(id)).filter(Boolean).join(', ')}
                  </p>
                </div>
                <strong className="shrink-0 text-rose-400">{money(remaining)}</strong>
              </div>
              <p className="mt-2 text-xs text-[var(--mini-muted)]">{t('To‘langan')}: {money(paid)} / {money(fee)}</p>
            </button>
            <div className="mt-3 flex flex-wrap gap-2">
              {canAcceptPayment && (
                <Button className="min-h-11 flex-1 px-3 text-xs" onClick={() => onAcceptPayment({ studentId: student.id, amount: remaining, month: period.month, year: period.year })}>
                  {t('To‘lov qabul qilish')}
                </Button>
              )}
              {callTo && (
                <a className="mini-secondary flex min-h-11 items-center justify-center gap-2 rounded-2xl px-3 text-xs font-bold" href={callTo}>
                  <Phone size={14} aria-hidden="true" /> {t('Qo‘ng‘iroq')}
                </a>
              )}
            </div>
          </Card>
        )
      })}
      {!rows.length && <EmptyState title={t('Qarzdor yo‘q')} />}
      {!!rows.length && !visible.length && <EmptyState title={t('Topilmadi')} />}
    </section>
  )
}
