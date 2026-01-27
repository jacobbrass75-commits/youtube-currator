import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('App error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#f1f1f1', padding: '2rem', textAlign: 'center' }}>
          <h1 style={{ marginBottom: '1rem' }}>Something went wrong</h1>
          <p style={{ color: '#aaa', marginBottom: '1.5rem' }}>The app encountered an unexpected error.</p>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '0.6rem 1.5rem', background: '#ff0000', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1rem', cursor: 'pointer' }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
