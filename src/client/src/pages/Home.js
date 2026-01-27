import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getSubscriptions, getRecommended, refreshRecommended, getStats } from '../api';

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function Home({ user }) {
  const [subVideos, setSubVideos] = useState([]);
  const [recVideos, setRecVideos] = useState([]);
  const [stats, setStats] = useState(null);
  const [loadingSubs, setLoadingSubs] = useState(true);
  const [loadingRecs, setLoadingRecs] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const loadStats = useCallback(() => {
    getStats().then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    getSubscriptions()
      .then(data => setSubVideos(data.videos))
      .catch(err => setError(err.message))
      .finally(() => setLoadingSubs(false));

    getRecommended()
      .then(data => setRecVideos(data.videos))
      .catch(err => setError(err.message))
      .finally(() => setLoadingRecs(false));

    loadStats();
  }, [loadStats]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const data = await refreshRecommended();
      setRecVideos(data.videos);
      setStats(prev => prev ? { ...prev, refreshesRemaining: data.refreshesRemaining } : prev);
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
      loadStats();
    }
  };

  return (
    <div className="home-page">
      <header className="home-header">
        <h1>YouTube Curator</h1>
        <div className="header-actions">
          {user && <span style={{ color: '#aaa', fontSize: '0.85rem' }}>{user.displayName}</span>}
          <Link to="/settings" className="settings-link">Settings</Link>
        </div>
      </header>

      {error && <div className="error-msg">{error}</div>}

      {/* Subscriptions Section */}
      <div className="section-header">
        <h2>From Your Subscriptions</h2>
      </div>
      {loadingSubs ? (
        <div className="empty-state">Loading subscriptions...</div>
      ) : subVideos.length === 0 ? (
        <div className="empty-state">No recent videos from your subscriptions.</div>
      ) : (
        <div className="video-grid">
          {subVideos.map(video => (
            <Link to={`/watch/${video.videoId}`} className="video-card" key={video.videoId}>
              <img src={video.thumbnail} alt={video.title} loading="lazy" />
              <div className="video-info">
                <h3>{video.title}</h3>
                <div className="channel">{video.channelTitle}</div>
                <div className="meta">{timeAgo(video.publishedAt)}</div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Recommended Section */}
      <div className="section-header">
        <h2>For You</h2>
        <button
          className="refresh-btn"
          onClick={handleRefresh}
          disabled={refreshing || (stats && stats.refreshesRemaining <= 0)}
        >
          {refreshing ? 'Refreshing...' : `Refresh${stats ? ` (${stats.refreshesRemaining} left)` : ''}`}
        </button>
      </div>
      {loadingRecs ? (
        <div className="empty-state">Curating recommendations...</div>
      ) : recVideos.length === 0 ? (
        <div className="empty-state">No recommendations available.</div>
      ) : (
        <div className="video-grid">
          {recVideos.map(video => (
            <Link
              to={`/watch/${video.videoId}?source=recommended`}
              className="video-card"
              key={video.videoId}
            >
              <img src={video.thumbnail} alt={video.title} loading="lazy" />
              <div className="video-info">
                <h3>{video.title}</h3>
                <div className="channel">{video.channelTitle}</div>
                <div className="meta">{timeAgo(video.publishedAt)}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default Home;
