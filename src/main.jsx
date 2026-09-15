import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { LanguageProvider } from './context/LanguageContext.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { WallpaperProvider } from './context/WallpaperContext.jsx'
import { DialogProvider } from './context/DialogContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <LanguageProvider>
      <ThemeProvider>
        <WallpaperProvider>
          <DialogProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </DialogProvider>
        </WallpaperProvider>
      </ThemeProvider>
    </LanguageProvider>
  </StrictMode>,
)
