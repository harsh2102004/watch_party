/**
 * @file constants.js
 * @description Centralized application constants, Role definitions, and Socket.IO
 * event registries with comprehensive payload documentation to eliminate typos
 * and enforce contract parity between client and server.
 */

/**
 * Available user roles within a watch party room.
 * Mirrors server-side Role enum.
 *
 * @readonly
 * @enum {string}
 */
export const Role = Object.freeze({
  /** Room creator with complete playback and administrative authority. */
  HOST: 'HOST',
  /** Moderator with direct playback controls and request review authority. */
  MODERATOR: 'MODERATOR',
  /** Standard room member capable of viewing and proposing playback actions. */
  PARTICIPANT: 'PARTICIPANT',
  /** Read-only spectator restricted to listening and watching. */
  VIEWER: 'VIEWER',
});

/**
 * Socket.IO event names used across the application.
 * All event payloads are documented in the JSDoc comments below.
 *
 * @readonly
 */
export const SOCKET_EVENTS = Object.freeze({
  // ---------------------------------------------------------------------------
  // Connection & Transport (Socket.IO built-in)
  // ---------------------------------------------------------------------------
  /**
   * Fired upon successful WebSocket connection establishment.
   * Payload: none
   */
  CONNECT: 'connect',

  /**
   * Fired when the socket connection is severed.
   * Payload: (reason: string)
   */
  DISCONNECT: 'disconnect',

  /**
   * Fired when connection handshake fails.
   * Payload: (error: Error)
   */
  CONNECT_ERROR: 'connect_error',

  // ---------------------------------------------------------------------------
  // Room Lifecycle Events (Client -> Server)
  // ---------------------------------------------------------------------------
  /**
   * Request to create a new watch room.
   * Payload: { username: string }
   */
  CREATE_ROOM: 'create_room',

  /**
   * Request to join an existing room by its 6-character room code.
   * Payload: { roomId: string, username: string }
   */
  JOIN_ROOM: 'join_room',

  /**
   * Voluntarily leave the current room.
   * Payload: { roomId: string }
   */
  LEAVE_ROOM: 'leave_room',

  // ---------------------------------------------------------------------------
  // Room Lifecycle Events (Server -> Client)
  // ---------------------------------------------------------------------------
  /**
   * Emitted to creator upon successful room creation.
   * Payload: {
   *   roomId: string,
   *   userId: string,
   *   role: 'HOST',
   *   participants: Array<{ userId, username, role, joinedAt }>,
   *   state: { videoId: string|null, playState: 'playing'|'paused', currentTime: number }
   * }
   */
  ROOM_CREATED: 'room_created',

  /**
   * Emitted to joining user upon successful room entry.
   * Payload: {
   *   roomId: string,
   *   userId: string,
   *   role: Role,
   *   participants: Array<{ userId, username, role, joinedAt }>,
   *   sync_state: { videoId: string|null, playState: 'playing'|'paused', currentTime: number }
   * }
   */
  ROOM_JOINED: 'room_joined',

  /**
   * Broadcast to existing members when a new user enters the room.
   * Payload: {
   *   userId: string,
   *   username: string,
   *   role: Role,
   *   participants: Array<{ userId, username, role, joinedAt }>
   * }
   */
  USER_JOINED: 'user_joined',

  /**
   * Broadcast to remaining members when a user departs or disconnects.
   * Payload: {
   *   userId: string,
   *   username: string,
   *   participants: Array<{ userId, username, role, joinedAt }>
   * }
   */
  USER_LEFT: 'user_left',

  // ---------------------------------------------------------------------------
  // Media Playback Controls (Guarded for HOST / MODERATOR)
  // ---------------------------------------------------------------------------
  /**
   * Request to resume playback at computed time.
   * Payload: {}
   */
  PLAY: 'play',

  /**
   * Request to pause playback at computed time.
   * Payload: {}
   */
  PAUSE: 'pause',

  /**
   * Request to jump playback to a target position.
   * Payload: { time: number } (non-negative timestamp in seconds)
   */
  SEEK: 'seek',

  /**
   * Request to change active YouTube video.
   * Payload: { videoId: string } (canonical 11-char ID or YouTube URL)
   */
  CHANGE_VIDEO: 'change_video',

  /**
   * Authoritative playback state broadcast to all room members.
   * Payload: {
   *   videoId: string|null,
   *   playState: 'playing' | 'paused',
   *   currentTime: number,
   *   serverTimestamp: number
   * }
   */
  SYNC_STATE: 'sync_state',

  // ---------------------------------------------------------------------------
  // Moderation & Role Administration (Guarded for HOST)
  // ---------------------------------------------------------------------------
  /**
   * Host assigns a new role to a participant.
   * Payload: { userId: string, role: 'MODERATOR' | 'PARTICIPANT' | 'VIEWER' }
   */
  ASSIGN_ROLE: 'assign_role',

  /**
   * Host removes a participant from the room.
   * Payload: { userId: string, reason?: string }
   */
  REMOVE_PARTICIPANT: 'remove_participant',

  /**
   * Host abdicates and transfers HOST authority to target user.
   * Old host becomes MODERATOR.
   * Payload: { userId: string }
   */
  TRANSFER_HOST: 'transfer_host',

  /**
   * Broadcast when a user's role is updated or auto-promoted.
   * Payload: {
   *   userId: string,
   *   username: string,
   *   role: Role,
   *   participants: Array<{ userId, username, role, joinedAt }>
   * }
   */
  ROLE_ASSIGNED: 'role_assigned',

  /**
   * Direct unicast to target socket when removed by host.
   * Payload: { reason: string }
   */
  REMOVED: 'removed',

  /**
   * Broadcast to remaining members when a participant is evicted.
   * Payload: {
   *   userId: string,
   *   participants: Array<{ userId, username, role, joinedAt }>
   * }
   */
  PARTICIPANT_REMOVED: 'participant_removed',

  // ---------------------------------------------------------------------------
  // Action Suggestions & Moderation Queue (PARTICIPANT / VIEWER)
  // ---------------------------------------------------------------------------
  /**
   * Non-host suggests a playback change.
   * Payload: {
   *   type: 'play' | 'pause' | 'seek' | 'change_video',
   *   payload: { time?: number, videoId?: string }
   * }
   */
  REQUEST_ACTION: 'request_action',

  /**
   * Acknowledgment receipt sent back to requester upon successful queuing.
   * Payload: {
   *   requestId: string,
   *   request: { id, type, payload, requesterId, requesterName, createdAt }
   * }
   */
  REQUEST_QUEUED: 'request_queued',

  /**
   * Alert dispatched selectively to HOST and MODERATOR sockets.
   * Payload: {
   *   id: string,
   *   requestId: string,
   *   type: 'play' | 'pause' | 'seek' | 'change_video',
   *   payload: any,
   *   requesterId: string,
   *   requesterName: string,
   *   createdAt: number
   * }
   */
  ACTION_REQUESTED: 'action_requested',

  /**
   * Host/Moderator approves a queued action suggestion.
   * Payload: { requestId: string }
   */
  APPROVE_REQUEST: 'approve_request',

  /**
   * Host/Moderator rejects a queued action suggestion.
   * Payload: { requestId: string, reason?: string }
   */
  REJECT_REQUEST: 'reject_request',

  /**
   * Notification sent directly to requester when suggestion is rejected.
   * Payload: { requestId: string, reason: string }
   */
  REQUEST_REJECTED: 'request_rejected',

  /**
   * Resolution event sent to HOST, MODERATORs, and requester.
   * Payload: {
   *   requestId: string,
   *   status: 'approved' | 'rejected' | 'expired'
   * }
   */
  REQUEST_RESOLVED: 'request_resolved',

  // ---------------------------------------------------------------------------
  // Real-Time Room Chat Events
  // ---------------------------------------------------------------------------
  /**
   * Room member broadcasts or sends a text message.
   * Client emit payload: { text: string }
   * Server broadcast payload: {
   *   id: string,
   *   userId: string,
   *   username: string,
   *   role: Role,
   *   text: string,
   *   timestamp: number
   * }
   */
  CHAT_MESSAGE: 'chat_message',

  // ---------------------------------------------------------------------------
  // Real-Time Emoji Reaction Events
  // ---------------------------------------------------------------------------
  /**
   * Room member broadcasts a floating emoji reaction.
   * Client emit payload: { emoji: string }
   * Server broadcast payload: {
   *   emoji: string,
   *   userId: string,
   *   username: string,
   *   timestamp: number
   * }
   */
  REACTION: 'reaction',

  // ---------------------------------------------------------------------------
  // Global Error Event
  // ---------------------------------------------------------------------------
  /**
   * Emitted to client when an action fails validation or permission checks.
   * Payload: {
   *   code: 'INVALID_USERNAME' | 'ROOM_NOT_FOUND' | 'USERNAME_TAKEN' |
   *         'NOT_IN_ROOM' | 'FORBIDDEN' | 'INVALID_TIME' | 'INVALID_VIDEO' |
   *         'USER_NOT_FOUND' | 'INVALID_REQUEST' | 'REQUEST_LIMIT_REACHED' |
   *         'REQUEST_NOT_FOUND' | 'RATE_LIMITED' | 'MESSAGE_TOO_LONG' |
   *         'INVALID_MESSAGE' | 'INVALID_REACTION',
   *   message: string
   * }
   */
  ERROR_EVENT: 'error_event',
});

