import { Camera, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import FaceCapture from './FaceCapture.jsx'
import FaceSyncBadge from './FaceSyncBadge.jsx'
import { faceLabel } from './faceLabels.js'
import { faceApi } from '../../lib/faceApi.js'
import './face.css'

/**
 * Mavjud o‘quvchi uchun Face ID rasmlari: ko‘rish, "Rasm qo‘shish / yangilash", o‘chirish, holat.
 * Ota komponent `key={studentId}` beradi — o‘quvchi almashganda holat yangidan boshlanadi.
 */
export default function FacePhotosPanel({ studentId, labels, confirm, onChanged }) {
  const label = (key, vars) => faceLabel(labels, key, vars)
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [shots, setShots] = useState({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    faceApi.details(studentId)
      .then((data) => { if (alive) setDetails(data) })
      .catch((loadError) => { if (alive) setError(loadError.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [studentId])

  const apply = (data) => {
    setDetails(data)
    onChanged?.(data)
  }

  const save = async () => {
    if (!Object.keys(shots).length) return
    setSaving(true)
    setError('')
    try {
      apply(await faceApi.uploadShots(studentId, shots))
      setOpen(false)
      setShots({})
      setMessage(label('saved'))
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  const removePhoto = async (photo) => {
    const ok = confirm ? await confirm(label('deletePhotoConfirm')) : window.confirm(label('deletePhotoConfirm'))
    if (!ok) return
    setError('')
    try {
      apply(await faceApi.remove(studentId, photo.id))
    } catch (removeError) {
      setError(removeError.message)
    }
  }

  const resync = async () => {
    setError('')
    try {
      apply(await faceApi.resync(studentId))
    } catch (syncError) {
      setError(syncError.message)
    }
  }

  const photos = details?.photos || []

  return (
    <section className="face-panel" aria-label={label('title')}>
      <div className="face-panel-head">
        <strong>{label('title')}</strong>
        {!loading ? <FaceSyncBadge status={details?.sync_status} photos={photos.length} labels={labels} /> : null}
      </div>
      {loading ? <p className="face-panel-muted">…</p> : (
        <>
          {photos.length ? (
            <div className="face-panel-photos">
              {photos.map((photo) => (
                <figure key={photo.id} className="face-panel-photo">
                  <img src={photo.url} alt={label(photo.angle)} loading="lazy" />
                  <figcaption>
                    {label(photo.angle)}
                    <button type="button" className="face-icon-btn" onClick={() => removePhoto(photo)} aria-label={label('delete')} title={label('delete')}>
                      <Trash2 size={14} />
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : <p className="face-panel-muted">{label('noPhotos')}</p>}
          {details?.sync?.some((row) => row.status === 'error') ? (
            <p className="face-capture-error">{details.sync.find((row) => row.status === 'error')?.last_error}</p>
          ) : null}
        </>
      )}
      {error ? <p className="face-capture-error" role="alert">{error}</p> : null}
      {message && !open ? <p className="face-panel-muted" aria-live="polite">{message}</p> : null}
      {open ? (
        <>
          <FaceCapture labels={labels} onChange={setShots} disabled={saving} />
          <div className="face-capture-actions">
            <button type="button" className="face-btn face-btn-primary" onClick={save} disabled={saving || !Object.keys(shots).length}>
              {saving ? label('saving') : label('save')}
            </button>
            <button type="button" className="face-btn" onClick={() => { setOpen(false); setShots({}) }} disabled={saving}>{label('cancel')}</button>
          </div>
        </>
      ) : (
        <div className="face-capture-actions">
          <button type="button" className="face-btn face-btn-primary" onClick={() => { setMessage(''); setOpen(true) }} disabled={loading}>
            <Camera size={16} /> {label('addOrUpdate')}
          </button>
          {details?.sync_status === 'error' ? (
            <button type="button" className="face-btn" onClick={resync}><RefreshCw size={16} /> {label('retry')}</button>
          ) : null}
        </div>
      )}
    </section>
  )
}
