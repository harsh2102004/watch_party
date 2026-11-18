import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Button,
  Input,
  Card,
  Badge,
  Modal,
  YouTubePlayer,
  VideoOverlayControls,
  PlayerControls,
  ActionRequestPanel,
  ParticipantsList,
  ApprovalPanel,
  Chat,
  ReactionOverlay,
  UserNav,
} from '../components/index.js';
import {
  useSocket,
  useRoom,
  useToast,
  useAuth,
  ConnectionStatusIndicator,
} from '../context/index.js';
import { useVideoSync } from '../hooks/index.js';
import { VALIDATION } from '../utils/constants.js';
import { formatTime } from '../utils/youtube.js';
import styles from './Room.module.css';

/**
 * Validates a display username.
 *
 * @param {string} username
 * @returns {string|null} Error string or null if valid.
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
 * Assembled Room Page.
 *
 * Layout:
 * - Header bar displaying brand, Room Code with copy action, user role, connection indicator, and Leave button.
 * - Responsive Two-Column Layout:
 *   - Left Column: Synchronized YouTube player, Master playback controls (seek bar, play/pause, skips, change video),
 *     and Participant action request panel.
 *   - Right Column: Real-time playback status summary pill, Moderator approval queue panel, and Active participants list.
 * - Deep-link prompt modal for direct URL visitors.
 */