/**
 * Whitelist of allowed reaction emojis.
 * @readonly
 */
export const ALLOWED_REACTIONS = Object.freeze([
  '❤️',
  '🔥',
  '😂',
  '🎉',
  '😮',
  '👏',
]);

/**
 * Validation constraints for user inputs.
 * @readonly
 */
export const VALIDATION = Object.freeze({
  USERNAME_MIN_LENGTH: 2,
  USERNAME_MAX_LENGTH: 20,
  ROOM_CODE_LENGTH: 6,
  ROOM_CODE_REGEX: /^[A-Z0-9]{6}$/,
  CHAT_MAX_LENGTH: 300,
});

/**
 * Valid action types allowed in playback requests.
 * @readonly
 */
export const REQUEST_TYPES = Object.freeze({
  PLAY: 'play',
  PAUSE: 'pause',
  SEEK: 'seek',
  CHANGE_VIDEO: 'change_video',
});

/**
 * Video synchronization parameters.
 * @readonly
 */
export const SYNC_CONFIG = Object.freeze({
  /** Drift threshold in seconds before issuing an imperative seek. */
  DRIFT_THRESHOLD_SECONDS: 1.5,
  /** Grace period in milliseconds to suppress echo loop state events after remote sync. */
  ECHO_SUPPRESSION_MS: 500,
});

/**
 * Lifecycle statuses for pending playback suggestions.
 * @readonly
 */
export const REQUEST_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
});
