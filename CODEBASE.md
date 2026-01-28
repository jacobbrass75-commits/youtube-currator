# YouTube Curator - Internal Codebase Documentation

> AI-powered Progressive Web App for curated YouTube video recommendations.
> Last updated after commit `b467c4d`.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Environment Variables](#environment-variables)
3. [Project Structure](#project-structure)
4. [Server Stack](#server-stack)
5. [Client Stack](#client-stack)
6. [Database Schema](#database-schema)
7. [API Reference](#api-reference)
8. [Architecture & Data Flows](#architecture--data-flows)
9. [Key Technologies](#key-technologies)
10. [Deployment](#deployment)

---

## Project Overview

YouTube Curator combines the YouTube Data API v3 with OpenAI's GPT-4o-mini to deliver personalized video recommendations. Users sign in with Google, and the app pulls videos from their subscriptions and trending content. An AI model selects the 10 best matches based on user-defined curation criteria. Users can reject videos with feedback, which triggers AI-driven preference updates.

**Key constraints:**
- Max 50 subscription videos returned (most recent across all channels)
- Max 5 users (configurable)
- Max 5 daily refreshes per user (configurable)
- Videos under 60 seconds (Shorts) are automatically filtered out
- Subscription lookback: 7 days (configurable)

---

## Environment Variables

Defined in `.env`, template in `.env.example`:

| Variable | Default | Purpose |
|----------|---------|---------|
| `GOOGLE_CLIENT_ID` | — | Google OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | — | Google OAuth 2.0 Client Secret |
| `GOOGLE_REDIRECT_URI` | — | OAuth callback URL (must match Google Console) |
| `OPENAI_API_KEY` | — | OpenAI API key for GPT-4o-mini |
| `SESSION_SECRET` | `change-me-in-production` | Express session signing secret |
| `DATABASE_PATH` | `./data/curator.db` | SQLite database file path |
| `MAX_USERS` | `5` | Maximum registered users |
| `MAX_DAILY_REFRESHES` | `5` | Refresh limit per user per day |
| `SUBSCRIPTION_DAYS` | `7` | Days to look back for subscription videos |
| `PORT` | `3001` | Server port |
| `BASE_PATH` | `/yt-curator` | URL base path for all routes |

---

## Project Structure

```
youtube-curator/
├── package.json                    # Root deps: express, better-sqlite3, googleapis, openai, helmet, cors
├── .env                            # Environment variables (gitignored)
├── .env.example                    # Environment template
├── .gitignore
├── CODEBASE.md                     # This file
├── data/
│   └── curator.db                  # SQLite database (gitignored)
└── src/
    ├── server/
    │   ├── index.js                # Express entry point (80 lines)
    │   ├── db.js                   # Database layer (174 lines)
    │   ├── middleware/
    │   │   └── auth.js             # requireAuth middleware (16 lines)
    │   ├── routes/
    │   │   ├── auth.js             # OAuth routes (105 lines)
    │   │   └── api.js              # API routes + error handling (175 lines)
    │   └── services/
    │       ├── youtube.js          # YouTube API wrapper (301 lines)
    │       └── openai.js           # OpenAI curation (105 lines)
    └── client/
        ├── package.json            # React deps, proxy config
        ├── public/
        │   ├── index.html          # HTML entry point
        │   ├── manifest.json       # PWA manifest
        │   ├── sw.js               # Service worker
        │   ├── favicon.ico
        │   ├── logo192.png
        │   └── logo512.png
        ├── src/
        │   ├── index.js            # React mount + ErrorBoundary + SW registration
        │   ├── App.js              # Router + auth state (42 lines)
        │   ├── App.css             # All styles (461 lines)
        │   ├── App.test.js         # Basic render test
        │   ├── api.js              # API client wrapper (61 lines)
        │   ├── ErrorBoundary.js    # Crash recovery component (37 lines)
        │   └── pages/
        │       ├── Login.js        # Sign-in page (31 lines)
        │       ├── Home.js         # Subscriptions + recommendations (129 lines)
        │       ├── Player.js       # Video embed + reject modal (77 lines)
        │       └── Settings.js     # Criteria editor + rejection history (102 lines)
        └── build/                  # Production build output (gitignored)
```

---

## Server Stack

### Entry Point — `src/server/index.js`

Initializes Express on `PORT` with:
- **CORS** — Enabled in dev mode only (origin: `http://localhost:3000`, credentials: true)
- **Helmet** — Security headers with relaxed CSP for YouTube embeds. HSTS and `upgrade-insecure-requests` disabled (server runs on HTTP)
- **express-session** — 7-day cookies, httpOnly, sameSite=lax
- **Static serving** — React build at `BASE_PATH`, SPA fallback to `index.html`
- **Root redirect** — `GET /` redirects to `BASE_PATH`

### Database — `src/server/db.js`

SQLite via `better-sqlite3` (synchronous). WAL mode and foreign keys enabled.

**Exported functions:**

| Function | Purpose |
|----------|---------|
| `initialize()` | Creates tables and indexes |
| `findUserByGoogleId(googleId)` | Lookup user by Google ID |
| `createUser({googleId, email, displayName, accessToken, refreshToken})` | Register new user (enforces MAX_USERS) |
| `updateUserTokens(userId, accessToken, refreshToken)` | Update OAuth tokens |
| `getUserById(userId)` | Fetch user by internal ID |
| `updateCurationCriteria(userId, criteria)` | Save curation preferences |
| `getShownVideoIds(userId)` | All shown video IDs for a user |
| `getRejectedVideos(userId, limit)` | Rejected videos with reasons |
| `addShownVideos(userId, videoIds)` | Batch-insert shown videos (transaction) |
| `rejectVideo(userId, videoId, reason)` | Mark video rejected (insert or update) |
| `getRefreshCount(userId)` | Today's refresh count |
| `incrementRefresh(userId)` | Increment counter (returns false if limit hit) |

### Auth Middleware — `src/server/middleware/auth.js`

`requireAuth` checks `req.session.userId`, fetches the user from DB, attaches to `req.user`, or returns 401.

### YouTube Service — `src/server/services/youtube.js`

| Function | Purpose |
|----------|---------|
| `getSubscriptionVideos(user)` | Fetch recent videos from subscribed channels (up to 100 channels, past N days, no Shorts, max 50 results). Fetches playlists in parallel batches of 10 with early exit once enough candidates collected. |
| `getCandidateVideos(user)` | Wider candidate pool: subscriptions (150 channels, 5 videos each) + 50 trending videos, deduplicated, minus already-shown, minus Shorts. Parallel playlist fetches in batches of 10. |
| `getVideoDetails(user, videoIds)` | Full metadata for video IDs (batched 50/request) |

Internal helpers:
- `getAuthClient(user)` — Creates OAuth2 client with auto token refresh (listens to `tokens` event, updates DB)
- `filterOutShorts(youtube, videos)` — Removes videos < 60 seconds via `contentDetails.duration`
- `parseDuration(iso)` — Converts ISO 8601 duration (PT1H2M3S) to seconds (null-safe)

### OpenAI Service — `src/server/services/openai.js`

| Function | Parameters | Model | Temp |
|----------|-----------|-------|------|
| `curateVideos(candidates, criteria, rejectedVideos)` | Candidate list + user prefs + rejection context | GPT-4o-mini | 0.7 |
| `suggestCriteriaUpdate(criteria, title, reason)` | Current criteria + rejected video title + reason | GPT-4o-mini | 0.5 |

`curateVideos` returns exactly 10 video IDs (pads with remaining candidates if AI returns fewer). Falls back to first 10 candidates on error.

`suggestCriteriaUpdate` returns rewritten criteria (2-3 sentences). Falls back to unchanged criteria on error.

---

## Client Stack

### Entry — `src/client/src/index.js`

Mounts `<App />` inside `<ErrorBoundary>` and `<React.StrictMode>`. Registers service worker at `/yt-curator/sw.js`.

### Router — `src/client/src/App.js`

| Route | Component | Auth Required |
|-------|-----------|---------------|
| `/` | `Home` or `Login` | Conditional |
| `/watch/:videoId` | `Player` | Yes |
| `/settings` | `Settings` | Yes |
| `*` | Redirect to `/` | — |

On mount, calls `checkAuth()`. Shows `Loading...` while checking. Uses `BrowserRouter` with `basename="/yt-curator"`.

### API Client — `src/client/src/api.js`

All functions use `fetchJSON()` which prepends `/yt-curator`, sets `credentials: 'same-origin'`, and redirects to login on 401.

| Function | Endpoint | Method |
|----------|----------|--------|
| `checkAuth()` | `/auth/check` | GET |
| `getSubscriptions()` | `/api/subscriptions` | GET |
| `getRecommended()` | `/api/recommended` | GET |
| `refreshRecommended()` | `/api/recommended/refresh` | POST |
| `rejectVideo(videoId, reason)` | `/api/video/:id/reject` | POST |
| `getSettings()` | `/api/user/settings` | GET |
| `updateSettings(curationCriteria)` | `/api/user/settings` | PUT |
| `getStats()` | `/api/user/stats` | GET |
| `getRejections()` | `/api/user/rejections` | GET |

### Pages

**Login.js** — Sign-in page with YouTube auth link. Shows error messages for `?error=max_users` or `?error=auth_failed`.

**Home.js** — Two sections: "From Your Subscriptions" (video grid) and "For You" (AI recommendations with refresh button showing remaining count). Uses `timeAgo()` for relative timestamps.

**Player.js** — YouTube embed via `youtube-nocookie.com` (autoplay, no related videos). "Not for me" button appears only for recommended videos (`?source=recommended`). Opens rejection modal with optional reason textarea.

**Settings.js** — Textarea for curation criteria (save disabled when unchanged). Rejection history list. Sign-out link.

**ErrorBoundary.js** — Class component catching render errors. Shows "Something went wrong" with reload button.

### Service Worker — `src/client/public/sw.js`

- Cache name: `yt-curator-v1`
- Precaches: `index.html` and `/yt-curator/`
- Skips caching for `/api/` and `/auth/` routes
- Network-first strategy: caches successful responses, falls back to cache or index.html offline

### Styles — `src/client/src/App.css`

Dark YouTube-inspired theme (`#0f0f0f` background, `#f1f1f1` text). Key classes:

| Class | Purpose |
|-------|---------|
| `.video-grid` | CSS Grid, auto-fill, min 280px columns |
| `.video-card` | Card with hover lift effect, 16:9 thumbnail |
| `.player-embed` | 16:9 iframe container |
| `.modal-overlay` | Fixed fullscreen overlay (z-index 100) |
| `.modal` | Centered dialog |
| `.error-msg` / `.success-msg` | Red/green notification banners |
| `.refresh-btn` | Pill-shaped button with disabled state |
| `.reject-btn` | Dark red button |

Responsive: single-column grid below 600px.

---

## Database Schema

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_id TEXT UNIQUE NOT NULL,
  email TEXT,
  display_name TEXT,
  access_token TEXT,
  refresh_token TEXT,
  curation_criteria TEXT DEFAULT 'Prefer educational, informative, or genuinely entertaining content. Avoid clickbait, drama, reaction content, and anything low-effort.',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE shown_videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  video_id TEXT NOT NULL,
  shown_date DATE DEFAULT (date('now')),
  was_rejected INTEGER DEFAULT 0,
  rejection_reason TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE daily_refreshes (
  user_id INTEGER NOT NULL,
  date DATE NOT NULL,
  refresh_count INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, date),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_shown_videos_user ON shown_videos(user_id);
CREATE INDEX idx_shown_videos_video ON shown_videos(video_id);
```

---

## API Reference

### Authentication Routes (prefix: `/yt-curator/auth`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/google` | Redirect to Google OAuth consent | No |
| GET | `/google/callback` | OAuth callback, creates/updates user, sets session | No |
| GET | `/check` | Returns `{ authenticated, user }` | No |
| GET | `/logout` | Destroys session, redirects | No |

### API Routes (prefix: `/yt-curator/api`, all require auth)

| Method | Path | Description | Returns |
|--------|------|-------------|---------|
| GET | `/subscriptions` | Recent subscription videos | `{ videos }` |
| GET | `/recommended` | 10 AI-curated videos | `{ videos }` |
| POST | `/recommended/refresh` | New batch (daily limit) | `{ videos, refreshesRemaining }` |
| POST | `/video/:id/reject` | Reject + AI criteria update | `{ message, updatedCriteria }` |
| GET | `/user/settings` | User preferences | `{ email, displayName, curationCriteria }` |
| PUT | `/user/settings` | Update criteria | `{ message, curationCriteria }` |
| GET | `/user/stats` | Refresh counts | `{ refreshesUsed, refreshesRemaining, maxDaily }` |
| GET | `/user/rejections` | Rejection history (100 max) | `{ rejections }` |

**Error responses:** `{ error: "message" }` with appropriate HTTP status codes (400, 401, 403, 429, 500).

YouTube scope/auth errors return `403` with `{ error: "YouTube access expired. Please sign out and sign back in.", reauth: true }` so the frontend can prompt re-authentication.

---

## Architecture & Data Flows

### Video Recommendation Flow

```
User clicks "Refresh" (Home.js)
  |
  v
POST /api/recommended/refresh
  |
  v
db.incrementRefresh() --- returns false if daily limit hit (429)
  |
  v
youtube.getCandidateVideos(user)
  |- Fetch subscriptions (3 pages x 50 = up to 150 channels)
  |- Get upload playlists for each channel
  |- Fetch recent videos (5 per channel, parallel batches of 10)
  |- Fetch 50 trending videos
  |- Deduplicate by videoId
  |- Remove already-shown videos
  |- Filter out Shorts (< 60 seconds)
  |
  v
openai.curateVideos(candidates, criteria, rejectedVideos)
  |- Constructs prompt with user criteria + candidate list + rejection context
  |- GPT-4o-mini selects 10 best video IDs
  |- Validates IDs exist in candidates, pads if needed
  |
  v
youtube.getVideoDetails(user, selectedIds)
  |- Batch-fetches full metadata (title, channel, description, thumbnail, duration, views)
  |
  v
db.addShownVideos(user.id, selectedIds)
  |
  v
Response: { videos: [...], refreshesRemaining: N }
```

### Rejection & Criteria Update Flow

```
User clicks "Not for me" on Player.js
  |
  v
Modal opens --- user optionally types reason
  |
  v
POST /api/video/:id/reject { reason }
  |
  v
db.rejectVideo(user.id, videoId, reason)
  |
  v
youtube.getVideoDetails(user, [videoId]) --- fetches title for AI context
  |
  v
openai.suggestCriteriaUpdate(currentCriteria, videoTitle, reason)
  |- GPT-4o-mini rewrites criteria (2-3 sentences)
  |
  v
db.updateCurationCriteria(user.id, updatedCriteria)
  |
  v
Response: { message, updatedCriteria }
Player.js shows "Rejected - preferences updated"
```

### Authentication Flow

```
Login.js --- user clicks "Sign in with YouTube"
  |
  v
GET /auth/google --- redirects to Google OAuth consent
  (scopes: youtube.readonly, userinfo.email, userinfo.profile)
  (access_type: offline, prompt: consent)
  |
  v
Google callback: GET /auth/google/callback?code=...
  |- Exchange code for tokens (access_token + refresh_token)
  |- Fetch user profile (email, name, google_id)
  |- Find or create user (createUser enforces MAX_USERS)
  |- Update tokens if existing user
  |- Set req.session.userId
  |- Redirect to BASE_PATH
  |
  v
App.js on mount: checkAuth()
  |- GET /auth/check
  |- Returns { authenticated: true, user: { displayName, email } }
  |- Routes render Home instead of Login
```

---

## Key Technologies

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Runtime | Node.js | — | Server runtime |
| Framework | Express | 5.2.1 | HTTP server, routing, middleware |
| Database | better-sqlite3 | 12.6.2 | Synchronous SQLite with WAL mode |
| Auth | googleapis | 170.1.0 | Google OAuth 2.0 + YouTube Data API v3 |
| AI | openai | 6.16.0 | GPT-4o-mini for curation + criteria updates |
| Security | helmet | 8.1.0 | HTTP security headers |
| Frontend | React | 19.2.4 | UI components and state |
| Routing | react-router-dom | 7.13.0 | Client-side SPA routing |
| Build | react-scripts (CRA) | 5.0.1 | Webpack build pipeline |
| PWA | Service Worker | — | Offline caching, installability |
| Process | pm2 | — | Process management, auto-restart |

---

## Deployment

### Running in Production

```bash
# Build client
npm run build

# Start with pm2
pm2 start src/server/index.js --name youtube-curator --cwd /root/youtube-curator
pm2 save
pm2 startup   # enables auto-restart on reboot
```

### pm2 Commands

```bash
pm2 status                      # Process status
pm2 logs youtube-curator        # View logs
pm2 restart youtube-curator     # Restart
pm2 stop youtube-curator        # Stop
pm2 delete youtube-curator      # Remove from pm2
```

### Notes

- Server runs on HTTP. If placing behind an HTTPS reverse proxy, set `cookie.secure: true` in session config and re-enable HSTS in Helmet.
- `BASE_PATH` (`/yt-curator`) is used by both server routes and client routing (`homepage` in client `package.json` and `BrowserRouter basename`).
- Dev mode: `npm run dev` runs Express (port 3001) + React dev server (port 3000) concurrently. Client `proxy` field forwards API calls to Express.
- SQLite database lives at `DATABASE_PATH` (default `./data/curator.db`). WAL files (`-shm`, `-wal`) are co-located and gitignored.
