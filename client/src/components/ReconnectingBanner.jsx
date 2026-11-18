/**
 * @file ReconnectingBanner.jsx
 * @description Sleek, non-blocking top banner displayed when WebSocket connectivity drops after boot.
 */

import React from 'react';
import styles from './ReconnectingBanner.module.css';

export function ReconnectingBanner({ isReconnecting }) {
  if (!isReconnecting) return null;

  return (
    <div className={styles.banner} role="alert" aria-live="assertive">
      <div className={styles.spinner} />
      <span>Connection lost. Reconnecting to party server...</span>
    </div>
  );
}
