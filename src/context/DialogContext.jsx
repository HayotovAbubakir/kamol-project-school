import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '../components/ui'
import { useLanguage } from './LanguageContext'

const DialogContext = createContext(null)

export function DialogProvider({ children }) {
  const { t } = useLanguage()
  const [dialog, setDialog] = useState(null)
  const [waitLeft, setWaitLeft] = useState(0)
  const resolverRef = useRef(null)

  const close = useCallback((result) => {
    resolverRef.current?.(result)
    resolverRef.current = null
    setDialog(null)
    setWaitLeft(0)
  }, [])

  const confirm = useCallback((options = {}) => {
    const {
      title,
      message,
      confirmLabel,
      cancelLabel,
      tone = 'danger',
      delaySeconds = 0,
    } = typeof options === 'string' ? { message: options } : options

    return new Promise((resolve) => {
      resolverRef.current = resolve
      const delay = Math.max(0, Number(delaySeconds) || 0)
      setWaitLeft(delay)
      setDialog({
        kind: 'confirm',
        title: title || t('dialog.confirmTitle'),
        message: message || '',
        confirmLabel: confirmLabel || t('common.delete'),
        cancelLabel: cancelLabel || t('common.cancel'),
        tone,
        delaySeconds: delay,
      })
    })
  }, [t])

  const alert = useCallback((options = {}) => {
    const {
      title,
      message,
      confirmLabel,
      tone = 'default',
    } = typeof options === 'string' ? { message: options } : options

    return new Promise((resolve) => {
      resolverRef.current = resolve
      setWaitLeft(0)
      setDialog({
        kind: 'alert',
        title: title || t('dialog.alertTitle'),
        message: message || '',
        confirmLabel: confirmLabel || t('dialog.ok'),
        tone,
      })
    })
  }, [t])

  useEffect(() => {
    if (!dialog || dialog.kind !== 'confirm' || waitLeft <= 0) return undefined
    const timer = window.setTimeout(() => setWaitLeft((n) => Math.max(0, n - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [dialog, waitLeft])

  const value = useMemo(() => ({ confirm, alert }), [confirm, alert])

  const confirmClass = dialog?.tone === 'danger' ? 'btn btn-danger' : 'btn btn-primary'
  const confirmLocked = dialog?.kind === 'confirm' && waitLeft > 0
  const confirmText = confirmLocked
    ? `${dialog.confirmLabel} (${waitLeft})`
    : dialog?.confirmLabel

  return (
    <DialogContext.Provider value={value}>
      {children}
      <Modal
        open={Boolean(dialog)}
        title={dialog?.title}
        onClose={() => close(dialog?.kind === 'confirm' ? false : true)}
        actions={
          dialog?.kind === 'confirm' ? (
            <>
              <button type="button" className="btn btn-outline" onClick={() => close(false)}>
                {dialog.cancelLabel}
              </button>
              <button
                type="button"
                className={confirmClass}
                disabled={confirmLocked}
                onClick={() => close(true)}
              >
                {confirmText}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => close(true)}>
              {dialog?.confirmLabel}
            </button>
          )
        }
      >
        {dialog?.message ? <p className="dialog-message">{dialog.message}</p> : null}
      </Modal>
    </DialogContext.Provider>
  )
}

export function useDialog() {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useDialog must be used within DialogProvider')
  return ctx
}
