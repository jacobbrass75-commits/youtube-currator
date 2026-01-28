const express = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');
const youtube = require('../services/youtube');
const openai = require('../services/openai');

const router = express.Router();

// All API routes require authentication
router.use(requireAuth);

// Detect YouTube API scope/auth errors and return a clear re-auth message
function isAuthError(err) {
  const msg = err.message || '';
  return msg.includes('insufficient authentication scopes') ||
    msg.includes('Invalid Credentials') ||
    msg.includes('invalid_grant') ||
    (err.code === 401) || (err.code === 403 && msg.includes('forbidden'));
}

function handleApiError(res, err, context) {
  console.error(`${context} error:`, err.message);
  if (isAuthError(err)) {
    return res.status(403).json({
      error: 'YouTube access expired. Please sign out and sign back in.',
      reauth: true,
    });
  }
  res.status(500).json({ error: `Failed to ${context.toLowerCase()}` });
}

// GET /api/subscriptions — Videos from subscriptions, past 7 days, no Shorts
router.get('/subscriptions', async (req, res) => {
  try {
    const videos = await youtube.getSubscriptionVideos(req.user);
    res.json({ videos });
  } catch (err) {
    handleApiError(res, err, 'Subscriptions');
  }
});

// GET /api/recommended — 10 curated videos
router.get('/recommended', async (req, res) => {
  try {
    const candidates = await youtube.getCandidateVideos(req.user);
    const rejectedVideos = db.getRejectedVideos(req.user.id, 20);

    const selectedIds = await openai.curateVideos(
      candidates,
      req.user.curation_criteria,
      rejectedVideos
    );

    const details = await youtube.getVideoDetails(req.user, selectedIds);

    // Record as shown
    db.addShownVideos(req.user.id, selectedIds);

    res.json({ videos: details });
  } catch (err) {
    handleApiError(res, err, 'Recommendations');
  }
});

// POST /api/recommended/refresh — Get 10 new videos (checks daily limit)
router.post('/recommended/refresh', async (req, res) => {
  try {
    const canRefresh = db.incrementRefresh(req.user.id);
    if (!canRefresh) {
      const max = parseInt(process.env.MAX_DAILY_REFRESHES || '5', 10);
      return res.status(429).json({
        error: `Daily refresh limit reached (${max} per day)`,
        refreshesRemaining: 0,
      });
    }

    const candidates = await youtube.getCandidateVideos(req.user);
    const rejectedVideos = db.getRejectedVideos(req.user.id, 20);

    const selectedIds = await openai.curateVideos(
      candidates,
      req.user.curation_criteria,
      rejectedVideos
    );

    const details = await youtube.getVideoDetails(req.user, selectedIds);
    db.addShownVideos(req.user.id, selectedIds);

    const refreshesUsed = db.getRefreshCount(req.user.id);
    const max = parseInt(process.env.MAX_DAILY_REFRESHES || '5', 10);

    res.json({
      videos: details,
      refreshesRemaining: Math.max(0, max - refreshesUsed),
    });
  } catch (err) {
    handleApiError(res, err, 'Refresh');
  }
});

// POST /api/video/:id/reject — Reject video, update criteria
router.post('/video/:id/reject', async (req, res) => {
  try {
    const videoId = req.params.id;
    const { reason } = req.body;

    db.rejectVideo(req.user.id, videoId, reason);

    // Get the video title for context
    let videoTitle = 'Unknown video';
    try {
      const details = await youtube.getVideoDetails(req.user, [videoId]);
      if (details.length > 0) {
        videoTitle = details[0].title;
      }
    } catch (e) {
      // non-critical
    }

    // Update curation criteria using AI
    const updatedCriteria = await openai.suggestCriteriaUpdate(
      req.user.curation_criteria,
      videoTitle,
      reason
    );

    db.updateCurationCriteria(req.user.id, updatedCriteria);

    res.json({
      message: 'Video rejected and preferences updated',
      updatedCriteria,
    });
  } catch (err) {
    handleApiError(res, err, 'Reject');
  }
});

// GET /api/user/settings — Get preferences
router.get('/user/settings', (req, res) => {
  res.json({
    email: req.user.email,
    displayName: req.user.display_name,
    curationCriteria: req.user.curation_criteria,
  });
});

// PUT /api/user/settings — Update curation criteria
router.put('/user/settings', (req, res) => {
  const { curationCriteria } = req.body;
  if (!curationCriteria || typeof curationCriteria !== 'string') {
    return res.status(400).json({ error: 'curationCriteria is required' });
  }
  db.updateCurationCriteria(req.user.id, curationCriteria.trim());
  res.json({ message: 'Settings updated', curationCriteria: curationCriteria.trim() });
});

// GET /api/user/stats — Refreshes remaining today
router.get('/user/stats', (req, res) => {
  const used = db.getRefreshCount(req.user.id);
  const max = parseInt(process.env.MAX_DAILY_REFRESHES || '5', 10);
  res.json({
    refreshesUsed: used,
    refreshesRemaining: Math.max(0, max - used),
    maxDaily: max,
  });
});

// GET /api/user/rejections — Get rejection history
router.get('/user/rejections', (req, res) => {
  const rejections = db.getRejectedVideos(req.user.id, 100);
  res.json({ rejections });
});

module.exports = router;
