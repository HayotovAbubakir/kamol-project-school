import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, StatusBadge } from './ui'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import {
  createScheduleChange,
  previewScheduleChange,
  resendScheduleNotification,
  scheduleHistory,
  undoScheduleChange,
} from '../lib/api'
import { getEffectiveLesson } from '../../shared/schedule.js'

const WEEKDAYS = [
  'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba',
  'Juma', 'Shanba', 'Yakshanba',
]

function isoDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function shiftedDate(date, days) {
  const result = new Date(`${date}T12:00:00Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

function prettyDate(value) {
  if (!value) return '—'
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}.${month}.${year}`
}

function scheduleFor(group, date) {
  const versions = (group.scheduleVersions || [])
    .filter((version) => version.valid_from <= date
      && (!version.valid_to || date < version.valid_to))
    .sort((left, right) => left.valid_from.localeCompare(right.valid_from))
  const version = versions.at(-1)
  const schedule = version?.schedule || group.schedule || []
  if (Array.isArray(schedule)) return schedule
  try {
    const parsed = JSON.parse(schedule)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function lessonSummary(lesson) {
  if (!lesson) return '—'
  return `${prettyDate(lesson.date)} · ${lesson.startTime || '—'}–${lesson.endTime || '—'}`
}

export default function ScheduleChangeDialog({ group, initialSlotId = '', onClose }) {
  const { user } = useAuth()
  const { refresh } = useData()
  const today = isoDate(new Date())
  const tomorrow = shiftedDate(today, 1)
  const [mode, setMode] = useState('single')
  const [date, setDate] = useState(tomorrow)
  const [newDate, setNewDate] = useState(tomorrow)
  const [validFrom, setValidFrom] = useState(tomorrow)
  const [slotId, setSlotId] = useState(initialSlotId)
  const [action, setAction] = useState('change')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [day, setDay] = useState(1)
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState(null)
  const [history, setHistory] = useState({ events: [], deliveries: [] })
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const requestId = useRef(null)

  const currentDate = mode === 'single' ? date : validFrom
  const schedule = useMemo(() => scheduleFor(group, currentDate), [group, currentDate])
  const sourceLessons = useMemo(() => getEffectiveLesson(group.id, date, {
    group,
    versions: group.scheduleVersions || [],
    overrides: group.scheduleOverrides || [],
  }).filter((lesson) => !['cancelled', 'rescheduled'].includes(lesson.status)),
  [group, date])
  const slots = mode === 'single' ? sourceLessons : schedule
  const selectedSlot = slots.find((slot, index) => String(slot.slotId || `slot-${index}`) === slotId)

  useEffect(() => {
    if (!selectedSlot) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStartTime(selectedSlot.startTime || '')
    setEndTime(selectedSlot.endTime || '')
    setDay(Number(selectedSlot.day) || 1)
  }, [selectedSlot])

  useEffect(() => {
    let active = true
    scheduleHistory(group.id)
      .then((result) => {
        if (active) setHistory(result)
      })
      .catch((err) => {
        if (active) setError(err.message || 'O‘zgarishlar tarixini yuklab bo‘lmadi.')
      })
      .finally(() => {
        if (active) setLoadingHistory(false)
      })
    return () => { active = false }
  }, [group.id])

  const payloadFields = () => ({
    groupId: group.id,
    type: mode === 'single' ? 'single' : 'permanent',
    reason: reason.trim(),
    slotId: String(selectedSlot?.slotId || slotId),
    ...(mode === 'single'
      ? { originalDate: date, action, newDate, startTime, endTime }
      : { validFrom, day, startTime, endTime }),
  })
  const payload = () => ({
    requestId: requestId.current || crypto.randomUUID(),
    ...payloadFields(),
  })
  const changeField = (setter, value) => {
    setter(value)
    setPreview(null)
    setError('')
    requestId.current = null
  }

  const updatePreview = async () => {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const request = payload()
      requestId.current = request.requestId
      const result = await previewScheduleChange(request)
      setPreview({ ...result, payload: request, fingerprint: JSON.stringify(payloadFields()) })
    } catch (err) {
      setPreview(null)
      setError(err.message || 'Jadvalni tekshirib bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!preview || JSON.stringify(preview.payload) !== JSON.stringify(payload())) {
      setError('Avval o‘zgarishni tekshiring.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await createScheduleChange(preview.payload)
      await refresh()
      setNotice('Jadval o‘zgarishi saqlandi va xabarnomalar navbatga qo‘yildi.')
      const result = await scheduleHistory(group.id)
      setHistory(result)
      onClose()
    } catch (err) {
      setError(err.message || 'O‘zgarishni saqlab bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  const undo = async (changeId) => {
    setBusy(true)
    setError('')
    try {
      await undoScheduleChange(changeId)
      await refresh()
      setHistory(await scheduleHistory(group.id))
      setNotice('O‘zgarish qaytarildi. Xabarnomalar yuboriladi.')
    } catch (err) {
      setError(err.message || 'O‘zgarishni qaytarib bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  const resend = async (notificationId) => {
    setBusy(true)
    setError('')
    try {
      await resendScheduleNotification(notificationId)
      setHistory(await scheduleHistory(group.id))
      setNotice('Xabarnoma qayta yuborish navbatiga qo‘yildi.')
    } catch (err) {
      setError(err.message || 'Xabarnomani qayta yuborib bo‘lmadi.')
    } finally {
      setBusy(false)
    }
  }

  const changeEvents = history.events.filter((event) => event.event_type === 'created')
  const deliveryByChange = new Map()
  for (const delivery of history.deliveries) {
    const current = deliveryByChange.get(delivery.change_id) || []
    current.push(delivery)
    deliveryByChange.set(delivery.change_id, current)
  }
  const previewMatches = preview?.fingerprint === JSON.stringify(payloadFields())

  return (
    <Modal
      open
      title={`Dars jadvalini o‘zgartirish · ${group.name}`}
      onClose={onClose}
      size="lg"
      actions={(
        <div className="schedule-change-actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>Yopish</button>
          <button type="button" className="btn btn-outline" disabled={busy || reason.trim().length < 3 || !selectedSlot} onClick={updatePreview}>
            {busy ? 'Tekshirilmoqda…' : 'Oldindan ko‘rish'}
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !previewMatches} onClick={save}>
            {busy ? 'Saqlanmoqda…' : 'Saqlash'}
          </button>
        </div>
      )}
    >
      <div className="schedule-change-dialog">
        <div className="schedule-change-tabs" role="tablist" aria-label="O‘zgarish turi">
          <button type="button" className={mode === 'single' ? 'is-active' : ''} onClick={() => changeField(setMode, 'single')}>
            Faqat bir kun uchun
          </button>
          <button type="button" className={mode === 'permanent' ? 'is-active' : ''} onClick={() => changeField(setMode, 'permanent')}>
            Shu sanadan boshlab davomiy
          </button>
        </div>

        <div className="schedule-change-form">
          {mode === 'single' ? (
            <>
              <label>
                <span>Dars sanasi</span>
                <input className="input" type="date" min={today} value={date}
                  onChange={(event) => { changeField(setDate, event.target.value); setSlotId('') }} />
              </label>
              <button type="button" className="btn btn-outline" onClick={() => { changeField(setDate, tomorrow); setSlotId('') }}>
                Ertangi kun
              </button>
              <label>
                <span>Dars</span>
                <select className="input" value={slotId} onChange={(event) => changeField(setSlotId, event.target.value)}>
                  <option value="">Darsni tanlang</option>
                  {slots.map((slot, index) => {
                    const id = String(slot.slotId || `slot-${index}`)
                    return <option key={id} value={id}>{slot.startTime}–{slot.endTime}</option>
                  })}
                </select>
              </label>
              <label>
                <span>Amal</span>
                <select className="input" value={action} onChange={(event) => changeField(setAction, event.target.value)}>
                  <option value="change">Vaqt yoki sanani o‘zgartirish</option>
                  <option value="cancel">Darsni bekor qilish</option>
                </select>
              </label>
              {action === 'change' ? (
                <>
                  <label><span>Yangi sana</span><input className="input" type="date" min={today} value={newDate}
                    onChange={(event) => changeField(setNewDate, event.target.value)} /></label>
                  <label><span>Boshlanish vaqti</span><input className="input" type="time" value={startTime}
                    onChange={(event) => changeField(setStartTime, event.target.value)} /></label>
                  <label><span>Tugash vaqti</span><input className="input" type="time" value={endTime}
                    onChange={(event) => changeField(setEndTime, event.target.value)} /></label>
                </>
              ) : null}
            </>
          ) : (
            <>
              <label><span>O‘zgarish kuchga kiradigan sana</span><input className="input" type="date" min={today}
                value={validFrom} onChange={(event) => { changeField(setValidFrom, event.target.value); setSlotId('') }} /></label>
              <label><span>Jadvaldagi dars</span>
                <select className="input" value={slotId} onChange={(event) => changeField(setSlotId, event.target.value)}>
                  <option value="">Darsni tanlang</option>
                  {schedule.map((slot, index) => {
                    const id = String(slot.slotId || `slot-${index}`)
                    return <option key={id} value={id}>{WEEKDAYS[Number(slot.day) - 1]} · {slot.startTime}–{slot.endTime}</option>
                  })}
                </select>
              </label>
              <label><span>Hafta kuni</span><select className="input" value={day} onChange={(event) => changeField(setDay, Number(event.target.value))}>
                {WEEKDAYS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
              </select></label>
              <label><span>Boshlanish vaqti</span><input className="input" type="time" value={startTime}
                onChange={(event) => changeField(setStartTime, event.target.value)} /></label>
              <label><span>Tugash vaqti</span><input className="input" type="time" value={endTime}
                onChange={(event) => changeField(setEndTime, event.target.value)} /></label>
            </>
          )}
          <label className="schedule-change-reason"><span>Sabab</span>
            <textarea className="input" rows="2" maxLength="500" value={reason}
              onChange={(event) => changeField(setReason, event.target.value)} placeholder="O‘zgarish sababini yozing" />
          </label>
        </div>

        {error ? <p className="schedule-change-error" role="alert">{error}</p> : null}
        {notice ? <p className="schedule-change-notice" role="status">{notice}</p> : null}
        {previewMatches ? (
          <section className="schedule-change-preview" aria-live="polite">
            <h3>Saqlashdan oldingi ko‘rinish</h3>
            <p><strong>Avval:</strong> {lessonSummary(preview.oldLesson)}</p>
            <p><strong>Keyin:</strong> {preview.newLesson?.status === 'cancelled'
              ? 'Dars bekor qilinadi'
              : mode === 'permanent'
                ? `${WEEKDAYS[Number(preview.newLesson?.day) - 1] || '—'} · ${preview.newLesson?.startTime}–${preview.newLesson?.endTime}`
                : `${lessonSummary(preview.newLesson)}${preview.newLesson?.newDate ? ` (ko‘chiriladi)` : ''}`}</p>
            <p>Xabarnoma oluvchilar: <strong>{preview.notificationCount}</strong></p>
            <StatusBadge tone="success">To‘qnashuv aniqlanmadi</StatusBadge>
          </section>
        ) : null}

        <section className="schedule-change-history">
          <h3>O‘zgarishlar tarixi</h3>
          {loadingHistory ? <p>Yuklanmoqda…</p> : changeEvents.length === 0 ? <p>Hozircha o‘zgarish yo‘q.</p> : (
            changeEvents.map((event) => {
              const details = (() => {
                try { return JSON.parse(event.details || '{}') } catch { return {} }
              })()
              const isActive = !details.revertedAt && !history.events.some((item) => item.change_id === event.change_id && item.event_type === 'reverted')
              const deliveries = deliveryByChange.get(event.change_id) || []
              return (
                <article key={event.id} className="schedule-change-history-item">
                  <div><strong>{details.reason || 'Sabab ko‘rsatilmagan'}</strong>
                    <span>{event.actor_name || 'Xodim'} · {new Date(event.created_at).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' })}</span>
                  </div>
                  {isActive && canUndo(user?.role) ? (
                    <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => undo(event.change_id)}>
                      Qaytarish
                    </button>
                  ) : null}
                  {deliveries.map((delivery) => (
                    <div className="schedule-change-delivery" key={delivery.id}>
                      <span>{delivery.recipient_name || 'Foydalanuvchi'} · {delivery.channel === 'telegram' ? 'Telegram' : 'Ilova'}</span>
                      <StatusBadge tone={delivery.status === 'sent' ? 'success' : delivery.status === 'failed' ? 'danger' : 'warning'}>
                        {delivery.status === 'sent' ? 'Yuborildi' : delivery.status === 'failed' ? 'Xato' : delivery.status === 'not_linked' ? 'Ulanmagan' : 'Navbatda'}
                      </StatusBadge>
                      {delivery.status === 'failed' && user?.role !== 'teacher' ? (
                        <button type="button" className="btn btn-outline btn-sm" disabled={busy}
                          onClick={() => resend(delivery.id)}>Qayta yuborish</button>
                      ) : null}
                    </div>
                  ))}
                </article>
              )
            })
          )}
        </section>
      </div>
    </Modal>
  )
}

function canUndo(role) {
  return ['owner', 'reception', 'teacher'].includes(role)
}
