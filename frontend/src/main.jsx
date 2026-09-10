import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { ThemeProvider } from './theme/ThemeContext.jsx'
import { GlobalStyle } from './theme/GlobalStyle.jsx'
import ErrorBoundary from './components/ui/ErrorBoundary.jsx'

/**
 * Report promise rejections nobody caught.
 *
 * An unhandled rejection is invisible by default: no error boundary sees it,
 * because nothing threw during render. It surfaces only as a console line that
 * does not say which of our code produced it.
 *
 * What this deliberately does NOT do is suppress anything. Browser-extension
 * noise — "Could not establish connection. Receiving end does not exist." — is
 * the usual reason to reach for a handler here, and a handler here cannot
 * touch it: a content script runs in its own isolated world, and its rejections
 * never reach this page's event loop. A listener that appears to swallow them
 * would only be hiding our own.
 */
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  console.error(
    '[khoj] unhandled promise rejection:',
    reason?.name ? `${reason.name}: ${reason.message}` : reason,
    reason?.stack ?? '',
  );
});

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
