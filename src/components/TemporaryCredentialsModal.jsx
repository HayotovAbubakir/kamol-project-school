import { Copy } from 'lucide-react'
import { useState } from 'react'
import { Modal } from './ui'

export default function TemporaryCredentialsModal({ credentials, onClose, subject = 'Foydalanuvchi' }) {
  const [copiedValue, setCopiedValue] = useState('')
  const [copyError, setCopyError] = useState('')
  const value = credentials ? `${credentials.username}\n${credentials.password}` : ''

  const copyCredentials = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedValue(value)
      setCopyError('')
    } catch (error) {
      setCopyError(error.message || 'Nusxalash amalga oshmadi.')
    }
  }

  return (
    <Modal
      open={Boolean(credentials)}
      title={`${subject} kirish ma’lumotlari`}
      onClose={onClose}
      actions={(
        <button type="button" className="btn btn-primary" onClick={onClose}>Tayyor</button>
      )}
    >
      {credentials ? (
        <div className="entity-form">
          <p className="text-sm text-muted">
            Parol faqat hozir ko‘rsatiladi. Nusxalab foydalanuvchiga yetkazing.
          </p>
          <div className="detail-meta-grid">
            <div className="detail-meta-item"><span>Login</span><strong>{credentials.username}</strong></div>
            <div className="detail-meta-item"><span>Vaqtinchalik parol</span><strong>{credentials.password}</strong></div>
          </div>
          {copyError ? <div className="alert alert-error">{copyError}</div> : null}
          <button type="button" className="btn btn-outline btn-sm" onClick={copyCredentials}>
            <Copy size={14} /> {copiedValue === value ? 'Nusxalandi' : 'Login va parolni nusxalash'}
          </button>
        </div>
      ) : null}
    </Modal>
  )
}
