import { createContext, useContext, useState, useCallback } from 'react'

const ToastContext = createContext(null)

let idSeq = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback((message, type = 'info', ms = 5000) => {
    const id = ++idSeq
    setToasts((prev) => [...prev, { id, message, type }])
    if (ms) setTimeout(() => dismiss(id), ms)
    return id
  }, [dismiss])

  // convenience helpers
  const toast = {
    error: (m) => push(m, 'error', 8000),
    success: (m) => push(m, 'success', 4000),
    info: (m) => push(m, 'info', 5000),
  }

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div className={'toast toast-' + t.type} key={t.id} onClick={() => dismiss(t.id)}>
            <i className={'ti ' + (t.type === 'error' ? 'ti-alert-triangle' : t.type === 'success' ? 'ti-check' : 'ti-info-circle')} aria-hidden="true" />
            <span>{t.message}</span>
            <button className="toast-x" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); dismiss(t.id) }}>
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  // Fallback so calling useToast() outside the provider never crashes.
  if (!ctx) return { error: () => {}, success: () => {}, info: () => {} }
  return ctx
}

// Helper: turn an API error into a friendly message.
export function friendlyError(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback
  const msg = error.message || String(error)
  if (/duplicate key/i.test(msg)) return 'That already exists.'
  if (/violates row-level security|permission denied|not authorized/i.test(msg)) return 'You don\u2019t have permission to do that.'
  if (/network|fetch|Failed to fetch/i.test(msg)) return 'Network problem. Check your connection and try again.'
  if (/JWT|token|session/i.test(msg)) return 'Your session expired. Please sign in again.'
  return msg.length < 120 ? msg : fallback
}
