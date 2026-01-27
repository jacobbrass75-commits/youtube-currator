import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getSettings, updateSettings, getRejections } from '../api';

function Settings() {
  const [criteria, setCriteria] = useState('');
  const [originalCriteria, setOriginalCriteria] = useState('');
  const [rejections, setRejections] = useState([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getSettings(), getRejections()])
      .then(([settings, rejData]) => {
        setCriteria(settings.curationCriteria);
        setOriginalCriteria(settings.curationCriteria);
        setRejections(rejData.rejections);
      })
      .catch(() => setMessage({ type: 'error', text: 'Failed to load settings' }))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await updateSettings(criteria);
      setOriginalCriteria(criteria);
      setMessage({ type: 'success', text: 'Curation criteria saved' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading settings...</div>;
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <Link to="/" className="back-btn">&larr; Back</Link>
        <h1>Settings</h1>
      </div>

      {message && (
        <div className={message.type === 'error' ? 'error-msg' : 'success-msg'}>
          {message.text}
        </div>
      )}

      <div className="settings-section">
        <h2>Curation Criteria</h2>
        <label>
          Tell the AI what kind of videos you want to see. This guides your "For You" recommendations.
        </label>
        <textarea
          value={criteria}
          onChange={e => setCriteria(e.target.value)}
        />
        <button
          className="save-btn"
          onClick={handleSave}
          disabled={saving || criteria === originalCriteria}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div className="settings-section">
        <h2>Rejection History</h2>
        {rejections.length === 0 ? (
          <p style={{ color: '#666', fontSize: '0.9rem' }}>
            No rejected videos yet. Use the "Not for me" button on recommended videos to train your preferences.
          </p>
        ) : (
          <ul className="rejection-list">
            {rejections.map((r, i) => (
              <li key={i}>
                <span>{r.video_id}</span>
                {r.rejection_reason && <> — {r.rejection_reason}</>}
                <div style={{ fontSize: '0.75rem', color: '#555' }}>{r.shown_date}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="settings-section">
        <a href="/yt-curator/auth/logout" className="logout-btn">
          Sign Out
        </a>
      </div>
    </div>
  );
}

export default Settings;
