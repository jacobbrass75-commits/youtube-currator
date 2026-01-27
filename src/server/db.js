const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || './data/curator.db';

let db;

function getDb() {
  if (!db) {
    db = new Database(path.resolve(DB_PATH));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initialize() {
  const conn = getDb();

  conn.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      google_id TEXT UNIQUE NOT NULL,
      email TEXT,
      display_name TEXT,
      access_token TEXT,
      refresh_token TEXT,
      curation_criteria TEXT DEFAULT 'Prefer educational, informative, or genuinely entertaining content. Avoid clickbait, drama, reaction content, and anything low-effort.',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS shown_videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      video_id TEXT NOT NULL,
      shown_date DATE DEFAULT (date('now')),
      was_rejected INTEGER DEFAULT 0,
      rejection_reason TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS daily_refreshes (
      user_id INTEGER NOT NULL,
      date DATE NOT NULL,
      refresh_count INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, date),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_shown_videos_user ON shown_videos(user_id);
    CREATE INDEX IF NOT EXISTS idx_shown_videos_video ON shown_videos(video_id);
  `);

  console.log('Database initialized');
}

// -- User helpers --

function findUserByGoogleId(googleId) {
  return getDb().prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);
}

function createUser({ googleId, email, displayName, accessToken, refreshToken }) {
  const maxUsers = parseInt(process.env.MAX_USERS || '5', 10);
  const count = getDb().prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
  if (count >= maxUsers) {
    throw new Error('Maximum number of users reached');
  }
  const result = getDb().prepare(
    'INSERT INTO users (google_id, email, display_name, access_token, refresh_token) VALUES (?, ?, ?, ?, ?)'
  ).run(googleId, email, displayName, accessToken, refreshToken);
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

function updateUserTokens(userId, accessToken, refreshToken) {
  if (refreshToken) {
    getDb().prepare('UPDATE users SET access_token = ?, refresh_token = ? WHERE id = ?')
      .run(accessToken, refreshToken, userId);
  } else {
    getDb().prepare('UPDATE users SET access_token = ? WHERE id = ?')
      .run(accessToken, userId);
  }
}

function getUserById(userId) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

function updateCurationCriteria(userId, criteria) {
  getDb().prepare('UPDATE users SET curation_criteria = ? WHERE id = ?').run(criteria, userId);
}

// -- Shown videos helpers --

function getShownVideoIds(userId) {
  return getDb().prepare(
    'SELECT video_id FROM shown_videos WHERE user_id = ?'
  ).all(userId).map(r => r.video_id);
}

function getRejectedVideos(userId, limit = 50) {
  return getDb().prepare(
    'SELECT video_id, rejection_reason, shown_date FROM shown_videos WHERE user_id = ? AND was_rejected = 1 ORDER BY id DESC LIMIT ?'
  ).all(userId, limit);
}

function addShownVideos(userId, videoIds) {
  const stmt = getDb().prepare(
    'INSERT OR IGNORE INTO shown_videos (user_id, video_id) VALUES (?, ?)'
  );
  const insertMany = getDb().transaction((ids) => {
    for (const vid of ids) {
      stmt.run(userId, vid);
    }
  });
  insertMany(videoIds);
}

function rejectVideo(userId, videoId, reason) {
  // First check if it exists
  const existing = getDb().prepare(
    'SELECT id FROM shown_videos WHERE user_id = ? AND video_id = ?'
  ).get(userId, videoId);

  if (existing) {
    getDb().prepare(
      'UPDATE shown_videos SET was_rejected = 1, rejection_reason = ? WHERE id = ?'
    ).run(reason || null, existing.id);
  } else {
    getDb().prepare(
      'INSERT INTO shown_videos (user_id, video_id, was_rejected, rejection_reason) VALUES (?, ?, 1, ?)'
    ).run(userId, videoId, reason || null);
  }
}

// -- Daily refresh helpers --

function getRefreshCount(userId) {
  const today = new Date().toISOString().split('T')[0];
  const row = getDb().prepare(
    'SELECT refresh_count FROM daily_refreshes WHERE user_id = ? AND date = ?'
  ).get(userId, today);
  return row ? row.refresh_count : 0;
}

function incrementRefresh(userId) {
  const today = new Date().toISOString().split('T')[0];
  const max = parseInt(process.env.MAX_DAILY_REFRESHES || '5', 10);
  const current = getRefreshCount(userId);
  if (current >= max) {
    return false;
  }
  getDb().prepare(
    'INSERT INTO daily_refreshes (user_id, date, refresh_count) VALUES (?, ?, 1) ON CONFLICT(user_id, date) DO UPDATE SET refresh_count = refresh_count + 1'
  ).run(userId, today);
  return true;
}

module.exports = {
  getDb,
  initialize,
  findUserByGoogleId,
  createUser,
  updateUserTokens,
  getUserById,
  updateCurationCriteria,
  getShownVideoIds,
  getRejectedVideos,
  addShownVideos,
  rejectVideo,
  getRefreshCount,
  incrementRefresh,
};
