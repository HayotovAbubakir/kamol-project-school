import { Copy, ScanFace } from 'lucide-react'
import { useEffect, useState } from 'react'
import { faceApi } from '../../lib/faceApi.js'
import { formatDate } from '../../lib/utils'
import { useDialog } from '../../context/DialogContext'
import GlassPane from '../GlassPane'
import { useSiteFaceLabels } from './useSiteFaceLabels.js'

function dateTime(value, fallback) {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
  return `${formatDate(value)} ${time}`
}

/** Egasi uchun: Face ID (Hikvision) qurilmalarini qo‘shish, tokenni bir marta ko‘rsatish, holatini ko‘rish. */
export default function FaceDevicesSection() {
  const labels = useSiteFaceLabels()
  const { confirm } = useDialog()
  const [devices, setDevices] = useState([])
  const [form, setForm] = useState({ name: '', serial: '' })
  const [token, setToken] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let alive = true
    faceApi.devices.list()
      .then((rows) => { if (alive) setDevices(rows) })
      .catch((loadError) => { if (alive) setError(loadError.message) })
    return () => { alive = false }
  }, [version])

  const reload = () => setVersion((value) => value + 1)

  const create = async (event) => {
    event.preventDefault()
    if (!form.name.trim()) return
    setBusy(true)
    setError('')
    try {
      const created = await faceApi.devices.create({ name: form.name.trim(), serial: form.serial.trim() })
      setToken({ name: created.name, value: created.token })
      setForm({ name: '', serial: '' })
      reload()
    } catch (createError) {
      setError(createError.message)
    } finally {
      setBusy(false)
    }
  }

  const act = async (device, action) => {
    if (action === 'rotate' && !(await confirm({ message: labels.rotateConfirm(), confirmLabel: labels.rotateToken(), tone: 'danger' }))) return
    if (action === 'delete' && !(await confirm({ message: labels.deleteDeviceConfirm(), confirmLabel: labels.delete(), tone: 'danger' }))) return
    setError('')
    try {
      const result = await faceApi.devices.action(device.id, action)
      if (result?.token) setToken({ name: device.name, value: result.token })
      reload()
    } catch (actionError) {
      setError(actionError.message)
    }
  }

  return (
    <GlassPane className="card wallpaper-card" radius={22}>
      <section className="appearance-section">
        <h2 className="appearance-title appearance-title-with-icon">
          <ScanFace size={18} />
          {labels.devicesTitle()}
        </h2>
        <p className="appearance-hint">{labels.devicesHint()}</p>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {token ? (
          <div className="alert alert-success" role="status">
            <strong>{token.name}</strong>
            <p>{labels.tokenOnce()}</p>
            <code style={{ wordBreak: 'break-all' }}>{token.value}</code>
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => navigator.clipboard?.writeText(token.value)}>
                <Copy size={14} /> {labels.copy()}
              </button>
            </div>
          </div>
        ) : null}

        {devices.length ? (
          <div className="grid gap-2">
            {devices.map((device) => (
              <div key={device.id} className="detail-meta-item">
                <span>{device.name}{device.serial ? ` · ${device.serial}` : ''} · {device.is_active ? labels.active() : labels.inactive()}</span>
                <strong>{labels.lastSeen()}: {dateTime(device.last_seen_at, labels.never())} · {labels.lastEvent()}: {dateTime(device.last_event_at, labels.never())}</strong>
                <span>{labels.syncCounts({ synced: device.synced_count || 0, pending: device.pending_count || 0, errors: device.error_count || 0 })}</span>
                <div className="student-detail-actions">
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => act(device, 'rotate')}>{labels.rotateToken()}</button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => act(device, device.is_active ? 'disable' : 'enable')}>
                    {device.is_active ? labels.disable() : labels.enable()}
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => act(device, 'delete')}>{labels.delete()}</button>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="appearance-hint">{labels.noDevices()}</p>}

        <form className="entity-form account-credentials-form" onSubmit={create}>
          <div className="field">
            <label htmlFor="face-device-name">{labels.deviceName()}</label>
            <input id="face-device-name" className="input" value={form.name} maxLength={80} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </div>
          <div className="field">
            <label htmlFor="face-device-serial">{labels.deviceSerial()}</label>
            <input id="face-device-serial" className="input" value={form.serial} maxLength={80} onChange={(event) => setForm({ ...form, serial: event.target.value })} />
          </div>
          <div className="page-header-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>{labels.addDevice()}</button>
          </div>
        </form>
      </section>
    </GlassPane>
  )
}