export function Room() {
  const { roomId: rawRoomId } = useParams();
  const navigate = useNavigate();
  const cleanRoomId = (rawRoomId || '').trim().toUpperCase();

  const { isConnected } = useSocket();
  const { showToast } = useToast();
  const { user } = useAuth();
  const {
    roomId,
    me,
    syncState,
    error,
    joinRoom,
    leaveRoom,
    clearError,
  } = useRoom();

  // Prompt Modal State (when user opens /room/:roomId directly without active session)
  const isJoined = roomId === cleanRoomId && Boolean(me);
  const playerRef = useRef(null);
  const playerWrapperRef = useRef(null);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [isPlayerHovered, setIsPlayerHovered] = useState(false);
  const hoverTimeoutRef = useRef(null);

  const handlePlayerMouseMove = useCallback(() => {
    setIsPlayerHovered(true);
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      setIsPlayerHovered(false);
    }, 2500);
  }, []);

  const handlePlayerMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    setIsPlayerHovered(false);
  }, []);
  const [modalUsername, setModalUsername] = useState(user?.username || '');
  const [usernameError, setUsernameError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const hasAutoJoined = useRef(false);

  // Auto-join if user is authenticated and not yet joined
  useEffect(() => {
    if (!isJoined && user?.username && cleanRoomId && isConnected && !isSubmitting && !hasAutoJoined.current) {
      hasAutoJoined.current = true;
      setIsSubmitting(true);
      joinRoom(cleanRoomId, user.username);
    }
  }, [isJoined, user, cleanRoomId, isConnected, isSubmitting, joinRoom]);

  // Synchronize player with room sync_state using useVideoSync
  const { handlePlayerStateChange } = useVideoSync({
    playerRef,
    syncState,
    isPlayerReady,
  });

  // Derived loading state
  const isJoining = isSubmitting && !error && !isJoined;

  const joinTimeoutRef = useRef(null);

  // ---------------------------------------------------------------------------
  // Validation on mount: ensure route parameter is a valid 6-char room code
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!cleanRoomId || !VALIDATION.ROOM_CODE_REGEX.test(cleanRoomId)) {
      showToast(`Invalid room code "${rawRoomId}".`, 'error');
      navigate('/', { replace: true });
    }
  }, [cleanRoomId, rawRoomId, navigate, showToast]);

  // ---------------------------------------------------------------------------
  // Toast on successful join
  // ---------------------------------------------------------------------------
  const hasNotifiedJoined = useRef(false);
  useEffect(() => {
    if (isJoined && !hasNotifiedJoined.current) {
      hasNotifiedJoined.current = true;
      if (joinTimeoutRef.current) {
        clearTimeout(joinTimeoutRef.current);
        joinTimeoutRef.current = null;
      }
      showToast(`Joined room "${cleanRoomId}" as ${me?.username}!`, 'success', 3500);
    }
  }, [isJoined, cleanRoomId, me, showToast]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (joinTimeoutRef.current) {
        clearTimeout(joinTimeoutRef.current);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const handleModalJoinSubmit = (e) => {
    e.preventDefault();
    clearError();

    const err = validateUsername(modalUsername);
    if (err) {
      setUsernameError(err);
      return;
    }

    setUsernameError('');
    setIsSubmitting(true);
    joinRoom(cleanRoomId, modalUsername.trim());

    // 10s fallback timeout
    if (joinTimeoutRef.current) clearTimeout(joinTimeoutRef.current);
    joinTimeoutRef.current = setTimeout(() => {
      setIsSubmitting(false);
      setUsernameError('Join request timed out. Please check your connection.');
    }, 10000);
  };

  const handleCancelModal = useCallback(() => {
    clearError();
    navigate('/');
  }, [clearError, navigate]);

  const handleLeave = () => {
    leaveRoom();
    showToast('You left the room.', 'info', 3000);
    navigate('/');
  };

  const handleCopyRoomCode = () => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(cleanRoomId);
      showToast(`Room code "${cleanRoomId}" copied to clipboard!`, 'info', 2500);
    }
  };

  const handleCopyInviteLink = () => {
    const inviteUrl = `${window.location.origin}/room/${cleanRoomId}`;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(inviteUrl)
        .then(() => {
          showToast(`Invite link copied to clipboard!`, 'success', 3000);
        })
        .catch(() => {
          // Fallback if clipboard permission fails
          showToast(`Invite link: ${inviteUrl}`, 'info', 5000);
        });
    } else {
      showToast(`Invite link: ${inviteUrl}`, 'info', 5000);
    }
  };

  // ---------------------------------------------------------------------------
  // Render: Direct URL Visitor (Not Joined Yet)
  // ---------------------------------------------------------------------------
  if (!isJoined) {
    return (
      <div className={styles.modalPromptContainer}>
        {/* Background placeholder while modal is open */}
        <Card
          title={`Connecting to Room ${cleanRoomId}...`}
          subtitle="Waiting for user credentials"
          headerAction={<ConnectionStatusIndicator size="sm" />}
          style={{ width: '100%', maxWidth: '480px', opacity: 0.6 }}
        >
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', margin: 0 }}>
            Please enter your display name in the prompt to join this synchronized watch session.
          </p>
        </Card>

        {/* Username Prompt Modal */}
        <Modal
          isOpen={!isJoined}
          onClose={handleCancelModal}
          title={`Join Room: ${cleanRoomId}`}
          subtitle="You opened a direct invite link. Enter your display name to enter the watch room."
          closeOnBackdrop={false}
          closeOnEscape={true}
          showCloseButton={true}
          footer={
            <>
              <Button
                variant="ghost"
                size="md"
                onClick={handleCancelModal}
                disabled={isJoining}
              >
                Back to Lobby
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={handleModalJoinSubmit}
                isLoading={isJoining}
                disabled={!isConnected || isJoining}
              >
                {isJoining ? 'Joining Room...' : 'Enter Watch Party'}
              </Button>
            </>
          }
        >
          <form onSubmit={handleModalJoinSubmit} noValidate>
            {error && error.code !== 'ROOM_NOT_FOUND' && (
              <div style={{
                padding: '0.65rem 0.85rem',
                marginBottom: '1rem',
                backgroundColor: 'var(--danger-bg)',
                border: '1px solid var(--danger-border)',
                borderRadius: 'var(--radius-md)',
                color: '#fca5a5',
                fontSize: '0.85rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <span><strong>{error.code}:</strong> {error.message}</span>
                <Button variant="ghost" size="sm" onClick={clearError} style={{ padding: '0.1rem 0.3rem', color: '#fca5a5' }}>
                  &times;
                </Button>
              </div>
            )}

            <Input
              label="Your Display Name"
              placeholder="e.g. Charlie"
              value={modalUsername}
              onChange={(e) => {
                setModalUsername(e.target.value);
                if (usernameError) setUsernameError('');
              }}
              error={usernameError}
              helperText="Choose a name to identify yourself in the room (2-20 chars)."
              maxLength={VALIDATION.USERNAME_MAX_LENGTH}
              disabled={isJoining}
              autoFocus
            />
          </form>
        </Modal>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Active Joined Watch Party View (Two-Column Assembled Room)
  // ---------------------------------------------------------------------------
  const isPlaying = syncState.playState === 'playing';

  return (
    <div className={styles.roomContainer}>
      {/* 1. Header Bar with Room Code, Copy Action, User Role, and Controls */}
      <header className={styles.headerBar}>
        <div className={styles.headerLeft}>
          <Link to="/" className={styles.appBrand} title="Return to lobby">
            <span>&#9654; WatchTogether</span>
          </Link>

          <div className={styles.roomCodeBadge}>
            <span>Room: {cleanRoomId}</span>
            <button
              type="button"
              className={styles.copyCodeBtn}
              onClick={handleCopyRoomCode}
              title="Copy room code"
            >
              &#128203; Copy
            </button>
          </div>

          <button
            type="button"
            className={styles.copyInviteBtn}
            onClick={handleCopyInviteLink}
            title="Copy shareable invite link to clipboard"
          >
            <span>&#128279;</span>
            <span>Copy Invite Link</span>
          </button>
        </div>

        <div className={styles.headerRight}>
          <UserNav />
          <div className={styles.userSummary}>
            <span className={styles.usernameHighlight}>{me?.username || 'User'}</span>
            {me?.role && (
              <Badge variant={me.role.toLowerCase()} size="sm">
                {me.role}
              </Badge>
            )}
          </div>

          <ConnectionStatusIndicator size="sm" />

          <Button variant="danger" size="sm" onClick={handleLeave}>
            Leave Room
          </Button>
        </div>
      </header>

      {/* Global Server Error Alert Banner */}
      {error && (
        <div className={styles.errorBanner}>
          <span><strong>{error.code}:</strong> {error.message}</span>
          <button
            type="button"
            className={styles.closeErrorBtn}
            onClick={clearError}
            aria-label="Dismiss error"
          >
            &times;
          </button>
        </div>
      )}

      {/* 2. Main Responsive Two-Column Layout */}
      <main className={styles.mainLayout}>
        {/* Left Column: Player & Controls */}
        <section className={styles.leftColumn}>
          {/* Synchronized YouTube IFrame Player with In-Video Controls & Floating Reaction Overlay */}
          <div
            className={styles.playerWrapper}
            ref={playerWrapperRef}
            style={{ position: 'relative' }}
            onMouseEnter={() => setIsPlayerHovered(true)}
            onMouseMove={handlePlayerMouseMove}
            onMouseLeave={handlePlayerMouseLeave}
          >
            <YouTubePlayer
              ref={playerRef}
              videoId={syncState.videoId}
              initialTime={syncState.currentTime}
              onReady={() => setIsPlayerReady(true)}
              onStateChange={handlePlayerStateChange}
            />
            {/* Floating reaction animation viewport overlay */}
            <ReactionOverlay showBar={false} />

            {/* In-Video Controls: Play, Pause, Seekbar, Skips, Timestamp inside video */}
            <VideoOverlayControls
              playerRef={playerRef}
              videoContainerRef={playerWrapperRef}
              isHovered={isPlayerHovered}
            />
          </div>

          {/* Change Video Stream Input */}
          <PlayerControls />

          {/* Emoji Reaction Bar (6 Whitelisted Emojis) */}
          <ReactionOverlay showBar={true} />

          {/* Action Request Panel (For Participant / Viewer suggestion queue) */}
          <ActionRequestPanel />
        </section>

        {/* Right Column: Playback State Pill, Approval Queue & Participants Roster */}
        <aside className={styles.rightColumn}>
          {/* Playback Status Pill */}
          <div className={styles.playbackStatusPill}>
            <div className={styles.playbackStateLabel}>
              <span
                className={`${styles.playbackDot} ${isPlaying ? styles.dotPlaying : styles.dotPaused}`}
              />
              <span>{syncState.playState}</span>
            </div>
            <div className={styles.playbackTimeLabel}>
              {formatTime(syncState.currentTime || 0)}
              {syncState.videoId && ` \u2022 ${syncState.videoId}`}
            </div>
          </div>

          {/* Host & Moderator Action Approval Panel (Shows when requests are pending) */}
          <ApprovalPanel />

          {/* Connected Participants List & Host Administration Toolbar */}
          <ParticipantsList />

          {/* Real-time Room Chat */}
          <Chat />
        </aside>
      </main>
    </div>
  );
}

export default Room;
