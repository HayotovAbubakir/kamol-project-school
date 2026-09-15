import { useState } from 'react'
import { Badge, PageHeader } from '../../components/ui'
import { useData } from '../../context/DataContext'
import { useLanguage } from '../../context/LanguageContext'
import { formatDate, todayISO } from '../../lib/utils'

const STATUS_KEYS = {
  present: 'admin.status.present',
  late: 'admin.status.late',
  absent: 'admin.status.absent',
}

export default function AdminAttendance() {
  const { data } = useData()
  const { t } = useLanguage()
  const [date, setDate] = useState(todayISO())
  const records = data.attendance.filter((a) => a.date === date)

  return (
    <>
      <PageHeader title={t('admin.attendance.title')} />
      <div className="field" style={{ maxWidth: 260 }}>
        <label>{t('common.date')}</label>
        <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('admin.label.student')}</th>
                <th>{t('admin.label.group')}</th>
                <th>{t('common.status')}</th>
                <th>{t('admin.attendance.note')}</th>
                <th>{t('admin.attendance.markedAt')}</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr><td colSpan={5} className="empty-state">{t('admin.attendance.empty')}</td></tr>
              ) : (
                records.map((record) => {
                  const student = data.students.find((s) => s.id === record.studentId)
                  const group = data.groups.find((g) => g.id === record.groupId)
                  const tone = record.status === 'present' ? 'success' : record.status === 'late' ? 'warning' : 'danger'
                  return (
                    <tr key={record.id}>
                      <td>{student?.name ?? '—'}</td>
                      <td>{group?.name ?? '—'}</td>
                      <td><Badge tone={tone}>{STATUS_KEYS[record.status] ? t(STATUS_KEYS[record.status]) : record.status}</Badge></td>
                      <td>{record.note || '—'}</td>
                      <td>{formatDate(record.markedAt)}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
