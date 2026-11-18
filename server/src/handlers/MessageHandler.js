/**
 * @file MessageHandler.js
 * @description Registers Socket.IO event listeners for a connected socket.
 */

import { Participant } from '../models/Participant.js';
import { Room } from '../models/Room.js';
import { Role } from '../models/role.js';
import { withPermission } from './guard.js';
import { extractVideoId } from '../utils/youtube.js';
import { ChatHandler } from './ChatHandler.js';
import { ReactionHandler } from './ReactionHandler.js';
import { roomRepository } from '../services/RoomRepository.js';

const USERNAME_MIN = 1;
const USERNAME_MAX = 20;

/**
 * Emits a standardized error event to a specific socket.
 *
 * @param {import('socket.io').Socket} socket - The target socket.
 * @param {string} code - A short machine-readable error code (e.g. 'ROOM_NOT_FOUND').
 * @param {string} message - A human-readable description of the error.
 */
export function emitError(socket, code, message) {
  socket.emit('error_event', { code, message });
}

/**
 * Validates and normalizes a username string.
 *
 * @param {unknown} username - Raw input from client.
 * @returns {{ valid: boolean, value?: string, error?: string }} Result object.
 */
function validateUsername(username) {
  if (typeof username !== 'string') {
    return { valid: false, error: 'Username must be a string.' };
  }
  const trimmed = username.trim();
  if (trimmed.length < USERNAME_MIN || trimmed.length > USERNAME_MAX) {
    return {
      valid: false,
      error: `Username must be between ${USERNAME_MIN} and ${USERNAME_MAX} characters.`,
    };
  }
  return { valid: true, value: trimmed };
}

/**
 * Handles all Socket.IO event listeners for a connected client.
 */
export class MessageHandler {
  /**
   * @param {import('socket.io').Server} io - The Socket.IO server instance.
   * @param {import('../models/RoomManager.js').RoomManager} roomManager - The shared room manager.
   * @param {Object} [options] - Configuration options for request lifecycle.
   * @param {number} [options.requestTtlMs=60000] - Expiry TTL for pending requests in ms.
   * @param {number} [options.sweeperIntervalMs=1000] - Frequency of sweeper interval in ms.
   */
  constructor(io, roomManager, options = {}) {
    this.io = io;
    this.roomManager = roomManager;
    this.requestTtlMs = typeof options.requestTtlMs === 'number' ? options.requestTtlMs : 60000;
    this.sweeperIntervalMs = typeof options.sweeperIntervalMs === 'number' ? options.sweeperIntervalMs : 1000;
    /** @type {Map<string, NodeJS.Timeout>} Active interval timers for room request sweepers */
    this.roomSweepers = new Map();
    /** @type {ChatHandler} Dedicated handler for room chat messages */
    this.chatHandler = new ChatHandler(this.io, this.roomManager);
    /** @type {ReactionHandler} Dedicated handler for room emoji reactions */
    this.reactionHandler = new ReactionHandler(this.io, this.roomManager);
  }

