import React, { useState, useEffect, useCallback } from 'react';
import { Button, Input, Badge } from './common/index.js';
import { useRoom } from '../context/index.js';
import { Role } from '../utils/constants.js';
import { extractVideoId, formatTime } from '../utils/youtube.js';
import styles from './PlayerControls.module.css';

/**
 * PlayerControls Component.
 *
 * Provides:
 * 1. Play/Pause toggle button.
 * 2. Scrubber seek bar displaying current elapsed time and duration, emitting seek only on release.
 * 3. YouTube URL paste input with "Change" button emitting change_video.
 * 4. Strict role authorization: fully interactive for HOST and MODERATOR, read-only/disabled for PARTICIPANT and VIEWER.
 *
 * @param {Object} props
 * @param {React.RefObject<any>} [props.playerRef] - Optional ref to YouTubePlayer to query duration & current time.
 * @param {string} [props.className=''] - Custom wrapper CSS class.
 */
export function PlayerControls({ playerRef, className = '' }) {
  const {
    me,
    syncState,
    play,
    pause,
    seek,
    changeVideo,
  } = useRoom();

  // Role verification: only HOST and MODERATOR have control authority
  const canControl = me?.role === Role.HOST || me?.role === Role.MODERATOR;

  // Video duration state
  const [duration, setDuration] = useState(0);

  // Seek bar state
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(null);

  // Change Video Form state
  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState('');

  // ---------------------------------------------------------------------------
  // Duration & Elapsed Time Polling
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

  // Compute active display time (scrubTime while dragging, else synced player time)
  const getElapsedSeconds = useCallback(() => {
    if (isScrubbing && scrubTime !== null) {
      return scrubTime;
    }
    if (playerRef?.current && syncState.playState === 'playing') {
      const liveTime = playerRef.current.getCurrentTime?.();
      if (typeof liveTime === 'number' && liveTime >= 0) {
        return liveTime;
      }
    }
    return syncState.currentTime || 0;
  }, [isScrubbing, scrubTime, playerRef, syncState]);

  const [displayTime, setDisplayTime] = useState(0);

  useEffect(() => {
    let animId;
    const updateTime = () => {
      setDisplayTime(getElapsedSeconds());
      animId = requestAnimationFrame(updateTime);
    };
    animId = requestAnimationFrame(updateTime);

    return () => cancelAnimationFrame(animId);
  }, [getElapsedSeconds]);

  // ---------------------------------------------------------------------------
  // Seek Bar Handlers (Emit seek ONLY on release)
  // ---------------------------------------------------------------------------
  const handleSeekStart = () => {
    if (!canControl || !syncState.videoId) return;
    setIsScrubbing(true);
  };

  const handleSeekChange = (e) => {
    if (!canControl || !syncState.videoId) return;
    setScrubTime(Number(e.target.value));
  };

  const handleSeekCommit = () => {
    if (isScrubbing && scrubTime !== null) {
      seek(scrubTime);
      setIsScrubbing(false);
      setScrubTime(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Play / Pause Toggle Handler
  // ---------------------------------------------------------------------------
  const handlePlayPause = () => {
    if (!canControl || !syncState.videoId) return;
    if (syncState.playState === 'playing') {
      pause();
    } else {
      play();
    }
  };

  // ---------------------------------------------------------------------------
  // Change Video Form Handler
  // ---------------------------------------------------------------------------
  const handleUrlSubmit = (e) => {
    e.preventDefault();
    if (!canControl) return;

    setUrlError('');
    const extractedId = extractVideoId(urlInput);

    if (!extractedId) {
      setUrlError('Please enter a valid YouTube URL or 11-character video ID.');
      return;
    }

    changeVideo(extractedId);
    setUrlInput('');
    setUrlError('');
  };

  const isPlaying = syncState.playState === 'playing';
  const maxRange = duration > 0 ? duration : Math.max(100, Math.floor(displayTime) + 10);

  return (
    <div className={`${styles.controlsContainer} ${className}`}>
      {/* Role Notice for non-hosts/mods */}
      {!canControl && (
        <div className={styles.disabledBanner}>
          <span>Playback controls are reserved for Host & Moderator.</span>
          <Badge variant={me?.role ? me.role.toLowerCase() : 'viewer'} size="sm">
            {me?.role || 'VIEWER'}
          </Badge>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* 1. Seek Bar & Time Indicators */}
      {/* -------------------------------------------------------------------- */}
      <div className={styles.seekSection}>
        <div className={styles.timeRow}>
          <span className={styles.currentTime}>{formatTime(displayTime)}</span>
          <span className={styles.durationTime}>
            {duration > 0 ? formatTime(duration) : '--:--'}
          </span>
        </div>

        <div className={styles.seekBarWrapper}>
          <input
            type="range"
            min={0}
            max={maxRange}
            step={0.5}
            value={Math.min(maxRange, displayTime)}
            disabled={!canControl || !syncState.videoId}
            onMouseDown={handleSeekStart}
            onTouchStart={handleSeekStart}
            onChange={handleSeekChange}
            onMouseUp={handleSeekCommit}
            onTouchEnd={handleSeekCommit}
            onKeyUp={handleSeekCommit}
            className={styles.rangeInput}
            aria-label="Seek video playback timestamp"
            title={canControl ? 'Drag to scrub, release to seek' : 'Only Host/Mod can seek'}
          />
        </div>
      </div>

      {/* -------------------------------------------------------------------- */}
      {/* 2. Playback Action Buttons */}
      {/* -------------------------------------------------------------------- */}
      <div className={styles.buttonRow}>
        <div className={styles.playbackGroup}>
          <Button
            variant={isPlaying ? 'secondary' : 'primary'}
            size="md"
            onClick={handlePlayPause}
            disabled={!canControl || !syncState.videoId}
            className={styles.playPauseButton}
            aria-label={isPlaying ? 'Pause video' : 'Play video'}
          >
            {isPlaying ? '⏸ Pause' : '▶ Play'}
          </Button>

          <Button
            variant="outline"
            size="md"
            onClick={() => seek(Math.max(0, displayTime - 10))}
            disabled={!canControl || !syncState.videoId}
            title="Rewind 10 seconds"
            aria-label="Rewind 10 seconds"
          >
            ↺ -10s
          </Button>

          <Button
            variant="outline"
            size="md"
            onClick={() => seek(displayTime + 10)}
            disabled={!canControl || !syncState.videoId}
            title="Fast forward 10 seconds"
            aria-label="Fast forward 10 seconds"
          >
            +10s ↻
          </Button>
        </div>

        <div className={styles.roleNotice}>
          {canControl ? (
            <Badge variant="host" size="sm">
              Playback Master
            </Badge>
          ) : (
            <Badge variant="muted" size="sm">
              View Only
            </Badge>
          )}
        </div>
      </div>

      {/* -------------------------------------------------------------------- */}
      {/* 3. Change Video Form */}
      {/* -------------------------------------------------------------------- */}
      <form onSubmit={handleUrlSubmit} className={styles.changeVideoForm} noValidate>
        <div className={styles.inputWrapper}>
          <Input
            placeholder="Paste YouTube URL or ID (e.g. https://youtu.be/...)"
            value={urlInput}
            onChange={(e) => {
              setUrlInput(e.target.value);
              if (urlError) setUrlError('');
            }}
            error={urlError}
            disabled={!canControl}
            helperText={canControl ? 'Enter any standard YouTube link, shorts URL, or 11-char ID.' : ''}
          />
        </div>

        <Button
          type="submit"
          variant="secondary"
          size="md"
          disabled={!canControl || !urlInput.trim()}
          style={{ alignSelf: 'flex-start', minWidth: '85px' }}
        >
          Change
        </Button>
      </form>
    </div>
  );
}

export default PlayerControls;
