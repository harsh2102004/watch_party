/**
 * @file loadYouTubeIframeApi.js
 * @description Singleton loader for the YouTube IFrame Player API.
 * Ensures the external script is injected exactly once across the application lifecycle.
 */

let apiPromise = null;

/**
 * Loads the YouTube IFrame Player API script and resolves with the global `window.YT` object.
 * Subsequent calls return the cached promise.
 *
 * @returns {Promise<typeof window.YT>}
 */
export function loadYouTubeIframeApi() {
  // If already loaded and ready
  if (typeof window !== 'undefined' && window.YT && window.YT.Player) {
    return Promise.resolve(window.YT);
  }

  // Return ongoing promise if script is already loading
  if (apiPromise) {
    return apiPromise;
  }

  apiPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      return reject(new Error('YouTube IFrame API can only be loaded in a browser environment.'));
    }

    // Check if script tag already exists in DOM
    const existingScript = document.querySelector('script[src*="youtube.com/iframe_api"]');

    // Store any previous callback
    const prevCallback = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      if (typeof prevCallback === 'function') {
        prevCallback();
      }
      resolve(window.YT);
    };

    if (!existingScript) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.id = 'youtube-iframe-api';
      tag.async = true;

      tag.onerror = () => {
        apiPromise = null;
        reject(new Error('Failed to load YouTube IFrame Player API.'));
      };

      const firstScriptTag = document.getElementsByTagName('script')[0];
      if (firstScriptTag && firstScriptTag.parentNode) {
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
      } else {
        document.head.appendChild(tag);
      }
    }
  });

  return apiPromise;
}

export default loadYouTubeIframeApi;
