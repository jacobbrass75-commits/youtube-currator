const { google } = require('googleapis');
const db = require('../db');

function getAuthClient(user) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials({
    access_token: user.access_token,
    refresh_token: user.refresh_token,
  });

  // Handle token refresh
  oauth2Client.on('tokens', (tokens) => {
    db.updateUserTokens(user.id, tokens.access_token, tokens.refresh_token);
  });

  return oauth2Client;
}

/**
 * Fetch subscription videos from the past N days (no Shorts).
 * Returns at most 50 videos, sorted by date descending.
 */
async function getSubscriptionVideos(user) {
  const MAX_VIDEOS = 50;
  const auth = getAuthClient(user);
  const youtube = google.youtube({ version: 'v3', auth });
  const days = parseInt(process.env.SUBSCRIPTION_DAYS || '7', 10);
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Step 1: Get user's subscriptions (max 2 pages = 100 channels)
  let subscriptions = [];
  let pageToken = undefined;
  for (let i = 0; i < 2; i++) {
    const resp = await youtube.subscriptions.list({
      part: 'snippet',
      mine: true,
      maxResults: 50,
      pageToken,
    });
    subscriptions.push(...resp.data.items);
    pageToken = resp.data.nextPageToken;
    if (!pageToken) break;
  }

  // Step 2: Get channelIds → uploads playlistIds
  const channelIds = subscriptions.map(s => s.snippet.resourceId.channelId);
  const uploadPlaylists = [];

  // Batch channel lookups (50 per request)
  for (let i = 0; i < channelIds.length; i += 50) {
    const batch = channelIds.slice(i, i + 50);
    const resp = await youtube.channels.list({
      part: 'contentDetails',
      id: batch.join(','),
      maxResults: 50,
    });
    for (const ch of resp.data.items) {
      uploadPlaylists.push(ch.contentDetails.relatedPlaylists.uploads);
    }
  }

  // Step 3: Get recent videos (parallel batches of 10, stop early when we have enough)
  const videos = [];
  for (let i = 0; i < uploadPlaylists.length; i += 10) {
    const batch = uploadPlaylists.slice(i, i + 10);
    const results = await Promise.allSettled(
      batch.map(playlistId =>
        youtube.playlistItems.list({
          part: 'snippet',
          playlistId,
          maxResults: 5,
        })
      )
    );
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      for (const item of result.value.data.items) {
        const publishedAt = new Date(item.snippet.publishedAt);
        if (publishedAt >= since) {
          videos.push({
            videoId: item.snippet.resourceId.videoId,
            title: item.snippet.title,
            channelTitle: item.snippet.channelTitle,
            thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
            publishedAt: item.snippet.publishedAt,
          });
        }
      }
    }
    // Stop fetching once we have plenty of candidates (need buffer for Shorts filtering)
    if (videos.length >= MAX_VIDEOS * 2) break;
  }

  // Step 4: Filter out Shorts by checking video durations
  const filtered = await filterOutShorts(youtube, videos);

  // Sort by date descending and cap at MAX_VIDEOS
  filtered.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  return filtered.slice(0, MAX_VIDEOS);
}

/**
 * Get candidate videos for AI curation — pulls from trending/popular and subscription-adjacent content.
 */
