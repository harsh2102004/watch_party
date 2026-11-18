/**
 * @file ConfigErrorScreen.jsx
 * @description Full-page error screen displayed in production when VITE_SERVER_URL is missing.
 */

import React from 'react';
import styles from './ConfigErrorScreen.module.css';

export function ConfigErrorScreen() {
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.iconWrapper}>⚠️</div>
        <h1 className={styles.title}>Configuration Required</h1>
        <p className={styles.message}>
          This production build cannot connect to the Watch Party server because the
          <strong> VITE_SERVER_URL</strong> environment variable is not configured.
        </p>

        <div className={styles.codeBlock}>
          # In your Vercel Project Settings &gt; Environment Variables:
          <br />
          VITE_SERVER_URL=https://your-watchparty-server.onrender.com
        </div>

        <p className={styles.tip}>
          Once set, trigger a redeployment on Vercel for the changes to take effect.
        </p>
      </div>
    </div>
  );
}
