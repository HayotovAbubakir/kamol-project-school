import { useEffect, useMemo, useRef, useState } from 'react'
import { getEffectiveLesson } from '../../shared/schedule.js'
import { t } from './i18n.js'
import {
  createScheduleChange,
  loadScheduleChangeHistory,
  previewScheduleChange,
  resendScheduleNotification,
  undoScheduleChange,
} from './api.js'

const WEEKDAYS = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba']

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function addDays(date, amount) {
  const result = new Date(`${date}T12:00:00Z`)
  result.setUTCDate(result.getUTCDate() + amount)
  return result.toISOString().slice(0, 10)
}

function dateLabel(value) {
  if (!value) return '—'
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}.${month}.${year}`
}

function deliveryStatusLabel(status) {
  return ({
    queued: t('Navbatda'),
    sending: t('Yuborilmoqda'),
    sent: t('Yuborildi'),
    failed: t('Xato'),
    not_linked: t('Telegram ulanmagan'),
  })[status] || t('Holati noma’lum')
}

function scheduleFor(group, date) {
  const versions = (group.scheduleVersions || [])
    .filter((version) => version.valid_from <= date && (!version.valid_to || date < version.valid_to))
    .sort((left, right) => left.valid_from.localeCompare(right.valid_from))
  const schedule = versions.at(-1)?.schedule || group.schedule || []
  if (Array.isArray(schedule)) return schedule
  try {
    const parsed = JSON.parse(schedule)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export default function ScheduleChangeSheet({ group, role, initialSlotId = '', onClose, onSaved }) {
  const today = todayISO()
  const tomorrow = addDays(today, 1)
  const [mode, setMode] = useState('single')
  const [date, setDate] = useState(tomorrow)
  const [newDate, setNewDate] = useState(tomorrow)
  const [pendingUndoId, setPendingUndoId] = useState('')
  const [validFrom, setValidFrom] = useState(tomorrow)
  const [slotId, setSlotId] = useState(initialSlotId)
  const [action, setAction] = useState('change')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [day, setDay] = useState(1)
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState(null)
  const [history, setHistory] = useState({ events: [], deliveries: [] })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const requestId = useRef(null)

  const schedule = useMemo(() => scheduleFor(group, mode === 'single' ? date : validFrom), [group, mode, date, validFrom])
  const lessons = useMemo(() => getEffectiveLesson(group.id, date, {
    group, versions: group.scheduleVersions || [], overrides: group.scheduleOverrides || [],
  }).filter((lesson) => !['cancelled', 'rescheduled'].includes(lesson.status)), [group, date])
  const slots = mode === 'single' ? lessons : schedule
  const selectedSlot = slots.find((slot, index) => String(slot.slotId || `slot-${index}`) === slotId)

  useEffect(() => {
    let active = true
    loadScheduleChangeHistory(group.id)
      .then((result) => { if (active) setHistory(result) })
      .catch((loadError) => { if (active) setError(loadError.message || t('Tarixni yuklab bo‘lmadi.')) })
      .finally(() => { if (active) setLoadingHistory(false) })
    return () => { active = false }
  }, [group.id])

  useEffect(() => {
    if (!selectedSlot) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStartTime(selectedSlot.startTime || '')
    setEndTime(selectedSlot.endTime || '')
    setDay(Number(selectedSlot.day) || 1)
  }, [selectedSlot])

  const payloadFields = () => ({
    groupId: group.id,
    type: mode === 'single' ? 'single' : 'permanent',
    reason: reason.trim(),
    slotId: String(selectedSlot?.slotId || slotId),
    ...(mode === 'single'
      ? { originalDate: date, action, newDate, startTime, endTime }
      : { validFrom, day, startTime, endTime }),
  })
  const currentFingerprint = JSON.stringify(payloadFields())
  const previewMatches = preview?.fingerprint === currentFingerprint

  function updateField(key, value) {
    const setters = {
      mode: setMode, date: setDate, newDate: setNewDate, validFrom: setValidFrom,
      slotId: setSlotId, action: setAction, startTime: setStartTime, endTime: setEndTime,
      day: setDay, reason: setReason,
    }
    setters[key](value)
    setPreview(null)
    setError('')
    requestId.current = null
  }

  async function checkChange() {
    setBusy(true)
    setError('')
    try {
      const request = { requestId: requestId.current || crypto.randomUUID(), ...payloadFields() }
      requestId.current = request.requestId
      const result = await previewScheduleChange(request)
      setPreview({ ...result, payload: request, fingerprint: currentFingerprint })
    } catch (previewError) {
      setPreview(null)
      setError(previewError.message || t('Jadvalni tekshirib bo‘lmadi.'))
    } finally {
      setBusy(false)
    }
  }

  async function saveChange() {
    if (!previewMatches) {
      setError(t('Avval o‘zgarishni tekshiring.'))
      return
    }
    setBusy(true)
    setError('')
    try {
      await createScheduleChange(preview.payload)
      await onSaved()
      onClose()
    } catch (saveError) {
      setError(saveError.message || t('O‘zgarishni saqlab bo‘lmadi.'))
    } finally {
      setBusy(false)
    }
  }

  async function undo(changeId) {
    setBusy(true)
    setError('')
    try {
      await undoScheduleChange(changeId)
      await onSaved()
      setHistory(await loadScheduleChangeHistory(group.id))
    } catch (undoError) {
      setError(undoError.message || t('O‘zgarishni qaytarib bo‘lmadi.'))
    } finally {
      setBusy(false)
    }
  }

  async function resend(id) {
    setBusy(true)
    setError('')
    try {
      await resendScheduleNotification(id)
      setHistory(await loadScheduleChangeHistory(group.id))
    } catch (resendError) {
      setError(resendError.message || t('Xabarnomani qayta yuborib bo‘lmadi.'))
    } finally {
      setBusy(false)
    }
  }

  const events = history.events.filter((event) => event.event_type === 'created')
  const deliveries = new Map()
  for (const delivery of history.deliveries) {
    const items = deliveries.get(delivery.change_id) || []
    items.push(delivery)
    deliveries.set(delivery.change_id, items)
  }

  return (
    <div className="mini-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="mini-sheet" role="dialog" aria-modal="true" aria-labelledby="mini-schedule-title">
        <div className="mini-sheet-handle" />
        <header className="mini-sheet-header">
          <h2 id="mini-schedule-title">{t('Dars jadvali ·')} {group.name}</h2>
          <button type="button" className="mini-icon-button" aria-label={t('Yopish')} onClick={onClose}>×</button>
        </header>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" className={`mini-secondary min-h-11 rounded-xl p-2 ${mode === 'single' ? 'ring-2 ring-[var(--mini-accent)]' : ''}`}
            onClick={() => updateField('mode', 'single')}>{t('Faqat bir kun')}</button>
          <button type="button" className={`mini-secondary min-h-11 rounded-xl p-2 ${mode === 'permanent' ? 'ring-2 ring-[var(--mini-accent)]' : ''}`}
            onClick={() => updateField('mode', 'permanent')}>{t('Davomiy')}</button>
        </div>
        <div className="mt-3 grid gap-3">
          {mode === 'single' ? (
            <>
              <label className="mini-field"><span>{t('Dars sanasi')}</span><input type="date" min={today} value={date}
                onChange={(event) => { updateField('date', event.target.value); setSlotId('') }} /></label>
              <button type="button" className="mini-secondary min-h-11 rounded-xl px-3" onClick={() => {
                updateField('date', tomorrow)
                setSlotId('')
              }}>{t('Ertangi kun')}</button>
              <label className="mini-field"><span>{t('Dars')}</span><select value={slotId} onChange={(event) => updateField('slotId', event.target.value)}>
                <option value="">{t('Darsni tanlang')}</option>
                {slots.map((slot, index) => <option key={slot.slotId || index} value={slot.slotId || `slot-${index}`}>{slot.startTime}–{slot.endTime}</option>)}
              </select></label>
              <label className="mini-field"><span>{t('Amal')}</span><select value={action} onChange={(event) => updateField('action', event.target.value)}>
                <option value="change">{t('Vaqt yoki sanani o‘zgartirish')}</option><option value="cancel">{t('Darsni bekor qilish')}</option>
              </select></label>
              {action === 'change' && <>
                <label className="mini-field"><span>{t('Yangi sana')}</span><input type="date" min={today} value={newDate} onChange={(event) => updateField('newDate', event.target.value)} /></label>
                <label className="mini-field"><span>{t('Boshlanish vaqti')}</span><input type="time" value={startTime} onChange={(event) => updateField('startTime', event.target.value)} /></label>
                <label className="mini-field"><span>{t('Tugash vaqti')}</span><input type="time" value={endTime} onChange={(event) => updateField('endTime', event.target.value)} /></label>
              </>}
            </>
          ) : <>
            <label className="mini-field"><span>{t('Kuchga kirish sanasi')}</span><input type="date" min={today} value={validFrom} onChange={(event) => { updateField('validFrom', event.target.value); setSlotId('') }} /></label>
            <label className="mini-field"><span>{t('Jadvaldagi dars')}</span><select value={slotId} onChange={(event) => updateField('slotId', event.target.value)}>
              <option value="">{t('Darsni tanlang')}</option>
              {schedule.map((slot, index) => <option key={slot.slotId || index} value={slot.slotId || `slot-${index}`}>{WEEKDAYS[Number(slot.day) - 1]} · {slot.startTime}–{slot.endTime}</option>)}
            </select></label>
            <label className="mini-field"><span>{t('Hafta kuni')}</span><select value={day} onChange={(event) => updateField('day', Number(event.target.value))}>
              {WEEKDAYS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
            </select></label>
            <label className="mini-field"><span>{t('Boshlanish vaqti')}</span><input type="time" value={startTime} onChange={(event) => updateField('startTime', event.target.value)} /></label>
            <label className="mini-field"><span>{t('Tugash vaqti')}</span><input type="time" value={endTime} onChange={(event) => updateField('endTime', event.target.value)} /></label>
          </>}
          <label className="mini-field"><span>{t('Sabab')}</span><textarea rows="2" maxLength="500" value={reason}
            onChange={(event) => updateField('reason', event.target.value)} placeholder={t('O‘zgarish sababini yozing')} /></label>
        </div>

        {error && <p className="mini-error mt-3" role="alert">{error}</p>}
        {previewMatches && (
          <div className="mt-3 rounded-2xl border border-[var(--mini-border)] p-3 text-sm" aria-live="polite">
            <strong>{t('O‘zgarish oldindan ko‘rinishi')}</strong>
            <p className="mt-2 text-[var(--mini-muted)]">Avval: {dateLabel(preview.oldLesson?.date)} · {preview.oldLesson?.startTime}–{preview.oldLesson?.endTime}</p>
            <p className="mt-1 text-[var(--mini-muted)]">Keyin: {preview.newLesson?.status === 'cancelled'
              ? t('Dars bekor qilinadi')
              : `${dateLabel(preview.newLesson?.newDate || preview.newLesson?.date)} · ${preview.newLesson?.startTime}–${preview.newLesson?.endTime}`}</p>
            <p className="mt-1">{t('Xabarnoma oluvchilar:')} <strong>{preview.notificationCount}</strong></p>
            <p className="mt-1 text-xs text-emerald-500">{t('To‘qnashuv aniqlanmadi')}</p>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="mini-secondary min-h-11 flex-1 rounded-xl px-3" onClick={onClose}>{t('Yopish')}</button>
          <button type="button" className="mini-secondary min-h-11 flex-1 rounded-xl px-3"
            disabled={busy || reason.trim().length < 3 || !selectedSlot} onClick={checkChange}>
            {busy ? t('Tekshirilmoqda…') : t('Tekshirish')}
          </button>
          <button type="button" className="mini-action min-h-11 flex-1 rounded-xl px-3 font-bold disabled:opacity-50"
            disabled={busy || !previewMatches} onClick={saveChange}>{busy ? t('Saqlanmoqda…') : t('Saqlash')}</button>
        </div>

        <details className="mt-5">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">{t('O‘zgarishlar tarixi')}</summary>
          {loadingHistory ? <p className="py-2 text-sm text-[var(--mini-muted)]">{t('Yuklanmoqda…')}</p>
            : events.length === 0 ? <p className="py-2 text-sm text-[var(--mini-muted)]">{t('Hozircha o‘zgarish yo‘q.')}</p>
              : events.map((event) => {
                const eventDetails = (() => { try { return JSON.parse(event.details || '{}') } catch { return {} } })()
                const active = !history.events.some((item) => item.change_id === event.change_id && item.event_type === 'reverted')
                return (
                  <article key={event.id} className="border-t border-[var(--mini-border)] py-3 text-sm">
                    <p className="font-semibold">{eventDetails.reason || t('Sabab ko‘rsatilmagan')}</p>
                    <p className="text-xs text-[var(--mini-muted)]">{event.actor_name || t('Xodim')} · {dateLabel(event.created_at)}</p>
                    {active && (pendingUndoId === event.change_id ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label={t('Qaytarishni tasdiqlash')}>
                        <span className="text-xs">{t('O‘quvchilarga yana xabar boradi. Qaytarilsinmi?')}</span>
                        <button type="button" className="mini-danger min-h-11 rounded-xl px-3" disabled={busy}
                          onClick={() => { setPendingUndoId(''); undo(event.change_id) }}>{t('Ha, qaytarish')}</button>
                        <button type="button" className="mini-secondary min-h-11 rounded-xl px-3" disabled={busy}
                          onClick={() => setPendingUndoId('')}>{t('Yo‘q')}</button>
                      </div>
                    ) : <button type="button" className="mini-secondary mt-2 min-h-11 rounded-xl px-3"
                      disabled={busy} onClick={() => setPendingUndoId(event.change_id)}>{t('Qaytarish')}</button>)}
                    {(deliveries.get(event.change_id) || []).map((delivery) => (
                      <div key={delivery.id} className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <span>{delivery.recipient_name} · {delivery.channel === 'telegram' ? t('Telegram') : t('Ilova')} · {deliveryStatusLabel(delivery.status)}</span>
                        {delivery.status === 'failed' && role !== 'teacher' && <button type="button" className="mini-secondary min-h-11 rounded-xl px-3"
                          disabled={busy} onClick={() => resend(delivery.id)}>{t('Qayta yuborish')}</button>}
                      </div>
                    ))}
                  </article>
                )
              })}
        </details>
      </section>
    </div>
  )
}
