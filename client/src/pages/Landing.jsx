import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Input, Card, UserNav } from '../components/index.js';
import {
  useSocket,
  useRoom,
  useAuth,
  ConnectionStatusIndicator,
} from '../context/index.js';
import { VALIDATION } from '../utils/constants.js';
import styles from './Landing.module.css';

/**
 * Validates a display username against length requirements.
 *
 * @param {string} username
 * @returns {string|null} Error message or null if valid.
 */
function validateUsername(username) {
  const trimmed = username.trim();
  if (!trimmed) {
    return 'Display name is required.';
  }
  if (trimmed.length < VALIDATION.USERNAME_MIN_LENGTH) {
    return `Username must be at least ${VALIDATION.USERNAME_MIN_LENGTH} characters.`;
  }
  if (trimmed.length > VALIDATION.USERNAME_MAX_LENGTH) {
    return `Username cannot exceed ${VALIDATION.USERNAME_MAX_LENGTH} characters.`;
  }
  return null;
}

/**
 * Validates a 6-character alphanumeric room code.
 *
 * @param {string} code
 * @returns {string|null} Error message or null if valid.
 */
function validateRoomCode(code) {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) {
    return 'Room code is required.';
  }
  if (trimmed.length !== VALIDATION.ROOM_CODE_LENGTH) {
    return `Room code must be exactly ${VALIDATION.ROOM_CODE_LENGTH} characters.`;
  }
  if (!VALIDATION.ROOM_CODE_REGEX.test(trimmed)) {
    return 'Room code must only contain letters and numbers.';
  }
  return null;
}

/**
 * Landing Page component.
 * Features dual "Create Room" and "Join Room" forms with client-side validation,
 * responsive loading states, and automatic redirection to /room/:roomId on success.
 */
