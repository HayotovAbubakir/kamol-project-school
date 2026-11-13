import { faceLabel } from './faceLabels.js'
import './face.css'

const STATUS = {
  synced: ['statusSynced', 'is-synced'],
  pending: ['statusPending', 'is-pending'],
  error: ['statusError', 'is-error'],
}

/** Face ID sinxronlash holati: yuklandi / navbatda / xato / rasm yo‘q / qurilma yo‘q. */
export default function FaceSyncBadge({ status, photos = 0, labels }) {
  const [key, tone] = !photos ? ['noPhotos', 'is-muted'] : STATUS[status] || ['noDevice', 'is-muted']
  return <span className={`face-badge ${tone}`}>{faceLabel(labels, key)}</span>
}
