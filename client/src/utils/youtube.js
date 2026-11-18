/**
 * @file youtube.js
 * @description YouTube URL parsing, video ID extraction, and time formatting utilities.
 */

export const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Extracts an 11-character YouTube video ID from a URL or raw ID string.
 *
 * Supports:
 * - Raw 11-character ID: "dQw4w9WgXcQ"
 * - Standard watch URL: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
 * - Shortened share URL: "https://youtu.be/dQw4w9WgXcQ"
 * - Embedded player URL: "https://www.youtube.com/embed/dQw4w9WgXcQ"
 * - Shorts URL: "https://www.youtube.com/shorts/dQw4w9WgXcQ"
 *
 * @param {unknown} input - The URL string or raw video ID.
 * @returns {string|null} The extracted 11-character video ID, or null if invalid.
 */
export function extractVideoId(input) {
  if (typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  // 1. Direct 11-character video ID check
  if (YOUTUBE_ID_REGEX.test(trimmed)) {
    return trimmed;
  }

  // 2. Parse URL formats
  try {
    const urlString = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');

    // Case A: youtu.be/<id>
    if (hostname === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0];
      return YOUTUBE_ID_REGEX.test(id) ? id : null;
    }

    // Case B: youtube.com/watch?v=<id>
    if (hostname.includes('youtube.com')) {
      if (url.searchParams.has('v')) {
        const id = url.searchParams.get('v');
        return id && YOUTUBE_ID_REGEX.test(id) ? id : null;
      }

      // Case C: youtube.com/embed/<id>
      const parts = url.pathname.split('/').filter(Boolean);
      const embedIdx = parts.indexOf('embed');
      if (embedIdx !== -1 && parts[embedIdx + 1]) {
        const id = parts[embedIdx + 1];
        return YOUTUBE_ID_REGEX.test(id) ? id : null;
      }

      // Case D: youtube.com/shorts/<id>
      const shortsIdx = parts.indexOf('shorts');
      if (shortsIdx !== -1 && parts[shortsIdx + 1]) {
        const id = parts[shortsIdx + 1];
        return YOUTUBE_ID_REGEX.test(id) ? id : null;
      }

      // Case E: youtube.com/live/<id>
      const liveIdx = parts.indexOf('live');
      if (liveIdx !== -1 && parts[liveIdx + 1]) {
        const id = parts[liveIdx + 1];
        return YOUTUBE_ID_REGEX.test(id) ? id : null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Formats a duration in seconds into mm:ss or hh:mm:ss format.
 *
 * @param {number} seconds
 * @returns {string} Formatted timestamp string.
 */
export function formatTime(seconds) {
  if (!seconds || isNaN(seconds) || seconds < 0) {
    return '0:00';
  }
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
