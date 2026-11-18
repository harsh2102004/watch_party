/**
 * @file youtube.js
 * @description Extracts YouTube video IDs from various URL formats or validates raw 11-char IDs.
 */

// YouTube video IDs consist of exactly 11 base64url characters (A-Z, a-z, 0-9, -, _)
const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Extracts an 11-character YouTube video ID from a URL or raw ID string.
 *
 * Supports:
 * - Raw 11-character ID: "dQw4w9WgXcQ"
 * - Standard watch URL: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
 * - Shortened share URL: "https://youtu.be/dQw4w9WgXcQ"
 * - Embedded player URL: "https://www.youtube.com/embed/dQw4w9WgXcQ"
 * - Shorts URL: "https://www.youtube.com/shorts/dQw4w9WgXcQ"
 * - URLs with additional query parameters (e.g. timestamps &t=120, playlists &list=...)
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
    // Add protocol if user supplied host without protocol
    const urlString = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');

    // Case A: youtu.be/<id>
    if (hostname === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0];
      return YOUTUBE_ID_REGEX.test(id) ? id : null;
    }

    // Case B: youtube.com or m.youtube.com
    if (hostname === 'youtube.com' || hostname === 'm.youtube.com') {
      // /watch?v=<id>
      if (url.pathname === '/watch') {
        const id = url.searchParams.get('v');
        return id && YOUTUBE_ID_REGEX.test(id) ? id : null;
      }

      // /embed/<id>
      if (url.pathname.startsWith('/embed/')) {
        const id = url.pathname.split('/')[2];
        return id && YOUTUBE_ID_REGEX.test(id) ? id : null;
      }

      // /shorts/<id>
      if (url.pathname.startsWith('/shorts/')) {
        const id = url.pathname.split('/')[2];
        return id && YOUTUBE_ID_REGEX.test(id) ? id : null;
      }

      // /live/<id>
      if (url.pathname.startsWith('/live/')) {
        const id = url.pathname.split('/')[2];
        return id && YOUTUBE_ID_REGEX.test(id) ? id : null;
      }
    }
  } catch {
    // URL parsing failed
    return null;
  }

  return null;
}
