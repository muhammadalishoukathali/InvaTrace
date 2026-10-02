import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Icon } from './Icon'

interface Props { children: ReactNode; resetKey?: string; fallback?: (retry: () => void, err: Error) => ReactNode }
interface State { err: Error | null }

/** Standard React error boundary - catches crashes in whatever subtree it
 *  wraps so one broken component doesn't take down the entire app with a
 *  blank white screen. A route change clears the error; failed module downloads
 *  need a reload because the browser and React.lazy retain their rejection. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null }
  static getDerivedStateFromError(err: Error) { return { err } }
  componentDidCatch(err: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error('[ErrorBoundary]', err, info)
  }
  componentDidUpdate(previous: Props) {
    if (previous.resetKey !== this.props.resetKey && this.state.err) this.setState({ err: null })
  }
  retry = () => {
    if (this.state.err && isModuleDownloadError(this.state.err)) {
      window.location.reload()
      return
    }
    this.setState({ err: null })
  }

  render() {
    if (!this.state.err) return this.props.children
    if (this.props.fallback) return this.props.fallback(this.retry, this.state.err)
    return <DefaultFallback retry={this.retry} />
  }
}

function isModuleDownloadError(err: Error) {
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk .* failed/i.test(err.message)
}

function DefaultFallback({ retry }: { retry: () => void }) {
  return (
    <div role="alert" style={{
      maxWidth: 420, margin: '48px auto', padding: 24, textAlign: 'center',
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--r-card)',
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: '50%', background: 'var(--red-light)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12,
      }}>
        <Icon name="AlertTriangle" size={26} color="var(--red)" />
      </div>
      <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>Something went wrong</h2>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
        This page could not load. Check your connection, then try again or open another page.
      </p>
      <button type="button" onClick={retry} style={{
        marginTop: 16, height: 'var(--h-primary)', padding: '0 20px',
        borderRadius: 'var(--r-button)', border: 'none',
        background: 'var(--green)', color: '#fff', fontWeight: 600,
        fontSize: 14, cursor: 'pointer',
      }}>
        Try again
      </button>
    </div>
  )
}
