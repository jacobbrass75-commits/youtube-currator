const BASE = '/yt-curator';

async function fetchJSON(url, options = {}) {
  const res = await fetch(BASE + url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (res.status === 401) {
    window.location.href = BASE;
    throw new Error('Not authenticated');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export function checkAuth() {
  return fetchJSON('/auth/check');
}

export function getSubscriptions() {
  return fetchJSON('/api/subscriptions');
}

export function getRecommended() {
  return fetchJSON('/api/recommended');
}

export function refreshRecommended() {
  return fetchJSON('/api/recommended/refresh', { method: 'POST' });
}

export function rejectVideo(videoId, reason) {
  return fetchJSON(`/api/video/${videoId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function getSettings() {
  return fetchJSON('/api/user/settings');
}

export function updateSettings(curationCriteria) {
  return fetchJSON('/api/user/settings', {
    method: 'PUT',
    body: JSON.stringify({ curationCriteria }),
  });
}

export function getStats() {
  return fetchJSON('/api/user/stats');
}

export function getRejections() {
  return fetchJSON('/api/user/rejections');
}
