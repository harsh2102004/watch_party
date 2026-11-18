import { useEffect, useRef, useCallback } from 'react';
import { SYNC_CONFIG } from '../utils/constants.js';

/**
 * Custom hook to synchronize the YouTubePlayer with incoming room sync_state.
 *
 * Implements:
 * 1. Video ID detection and loading.
 * 2. Latency-compensated timestamp calculation (currentTime + (Date.now() - serverTimestamp)/1000 when playing).
 * 3. Drift threshold check (> 1.5s) before issuing imperative seekTo.
 * 4. Play/Pause state alignment.
 * 5. `isRemoteUpdate` ref flag preventing echo loops (suppressing outgoing socket emits on programmatic updates).
 *
 * @param {Object} params
 * @param {React.RefObject<any>} params.playerRef - Ref to the YouTubePlayer imperative handle.
 * @param {import('../context/RoomContext.js').SyncState} params.syncState - Current room sync state.
 * @param {boolean} params.isPlayerReady - Whether the YouTube IFrame player is initialized and ready.
 * @param {(event: { data: number, target: any }) => void} [params.onLocalStateChange] - Callback for authentic user-driven state changes.
 * @returns {{
 *   isRemoteUpdateRef: React.MutableRefObject<boolean>,
 *   applySync: (state?: import('../context/RoomContext.js').SyncState) => void,
 *   handlePlayerStateChange: (event: { data: number, target: any }) => void
 * }}
 */
export function useVideoSync({
  playerRef,
  syncState,
  isPlayerReady,
  onLocalStateChange,
}) {
  const isRemoteUpdateRef = useRef(false);
  const suppressTimerRef = useRef(null);
  const currentVideoIdRef = useRef(syncState?.videoId || null);

  // Clear suppression timer on unmount
  useEffect(() => {
    return () => {
      if (suppressTimerRef.current) {
        clearTimeout(suppressTimerRef.current);
      }
    };
  }, []);

  /**
   * Sets the isRemoteUpdate flag to true for a grace period,
   * preventing programmatic player calls from echoing back to the server.
   */
  const markRemoteUpdate = useCallback((durationMs = SYNC_CONFIG.ECHO_SUPPRESSION_MS) => {
    isRemoteUpdateRef.current = true;
    if (suppressTimerRef.current) {
      clearTimeout(suppressTimerRef.current);
    }
    suppressTimerRef.current = setTimeout(() => {
      isRemoteUpdateRef.current = false;
    }, durationMs);
  }, []);

  /**
   * Applies the server syncState to the YouTube player instance.
   */
  const applySync = useCallback(
    (targetSyncState) => {
      const stateToApply = targetSyncState || syncState;
      if (!playerRef.current || !isPlayerReady || !stateToApply) {
        return;
      }

      const {
        videoId,
        playState,
        currentTime = 0,
        serverTimestamp,
      } = stateToApply;

      // 1. Calculate latency-compensated target playback time:
      // If currently playing, add the elapsed milliseconds since the server timestamp.
      const now = Date.now();
      const elapsedSinceServer =
        serverTimestamp && playState === 'playing'
          ? Math.max(0, (now - serverTimestamp) / 1000)
          : 0;

      const latencyCompensatedTarget = currentTime + elapsedSinceServer;

      // 2. Video change check:
      // If videoId changed, load the new video at the compensated timestamp.
      if (videoId && videoId !== currentVideoIdRef.current) {
        currentVideoIdRef.current = videoId;
        markRemoteUpdate();

        if (playState === 'playing') {
          playerRef.current.loadVideo(videoId, latencyCompensatedTarget);
        } else {
          playerRef.current.cueVideo(videoId, latencyCompensatedTarget);
        }
        return;
      }

      // If no video is loaded at all, nothing further to sync
      if (!videoId) return;

      // 3. Drift check:
      // Compare player's current position to latency-compensated target.
      const playerCurrentTime = playerRef.current.getCurrentTime();
      const drift = Math.abs(playerCurrentTime - latencyCompensatedTarget);

      if (drift > SYNC_CONFIG.DRIFT_THRESHOLD_SECONDS) {
        markRemoteUpdate();
        playerRef.current.seekTo(latencyCompensatedTarget, true);
      }

      // 4. Play/Pause state alignment:
      // YT.PlayerState: 1 = PLAYING, 2 = PAUSED, 3 = BUFFERING
      const playerState = playerRef.current.getPlayerState();

      if (playState === 'playing') {
        if (playerState !== 1 && playerState !== 3) {
          markRemoteUpdate();
          playerRef.current.play();
        }
      } else if (playState === 'paused') {
        if (playerState === 1 || playerState === 3) {
          markRemoteUpdate();
          playerRef.current.pause();
        }
      }
    },
    [playerRef, isPlayerReady, syncState, markRemoteUpdate]
  );

  // Apply sync_state whenever syncState changes or when the player finishes loading
  useEffect(() => {
    applySync(syncState);
  }, [syncState, isPlayerReady, applySync]);

  /**
   * Intercepts YouTube onStateChange events.
   * If flagged as a remote update, suppresses outgoing socket emissions to prevent echo loops.
   */
  const handlePlayerStateChange = useCallback(
    (event) => {
      if (isRemoteUpdateRef.current) {
        // Suppress programmatic feedback loop
        return;
      }

      // Authentic local user action
      onLocalStateChange?.(event);
    },
    [onLocalStateChange]
  );

  return {
    isRemoteUpdateRef,
    applySync,
    handlePlayerStateChange,
  };
}

export default useVideoSync;
