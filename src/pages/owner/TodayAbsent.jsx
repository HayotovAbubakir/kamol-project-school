import { ArrowLeft } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { PageEnter } from '../../components/motion/PageMotion'
import {
  Avatar,
  EmptyState,
  MasterDetail,
  MasterListItem,
  PageHeader,
  StatusBadge,
} from '../../components/ui'
import { useData } from '../../context/DataContext'
import { useLanguage } from '../../context/LanguageContext'
import { getTodayAbsentStudents } from '../../lib/analytics'
import { formatPhoneDisplay, parseParentPhones } from '../../lib/phone'
import { formatPhone, todayISO } from '../../lib/utils'

export default function TodayAbsent() {
  const { data } = useData()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const home = pathname.startsWith('/admin') ? '/admin' : '/owner'
  const today = todayISO()

  const list = useMemo(() => getTodayAbsentStudents(data, today), [data, today])
  const [selectedId, setSelectedId] = useState(null)
  const selected = list.find((i) => i.id === selectedId) ?? null

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

      <MasterDetail
        list={(
          <>
            <div className="master-list-head">
              <span className="chart-card-meta">{t('owner.absentToday.date', { date: today })}</span>
            </div>
            {list.length === 0 ? null : list.map((item) => (
              <MasterListItem
                key={`${item.id}-${item.groupId}`}
                active={selectedId === item.id}
                tone="warning"
                avatar={<Avatar name={item.name} size="sm" />}
                title={item.name}
                subtitle={item.groupName}
                badge={<StatusBadge tone="danger">{t('owner.absentToday.absent')}</StatusBadge>}
                onClick={() => setSelectedId(item.id)}
              />
            ))}
          </>
        )}
        detail={
          list.length === 0 ? (
            <EmptyState title={t('owner.absentToday.empty')} />
          ) : !selected ? (
            <div className="master-detail-empty">{t('owner.absentToday.select')}</div>
          ) : (
            <>
              <div className="master-detail-head">
                <Avatar name={selected.name} />
                <div>
                  <h2>{selected.name}</h2>
                  <p>{t('owner.absentToday.missedLesson', { group: selected.groupName })}</p>
                </div>
                <StatusBadge tone="danger">{t('owner.absentToday.absent')}</StatusBadge>
              </div>
              <div className="detail-meta-grid">
                <div className="detail-meta-item">
                  <span>{t('owner.schedule.group')}</span>
                  <strong>{selected.groupName}</strong>
                </div>
                <div className="detail-meta-item">
                  <span>{t('common.phone')}</span>
                  <strong>{selected.phone ? formatPhone(selected.phone) : '—'}</strong>
                </div>
                {(() => {
                  const { fatherPhone, motherPhone } = parseParentPhones(selected.parentPhone)
                  return (
                    <>
                      <div className="detail-meta-item">
                        <span>{t('admin.label.fatherPhone')}</span>
                        <strong>{fatherPhone ? formatPhoneDisplay(fatherPhone) : '—'}</strong>
                      </div>
                      <div className="detail-meta-item">
                        <span>{t('admin.label.motherPhone')}</span>
                        <strong>{motherPhone ? formatPhoneDisplay(motherPhone) : '—'}</strong>
                      </div>
                    </>
                  )
                })()}
              </div>
            </>
          )
        }
      />
    </PageEnter>
  )
}
