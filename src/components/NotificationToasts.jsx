import { X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useNotifications } from '../context/NotificationContext'

export default function NotificationToasts() {
  const { toasts, dismissToast } = useNotifications()

  return (
    <div className="notif-toast-host" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((item) => {
          const Icon = item.icon
          return (
            <motion.div
              key={item.id}
              className="notif-toast"
              initial={{ opacity: 0, y: -12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={{ duration: 0.2 }}
              role="status"
            >
              <div className="notif-toast-icon">
                {Icon ? <Icon size={16} /> : null}
              </div>
              <div className="notif-toast-body">
                <strong>{item.title}</strong>
                {item.text ? <p>{item.text}</p> : null}
              </div>
              <button
                type="button"
                className="notif-toast-close"
                onClick={() => dismissToast(item.id)}
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
