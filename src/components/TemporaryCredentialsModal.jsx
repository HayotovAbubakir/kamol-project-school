import { Copy } from 'lucide-react'
import { useState } from 'react'
import { Modal } from './ui'
import { translate as tr } from '../i18n/runtime'

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
        <button type="button" className="btn btn-primary" onClick={onClose}>{tr('Tayyor')}</button>
      )}
    >
      {credentials ? (
        <div className="entity-form">
          <p className="text-sm text-muted">
           {tr('Parol faqat hozir ko‘rsatiladi. Nusxalab foydalanuvchiga yetkazing.')}
          </p>
          <div className="detail-meta-grid">
            <div className="detail-meta-item"><span>Login</span><strong>{credentials.username}</strong></div>
            <div className="detail-meta-item"><span>{tr('Vaqtinchalik parol')}</span><strong>{credentials.password}</strong></div>
          </div>
          {copyError ? <div className="alert alert-error">{copyError}</div> : null}
          <button type="button" className="btn btn-outline btn-sm" onClick={copyCredentials}>
            <Copy size={14} /> {copiedValue === value ? tr('Nusxalandi') : tr('Login va parolni nusxalash')}
          </button>
        </div>
      ) : null}
    </Modal>
  )
}
