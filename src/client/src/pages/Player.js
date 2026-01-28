import React, { useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { rejectVideo } from '../api';

function Player() {
  const { videoId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isRecommended = searchParams.get('source') === 'recommended';

  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [rejected, setRejected] = useState(false);

  const handleReject = async () => {
    setRejecting(true);
    try {
      await rejectVideo(videoId, rejectReason);
      setRejected(true);
      setShowRejectModal(false);
    } catch (err) {
      alert('Failed to reject: ' + err.message);
    } finally {
      setRejecting(false);
    }
  };

  return (
    <div className="player-page">
      <div className="player-header">
        <button className="back-btn" onClick={() => navigate('/')}>
          &larr; Back
        </button>
        {isRecommended && !rejected && (
          <button className="reject-btn" onClick={() => setShowRejectModal(true)}>
            Not for me
          </button>
        )}
        {rejected && (
          <span style={{ color: '#ff6b6b', fontSize: '0.85rem' }}>Rejected — preferences updated</span>
        )}
      </div>

      <div className="player-embed">
        <iframe
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&origin=${window.location.origin}`}
          title="YouTube video player"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>

      {showRejectModal && (
        <div className="modal-overlay" onClick={() => setShowRejectModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Why isn't this for you?</h3>
            <textarea
              placeholder="Optional: describe what you didn't like (e.g., 'too clickbaity', 'not interested in this topic')"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
            />
            <div className="modal-actions">
              <button className="cancel" onClick={() => setShowRejectModal(false)}>Cancel</button>
              <button className="confirm" onClick={handleReject} disabled={rejecting}>
                {rejecting ? 'Rejecting...' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Player;
