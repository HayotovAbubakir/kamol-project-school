import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import Select from '../../components/Select'
import { PageEnter } from '../../components/motion/PageMotion'
import { EmptyState } from '../../components/ui'
import { useNotifications } from '../../context/NotificationContext'
import { useLanguage } from '../../context/LanguageContext'
import { currentMonthYear } from '../../lib/utils'

const MONTH_KEYS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
]

function buildYearOptions(centerYear) {
  const years = new Set()
  for (let y = centerYear - 3; y <= centerYear + 1; y += 1) years.add(y)
  return [...years].sort((a, b) => b - a)
}

export default function OwnerNotifications() {
  const { getItemsForMonth, dismissNotification, scheduleError } = useNotifications()
  const { t } = useLanguage()
  const initial = currentMonthYear()
  const [month, setMonth] = useState(initial.month)
  const [year, setYear] = useState(initial.year)

  const yearOptions = useMemo(() => buildYearOptions(initial.year), [initial.year])
  const items = getItemsForMonth(month, year)

  return (
    <PageEnter>
      <div className="notif-page">
        {scheduleError ? <p className="schedule-change-error" role="alert">{scheduleError}</p> : null}
        <div className="notif-page-toolbar">
          <div className="notif-month-pickers">
            <label className="notif-month-field">
              <span>{t('common.month')}</span>
              <Select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                options={MONTH_KEYS.map((key, index) => ({
                  value: index + 1,
                  label: t(`domain.month.${key}`),
                }))}
              />
            </label>
            <label className="notif-month-field">
              <span>{t('common.year')}</span>
              <Select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                options={yearOptions.map((y) => ({
                  value: y,
                  label: String(y),
                }))}
              />
            </label>
          </div>
        </div>

        {items.length === 0 ? (
          <EmptyState title={t('owner.notifications.empty')} />
        ) : (
          <div className="notif-list">
            {items.map((item) => {
              const Icon = item.icon
              return (
                <div key={item.id} className="insight-banner notif-item">
                  <div className="insight-icon">
                    <Icon size={18} />
                  </div>
                  <div className="notif-item-body">
                    <strong>{item.title}</strong>
                    <p>{item.text}</p>
                  </div>
                  <button
                    type="button"
                    className="notif-delete-btn"
                    onClick={() => dismissNotification(item.id)}
                    aria-label={t('owner.notifications.delete')}
                    title={t('owner.notifications.delete')}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </PageEnter>
  )
}
