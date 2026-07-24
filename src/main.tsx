import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './relationship-polish.css'
import './theme.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const serviceWorkerUrl = new URL('sw.js', document.baseURI)
    void navigator.serviceWorker.register(serviceWorkerUrl, { scope: './' })
  })
}
