/**
 * @file ColdStartScreen.jsx
 * @description Clean waiting/loading screen displayed while connecting to the backend server.
 */

import React from 'react';
import styles from './ColdStartScreen.module.css';

export function ColdStartScreen({ isTimedOut, onRetry }) {
  return (
    <div className={styles.container}>
      <div className={styles.ambientGlow} />

      <div className={styles.card}>
        <div className={styles.spinnerWrapper}>
          <div className={styles.spinner} />
          <span className={styles.spinnerIcon}>🎬</span>
        </div>

        <h2 className={styles.title}>
          {isTimedOut ? 'Connecting is taking a while' : 'Connecting to server...'}
        </h2>

        <p className={styles.message}>
          {isTimedOut
            ? 'The server is taking longer than usual to respond. Please check your internet connection or click retry.'
            : 'Please wait a moment while we establish a secure connection to the watch party server.'}
        </p>

        <div className={styles.statusBox}>
          <span className={styles.pulseDot} />
          <span>{isTimedOut ? 'Waiting for response...' : 'Please wait...'}</span>
        </div>

        {isTimedOut && (
          <div>
            <button type="button" onClick={onRetry} className={styles.retryBtn}>
              Retry Connection
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default ColdStartScreen;
