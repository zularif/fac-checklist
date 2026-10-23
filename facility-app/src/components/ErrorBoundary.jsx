import { Component } from 'react'

// In the installed PWA there's no address bar to refresh, so an uncaught
// error would leave the user stuck on a blank screen. This catches it and
// offers a way back.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    // keep a note for debugging; harmless if console isn't open
    console.error('App error:', error)
  }

  reset = () => {
    this.setState({ hasError: false })
    // send the user home and force a fresh render
    window.location.hash = ''
    window.location.assign('/')
  }

  reload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="screen" style={{ textAlign: 'center', paddingTop: 60 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>
            <i className="ti ti-alert-triangle" style={{ color: 'var(--warning)' }} aria-hidden="true" />
          </div>
          <p className="page-title">Something went wrong</p>
          <p className="page-sub">The screen didn't load properly. Tap below to get going again.</p>
          <button className="btn-primary" style={{ maxWidth: 260, margin: '16px auto 8px' }} onClick={this.reload}>
            <i className="ti ti-refresh" aria-hidden="true" />Reload the app
          </button>
          <button className="btn-secondary" style={{ maxWidth: 260, margin: '0 auto' }} onClick={this.reset}>
            <i className="ti ti-home" aria-hidden="true" />Go to home
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
