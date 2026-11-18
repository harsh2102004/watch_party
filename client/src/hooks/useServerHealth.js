/**
 * @file useServerHealth.js
 * @description Hook that probes the server health endpoint on app initialization to handle
 * Render free-tier cold starts gracefully, retrying every 3 seconds up to 90 seconds.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getServerUrl, isConfigValid } from '../utils/config.js';

const PING_INTERVAL_MS = 3000;
const MAX_WAIT_SECONDS = 90;

export function useServerHealth() {
  const [isServerReady, setIsServerReady] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isTimedOut, setIsTimedOut] = useState(false);
  const [isConfigMissing] = useState(!isConfigValid());

  const serverUrl = getServerUrl();
  const startTimeRef = useRef(null);
  const intervalRef = useRef(null);

  const checkHealth = useCallback(async () => {
    if (!serverUrl) return;

    if (!startTimeRef.current) {
      startTimeRef.current = Date.now();
    }

    try {
      const res = await fetch(`${serverUrl}/health`, {
        cache: 'no-store',
      });
      if (res.ok) {
        setIsServerReady(true);
        setIsTimedOut(false);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    } catch {
      // Server is sleeping or still starting up; continue retrying
      const elapsed = Math.round((Date.now() - (startTimeRef.current || Date.now())) / 1000);
      setElapsedSeconds(elapsed);

      if (elapsed >= MAX_WAIT_SECONDS) {
        setIsTimedOut(true);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    }
  }, [serverUrl]);

  const retry = useCallback(() => {
    startTimeRef.current = Date.now();
    setElapsedSeconds(0);
    setIsTimedOut(false);
    setIsServerReady(false);
    checkHealth();

    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(checkHealth, PING_INTERVAL_MS);
  }, [checkHealth]);

  useEffect(() => {
    if (!serverUrl) return;

    // Immediate initial probe
    checkHealth();

    // Start 3s polling timer
    intervalRef.current = setInterval(checkHealth, PING_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [serverUrl, checkHealth]);

  return {
    isServerReady,
    elapsedSeconds,
    isTimedOut,
    isConfigMissing,
    retry,
  };
}
