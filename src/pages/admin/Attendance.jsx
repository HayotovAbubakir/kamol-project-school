import { useState } from 'react'
import { Badge, PageHeader } from '../../components/ui'
import { useData } from '../../context/DataContext'
import { useLanguage } from '../../context/LanguageContext'
import { formatDate, todayISO } from '../../lib/utils'
import AttendanceSourceTag from '../../components/face/AttendanceSourceTag.jsx'
import { useSiteFaceLabels } from '../../components/face/useSiteFaceLabels.js'
import { faceApi } from '../../lib/faceApi.js'

const STATUS_KEYS = {
  present: 'admin.status.present',
  late: 'admin.status.late',
  absent: 'admin.status.absent',
}

export default function AdminAttendance() {
  const { data, refresh } = useData()
  const { t } = useLanguage()
  const faceLabels = useSiteFaceLabels()
  const [date, setDate] = useState(todayISO())
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeMessage, setFinalizeMessage] = useState('')
  const records = data.attendance.filter((a) => a.date === date)

  const finalize = async () => {
    setFinalizing(true)
    setFinalizeMessage('')
    try {
      const result = await faceApi.finalize(date)
      setFinalizeMessage(faceLabels.finalizeDone({ closed: result?.closed || 0, absent: result?.absent || 0 }))
      await refresh()
    } catch (finalizeError) {
      setFinalizeMessage(finalizeError.message)
    } finally {
      setFinalizing(false)
    }
  }

  return (
    <>
      <PageHeader title={t('admin.attendance.title')} />
      <div className="page-toolbar">
        <div className="field page-toolbar-field">
          <label htmlFor="attendance-date">{t('common.date')}</label>
          <input id="attendance-date" type="date" className="input" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value || todayISO())} />
        </div>
        <button type="button" className="btn btn-outline page-toolbar-btn" onClick={finalize} disabled={finalizing}>
          {faceLabels.finalize()}
        </button>
        {finalizeMessage ? <span className="page-toolbar-note" aria-live="polite">{finalizeMessage}</span> : null}
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
                      <td>
                        <Badge tone={tone}>{STATUS_KEYS[record.status] ? t(STATUS_KEYS[record.status]) : record.status}</Badge>
                        {' '}<AttendanceSourceTag record={record} labels={faceLabels} />
                      </td>
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