async function getCandidateVideos(user) {
  const auth = getAuthClient(user);
  const youtube = google.youtube({ version: 'v3', auth });

  const candidates = [];

  // Get a wider set of videos from subscriptions (more channels, more videos)
  const days = parseInt(process.env.SUBSCRIPTION_DAYS || '7', 10);
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Get subscriptions
  let subscriptions = [];
  let pageToken = undefined;
  for (let i = 0; i < 3; i++) {
    const resp = await youtube.subscriptions.list({
      part: 'snippet',
      mine: true,
      maxResults: 50,
      pageToken,
    });
    subscriptions.push(...resp.data.items);
    pageToken = resp.data.nextPageToken;
    if (!pageToken) break;
  }

  const channelIds = subscriptions.map(s => s.snippet.resourceId.channelId);

  // Get uploads playlists
  const uploadPlaylists = [];
  for (let i = 0; i < channelIds.length; i += 50) {
    const batch = channelIds.slice(i, i + 50);
    const resp = await youtube.channels.list({
      part: 'contentDetails',
      id: batch.join(','),
      maxResults: 50,
    });
    for (const ch of resp.data.items) {
      uploadPlaylists.push(ch.contentDetails.relatedPlaylists.uploads);
    }
  }

  // Get recent videos (parallel, batches of 10)
  for (let i = 0; i < uploadPlaylists.length; i += 10) {
    const batch = uploadPlaylists.slice(i, i + 10);
    const results = await Promise.allSettled(
      batch.map(playlistId =>
        youtube.playlistItems.list({
          part: 'snippet',
          playlistId,
          maxResults: 5,
        })
      )
    );
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      for (const item of result.value.data.items) {
        const publishedAt = new Date(item.snippet.publishedAt);
        if (publishedAt >= since) {
          candidates.push({
            videoId: item.snippet.resourceId.videoId,
            title: item.snippet.title,
            channelTitle: item.snippet.channelTitle,
            description: item.snippet.description?.substring(0, 200) || '',
            thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
            publishedAt: item.snippet.publishedAt,
          });
        }
      }
    }
  }

  // Also pull some popular/trending videos via search
  try {
    const resp = await youtube.videos.list({
      part: 'snippet,contentDetails',
      chart: 'mostPopular',
      regionCode: 'US',
      maxResults: 50,
    });
    for (const item of resp.data.items) {
      const duration = parseDuration(item.contentDetails.duration);
      if (duration >= 60) {
        candidates.push({
          videoId: item.id,
          title: item.snippet.title,
          channelTitle: item.snippet.channelTitle,
          description: item.snippet.description?.substring(0, 200) || '',
          thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
          publishedAt: item.snippet.publishedAt,
        });
      }
    }
  } catch (err) {
    console.warn('Error fetching trending:', err.message);
  }

  // Deduplicate by videoId
  const seen = new Set();
  const unique = [];
  for (const v of candidates) {
    if (!seen.has(v.videoId)) {
      seen.add(v.videoId);
      unique.push(v);
    }
  }

  // Filter out already-shown videos
  const shownIds = new Set(db.getShownVideoIds(user.id));
  const fresh = unique.filter(v => !shownIds.has(v.videoId));

  // Filter out Shorts
  const auth2 = getAuthClient(user);
  const yt2 = google.youtube({ version: 'v3', auth: auth2 });
  const filtered = await filterOutShorts(yt2, fresh);

  return filtered;
}

/**
 * Get full video details by IDs (for embedding/display).
 */
async function getVideoDetails(user, videoIds) {
  if (!videoIds.length) return [];
  const auth = getAuthClient(user);
  const youtube = google.youtube({ version: 'v3', auth });

  const details = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const resp = await youtube.videos.list({
      part: 'snippet,contentDetails,statistics',
      id: batch.join(','),
    });
    for (const item of resp.data.items) {
      details.push({
        videoId: item.id,
        title: item.snippet.title,
        channelTitle: item.snippet.channelTitle,
        description: item.snippet.description?.substring(0, 300) || '',
        thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
        publishedAt: item.snippet.publishedAt,
        duration: item.contentDetails.duration,
        viewCount: item.statistics.viewCount,
      });
    }
  }
  return details;
}

/**
 * Filter out Shorts (videos under 60 seconds).
 */
async function filterOutShorts(youtube, videos) {
  if (!videos.length) return [];

  const videoIds = videos.map(v => v.videoId);
  const durations = {};

  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const resp = await youtube.videos.list({
      part: 'contentDetails',
      id: batch.join(','),
    });
    for (const item of resp.data.items) {
      durations[item.id] = parseDuration(item.contentDetails.duration);
    }
  }

  return videos.filter(v => {
    const dur = durations[v.videoId];
    return dur !== undefined && dur >= 60;
  });
}

/**
 * Parse ISO 8601 duration (PT1H2M3S) to seconds.
 */
function parseDuration(iso) {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}

module.exports = {
  getSubscriptionVideos,
  getCandidateVideos,
  getVideoDetails,
};
