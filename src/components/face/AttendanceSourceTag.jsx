import { ScanFace } from 'lucide-react'
import { faceLabel } from './faceLabels.js'
import './face.css'

function arrivalTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

/** Davomat manbasi (Face ID / qo‘lda), kechikish daqiqasi va kelgan vaqt. */
export default function AttendanceSourceTag({ record, labels }) {
  if (!record) return null
  const source = record.source || 'manual'
  const late = record.status === 'late' && Number(record.lateMinutes ?? record.late_minutes) > 0
    ? faceLabel(labels, 'lateMinutes', { minutes: Number(record.lateMinutes ?? record.late_minutes) })
    : ''
  const time = arrivalTime(record.checkedInAt ?? record.checked_in_at)
  return (
    <span className={`attendance-source${source === 'face' ? ' is-face' : ''}`}>
      {source === 'face' ? <ScanFace size={12} aria-hidden="true" /> : null}
      {faceLabel(labels, source === 'face' ? 'sourceFace' : 'sourceManual')}
      {late ? ` · ${late}` : ''}
      {time ? ` · ${faceLabel(labels, 'arrivedAt', { time })}` : ''}
    </span>
  )
}
