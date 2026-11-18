import React, { useState } from 'react';
import { Button, Input, Badge } from './common/index.js';
import { useRoom } from '../context/index.js';
import { Role } from '../utils/constants.js';
import { extractVideoId, formatTime } from '../utils/youtube.js';
import styles from './ActionRequestPanel.module.css';

/**
 * Parses a user time string into non-negative seconds.
 * Accepts raw seconds ("95") or timestamp format ("1:35" or "01:05:20").
 *
 * @param {string} input
 * @returns {number|null} Time in seconds or null if invalid.
 */
function parseTimestamp(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;

  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').map((p) => p.trim());
    if (parts.length === 2) {
      const minutes = parseInt(parts[0], 10);
      const seconds = parseFloat(parts[1]);
      if (!Number.isNaN(minutes) && !Number.isNaN(seconds) && minutes >= 0 && seconds >= 0 && seconds < 60) {
        return minutes * 60 + seconds;
      }
    } else if (parts.length === 3) {
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      const seconds = parseFloat(parts[2]);
      if (
        !Number.isNaN(hours) &&
        !Number.isNaN(minutes) &&
        !Number.isNaN(seconds) &&
        hours >= 0 &&
        minutes >= 0 &&
        seconds >= 0 &&
        minutes < 60 &&
        seconds < 60
      ) {
        return hours * 3600 + minutes * 60 + seconds;
      }
    }
    return null;
  }

  const seconds = parseFloat(trimmed);
  return !Number.isNaN(seconds) && seconds >= 0 ? seconds : null;
}

/**
 * ActionRequestPanel Component.
 *
 * Enables non-controlling members (PARTICIPANT and VIEWER) to:
 * 1. Propose Play, Pause, Seek, and Change Video actions to room moderators.
 * 2. Monitor real-time statuses of their own requests (pending, approved, rejected, expired).
 * 3. Enforces the server-side limit of at most 3 simultaneous pending requests per user.
 *
 * @param {Object} props
 * @param {string} [props.className=''] - Custom wrapper CSS class.
 */
