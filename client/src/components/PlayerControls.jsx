import React, { useState } from 'react';
import { Button, Input, Badge } from './common/index.js';
import { useRoom } from '../context/index.js';
import { Role } from '../utils/constants.js';
import { extractVideoId } from '../utils/youtube.js';
import styles from './PlayerControls.module.css';

/**
 * PlayerControls Component.
 *
 * Dedicated video change and room stream manager:
 * - Enter any YouTube URL, shorts link, live link, or 11-char ID.
 * - Displays role notice for participants/viewers.
 */
export function PlayerControls({ className = '' }) {
  const { me, changeVideo } = useRoom();

  const canControl = me?.role === Role.HOST || me?.role === Role.MODERATOR;

  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState('');

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

  return (
    <div className={`${styles.controlsContainer} ${className}`}>
      <div className={styles.headerRow}>
        <div className={styles.titleGroup}>
          <span className={styles.titleIcon}>🎬</span>
          <span>Room Video Stream</span>
        </div>
        {canControl ? (
          <Badge variant="host" size="sm">
            Host / Mod
          </Badge>
        ) : (
          <Badge variant="muted" size="sm">
            Viewer
          </Badge>
        )}
      </div>

      {!canControl ? (
        <div className={styles.disabledBanner}>
          <span>Video playback is managed by Host & Moderator. Use "Request Action" below to propose changes.</span>
          <Badge variant={me?.role ? me.role.toLowerCase() : 'viewer'} size="sm">
            {me?.role || 'VIEWER'}
          </Badge>
        </div>
      ) : (
        <form onSubmit={handleUrlSubmit} className={styles.changeVideoForm} noValidate>
          <div className={styles.inputWrapper}>
            <Input
              placeholder="Paste YouTube video link (e.g. https://youtu.be/... or /shorts/...)"
              value={urlInput}
              onChange={(e) => {
                setUrlInput(e.target.value);
                if (urlError) setUrlError('');
              }}
              error={urlError}
              helperText="Paste any standard YouTube video, Shorts, Live stream, or 11-character ID."
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={!urlInput.trim()}
            style={{ alignSelf: 'flex-start', minWidth: '120px' }}
          >
            Change Video
          </Button>
        </form>
      )}
    </div>
  );
}

export default PlayerControls;
