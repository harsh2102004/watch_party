import React, {
  forwardRef,
  useRef,
  useState,
  useEffect,
  useImperativeHandle,
} from 'react';
import { loadYouTubeIframeApi } from '../utils/loadYouTubeIframeApi.js';
import styles from './YouTubePlayer.module.css';

/**
 * YouTubePlayer component wrapping the official YouTube IFrame Player API.
 * Disables native player controls (controls: 0) to ensure synchronized custom room controls are used.
 *
 * @param {Object} props
 * @param {string} [props.videoId] - The 11-character YouTube video ID.
 * @param {number} [props.initialTime=0] - Initial playback start timestamp in seconds.
 * @param {(event: any) => void} [props.onReady] - Fired when the player finishes loading and is ready.
 * @param {(event: { data: number, target: any }) => void} [props.onStateChange] - Fired when playback state changes.
 * @param {(event: any) => void} [props.onError] - Fired when an embedded player error occurs.
 * @param {boolean} [props.clickShield=true] - Transparent overlay preventing direct clicks on the iframe.
 * @param {string} [props.className=''] - Custom wrapper CSS class.
 * @param {React.Ref<any>} ref - Imperative handle exposing play, pause, seekTo, and loadVideo.
 */
export const YouTubePlayer = forwardRef(function YouTubePlayer(
  {
    videoId,
    initialTime = 0,
    onReady,
    onStateChange,
    onError,
    clickShield = true,
    className = '',
  },
  ref
) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const isReadyRef = useRef(false);
  const currentVideoIdRef = useRef(videoId || null);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [loadError, setLoadError] = useState(null);

  // Keep latest callbacks in refs to avoid rebuilding player on callback reference change
  const callbacksRef = useRef({ onReady, onStateChange, onError });
  useEffect(() => {
    callbacksRef.current = { onReady, onStateChange, onError };
  });

  // ---------------------------------------------------------------------------
  // Expose Imperative Methods via useImperativeHandle
  // ---------------------------------------------------------------------------
  useImperativeHandle(
    ref,
    () => ({
      /** Plays the currently loaded video */
      play: () => {
        if (playerRef.current && isReadyRef.current) {
          try {
            playerRef.current.playVideo();
          } catch {}
        }
      },
      /** Pauses the currently playing video */
      pause: () => {
        if (playerRef.current && isReadyRef.current) {
          try {
            playerRef.current.pauseVideo();
          } catch {}
        }
      },
      /**
       * Seeks to a specific timestamp in seconds.
       * @param {number} seconds
       * @param {boolean} [allowSeekAhead=true]
       */
      seekTo: (seconds, allowSeekAhead = true) => {
        if (playerRef.current && isReadyRef.current) {
          try {
            playerRef.current.seekTo(seconds, allowSeekAhead);
          } catch {}
        }
      },
      /**
       * Loads and starts playing a new video.
       * @param {string} newVideoId
       * @param {number} [startSeconds=0]
       */
      loadVideo: (newVideoId, startSeconds = 0) => {
        if (playerRef.current && isReadyRef.current && newVideoId) {
          currentVideoIdRef.current = newVideoId;
          try {
            playerRef.current.loadVideoById({
              videoId: newVideoId,
              startSeconds,
            });
          } catch {
            playerRef.current.loadVideoById(newVideoId, startSeconds);
          }
        }
      },
      /**
       * Cues a video without automatically playing.
       * @param {string} newVideoId
       * @param {number} [startSeconds=0]
       */
      cueVideo: (newVideoId, startSeconds = 0) => {
        if (playerRef.current && isReadyRef.current && newVideoId) {
          currentVideoIdRef.current = newVideoId;
          try {
            playerRef.current.cueVideoById({
              videoId: newVideoId,
              startSeconds,
            });
          } catch {
            playerRef.current.cueVideoById(newVideoId, startSeconds);
          }
        }
      },
      /** Gets current elapsed playback time in seconds */
      getCurrentTime: () => {
        if (playerRef.current && isReadyRef.current) {
          try {
            return playerRef.current.getCurrentTime() || 0;
          } catch {}
        }
        return 0;
      },
      /** Gets total duration of loaded video in seconds */
      getDuration: () => {
        if (playerRef.current && isReadyRef.current) {
          try {
            return playerRef.current.getDuration() || 0;
          } catch {}
        }
        return 0;
      },
      /** Gets raw player state enum number */
      getPlayerState: () => {
        if (playerRef.current && isReadyRef.current) {
          try {
            return playerRef.current.getPlayerState();
          } catch {}
        }
        return -1;
      },
      /** Checks whether the player is fully initialized */
      isReady: () => isReadyRef.current,
      /** Returns raw YT.Player instance */
      getInternalPlayer: () => playerRef.current,
    }),
    []
  );

  // ---------------------------------------------------------------------------
  // Initialize YouTube IFrame Player when a valid videoId is provided
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Do not initialize player with undefined/null videoId (prevents "Invalid video id" error)
    if (!videoId) {
      currentVideoIdRef.current = null;
      return;
    }

    let isMounted = true;
    const container = containerRef.current;
    if (!container) return;

    // 1. If player does not exist yet, instantiate it with the valid videoId
    if (!playerRef.current) {
      currentVideoIdRef.current = videoId;
      container.innerHTML = '';
      const targetDiv = document.createElement('div');
      container.appendChild(targetDiv);

      loadYouTubeIframeApi()
        .then((YT) => {
          if (!isMounted) return;

          const player = new YT.Player(targetDiv, {
            videoId,
            width: '100%',
            height: '100%',
            playerVars: {
              controls: 0, // Disable native player controls
              disablekb: 1, // Disable keyboard controls
              modestbranding: 1, // Hide logo
              rel: 0, // No external recommendations
              enablejsapi: 1,
              playsinline: 1,
              autoplay: 0,
              fs: 0,
            },
            events: {
              onReady: (event) => {
                if (!isMounted) return;
                playerRef.current = player;
                isReadyRef.current = true;
                setIsPlayerReady(true);

                if (typeof initialTime === 'number' && initialTime > 0) {
                  try {
                    player.seekTo(initialTime, true);
                  } catch {}
                }

                callbacksRef.current.onReady?.(event);

                // If videoId changed while player was initializing, cue latest
                if (currentVideoIdRef.current && currentVideoIdRef.current !== videoId) {
                  try {
                    player.cueVideoById({
                      videoId: currentVideoIdRef.current,
                      startSeconds: 0,
                    });
                  } catch {
                    player.cueVideoById(currentVideoIdRef.current, 0);
                  }
                }
              },
              onStateChange: (event) => {
                if (!isMounted) return;
                callbacksRef.current.onStateChange?.(event);
              },
              onError: (event) => {
                if (!isMounted) return;
                callbacksRef.current.onError?.(event);
              },
            },
          });
        })
        .catch((err) => {
          if (!isMounted) return;
          setLoadError(err.message || 'Failed to initialize YouTube Player.');
        });
    } else if (isReadyRef.current) {
      // 2. Player already exists and is ready: switch video if videoId changed
      if (currentVideoIdRef.current !== videoId) {
        currentVideoIdRef.current = videoId;
        try {
          playerRef.current.cueVideoById({
            videoId,
            startSeconds: initialTime || 0,
          });
        } catch {
          playerRef.current.cueVideoById(videoId, initialTime || 0);
        }
      }
    }

    return () => {
      isMounted = false;
    };
  }, [videoId, initialTime]);

  // Clean up player on unmount
  useEffect(() => {
    return () => {
      isReadyRef.current = false;
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {}
        playerRef.current = null;
      }
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, []);

  return (
    <div className={`${styles.playerWrapper} ${className}`}>
      {/* Empty placeholder when no video is selected */}
      {!videoId && (
        <div className={styles.placeholder}>
          <div className={styles.placeholderIcon} aria-hidden="true">▶</div>
          <h3 className={styles.placeholderTitle}>No Video Loaded</h3>
          <p className={styles.placeholderSubtitle}>
            Paste a YouTube video link or ID into the room input to start the watch party.
          </p>
        </div>
      )}

      {/* Target container where YT.Player mounts the iframe */}
      <div
        ref={containerRef}
        className={styles.iframeTarget}
        style={{ display: videoId ? 'block' : 'none' }}
      />

      {/* Transparent Shield preventing native click-to-pause */}
      {clickShield && videoId && isPlayerReady && (
        <div
          className={styles.clickShield}
          aria-hidden="true"
          title="Playback is synchronized by room controls"
        />
      )}

      {/* Loading & Initialization Overlay */}
      {videoId && !isPlayerReady && !loadError && (
        <div className={styles.loadingOverlay}>
          <div className={styles.spinner} />
          <span>Loading YouTube Stream...</span>
        </div>
      )}

      {/* Error state */}
      {loadError && (
        <div className={styles.loadingOverlay} style={{ color: '#fca5a5' }}>
          <span>{loadError}</span>
        </div>
      )}
    </div>
  );
});

export default YouTubePlayer;
