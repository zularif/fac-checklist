import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './work.css'
import { OfflineProvider } from './context/OfflineContext'
import App from './App.jsx'
import UpdatePrompt from './components/UpdatePrompt.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { ToastProvider } from './context/ToastContext.jsx'

// After a new deploy, an already-open app may ask for an old file name that no
// longer exists. Reload once to pick up the new version instead of failing.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  try {
    const last = Number(sessionStorage.getItem('reload-after-deploy') || 0)
    if (Date.now() - last < 30000) return // avoid a reload loop
    sessionStorage.setItem('reload-after-deploy', String(Date.now()))
  } catch { /* storage blocked */ }
  window.location.reload()
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <OfflineProvider><App /><UpdatePrompt /></OfflineProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
)
