import React from 'react';

function Login() {
  const error = new URLSearchParams(window.location.search).get('error');

  return (
    <div className="login-page">
      <h1>YouTube Curator</h1>
      <p>
        Get AI-curated video recommendations based on your subscriptions and preferences.
        No Shorts, no noise — just the content you actually want to watch.
      </p>
      {error === 'max_users' && (
        <div className="error-msg">
          This instance has reached its maximum number of users. Contact the admin.
        </div>
      )}
      {error === 'auth_failed' && (
        <div className="error-msg">
          Authentication failed. Please try again.
        </div>
      )}
      <a href="/yt-curator/auth/google" className="login-btn">
        Sign in with YouTube
      </a>
    </div>
  );
}

export default Login;
