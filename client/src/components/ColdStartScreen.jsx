/**
 * @file ColdStartScreen.jsx
 * @description Friendly loading screen displayed while pinging a sleeping Render backend container.
 */

import React from 'react';
import styles from './ColdStartScreen.module.css';

export function ColdStartScreen({ elapsedSeconds, isTimedOut, onRetry }) {
  return (
    <div className={styles.container}>
      <div className={styles.ambientGlow} />

      <div className={styles.card}>
        <div className={styles.spinnerWrapper}>
          <div className={styles.spinner} />
          <span className={styles.spinnerIcon}>⚡</span>
        </div>

        <h2 className={styles.title}>
          {isTimedOut ? 'Server Wakeup Delay' : 'Waking up the party server...'}
        </h2>

        <p className={styles.message}>
          {isTimedOut
            ? 'The backend server on Render took longer than expected to boot. Please retry or check service status.'
            : 'Render free-tier instances sleep during inactivity. We are spinning up the backend container now.'}
        </p>

        <div className={styles.timerBox}>
          <span className={styles.pulseDot} />
          <span>Elapsed: {elapsedSeconds}s / ~50s</span>
        </div>

        {isTimedOut && (
          <div>
            <button type="button" onClick={onRetry} className={styles.retryBtn}>
              Retry Connection
            </button>
          </div>
        )}

        <p className={styles.note}>
          Once the server acknowledges health status, you will be directed straight to the rooms.
        </p>
      </div>
    </div>
  );
}