export function ActionRequestPanel({ className = '' }) {
  const { me, syncState, myRequests = [], requestAction } = useRoom();

  // Only non-controllers (PARTICIPANT / VIEWER) use this panel
  const isController = me?.role === Role.HOST || me?.role === Role.MODERATOR;

  const [seekInput, setSeekInput] = useState('');
  const [seekError, setSeekError] = useState('');

  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState('');

  if (isController) {
    return null;
  }

  const pendingCount = myRequests.filter((r) => r.status === 'pending').length;
  const isLimitReached = pendingCount >= 3;

  // ---------------------------------------------------------------------------
  // Action Emitters
  // ---------------------------------------------------------------------------

  const handleRequestPlay = () => {
    if (isLimitReached) return;
    requestAction('play');
  };

  const handleRequestPause = () => {
    if (isLimitReached) return;
    requestAction('pause');
  };

  const handleRequestSeek = (e) => {
    e.preventDefault();
    if (isLimitReached) return;

    setSeekError('');
    const targetSeconds = parseTimestamp(seekInput);

    if (targetSeconds === null) {
      setSeekError('Enter valid seconds (e.g. 90) or time (e.g. 1:30).');
      return;
    }

    requestAction('seek', { time: targetSeconds });
    setSeekInput('');
    setSeekError('');
  };

  const handleRequestChangeVideo = (e) => {
    e.preventDefault();
    if (isLimitReached) return;

    setUrlError('');
    const extractedId = extractVideoId(urlInput);

    if (!extractedId) {
      setUrlError('Enter a valid YouTube URL or 11-character video ID.');
      return;
    }

    requestAction('change_video', { videoId: extractedId });
    setUrlInput('');
    setUrlError('');
  };

  /**
   * Helper to format request action labels.
   */
  const formatRequestLabel = (req) => {
    switch (req.type) {
      case 'play':
        return 'Play Request';
      case 'pause':
        return 'Pause Request';
      case 'seek':
        return `Seek to ${formatTime(req.payload?.time || 0)}`;
      case 'change_video':
        return `Change Video (${req.payload?.videoId || 'Unknown'})`;
      default:
        return req.type;
    }
  };

  /**
   * Status badge variant mapping.
   */
  const getStatusBadgeVariant = (status) => {
    switch (status) {
      case 'approved':
        return 'success';
      case 'rejected':
        return 'danger';
      case 'expired':
        return 'neutral';
      case 'pending':
      default:
        return 'warning';
    }
  };

  return (
    <div className={`${styles.panelContainer} ${className}`}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <h3 className={styles.title}>
            <span>Request Action</span>
          </h3>
          <p className={styles.subtitle}>
            Suggest playback controls to the Host and Moderators.
          </p>
        </div>
        <Badge variant={isLimitReached ? 'danger' : 'neutral'} size="sm">
          {pendingCount}/3 Pending
        </Badge>
      </div>

      {/* Quick Play & Pause Buttons */}
      <div className={styles.actionsGrid}>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRequestPlay}
          disabled={isLimitReached || syncState.playState === 'playing'}
        >
          Request Play
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRequestPause}
          disabled={isLimitReached || syncState.playState === 'paused'}
        >
          Request Pause
        </Button>
      </div>

      {/* Request Seek Form */}
      <form onSubmit={handleRequestSeek} className={styles.formRow} noValidate>
        <div className={styles.inputGroup}>
          <Input
            placeholder="Seek to (e.g. 1:30 or 90)"
            value={seekInput}
            onChange={(e) => {
              setSeekInput(e.target.value);
              if (seekError) setSeekError('');
            }}
            error={seekError}
            disabled={isLimitReached}
          />
        </div>
        <Button
          type="submit"
          variant="secondary"
          size="md"
          disabled={isLimitReached || !seekInput.trim()}
        >
          Request Seek
        </Button>
      </form>

      {/* Request Change Video Form */}
      <form onSubmit={handleRequestChangeVideo} className={styles.formRow} noValidate>
        <div className={styles.inputGroup}>
          <Input
            placeholder="Paste YouTube URL to suggest video"
            value={urlInput}
            onChange={(e) => {
              setUrlInput(e.target.value);
              if (urlError) setUrlError('');
            }}
            error={urlError}
            disabled={isLimitReached}
          />
        </div>
        <Button
          type="submit"
          variant="secondary"
          size="md"
          disabled={isLimitReached || !urlInput.trim()}
        >
          Request Video
        </Button>
      </form>

      <div className={styles.sectionDivider} />

      {/* My Requests Status Tracking */}
      <div className={styles.requestsSection}>
        <div className={styles.requestsHeader}>
          <span>My Requests ({myRequests.length})</span>
          {isLimitReached && (
            <span style={{ color: 'var(--danger-border)', fontSize: '0.75rem' }}>
              Pending limit reached (3 max)
            </span>
          )}
        </div>

        {myRequests.length === 0 ? (
          <div className={styles.emptyState}>
            No action requests submitted yet. Use the buttons above to suggest playback changes.
          </div>
        ) : (
          <div className={styles.requestsList}>
            {myRequests.map((req) => (
              <div key={req.id} className={styles.requestCard}>
                <div className={styles.cardLeft}>
                  <span className={styles.requestType}>
                    {formatRequestLabel(req)}
                  </span>
                  <span className={styles.requestDetails}>
                    {new Date(req.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
                <div className={styles.cardRight}>
                  <Badge variant={getStatusBadgeVariant(req.status)} size="sm">
                    {req.status ? req.status.toUpperCase() : 'PENDING'}
                  </Badge>
                  {req.status === 'rejected' && req.reason && (
                    <span className={styles.rejectReason}>
                      Reason: {req.reason}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ActionRequestPanel;