export function Landing() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isConnected, socket } = useSocket();
  const { user, guestName } = useAuth();
  const {
    roomId,
    error,
    lastRemovalReason,
    createRoom,
    joinRoom,
    clearError,
  } = useRoom();

  // Tab State: 'create' | 'join'
  const initialCode = searchParams.get('code') || searchParams.get('room') || '';
  const [activeTab, setActiveTab] = useState(initialCode ? 'join' : 'create');

  // Username and code states
  const [createUsername, setCreateUsername] = useState(user?.username || guestName || '');
  const [createError, setCreateError] = useState('');
  const [joinUsername, setJoinUsername] = useState(user?.username || guestName || '');
  const [joinCode, setJoinCode] = useState(initialCode);
  const [joinErrors, setJoinErrors] = useState({ username: '', roomCode: '' });

  // Active submission action: 'create' | 'join' | null
  const [pendingAction, setPendingAction] = useState(null);

  // Derived loading states: active if pendingAction matches and no room error
  const isCreating = pendingAction === 'create' && !error;
  const isJoining = pendingAction === 'join' && !error;

  // Local timeout error state
  const [timeoutError, setTimeoutError] = useState('');
  const timeoutRef = useRef(null);

  // Clear timeout timer helper
  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Redirection on Room Entry
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (roomId) {
      clearTimer();
      navigate(`/room/${roomId}`);
    }
  }, [roomId, navigate, clearTimer]);

  // Teardown timeout on unmount
  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  // ---------------------------------------------------------------------------
  // Form Submission Handlers
  // ---------------------------------------------------------------------------

  const handleCreateSubmit = (e) => {
    e.preventDefault();
    setTimeoutError('');
    clearError();

    const effectiveUsername = user?.username || createUsername.trim();
    if (!user?.username) {
      const usernameErr = validateUsername(createUsername);
      if (usernameErr) {
        setCreateError(usernameErr);
        return;
      }
    }

    setCreateError('');
    setPendingAction('create');
    createRoom(effectiveUsername);

    // Fallback timeout in case server doesn't respond
    clearTimer();
    timeoutRef.current = setTimeout(() => {
      setPendingAction(null);
      setTimeoutError('Server took too long to create room. Please try again.');
    }, 10000);
  };

  const handleJoinSubmit = (e) => {
    e.preventDefault();
    setTimeoutError('');
    clearError();

    const effectiveUsername = user?.username || joinUsername.trim();
    const usernameErr = user?.username ? null : validateUsername(joinUsername);
    const codeErr = validateRoomCode(joinCode);

    if (usernameErr || codeErr) {
      setJoinErrors({
        username: usernameErr || '',
        roomCode: codeErr || '',
      });
      return;
    }

    setJoinErrors({ username: '', roomCode: '' });
    setPendingAction('join');
    joinRoom(joinCode.trim().toUpperCase(), effectiveUsername);

    // Fallback timeout in case server doesn't respond
    clearTimer();
    timeoutRef.current = setTimeout(() => {
      setPendingAction(null);
      setTimeoutError('Server took too long to join room. Please check the code and try again.');
    }, 10000);
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setCreateError('');
    setJoinErrors({ username: '', roomCode: '' });
    setTimeoutError('');
    clearError();
  };

  const anyLoading = isCreating || isJoining;

  return (
    <div className={styles.landingContainer}>
      <div className={styles.ambientGlow} />

      <div className={styles.contentWrapper}>
        <header className={styles.header}>
          <span className={styles.brandBadge}>Real-Time Video Sync</span>
          <h1 className={styles.title}>
            Watch<span className={styles.titleGradient}>Party</span>
          </h1>
          <p className={styles.subtitle}>
            Watch synchronized YouTube streams together with real-time playback,
            role permissions, and collaborative queues.
          </p>
        </header>

        <Card
          headerAction={
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <UserNav />
              <ConnectionStatusIndicator size="sm" />
            </div>
          }
          footer={
            <div className={styles.footerInfo}>
              <span>
                {isConnected ? 'Connected to Party Server' : 'Connecting to Server...'}
              </span>
              <span>
                {socket?.id ? `Socket: ${socket.id.slice(0, 6)}...` : 'Offline'}
              </span>
            </div>
          }
        >
          {/* Tab Selector */}
          <div className={styles.tabNav} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'create'}
              className={`${styles.tabButton} ${activeTab === 'create' ? styles.tabActive : ''}`}
              onClick={() => handleTabChange('create')}
              disabled={anyLoading}
            >
              Create Room
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'join'}
              className={`${styles.tabButton} ${activeTab === 'join' ? styles.tabActive : ''}`}
              onClick={() => handleTabChange('join')}
              disabled={anyLoading}
            >
              Join Room
            </button>
          </div>

          <div style={{ marginTop: '1.25rem' }}>
            {/* Last Removal Banner */}
            {lastRemovalReason && (
              <div className={`${styles.alertBanner} ${styles.warningBanner}`} style={{ marginBottom: '1rem' }}>
                <span>{lastRemovalReason}</span>
              </div>
            )}

            {/* Global Server Error Banner */}
            {error && (
              <div className={`${styles.alertBanner} ${styles.errorBanner}`} style={{ marginBottom: '1rem' }}>
                <span><strong>{error.code}:</strong> {error.message}</span>
                <button
                  type="button"
                  className={styles.closeButton}
                  onClick={clearError}
                  aria-label="Dismiss error"
                >
                  &times;
                </button>
              </div>
            )}

            {/* Timeout Error Banner */}
            {timeoutError && (
              <div className={`${styles.alertBanner} ${styles.errorBanner}`} style={{ marginBottom: '1rem' }}>
                <span>{timeoutError}</span>
                <button
                  type="button"
                  className={styles.closeButton}
                  onClick={() => setTimeoutError('')}
                  aria-label="Dismiss error"
                >
                  &times;
                </button>
              </div>
            )}

            {/* Offline Notification */}
            {!isConnected && (
              <div className={`${styles.alertBanner} ${styles.infoBanner}`} style={{ marginBottom: '1rem' }}>
                <span>Connecting to server... Action buttons will enable once connected.</span>
              </div>
            )}

            {/* ---------------------------------------------------------------- */}
            {/* Create Room Form */}
            {/* ---------------------------------------------------------------- */}
            {activeTab === 'create' && (
              <form onSubmit={handleCreateSubmit} className={styles.form} noValidate>
                <p className={styles.formDescription}>
                  Start a brand new watch room as the <strong>HOST</strong>. You will have full playback controls and moderation privileges.
                </p>

                {user?.username ? (
                  <div style={{
                    padding: '0.75rem 1rem',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 'var(--radius-md, 0.5rem)',
                    marginBottom: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}>
                    <span style={{ fontSize: '0.875rem', color: 'var(--text-muted, #94a3b8)' }}>
                      Creating room as:
                    </span>
                    <strong style={{ color: '#818cf8', fontSize: '0.95rem' }}>
                      {user.username}
                    </strong>
                  </div>
                ) : (
                  <Input
                    label="Display Name"
                    placeholder="e.g. Alice"
                    value={createUsername}
                    onChange={(e) => {
                      setCreateUsername(e.target.value);
                      if (createError) setCreateError('');
                    }}
                    error={createError}
                    helperText="Between 2 and 20 characters."
                    disabled={anyLoading}
                    maxLength={VALIDATION.USERNAME_MAX_LENGTH}
                    autoFocus
                  />
                )}

                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  isLoading={isCreating}
                  disabled={!isConnected || anyLoading}
                  style={{ width: '100%', marginTop: '0.25rem' }}
                >
                  {isCreating ? 'Creating Watch Room...' : 'Create Watch Room'}
                </Button>
              </form>
            )}

            {/* ---------------------------------------------------------------- */}
            {/* Join Room Form */}
            {/* ---------------------------------------------------------------- */}
            {activeTab === 'join' && (
              <form onSubmit={handleJoinSubmit} className={styles.form} noValidate>
                <p className={styles.formDescription}>
                  Enter the 6-character room code to join an ongoing watch party as a <strong>PARTICIPANT</strong>.
                </p>

                {user?.username ? (
                  <div style={{
                    padding: '0.75rem 1rem',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 'var(--radius-md, 0.5rem)',
                    marginBottom: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}>
                    <span style={{ fontSize: '0.875rem', color: 'var(--text-muted, #94a3b8)' }}>
                      Joining room as:
                    </span>
                    <strong style={{ color: '#818cf8', fontSize: '0.95rem' }}>
                      {user.username}
                    </strong>
                  </div>
                ) : (
                  <Input
                    label="Display Name"
                    placeholder="e.g. Bob"
                    value={joinUsername}
                    onChange={(e) => {
                      setJoinUsername(e.target.value);
                      if (joinErrors.username) {
                        setJoinErrors((prev) => ({ ...prev, username: '' }));
                      }
                    }}
                    error={joinErrors.username}
                    helperText="Choose a unique name in the room."
                    disabled={anyLoading}
                    maxLength={VALIDATION.USERNAME_MAX_LENGTH}
                    autoFocus={!initialCode}
                  />
                )}

                <Input
                  label="Room Code"
                  placeholder="6-character code (e.g. ABC123)"
                  value={joinCode}
                  onChange={(e) => {
                    const cleaned = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                    setJoinCode(cleaned);
                    if (joinErrors.roomCode) {
                      setJoinErrors((prev) => ({ ...prev, roomCode: '' }));
                    }
                  }}
                  error={joinErrors.roomCode}
                  helperText="Ask the host for the 6-character room code."
                  disabled={anyLoading}
                  maxLength={VALIDATION.ROOM_CODE_LENGTH}
                  autoFocus={Boolean(initialCode) || Boolean(user?.username)}
                />

                <Button
                  type="submit"
                  variant="secondary"
                  size="md"
                  isLoading={isJoining}
                  disabled={!isConnected || anyLoading}
                  style={{ width: '100%', marginTop: '0.25rem' }}
                >
                  {isJoining ? 'Joining Room...' : 'Join Watch Room'}
                </Button>
              </form>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

export default Landing;