  /**
   * Attaches all event listeners to the given socket.
   *
   * @param {import('socket.io').Socket} socket - The newly connected socket.
   */
  register(socket) {
    console.log(`client connected: ${socket.id}`);

    // Delegate real-time chat handler
    this.chatHandler.register(socket);
    // Delegate real-time reaction handler
    this.reactionHandler.register(socket);

    socket.on('create_room', (data) => this.#onCreateRoom(socket, data));
    socket.on('join_room', (data) => this.#onJoinRoom(socket, data));
    socket.on('leave_room', (data) => this.#onLeaveRoom(socket, data));
    socket.on('disconnect', () => this.#onDisconnect(socket));

    // Playback control events (protected by permission guard)
    socket.on('play', withPermission('play', this.roomManager, socket, (ctx) => this.#onPlay(ctx)));
    socket.on('pause', withPermission('pause', this.roomManager, socket, (ctx) => this.#onPause(ctx)));
    socket.on('seek', withPermission('seek', this.roomManager, socket, (ctx) => this.#onSeek(ctx)));
    socket.on('change_video', withPermission('change_video', this.roomManager, socket, (ctx) => this.#onChangeVideo(ctx)));

    // Role & room administration events (guarded by permission guard: HOST only)
    socket.on('assign_role', withPermission('assign_role', this.roomManager, socket, (ctx) => this.#onAssignRole(ctx)));
    socket.on('remove_participant', withPermission('remove_participant', this.roomManager, socket, (ctx) => this.#onRemoveParticipant(ctx)));
    socket.on('transfer_host', withPermission('transfer_host', this.roomManager, socket, (ctx) => this.#onTransferHost(ctx)));

    // Action request & review events
    socket.on('request_action', withPermission('request_action', this.roomManager, socket, (ctx) => this.#onRequestAction(ctx)));
    socket.on('approve_request', withPermission('approve_request', this.roomManager, socket, (ctx) => this.#onApproveRequest(ctx)));
    socket.on('reject_request', withPermission('reject_request', this.roomManager, socket, (ctx) => this.#onRejectRequest(ctx)));
  }

  // ---------------------------------------------------------------------------
  // Private handlers
  // ---------------------------------------------------------------------------

  /**
   * Handles "create_room" event.
   * Validates username, creates a room, adds the creator as HOST,
   * and emits "room_created" back to the creator.
   *
   * @param {import('socket.io').Socket} socket
   * @param {{ username: string }} data
   */
  async #onCreateRoom(socket, data) {
    let username;
    let userId;

    if (socket.data?.user && !socket.data.user.isGuest) {
      // Authenticated user: enforce verified identity from token
      username = socket.data.user.username;
      userId = socket.data.user.userId;
    } else {
      // Guest user: validate requested username
      const rawName = data?.username || socket.data?.user?.username;
      const { valid, value, error } = validateUsername(rawName);
      if (!valid) {
        return emitError(socket, 'INVALID_USERNAME', error);
      }
      username = value;
      userId = socket.data?.user?.userId;
    }

    // Create room and add the creator as HOST
    const room = this.roomManager.createRoom();
    const host = new Participant({ username, socketId: socket.id, role: Role.HOST, userId });
    room.addParticipant(host);
    this.startRoomSweeper(room);

    // Save room to persistence (fire-and-forget, non-blocking)
    roomRepository.saveRoom(room);

    // Subscribe the socket to the room channel
    await socket.join(room.roomId);

    socket.emit('room_created', {
      roomId: room.roomId,
      userId: host.userId,
      role: host.role,
      participants: room.getParticipantsList(),
      state: {
        videoId: room.videoId,
        playState: room.playState,
        currentTime: room.getComputedTime(),
      },
      chat_history: room.getChatHistory(),
    });

    console.log(`Room ${room.roomId} created by "${username}" (${socket.id})`);
  }

  /**
   * Handles "join_room" event.
   * Validates roomId and username, checks availability, adds participant,
   * joins socket channel, emits "room_joined" to joiner, and broadcasts
   * "user_joined" to other members in the room.
   *
   * @param {import('socket.io').Socket} socket
   * @param {{ roomId: string, username: string }} data
   */
  async #onJoinRoom(socket, data) {
    const roomId = typeof data?.roomId === 'string' ? data.roomId.trim().toUpperCase() : '';
    let room = this.roomManager.getRoom(roomId);

    // If room is not in memory, attempt restoration from persistent storage (MongoDB / repository)
    if (!room && roomId) {
      try {
        const persistedDoc = await roomRepository.findRoom(roomId);
        if (persistedDoc) {
          // Recreate empty room in memory (paused at time 0)
          room = new Room({
            roomId: persistedDoc.roomId || roomId,
            videoId: persistedDoc.videoId || null,
            currentTime: 0,
            playState: 'paused',
          });
          room.isRestored = true;

          // Load recent messages into room's chat cache
          const recentMessages = await roomRepository.getRecentMessages(roomId, 50);
          for (const msg of recentMessages) {
            room.addChatMessage(msg);
          }

          this.roomManager.rooms.set(room.roomId, room);
          console.log(`[RoomManager] Restored room ${room.roomId} from database on join.`);
        }
      } catch (err) {
        console.warn(`[RoomManager] Error attempting to restore room ${roomId}: ${err.message}`);
      }
    }

    if (!room) {
      return emitError(socket, 'ROOM_NOT_FOUND', `Room "${roomId}" does not exist.`);
    }

    let username;
    let userId;

    if (socket.data?.user && !socket.data.user.isGuest) {
      // Authenticated user: enforce verified identity from token
      username = socket.data.user.username;
      userId = socket.data.user.userId;
    } else {
      // Guest user: validate requested username
      const rawName = data?.username || socket.data?.user?.username;
      const { valid, value, error } = validateUsername(rawName);
      if (!valid) {
        return emitError(socket, 'INVALID_USERNAME', error);
      }
      username = value;
      userId = socket.data?.user?.userId;
    }

    // Reconnect & Role Restore Check:
    // When an authenticated user reconnects (page refresh or network drop) or opens a second tab,
    // restore their previous role and participant entry instead of creating duplicates or failing.
    const existingParticipant = userId ? room.getParticipant(userId) : null;
    if (existingParticipant) {
      // Interview Decision: Active Single-Session Enforcement
      // Allowing multiple concurrent WebSocket connections for one authenticated user
      // causes split-brain playback sync conflicts, double-heartbeats, and request loops.
      // We gracefully disconnect the older tab/session before attaching the new socket.
      if (existingParticipant.socketId && existingParticipant.socketId !== socket.id) {
        const oldSocket = this.io.sockets.sockets.get(existingParticipant.socketId);
        if (oldSocket) {
          oldSocket.emit('session_replaced', {
            message: 'You have joined this room in another tab or window. This session has been closed.',
          });
          oldSocket.disconnect(true);
        }
      }

      existingParticipant.socketId = socket.id;
      await socket.join(room.roomId);

      socket.emit('room_joined', {
        roomId: room.roomId,
        userId: existingParticipant.userId,
        role: existingParticipant.role,
        participants: room.getParticipantsList(),
        sync_state: {
          videoId: room.videoId,
          playState: room.playState,
          currentTime: room.getComputedTime(),
        },
        chat_history: room.getChatHistory(),
      });

      console.log(`[Reconnect] Restored session & role (${existingParticipant.role}) for "${existingParticipant.username}" (${userId}) in ${room.roomId}`);
      return;
    }

    // Cancel any pending empty-room grace timer on join
    if (room.graceTimer) {
      clearTimeout(room.graceTimer);
      room.graceTimer = null;
    }

    if (room.isUsernameTaken(username, userId)) {
      return emitError(
        socket,
        'USERNAME_TAKEN',
        `Username "${username}" is already taken in this room.`
      );
    }

    // Determine role:
    // 1. If user previously disconnected from this active room, restore their previous role!
    // 2. If room is empty (e.g. restored from persistence or grace window), first joiner becomes HOST.
    // 3. Otherwise default to Role.PARTICIPANT.
    const restoredRole = userId ? room.getDisconnectedRole(userId) : null;
    const isFirstJoiner = room.isEmpty();
    const assignedRole = restoredRole || (isFirstJoiner ? Role.HOST : Role.PARTICIPANT);

    if (restoredRole && userId) {
      room.clearDisconnectedParticipant(userId);
    }

    // Add joiner to the room
    const participant = new Participant({
      username,
      socketId: socket.id,
      role: assignedRole,
      userId,
    });
    room.addParticipant(participant);

    // If room was restored, it is now active; ensure sweeper is running
    if (isFirstJoiner && !this.roomSweepers.has(room.roomId)) {
      this.startRoomSweeper(room);
    }

    // Subscribe to Socket.IO room channel
    await socket.join(room.roomId);

    // 1. Emit full room state back to the newly joined client
    socket.emit('room_joined', {
      roomId: room.roomId,
      userId: participant.userId,
      role: participant.role,
      participants: room.getParticipantsList(),
      sync_state: {
        videoId: room.videoId,
        playState: room.playState,
        currentTime: room.getComputedTime(),
      },
      chat_history: room.getChatHistory(),
    });

    // 2. Broadcast to other members in the room that someone joined
    socket.to(room.roomId).emit('user_joined', {
      userId: participant.userId,
      username: participant.username,
      role: participant.role,
      participants: room.getParticipantsList(),
    });

    console.log(`"${username}" joined room ${room.roomId} (${socket.id})`);
  }

  /**
   * Handles "leave_room" event.
   * Removes participant from room, broadcasts "user_left", auto-promotes
   * if host left, prunes empty room, and leaves socket channel.
   *
   * @param {import('socket.io').Socket} socket
   * @param {{ roomId: string }} data
   */
  async #onLeaveRoom(socket, data) {
    const roomId = typeof data?.roomId === 'string' ? data.roomId.trim().toUpperCase() : '';
    const room = this.roomManager.getRoom(roomId);
    if (!room) {
      return emitError(socket, 'ROOM_NOT_FOUND', `Room "${roomId}" does not exist.`);
    }

    this.#removeParticipantFromRoom(socket, room);
    await socket.leave(room.roomId);
  }

  /**
   * Handles socket disconnect event.
   * Finds any room the socket is currently part of, cleans up participant,
   * broadcasts departure, auto-promotes host if needed, and deletes empty rooms.
   *
   * @param {import('socket.io').Socket} socket
   */
  #onDisconnect(socket) {
    console.log(`client disconnected: ${socket.id}`);

    // Scan rooms to find if this socket was a participant
    for (const [, room] of this.roomManager.rooms) {
      if (room.getParticipantBySocket(socket.id)) {
        this.#removeParticipantFromRoom(socket, room);
      }
    }
  }

  /**
   * Handles "play" event (guarded).
   * Executes play on room state and broadcasts sync_state to all room participants.
   *
   * @param {{ socket: import('socket.io').Socket, room: import('../models/Room.js').Room, participant: Participant, data: any }} context
   */
  #onPlay({ room }) {
    room.play();
    this.#broadcastSyncState(room);
  }

  /**
   * Handles "pause" event (guarded).
   * Executes pause on room state and broadcasts sync_state to all room participants.
   *
   * @param {{ socket: import('socket.io').Socket, room: import('../models/Room.js').Room, participant: Participant, data: any }} context
   */
  #onPause({ room }) {
    room.pause();
    this.#broadcastSyncState(room);
  }

  /**
   * Handles "seek" event (guarded).
   * Validates target time is a non-negative number, sets currentTime,
   * preserves existing playState, updates lastUpdatedAt, and broadcasts sync_state.
   *
   * @param {{ socket: import('socket.io').Socket, room: import('../models/Room.js').Room, participant: Participant, data: { time: number } }} context
   */
  #onSeek({ socket, room, data }) {
    const seekTime = data?.time;
    if (typeof seekTime !== 'number' || Number.isNaN(seekTime) || seekTime < 0) {
      return emitError(socket, 'INVALID_TIME', 'Seek time must be a non-negative number.');
    }

    room.seek(seekTime);
    this.#broadcastSyncState(room);
  }

  /**
   * Handles "change_video" event (guarded).
   * Extracts valid YouTube video ID from URL or raw ID, resets currentTime to 0,
   * sets playState to 'paused', updates lastUpdatedAt, and broadcasts sync_state.
   *
   * @param {{ socket: import('socket.io').Socket, room: import('../models/Room.js').Room, participant: Participant, data: { videoId: string } }} context
   */
  #onChangeVideo({ socket, room, data }) {
    const rawInput = data?.videoId;
    if (!rawInput || typeof rawInput !== 'string') {
      return emitError(socket, 'INVALID_VIDEO', 'A valid videoId or YouTube URL is required.');
    }

    const videoId = extractVideoId(rawInput);
    if (!videoId) {
      return emitError(socket, 'INVALID_VIDEO', 'Invalid YouTube URL or video ID.');
    }

    room.changeVideo(videoId);
    roomRepository.updateVideo(room.roomId, videoId);
    this.#broadcastSyncState(room);
  }

  /**
   * Handles "assign_role" event (guarded: HOST only).
   * Rules:
   * - Cannot target self.
   * - Cannot assign HOST via this event (use transfer_host instead).
   * - Target participant must exist in the room.
   * - Role must be a valid Role value.
   * Updates participant role and broadcasts role_assigned to the whole room.
   *
   * @param {{ socket: import('socket.io').Socket, room: import('../models/Room.js').Room, participant: Participant, data: any }} context
   */
  #onAssignRole({ socket, room, participant, data }) {
    const targetUserId = data?.userId;
    const newRole = data?.role;

    // Rule 1: Target participant must be provided
    if (!targetUserId || typeof targetUserId !== 'string') {
      return emitError(socket, 'INVALID_REQUEST', 'target userId is required.');
    }

    // Rule 2: Cannot target self
    if (targetUserId === participant.userId) {
      return emitError(socket, 'INVALID_REQUEST', 'Cannot change your own role via assign_role.');
    }

    // Rule 3: Cannot assign HOST via this event
    if (newRole === Role.HOST) {
      return emitError(socket, 'INVALID_ROLE', 'Cannot assign HOST role via assign_role. Use transfer_host.');
    }

    // Rule 4: Role must be a valid Role value (MODERATOR, PARTICIPANT, VIEWER)
    const validRoles = [Role.MODERATOR, Role.PARTICIPANT, Role.VIEWER];
    if (!validRoles.includes(newRole)) {
      return emitError(socket, 'INVALID_ROLE', `Invalid role "${newRole}".`);
    }

    // Rule 5: Target participant must exist in the room
    const targetParticipant = room.getParticipant(targetUserId);
    if (!targetParticipant) {
      return emitError(socket, 'USER_NOT_FOUND', 'Target user is not in this room.');
    }

    // Update target participant's role
    room.setRole(targetUserId, newRole);

    // Broadcast role_assigned to the room
    this.io.to(room.roomId).emit('role_assigned', {
      userId: targetParticipant.userId,
      username: targetParticipant.username,
      role: targetParticipant.role,
      participants: room.getParticipantsList(),
    });

    console.log(`Role assigned: ${targetParticipant.username} is now ${newRole} in ${room.roomId}`);
  }

  /**
   * Handles "remove_participant" event.
   * Guarded by permission guard: Role.HOST only.
   * Rules:
   * 1. Target userId must be provided.
   * 2. Cannot target self (HOST cannot remove self).
   * 3. Target participant must exist in the room.
   * Actions:
   * - Emits "removed" { reason } directly to the target socket.
   * - Makes the target socket leave the room channel.
   * - Removes the participant from the room model.
   * - Broadcasts "participant_removed" { userId, participants } to the rest of the room.
   *
   * @param {{ socket: import('socket.io').Socket, room: import('../models/Room.js').Room, participant: import('../models/Participant.js').Participant, data: { userId: string, reason?: string } }} ctx
   */
  async #onRemoveParticipant({ socket, room, participant, data }) {
    const targetUserId = data?.userId;

    // Rule 1: Target participant must be provided
    if (!targetUserId || typeof targetUserId !== 'string') {
      return emitError(socket, 'INVALID_REQUEST', 'userId is required.');
    }

    // Rule 2: Cannot target self
    if (targetUserId === participant.userId) {
      return emitError(socket, 'INVALID_REQUEST', 'Cannot remove yourself.');
    }

    // Rule 3: Target participant must exist in the room
    const targetParticipant = room.getParticipant(targetUserId);
    if (!targetParticipant) {
      return emitError(socket, 'USER_NOT_FOUND', 'Target user is not in this room.');
    }

    const reason = typeof data?.reason === 'string' && data.reason.trim()
      ? data.reason.trim()
      : 'Removed by host';

    // Find target socket to notify directly and remove from room channel
    const targetSocket = this.io.sockets?.sockets?.get?.(targetParticipant.socketId)
      || this.io.of?.('/').sockets?.get?.(targetParticipant.socketId);

    if (targetSocket) {
      targetSocket.emit('removed', { reason });
      await targetSocket.leave(room.roomId);
    }

    // Remove from the Room model
    room.removeParticipant(targetUserId);

    // Broadcast participant_removed to remaining room participants
    this.io.to(room.roomId).emit('participant_removed', {
      userId: targetUserId,
      participants: room.getParticipantsList(),
    });

    console.log(`"${targetParticipant.username}" (${targetUserId}) removed from room ${room.roomId} by host "${participant.username}"`);
  }

  /**
   * Handles "transfer_host" event.
   * Guarded by permission guard: Role.HOST only.
   * Rules:
   * 1. Target userId must be provided and valid.
   * 2. Cannot transfer to self (already host).
   * 3. Target participant must exist in the room.
   * Actions:
   * - Old host becomes Role.MODERATOR.
   * - Target user becomes Role.HOST.
   * - Broadcasts "role_assigned" for both users with the updated participants list.
   *
   * @param {{ socket: import('socket.io').Socket, room: import('../models/Room.js').Room, participant: import('../models/Participant.js').Participant, data: { userId: string } }} ctx
   */
  #onTransferHost({ socket, room, participant, data }) {
    const targetUserId = data?.userId;

    // Rule 1: Target participant must be provided
    if (!targetUserId || typeof targetUserId !== 'string') {
      return emitError(socket, 'INVALID_REQUEST', 'userId is required.');
    }

    // Rule 2: Cannot transfer host to self
    if (targetUserId === participant.userId) {
      return emitError(socket, 'INVALID_REQUEST', 'Cannot transfer host to yourself.');
    }

    // Rule 3: Target participant must exist in the room
    const targetParticipant = room.getParticipant(targetUserId);
    if (!targetParticipant) {
      return emitError(socket, 'USER_NOT_FOUND', 'Target user is not in this room.');
    }

    // Atomic role update: old host becomes MODERATOR, new host becomes HOST
    room.setRole(participant.userId, Role.MODERATOR);
    room.setRole(targetUserId, Role.HOST);

    const updatedParticipants = room.getParticipantsList();

    // Broadcast role_assigned for the demoted old host (now MODERATOR)
    this.io.to(room.roomId).emit('role_assigned', {
      userId: participant.userId,
      username: participant.username,
      role: Role.MODERATOR,
      participants: updatedParticipants,
    });

    // Broadcast role_assigned for the promoted new host (now HOST)
    this.io.to(room.roomId).emit('role_assigned', {
      userId: targetParticipant.userId,
      username: targetParticipant.username,
      role: Role.HOST,
      participants: updatedParticipants,
    });

    console.log(`Host transferred from "${participant.username}" to "${targetParticipant.username}" in room ${room.roomId}`);
  }

  /**
   * Handles "request_action" event from PARTICIPANT or VIEWER.
   * Validates action type and payload, enforces a per-user limit of 3 pending requests,
   * stores the request in Room.pendingRequests, acknowledges the requester with "request_queued",
   * and notifies HOST/MODERATOR sockets with "action_requested".
   *
   * @param {{ socket: import('socket.io').Socket, room: import('../models/Room.js').Room, participant: import('../models/Participant.js').Participant, data: { type: string, payload?: any } }} ctx
   */
  #onRequestAction({ socket, room, participant, data }) {
    const type = data?.type;
    const rawPayload = data?.payload;

    // 1. Validate action type
    const validTypes = ['play', 'pause', 'seek', 'change_video'];
    if (!type || typeof type !== 'string' || !validTypes.includes(type)) {
      return emitError(socket, 'INVALID_REQUEST', 'Action type must be play, pause, seek, or change_video.');
    }

    // 2. Validate payload based on action type
    let normalizedPayload = {};

    if (type === 'seek') {
      const seekTime = rawPayload?.time;
      if (typeof seekTime !== 'number' || Number.isNaN(seekTime) || seekTime < 0) {
        return emitError(socket, 'INVALID_REQUEST', 'Seek time must be a non-negative number.');
      }
      normalizedPayload = { time: seekTime };
    } else if (type === 'change_video') {
      const rawVideoId = rawPayload?.videoId;
      if (!rawVideoId || typeof rawVideoId !== 'string') {
        return emitError(socket, 'INVALID_VIDEO', 'A valid videoId or YouTube URL is required.');
      }
      const videoId = extractVideoId(rawVideoId);
      if (!videoId) {
        return emitError(socket, 'INVALID_VIDEO', 'Invalid YouTube URL or video ID.');
      }
      normalizedPayload = { videoId };
    } else {
      // play or pause
      normalizedPayload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
    }

    // 3. Ensure sweeper is running, prune expired requests, and enforce 3 pending requests limit per user
    this.startRoomSweeper(room);
    this.sweepExpiredRequests(room);

    const userPendingCount = room.getPendingList().filter(
      (req) => req.requesterId === participant.userId
    ).length;

    if (userPendingCount >= 3) {
      return emitError(socket, 'REQUEST_LIMIT_REACHED', 'Limit of 3 pending requests per user reached.');
    }

    // 4. Store request in the Room model
    const storedRequest = room.addRequest({
      type,
      payload: normalizedPayload,
      requesterId: participant.userId,
      requesterName: participant.username,
    });

    // 5. Send "request_queued" { requestId } to the requester
    socket.emit('request_queued', {
      requestId: storedRequest.id,
      request: storedRequest,
    });

    // 6. Emit "action_requested" with request details only to HOST/MODERATOR sockets in the room
    for (const p of room.participants.values()) {
      if (p.role === Role.HOST || p.role === Role.MODERATOR) {
        const modSocket = this.io.sockets?.sockets?.get?.(p.socketId)
          || this.io.of?.('/').sockets?.get?.(p.socketId);
        if (modSocket) {
          modSocket.emit('action_requested', {
            id: storedRequest.id,
            requestId: storedRequest.id,
            type: storedRequest.type,
            payload: storedRequest.payload,
            requesterId: storedRequest.requesterId,
            requesterName: storedRequest.requesterName,
            createdAt: storedRequest.createdAt,
          });
        }
      }
    }

    console.log(`Action "${type}" requested by "${participant.username}" in room ${room.roomId} (id: ${storedRequest.id})`);
  }

  /**
   * Handles "approve_request" event.
   * Guarded for HOST / MODERATOR roles.
   * - Executes the action via shared Room.applyAction(type, payload).
   * - Removes the request from Room.pendingRequests.
   * - Broadcasts updated sync_state to the room.
   * - Emits "request_resolved" { requestId, status: 'approved' } to HOST/MODERATORS and the requester.
   *
   * @param {{ socket: import('socket.io').Socket, room: import('../models/Room.js').Room, participant: Participant, data: { requestId: string } }} ctx
   */
  #onApproveRequest({ socket, room, data }) {
    const requestId = data?.requestId;
    if (!requestId || typeof requestId !== 'string') {
      return emitError(socket, 'INVALID_REQUEST', 'requestId is required.');
    }

    const request = room.getRequest(requestId);
    if (!request) {
      return emitError(socket, 'REQUEST_NOT_FOUND', 'Request not found.');
    }

    // 1. Execute action via shared Room action method
    room.applyAction(request.type, request.payload);

    // If approved request was change_video, update video in repository
    if (request.type === 'change_video' && request.payload?.videoId) {
      roomRepository.updateVideo(room.roomId, request.payload.videoId);
    }

    // 2. Remove pending request
    room.removeRequest(requestId);

    // 3. Broadcast sync_state to entire room
    this.#broadcastSyncState(room);

    // 4. Broadcast request_resolved to HOST/MODERATORS and notify requester
    this.#notifyRequestResolved(room, requestId, 'approved', request.requesterId);

    console.log(`Request ${requestId} (${request.type}) approved by room moderator`);
  }

  /**
   * Handles "reject_request" event.
   * Guarded for HOST / MODERATOR roles.
   * - Removes the request from Room.pendingRequests.
   * - Notifies requester with "request_rejected".
   * - Emits "request_resolved" { requestId, status: 'rejected' } to HOST/MODERATORS and the requester.
   *
   * @param {{ socket: import('socket.io').Socket, room: import('../models/Room.js').Room, participant: Participant, data: { requestId: string, reason?: string } }} ctx
   */
  #onRejectRequest({ socket, room, data }) {
    const requestId = data?.requestId;
    if (!requestId || typeof requestId !== 'string') {
      return emitError(socket, 'INVALID_REQUEST', 'requestId is required.');
    }

    const request = room.getRequest(requestId);
    if (!request) {
      return emitError(socket, 'REQUEST_NOT_FOUND', 'Request not found.');
    }

    // 1. Remove pending request
    room.removeRequest(requestId);

    // 2. Notify requester with "request_rejected"
    const requester = room.getParticipant(request.requesterId);
    if (requester) {
      const requesterSocket = this.io.sockets?.sockets?.get?.(requester.socketId)
        || this.io.of?.('/').sockets?.get?.(requester.socketId);
      if (requesterSocket) {
        requesterSocket.emit('request_rejected', {
          requestId,
          reason: typeof data?.reason === 'string' && data.reason.trim() ? data.reason.trim() : 'Rejected by moderator',
        });
      }
    }

    // 3. Broadcast request_resolved to HOST/MODERATORS and notify requester
    this.#notifyRequestResolved(room, requestId, 'rejected', request.requesterId);

    console.log(`Request ${requestId} (${request.type}) rejected by room moderator`);
  }

  /**
   * Dispatches "request_resolved" { requestId, status } to HOST/MODERATOR sockets and the requester.
   *
   * @param {import('../models/Room.js').Room} room
   * @param {string} requestId
   * @param {'approved' | 'rejected'} status
   * @param {string} requesterId
   */
  #notifyRequestResolved(room, requestId, status, requesterId) {
    const notifiedSockets = new Set();

    // 1. Alert HOST and MODERATOR sockets in the room
    for (const p of room.participants.values()) {
      if (p.role === Role.HOST || p.role === Role.MODERATOR) {
        const modSocket = this.io.sockets?.sockets?.get?.(p.socketId)
          || this.io.of?.('/').sockets?.get?.(p.socketId);
        if (modSocket && !notifiedSockets.has(modSocket.id)) {
          modSocket.emit('request_resolved', { requestId, status });
          notifiedSockets.add(modSocket.id);
        }
      }
    }

    // 2. Alert the requester socket
    const requester = room.getParticipant(requesterId);
    if (requester) {
      const requesterSocket = this.io.sockets?.sockets?.get?.(requester.socketId)
        || this.io.of?.('/').sockets?.get?.(requester.socketId);
      if (requesterSocket && !notifiedSockets.has(requesterSocket.id)) {
        requesterSocket.emit('request_resolved', { requestId, status });
        notifiedSockets.add(requesterSocket.id);
      }
    }
  }

  /**
   * Broadcasts current sync_state to all participants in a room.
   *
   * @param {import('../models/Room.js').Room} room
   */
  #broadcastSyncState(room) {
    this.io.to(room.roomId).emit('sync_state', {
      playState: room.playState,
      currentTime: room.getComputedTime(),
      videoId: room.videoId,
      serverTimestamp: Date.now(),
    });
  }

  // ---------------------------------------------------------------------------
  // Request expiry sweeper methods
  // ---------------------------------------------------------------------------

  /**
   * Starts the periodic expiry sweeper for a room if not already running.
   *
   * @param {import('../models/Room.js').Room} room
   */
  startRoomSweeper(room) {
    if (!room || this.roomSweepers.has(room.roomId)) return;

    const timer = setInterval(() => {
      this.sweepExpiredRequests(room);
    }, this.sweeperIntervalMs);

    if (timer && typeof timer.unref === 'function') {
      timer.unref();
    }

    this.roomSweepers.set(room.roomId, timer);
    room.sweeperTimer = timer;
  }

  /**
   * Stops the periodic expiry sweeper for a room.
   *
   * @param {string} roomId
   */
  stopRoomSweeper(roomId) {
    if (!roomId) return;
    const upperId = roomId.toUpperCase();
    const timer = this.roomSweepers.get(upperId);
    if (timer) {
      clearInterval(timer);
      this.roomSweepers.delete(upperId);
    }
    const room = this.roomManager.getRoom(upperId);
    if (room) {
      room.clearTimers?.();
    }
  }

  /**
   * Cleans expired pending requests for a room and emits "request_resolved"
   * with status 'expired' to HOST/MODERATOR sockets and the requester.
   *
   * @param {import('../models/Room.js').Room} room
   * @returns {Array<import('../models/Room.js').PendingRequest>} List of expired requests.
   */
  sweepExpiredRequests(room) {
    if (!room) return [];
    const expired = room.cleanExpired(this.requestTtlMs);
    for (const req of expired) {
      this.#notifyRequestResolved(room, req.id, 'expired', req.requesterId);
    }
    return expired;
  }

  /**
   * Clears all active room sweepers across the server.
   */
  clearAllSweepers() {
    for (const [roomId, timer] of this.roomSweepers) {
      clearInterval(timer);
      const room = this.roomManager.getRoom(roomId);
      if (room) {
        room.clearTimers?.();
      }
    }
    this.roomSweepers.clear();
  }

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  /**
   * Removes a participant (located by socketId) from a room, broadcasts
   * "user_left" to remaining members, auto-promotes a new host if the host left,
   * and prunes the room if it becomes empty.
   *
   * @param {import('socket.io').Socket} socket
   * @param {import('../models/Room.js').Room} room
   */
  #removeParticipantFromRoom(socket, room) {
    const participant = room.getParticipantBySocket(socket.id);
    if (!participant) return;

    const wasHost = participant.role === Role.HOST;

    // Cache disconnected participant's role for reconnection/page refresh restoration
    room.saveDisconnectedParticipant(participant);

    room.removeParticipant(participant.userId);

    // If room is now empty, allow a brief grace period for authenticated user reloads
    if (room.isEmpty()) {
      if (participant && socket.data?.user && !socket.data.user.isGuest) {
        room.graceTimer = setTimeout(() => {
          if (room.isEmpty()) {
            this.stopRoomSweeper(room.roomId);
            this.roomManager.deleteIfEmpty(room.roomId);
            roomRepository.touchRoom(room.roomId);
            console.log(`Grace period expired; room ${room.roomId} deleted.`);
          }
        }, 15000);
        if (room.graceTimer && typeof room.graceTimer.unref === 'function') {
          room.graceTimer.unref();
        }
        console.log(`"${participant.username}" left room ${room.roomId} (grace window active)`);
        return;
      }

      this.stopRoomSweeper(room.roomId);
      this.roomManager.deleteIfEmpty(room.roomId);
      roomRepository.touchRoom(room.roomId);
      console.log(`"${participant.username}" left room ${room.roomId} (room deleted)`);
      return;
    }

    // Broadcast user_left to remaining members with the latest participants list
    this.io.to(room.roomId).emit('user_left', {
      userId: participant.userId,
      username: participant.username,
      participants: room.getParticipantsList(),
    });

    // If the departing participant was the HOST, auto-promote a replacement
    if (wasHost) {
      this.#promoteNextHost(room);
    }

    console.log(`"${participant.username}" left room ${room.roomId} (${socket.id})`);
  }

  /**
   * Selects and auto-promotes the next host:
   * First searches for any MODERATOR (earliest joined),
   * else searches for the earliest-joined PARTICIPANT (or any remaining user).
   * Broadcasts "role_assigned" to the room upon promotion.
   *
   * @param {import('../models/Room.js').Room} room
   */
  #promoteNextHost(room) {
    const participantsList = Array.from(room.participants.values());
    if (participantsList.length === 0) return;

    // Sort by joinedAt ascending (earliest joined first)
    const sorted = participantsList.slice().sort((a, b) => {
      return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
    });

    // Priority 1: First MODERATOR
    let nextHost = sorted.find((p) => p.role === Role.MODERATOR);

    // Priority 2: Earliest-joined PARTICIPANT
    if (!nextHost) {
      nextHost = sorted.find((p) => p.role === Role.PARTICIPANT);
    }

    // Priority 3: Any remaining user if roles were custom/viewer
    if (!nextHost) {
      nextHost = sorted[0];
    }

    // Promote
    room.setRole(nextHost.userId, Role.HOST);

    // Broadcast role_assigned { userId, username, role, participants }
    this.io.to(room.roomId).emit('role_assigned', {
      userId: nextHost.userId,
      username: nextHost.username,
      role: nextHost.role,
      participants: room.getParticipantsList(),
    });

    console.log(`Auto-promoted "${nextHost.username}" to HOST in room ${room.roomId}`);
  }
}
