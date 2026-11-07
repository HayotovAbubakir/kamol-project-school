import { ArrowLeft } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import MoneyInput from '../../components/MoneyInput'
import { PageEnter } from '../../components/motion/PageMotion'
import {
  Avatar,
  MasterDetail,
  MasterListItem,
  PageHeader,
} from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { useData } from '../../context/DataContext'
import { useLanguage } from '../../context/LanguageContext'
import { amountPaidForMonth, remainingFee, isStudentDebtor } from '../../lib/store'
import { currentMonthYear, formatMoney, formatPhone } from '../../lib/utils'

export default function OwnerDebtors() {
  const { data, addPayment } = useData()
  const { user } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const home = pathname.startsWith('/reception') ? '/reception' : '/owner'
  const { month, year } = currentMonthYear()
  const period = `${month}/${year}`
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [amountInput, setAmountInput] = useState('')

  const unpaidList = useMemo(
    () => data.students
      .filter((s) => isStudentDebtor(data.payments, s.id, month, year, s.monthlyFee))
      .map((s) => {
        const paid = amountPaidForMonth(data.payments, s.id, month, year)
        const due = remainingFee(s, data.payments, month, year)
        return {
          id: s.id,
          name: s.name,
          subtitle: due > 0 ? t('owner.debtors.remaining', { amount: formatMoney(due) }) : formatMoney(s.monthlyFee),
          paid,
          due,
          entity: s,
        }
      }),
    [data.students, data.payments, month, year, t],
  )

  const [selectedId, setSelectedId] = useState(null)
  const selected = unpaidList.find((i) => i.id === selectedId) ?? null

  useEffect(() => {
    if (!selected) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAmountInput('')
      return
    }
    setAmountInput(String(Math.max(0, Math.round(selected.due))))
    setError('')
  }, [selected])

  const payAmount = Number(amountInput)

  const collect = async () => {
    if (!selected) return
    if (!Number.isFinite(payAmount) || payAmount <= 0) {
      setError(t('owner.debtors.amountInvalid'))
      return
    }
    if (payAmount > selected.due) {
      setError(t('owner.debtors.amountTooHigh', { amount: formatMoney(selected.due) }))
      return
    }

    setError('')
    setBusyId(selected.id)
    try {
      await addPayment({
        studentId: selected.entity.id,
        studentName: selected.entity.name,
        amount: payAmount,
        month,
        year,
        recordedBy: user.id,
      })
    } catch (err) {
      setError(err.message || t('owner.debtors.saveFailed'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <PageEnter>
      <PageHeader
        actions={
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => navigate(home)}
          >
            <ArrowLeft size={16} />
            {t('common.backHome')}
          </button>
        }
      />
      {error && <div className="alert alert-error">{error}</div>}
      <MasterDetail
        list={(
          <>
            <div className="master-list-head">
              <span className="chart-card-meta">{period}</span>
            </div>
            {unpaidList.length === 0 ? null : unpaidList.map((item) => (
              <MasterListItem
                key={item.id}
                active={selectedId === item.id}
                tone="danger"
                avatar={<Avatar name={item.name} size="sm" />}
                title={item.name}
                subtitle={item.subtitle}
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
                  <p>{t('owner.debtors.periodPending', { period })}</p>
                </div>
              </div>
              <div className="detail-meta-grid">
                <div className="detail-meta-item"><span>{t('owner.debtors.monthlyFee')}</span><strong>{formatMoney(selected.entity.monthlyFee)}</strong></div>
                <div className="detail-meta-item"><span>{t('owner.debtors.paid')}</span><strong>{formatMoney(amountPaidForMonth(data.payments, selected.id, month, year))}</strong></div>
                <div className="detail-meta-item"><span>{t('owner.debtors.remainingLabel')}</span><strong className="money-text money-text-danger">{formatMoney(selected.due)}</strong></div>
                <div className="detail-meta-item"><span>{t('common.phone')}</span><strong>{selected.entity.phone ? formatPhone(selected.entity.phone) : '—'}</strong></div>
              </div>

              <div className="debtor-pay-row">
                <div className="field debtor-pay-field">
                  <label htmlFor="debtor-pay-amount">{t('owner.debtors.payAmount')}</label>
                  <MoneyInput
                    id="debtor-pay-amount"
                    value={amountInput}
                    onChange={setAmountInput}
                    placeholder={String(Math.round(selected.due))}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busyId === selected.id || selected.due <= 0 || !payAmount}
                  onClick={collect}
                >
                  {busyId === selected.id
                    ? t('common.saving')
                    : t('owner.debtors.collect', { amount: formatMoney(payAmount || 0) })}
                </button>
              </div>
            </>
          )
        }
      />
    </PageEnter>
  )
}
