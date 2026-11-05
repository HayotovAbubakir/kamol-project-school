import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import MainApp from './MainApp.jsx'
import './miniapp.css'

createRoot(document.getElementById('miniapp-root')).render(
  <StrictMode>
    <MainApp />
  </StrictMode>,
)
