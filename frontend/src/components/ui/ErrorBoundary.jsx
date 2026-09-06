import { Component } from 'react';

/**
 * Stops one broken component from blanking the entire app.
 *
 * React unmounts the whole tree when a render throws and nothing catches it, so
 * a single `ReferenceError` three components deep leaves an empty <div id="root">
 * and a blank page. The message is in the console, but nothing on screen says so
 * — which is why a crash and a hung dev server look identical to whoever is
 * actually using the thing.
 *
 * To clear a caught error, change the boundary's `key` — `<ErrorBoundary
 * key={tab}>`. A new key mounts a fresh instance with clean state, which is the
 * only race-free way to do it. Comparing a `resetKey` prop across renders is
 * not: a tab change and the error it triggers land in the same commit, React
 * discards the failed render's derived state and re-renders the boundary from
 * the last committed props, so the comparison sees a stale key, clears the
 * error, re-renders the component that just threw, and loops until React gives
 * up and remounts the tree — losing the very state that chose the tab.
 *
 * Deliberately styled with plain inline styles rather than styled-components:
 * this is the last thing standing between an exception and a white page, and it
 * must not depend on a theme provider or a css-in-js runtime that may be the
 * very thing that just failed.
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep the component stack reachable — the fallback shows the message, but
    // the stack is what says which component threw.
    console.error('[khoj] render error:', error, info?.componentStack);
    this.props.onError?.(error, info);
  }

  reset() {
    this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { title = 'Something went wrong' } = this.props;
    // `error` is whatever was thrown, and that need not be an Error at all —
    // a thrown string has no `.message`.
    const message =
      (error && typeof error === 'object' && error.message) || String(error) || 'Unknown error.';

    return (
      <div role="alert" style={styles.wrap}>
        <div style={styles.card}>
          <p style={styles.kicker}>Error</p>
          <h2 style={styles.title}>{title}</h2>
          <p style={styles.body}>
            This section failed to render. The rest of the app is still usable.
          </p>
          <pre style={styles.pre}>{message}</pre>

          {import.meta.env?.DEV && error?.stack && (
            <details style={styles.details}>
              <summary style={styles.summary}>Stack trace</summary>
              <pre style={{ ...styles.pre, marginTop: '0.6rem' }}>{error.stack}</pre>
            </details>
          )}

          <div style={styles.actions}>
            <button type="button" style={styles.button} onClick={this.reset}>
              Try again
            </button>
            <button
              type="button"
              style={{ ...styles.button, ...styles.buttonGhost }}
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}

/* Theme-agnostic on purpose: greys at low alpha read correctly on both the
   light and dark palettes without knowing which one is active. */
const styles = {
  wrap: { padding: '2rem 1.2rem', display: 'flex', justifyContent: 'center' },
  card: {
    maxWidth: '38rem',
    width: '100%',
    border: '1px solid rgba(128, 128, 128, 0.32)',
    borderRadius: '10px',
    background: 'rgba(128, 128, 128, 0.06)',
    padding: '1.6rem 1.5rem',
    color: 'inherit',
    font: 'inherit',
  },
  kicker: {
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: '0.62rem',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    opacity: 0.6,
    margin: '0 0 0.5rem',
  },
  title: { fontSize: '1.05rem', fontWeight: 500, margin: '0 0 0.5rem' },
  body: { fontSize: '0.88rem', lineHeight: 1.6, opacity: 0.75, margin: '0 0 1rem' },
  pre: {
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: '0.75rem',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    background: 'rgba(128, 128, 128, 0.12)',
    borderRadius: '6px',
    padding: '0.7rem 0.8rem',
    margin: 0,
    maxHeight: '16rem',
    overflow: 'auto',
  },
  details: { marginTop: '0.9rem', fontSize: '0.8rem' },
  summary: { cursor: 'pointer', opacity: 0.7 },
  actions: { display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '1.2rem' },
  button: {
    font: 'inherit',
    fontSize: '0.82rem',
    padding: '0.5rem 1rem',
    borderRadius: '999px',
    border: '1px solid rgba(128, 128, 128, 0.4)',
    background: 'rgba(128, 128, 128, 0.14)',
    color: 'inherit',
    cursor: 'pointer',
  },
  buttonGhost: { background: 'transparent' },
};

export default ErrorBoundary;
