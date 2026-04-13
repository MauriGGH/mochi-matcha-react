import { useState, useCallback, createContext, useContext } from 'react'

const ToastContext = createContext(null)

export function ToastProvider({ children, staff = false }) {
  const [toasts, setToasts] = useState([])

  const showToast = useCallback((msg, type = '') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, msg, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3200)
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className={`mm-toast-container ${staff ? 'staff-toast' : ''}`}>
        {toasts.map(t => (
          <div key={t.id} className={`mm-toast ${t.type}`}>{t.msg}</div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
