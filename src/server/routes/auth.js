const express = require('express');
const { google } = require('googleapis');
const db = require('../db');

const router = express.Router();

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// Start OAuth flow
router.get('/google', (req, res) => {
  const oauth2Client = getOAuth2Client();
  const scopes = [
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ];
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
  });
  res.redirect(url);
});

// OAuth callback
router.get('/google/callback', async (req, res) => {
  const BASE_PATH = process.env.BASE_PATH || '/yt-curator';
  const { code } = req.query;

  if (!code) {
    return res.redirect(BASE_PATH + '?error=no_code');
  }

  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user info
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: profile } = await oauth2.userinfo.get();

    // Find or create user
    let user = db.findUserByGoogleId(profile.id);
    if (user) {
      db.updateUserTokens(user.id, tokens.access_token, tokens.refresh_token);
      user = db.getUserById(user.id);
    } else {
      try {
        user = db.createUser({
          googleId: profile.id,
          email: profile.email,
          displayName: profile.name,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
        });
      } catch (err) {
        if (err.message === 'Maximum number of users reached') {
          return res.redirect(BASE_PATH + '?error=max_users');
        }
        throw err;
      }
    }

    req.session.userId = user.id;
    res.redirect(BASE_PATH);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect(BASE_PATH + '?error=auth_failed');
  }
});

// Check auth status (for frontend)
router.get('/check', (req, res) => {
  if (req.session && req.session.userId) {
    const user = db.getUserById(req.session.userId);
    if (user) {
      return res.json({
        authenticated: true,
        user: {
          displayName: user.display_name,
          email: user.email,
        },
      });
    }
  }
  res.json({ authenticated: false });
});

// Logout
router.get('/logout', (req, res) => {
  const BASE_PATH = process.env.BASE_PATH || '/yt-curator';
  req.session.destroy(() => {
    res.redirect(BASE_PATH);
  });
});

module.exports = router;
