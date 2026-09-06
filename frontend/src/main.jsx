import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { ThemeProvider } from './theme/ThemeContext.jsx'
import { GlobalStyle } from './theme/GlobalStyle.jsx'
import ErrorBoundary from './components/ui/ErrorBoundary.jsx'

// The boundary sits outside ThemeProvider deliberately. Its fallback uses no
// theme and no styled-components, so a failure in the provider itself still
// renders something readable rather than an empty <div id="root">.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary title="Khoj failed to start">
      <ThemeProvider>
        <GlobalStyle />
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
