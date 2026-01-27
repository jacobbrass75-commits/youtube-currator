require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3001;
const BASE_PATH = process.env.BASE_PATH || '/yt-curator';

// CORS for development (React dev server on port 3000)
if (process.env.NODE_ENV !== 'production') {
  app.use(cors({
    origin: 'http://localhost:3000',
    credentials: true,
  }));
}

// Security headers (relaxed for YouTube embeds)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://www.youtube.com", "https://s.ytimg.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      frameSrc: ["https://www.youtube.com", "https://www.youtube-nocookie.com"],
      imgSrc: ["'self'", "https://i.ytimg.com", "https://yt3.ggpht.com", "https://lh3.googleusercontent.com", "data:"],
      connectSrc: ["'self'"],
    }
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json());

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // set to true if behind HTTPS proxy
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: 'lax',
  }
}));

// Routes
app.use(BASE_PATH + '/auth', authRoutes);
app.use(BASE_PATH + '/api', apiRoutes);

// Serve React build
const clientBuildPath = path.join(__dirname, '..', 'client', 'build');
app.use(BASE_PATH, express.static(clientBuildPath));

// SPA fallback — any unmatched route under BASE_PATH serves index.html
app.get(BASE_PATH + '/*splat', (req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});

// Redirect root to base path
app.get('/', (req, res) => {
  res.redirect(BASE_PATH);
});

// Initialize database then start server
db.initialize();

app.listen(PORT, () => {
  console.log(`YouTube Curator running on port ${PORT} at ${BASE_PATH}`);
});
