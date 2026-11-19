import React, { useState, useEffect, useCallback } from 'react';
import { useRoom } from '../context/index.js';
import { Role } from '../utils/constants.js';
import { formatTime } from '../utils/youtube.js';
import styles from './VideoOverlayControls.module.css';

/**
 * VideoOverlayControls Component.
 *
 * Places synchronized playback controls directly INSIDE the video viewport:
 * 1. Center large Play button overlay when paused.
 * 2. Full-width seek bar spanning the video bottom.
 * 3. In-video Play/Pause toggle, -10s rewind, +10s fast forward, timestamp readout.
 * 4. Fullscreen toggle for cinematic viewing.
 * 5. Auto-fades out during playback when mouse is idle; always visible when paused or hovered.
 *
 * @param {Object} props
 * @param {React.RefObject<any>} props.playerRef - Ref to YouTubePlayer instance.
 * @param {React.RefObject<HTMLDivElement>} props.videoContainerRef - Ref to video wrapper for fullscreen.
 * @param {boolean} [props.isHovered=false] - Whether cursor is hovering over the video area.
 */
export function VideoOverlayControls({
  playerRef,
  videoContainerRef,
  isHovered = false,
}) {
  const { me, syncState, play, pause, seek } = useRoom();

  const canControl = me?.role === Role.HOST || me?.role === Role.MODERATOR;
  const isPlaying = syncState.playState === 'playing';
  const hasVideo = Boolean(syncState.videoId);

  const [duration, setDuration] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [volume, setVolume] = useState(100);
  const [isMuted, setIsMuted] = useState(false);

  // ---------------------------------------------------------------------------
  // Duration Polling
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let isMounted = true;
    const interval = setInterval(() => {
      if (!isMounted || !playerRef?.current) return;
      const playerDuration = playerRef.current.getDuration?.() || 0;
      if (playerDuration > 0 && playerDuration !== duration) {
        setDuration(playerDuration);
      }
    }, 1000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [playerRef, duration]);

  // ---------------------------------------------------------------------------
  // Fullscreen Detection
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = () => {
    if (!videoContainerRef?.current) return;

    if (!document.fullscreenElement) {
      videoContainerRef.current.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  // ---------------------------------------------------------------------------
  // Computed Display Time
  // ---------------------------------------------------------------------------
  const getElapsedSeconds = useCallback(() => {
    if (isScrubbing && scrubTime !== null) {
      return scrubTime;
    }
    if (playerRef?.current && isPlaying) {
      const realTime = playerRef.current.getCurrentTime?.();
      if (typeof realTime === 'number' && realTime > 0) {
        return realTime;
      }
    }
    return syncState.currentTime || 0;
  }, [isScrubbing, scrubTime, playerRef, isPlaying, syncState.currentTime]);

  const [displayTime, setDisplayTime] = useState(getElapsedSeconds());

  useEffect(() => {
    if (isScrubbing) return;

    const interval = setInterval(() => {
      setDisplayTime(getElapsedSeconds());
    }, 250);

    return () => clearInterval(interval);
  }, [getElapsedSeconds, isScrubbing]);

  // ---------------------------------------------------------------------------
  // Play / Pause Handlers
  // ---------------------------------------------------------------------------
  const handlePlayPause = () => {
    if (!canControl || !hasVideo) return;
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  };

  // ---------------------------------------------------------------------------
  // Seek Handlers
  // ---------------------------------------------------------------------------
  const handleSeekStart = () => {
    if (!canControl || !hasVideo) return;
    setIsScrubbing(true);
  };

  const handleSeekChange = (e) => {
    if (!canControl || !hasVideo) return;
    const target = parseFloat(e.target.value);
    setScrubTime(target);
    setDisplayTime(target);
  };

  const handleSeekCommit = (e) => {
    if (!canControl || !hasVideo) return;
    const target = parseFloat(e.target.value);
    setIsScrubbing(false);
    setScrubTime(null);
    seek(target);
  };

  // ---------------------------------------------------------------------------
  // Volume Handlers
  // ---------------------------------------------------------------------------
  const handleToggleMute = () => {
    if (!playerRef?.current) return;
    if (isMuted || volume === 0) {
      playerRef.current.unMute?.();
      const restoredVol = volume === 0 ? 60 : volume;
      playerRef.current.setVolume?.(restoredVol);
      setVolume(restoredVol);
      setIsMuted(false);
    } else {
      playerRef.current.mute?.();
      setIsMuted(true);
    }
  };

  const handleVolumeChange = (e) => {
    const newVol = parseInt(e.target.value, 10);
    setVolume(newVol);
    if (!playerRef?.current) return;
    playerRef.current.setVolume?.(newVol);
    if (newVol === 0) {
      playerRef.current.mute?.();
      setIsMuted(true);
    } else if (isMuted) {
      playerRef.current.unMute?.();
      setIsMuted(false);
    }
  };

  const getVolumeIcon = () => {
    if (isMuted || volume === 0) return '🔇';
    if (volume < 50) return '🔉';
    return '🔊';
  };

  if (!hasVideo) {
    return null;
  }

  const maxRange = duration > 0 ? duration : Math.max(100, Math.floor(displayTime) + 10);
  const showControls = !isPlaying || isHovered || isScrubbing;

  return (
    <div
      className={`${styles.overlayWrapper} ${showControls ? styles.visible : styles.hidden}`}
      aria-label="Video playback overlay controls"
    >
      {/* 1. Center Big Play Button (when paused) */}
      <div className={styles.centerOverlay}>
        {!isPlaying && (
          <button
            type="button"
            className={styles.bigPlayButton}
            onClick={handlePlayPause}
            disabled={!canControl}
            title={canControl ? 'Play video' : 'Only Host & Moderator can control playback'}
            aria-label="Play video"
          >
            &#9654;
          </button>
        )}
      </div>

      {/* 2. Bottom Glassmorphic Control Bar */}
      <div className={styles.bottomControls}>
        {/* Seek Bar */}
        <div className={styles.seekBarContainer}>
          <input
            type="range"
            min={0}
            max={maxRange}
            step={0.5}
            value={Math.min(maxRange, displayTime)}
            disabled={!canControl}
            onMouseDown={handleSeekStart}
            onTouchStart={handleSeekStart}
            onChange={handleSeekChange}
            onMouseUp={handleSeekCommit}
            onTouchEnd={handleSeekCommit}
            onKeyUp={handleSeekCommit}
            className={styles.rangeInput}
            aria-label="Seek video playback"
            title={canControl ? 'Drag to seek' : 'Only Host/Moderator can seek'}
          />
        </div>

        {/* Buttons and Indicators Row */}
        <div className={styles.controlsRow}>
          {/* Left Actions: Play/Pause, -10s, +10s, Time */}
          <div className={styles.leftControls}>
            <button
              type="button"
              className={`${styles.ctrlBtn} ${styles.playBtn}`}
              onClick={handlePlayPause}
              disabled={!canControl}
              title={isPlaying ? 'Pause' : 'Play'}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? '⏸ Pause' : '▶ Play'}
            </button>

            <button
              type="button"
              className={styles.ctrlBtn}
              onClick={() => seek(Math.max(0, displayTime - 10))}
              disabled={!canControl}
              title="Rewind 10 seconds"
              aria-label="Rewind 10 seconds"
            >
              ↺ 10s
            </button>

            <button
              type="button"
              className={styles.ctrlBtn}
              onClick={() => seek(displayTime + 10)}
              disabled={!canControl}
              title="Forward 10 seconds"
              aria-label="Forward 10 seconds"
            >
              10s ↻
            </button>

            <div className={styles.timeDisplay}>
              <span className={styles.timeCurrent}>{formatTime(displayTime)}</span>
              <span className={styles.timeDivider}>/</span>
              <span className={styles.timeDuration}>
                {duration > 0 ? formatTime(duration) : '--:--'}
              </span>
            </div>

            {/* Volume Button & Slider */}
            <div className={styles.volumeGroup}>
              <button
                type="button"
                className={styles.volumeBtn}
                onClick={handleToggleMute}
                title={isMuted ? 'Unmute audio' : 'Mute audio'}
                aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
              >
                {getVolumeIcon()}
              </button>

              <div className={styles.volumeSliderContainer}>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className={styles.volumeSlider}
                  aria-label="Volume slider"
                  title={`Volume: ${isMuted ? 0 : volume}%`}
                />
              </div>
            </div>
          </div>

          {/* Right Actions: Role Status & Fullscreen Toggle */}
          <div className={styles.rightControls}>
            <span
              className={`${styles.rolePill} ${!canControl ? styles.rolePillViewer : ''}`}
            >
              {canControl ? (me?.role || 'HOST') : 'SYNCED'}
            </span>

            <button
              type="button"
              className={styles.fullscreenBtn}
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit full screen' : 'Full screen'}
              aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
            >
              {isFullscreen ? '🗗' : '⛶'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default VideoOverlayControls;
