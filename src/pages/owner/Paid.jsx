import { useMemo, useState } from 'react'
import { PageEnter } from '../../components/motion/PageMotion'
import {
  Avatar,
  MasterDetail,
  MasterListItem,
  StatusBadge,
} from '../../components/ui'
import { useData } from '../../context/DataContext'
import { useLanguage } from '../../context/LanguageContext'
import { studentPaidForMonth } from '../../lib/store'
import { currentMonthYear, formatDate, formatMoney, formatPhone } from '../../lib/utils'

export default function OwnerPaid() {
  const { data } = useData()
  const { t } = useLanguage()
  const { month, year } = currentMonthYear()
  const period = `${month}/${year}`

  const paidList = useMemo(() => {
    const monthPayments = data.payments.filter(
      (p) => Number(p.month) === Number(month) && Number(p.year) === Number(year),
    )
    const byKey = new Map()

    for (const payment of monthPayments) {
      const student = payment.studentId
        ? data.students.find((s) => s.id === payment.studentId)
        : null
      const key = payment.studentId || `gone:${payment.studentName || payment.id}`
      const prev = byKey.get(key) || {
        id: key,
        studentId: payment.studentId,
        name: student?.name || payment.studentName || t('owner.paid.deletedStudent'),
        amount: 0,
        paidAt: payment.paidAt,
        entity: student || null,
        deleted: !student,
      }
      prev.amount += Number(payment.amount) || 0
      if (String(payment.paidAt || '') > String(prev.paidAt || '')) {
        prev.paidAt = payment.paidAt
      }
      if (student) {
        prev.name = student.name
        prev.entity = student
        prev.deleted = false
      }
      byKey.set(key, prev)
    }

    return [...byKey.values()]
      .map((item) => {
        const full = item.entity
          ? studentPaidForMonth(data.payments, item.entity.id, month, year, item.entity.monthlyFee)
          : item.amount > 0
        return {
          ...item,
          subtitle: formatMoney(item.amount),
          full,
        }
      })
      .sort((a, b) => String(b.paidAt || '').localeCompare(String(a.paidAt || '')))
  }, [data.students, data.payments, month, year, t])

  const [selectedId, setSelectedId] = useState(null)
  const selected = paidList.find((i) => i.id === selectedId)

  return (
    <PageEnter>
      <MasterDetail
        list={(
          <>
            <div className="master-list-head">
              <span className="chart-card-meta">{period}</span>
            </div>
            {paidList.length === 0 ? null : paidList.map((item) => (
              <MasterListItem
                key={item.id}
                active={selectedId === item.id}
                avatar={<Avatar name={item.name} size="sm" />}
                title={item.name}
                subtitle={item.subtitle}
                badge={(
                  <StatusBadge tone={item.deleted ? 'neutral' : (item.full ? 'success' : 'warning')}>
                    {item.deleted
                      ? t('owner.paid.deletedStudent')
                      : (item.full ? t('owner.paid.paid') : t('owner.paid.partial'))}
                  </StatusBadge>
                )}
                onClick={() => setSelectedId(item.id)}
              />
            ))}
          </>
        )}
        detail={
          !selected ? (
            <div className="master-detail-empty">{t('owner.paid.select')}</div>
          ) : (
            <>
              <div className="master-detail-head">
                <Avatar name={selected.name} />
                <div>
                  <h2>{selected.name}</h2>
                  <p>
                    {selected.deleted
                      ? t('owner.paid.deletedPaymentNote')
                      : t(selected.full ? 'owner.paid.periodFull' : 'owner.paid.periodPartial', { period })}
                  </p>
                </div>
                <StatusBadge tone={selected.deleted ? 'neutral' : (selected.full ? 'success' : 'warning')}>
                  {selected.deleted
                    ? t('owner.paid.keptPayment')
                    : (selected.full ? t('owner.paid.paid') : t('owner.paid.partial'))}
                </StatusBadge>
              </div>
              <div className="detail-meta-grid">
                <div className="detail-meta-item"><span>{t('common.amount')}</span><strong className="money-text">{formatMoney(selected.amount)}</strong></div>
                <div className="detail-meta-item"><span>{t('common.date')}</span><strong>{selected.paidAt ? formatDate(selected.paidAt) : '—'}</strong></div>
                <div className="detail-meta-item">
                  <span>{t('common.phone')}</span>
                  <strong>{selected.entity?.phone ? formatPhone(selected.entity.phone) : '—'}</strong>
                </div>
              </div>
            </>
          )
        }
      />
    </PageEnter>
  )
}
