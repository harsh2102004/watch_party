import React, { useCallback, useEffect, useReducer, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { SOCKET_EVENTS } from '../utils/constants.js';
import { RoomContext } from './RoomContext.js';
import { useSocket } from './useSocket.js';
import { useToast } from './useToast.js';

/** @type {import('./RoomContext.js').RoomState} */
const initialRoomState = {
  roomId: null,
  me: null,
  participants: [],
  syncState: {
    videoId: null,
    playState: 'paused',
    currentTime: 0,
    serverTimestamp: null,
  },
  pendingRequests: [],
  myRequests: [],
  chat: [],
  error: null,
  lastRemovalReason: null,
};

/**
 * Reducer function managing centralized real-time room state.
 *
 * @param {import('./RoomContext.js').RoomState} state
 * @param {{ type: string, payload?: any }} action
 * @returns {import('./RoomContext.js').RoomState}
 */
function roomReducer(state, action) {
  switch (action.type) {
    case 'ROOM_ENTERED': {
      const { roomId, userId, role, participants = [], syncState = {} } = action.payload;
      const myParticipant = participants.find((p) => p.userId === userId);
      const username = myParticipant?.username || state.me?.username || '';

      return {
        ...state,
        roomId,
        me: { userId, username, role },
        participants,
        syncState: {
          videoId: syncState.videoId ?? null,
          playState: syncState.playState ?? 'paused',
          currentTime: syncState.currentTime ?? 0,
          serverTimestamp: syncState.serverTimestamp ?? null,
        },
        pendingRequests: [],
        myRequests: [],
        chat: action.payload.chat || [],
        error: null,
        lastRemovalReason: null,
      };
    }

    case 'SET_PARTICIPANTS': {
      const participants = action.payload || [];
      let me = state.me;

      // Keep own role and username up to date with server participant list
      if (me) {
        const found = participants.find((p) => p.userId === me.userId);
        if (found && (found.role !== me.role || found.username !== me.username)) {
          me = { ...me, role: found.role, username: found.username };
        }
      }

      return {
        ...state,
        participants,
        me,
      };
    }

    case 'ROLE_ASSIGNED': {
      const { userId, role, participants = [] } = action.payload;
      let me = state.me;
      if (me && me.userId === userId) {
        me = { ...me, role };
      }
      return {
        ...state,
        participants: participants.length > 0 ? participants : state.participants,
        me,
      };
    }

    case 'SET_SYNC_STATE': {
      const syncState = action.payload || {};
      return {
        ...state,
        syncState: {
          videoId: syncState.videoId !== undefined ? syncState.videoId : state.syncState.videoId,
          playState: syncState.playState || state.syncState.playState,
          currentTime: typeof syncState.currentTime === 'number' ? syncState.currentTime : state.syncState.currentTime,
          serverTimestamp: syncState.serverTimestamp ?? Date.now(),
        },
      };
    }

    case 'ADD_PENDING_REQUEST': {
      const req = action.payload;
      if (!req) return state;
      const id = req.id || req.requestId;
      const exists = state.pendingRequests.some((item) => (item.id || item.requestId) === id);
      if (exists) return state;

      return {
        ...state,
        pendingRequests: [...state.pendingRequests, req],
      };
    }

    case 'REMOVE_PENDING_REQUEST': {
      const { requestId } = action.payload;
      return {
        ...state,
        pendingRequests: state.pendingRequests.filter(
          (req) => req.id !== requestId && req.requestId !== requestId
        ),
      };
    }

    case 'ADD_MY_REQUEST': {
      const req = action.payload;
      if (!req) return state;
      const id = req.id || req.requestId;
      const exists = state.myRequests.some((item) => item.id === id);
      const newEntry = {
        id,
        type: req.type,
        payload: req.payload || {},
        status: req.status || 'pending',
        reason: req.reason || null,
        createdAt: req.createdAt || Date.now(),
      };
      if (exists) {
        return {
          ...state,
          myRequests: state.myRequests.map((item) => (item.id === id ? { ...item, ...newEntry } : item)),
        };
      }
      return {
        ...state,
        myRequests: [newEntry, ...state.myRequests],
      };
    }

    case 'RESOLVE_MY_REQUEST': {
      const { requestId, status } = action.payload || {};
      if (!requestId) return state;
      return {
        ...state,
        myRequests: state.myRequests.map((req) => {
          if (req.id === requestId) {
            return {
              ...req,
              status: status || req.status,
            };
          }
          return req;
        }),
      };
    }

    case 'REJECT_MY_REQUEST': {
      const { requestId, reason } = action.payload || {};
      if (!requestId) return state;
      return {
        ...state,
        myRequests: state.myRequests.map((req) => {
          if (req.id === requestId) {
            return {
              ...req,
              status: 'rejected',
              reason: reason || req.reason || 'Rejected by moderator',
            };
          }
          return req;
        }),
      };
    }

    case 'ADD_CHAT_MESSAGE': {
      const msg = action.payload;
      if (!msg) return state;
      const exists = state.chat.some((m) => m.id === msg.id);
      if (exists) return state;
      const updatedChat = [...state.chat, msg];
      if (updatedChat.length > 50) {
        updatedChat.shift();
      }
      return {
        ...state,
        chat: updatedChat,
      };
    }

    case 'SET_REMOVED': {
      return {
        ...initialRoomState,
        lastRemovalReason: action.payload?.reason || 'Removed from room by host',
      };
    }

    case 'SET_ERROR': {
      return {
        ...state,
        error: {
          code: action.payload?.code || 'UNKNOWN_ERROR',
          message: action.payload?.message || 'An unexpected error occurred.',
          timestamp: Date.now(),
        },
      };
    }

    case 'CLEAR_ERROR': {
      return {
        ...state,
        error: null,
      };
    }

    case 'RESET_ROOM': {
      return {
        ...initialRoomState,
      };
    }

    default:
      return state;
  }
}

/**
 * RoomProvider binds all server Socket.IO events to state mutations,
 * and provides imperative action dispatchers to children via useRoom().
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children
 */
export function RoomProvider({ children }) {
  const { socket } = useSocket();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(roomReducer, initialRoomState);

  // Keep ref to latest state so event handlers read up-to-date values without resubscribing
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Subscribe to all real-time room events
  useEffect(() => {
    if (!socket) return;

    // 1. Room Creation
    const handleRoomCreated = (data) => {
      dispatch({
        type: 'ROOM_ENTERED',
        payload: {
          roomId: data.roomId,
          userId: data.userId,
          role: data.role,
          participants: data.participants,
          syncState: data.state,
          chat: data.chat_history || data.chat || [],
        },
      });
    };

    // 2. Room Joining
    const handleRoomJoined = (data) => {
      dispatch({
        type: 'ROOM_ENTERED',
        payload: {
          roomId: data.roomId,
          userId: data.userId,
          role: data.role,
          participants: data.participants,
          syncState: data.sync_state,
          chat: data.chat_history || data.chat || [],
        },
      });
    };

    // 3. User Joined
    const handleUserJoined = (data) => {
      dispatch({ type: 'SET_PARTICIPANTS', payload: data.participants });
      if (data?.username) {
        showToast(`${data.username} joined the room`, 'info', 3500);
        dispatch({
          type: 'ADD_CHAT_MESSAGE',
          payload: {
            id: `system-join-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            isSystem: true,
            systemType: 'join',
            text: `${data.username} joined the room`,
            timestamp: Date.now(),
          },
        });
      }
    };

    // 4. User Left
    const handleUserLeft = (data) => {
      dispatch({ type: 'SET_PARTICIPANTS', payload: data.participants });
      if (data?.username) {
        showToast(`${data.username} left the room`, 'info', 3500);
        dispatch({
          type: 'ADD_CHAT_MESSAGE',
          payload: {
            id: `system-leave-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            isSystem: true,
            systemType: 'leave',
            text: `${data.username} left the room`,
            timestamp: Date.now(),
          },
        });
      }
    };

    // 5. Role Assigned ("You are now a Moderator")
    const handleRoleAssigned = (data) => {
      dispatch({ type: 'ROLE_ASSIGNED', payload: data });
      const targetUserId = data?.userId;
      const currentUserId = stateRef.current?.me?.userId;
      const isMe = Boolean(currentUserId && targetUserId === currentUserId);

      const roleLabels = {
        HOST: 'Host',
        MODERATOR: 'Moderator',
        PARTICIPANT: 'Participant',
        VIEWER: 'Viewer',
      };
      const roleLabel = roleLabels[data?.role] || data?.role || 'Member';

      if (isMe) {
        showToast(`You are now a ${roleLabel}`, 'success', 4500);
      } else if (data?.username) {
        showToast(`${data.username} is now a ${roleLabel}`, 'info', 3500);
      }
    };

    // 6. Participant Removed
    const handleParticipantRemoved = (data) => {
      dispatch({ type: 'SET_PARTICIPANTS', payload: data.participants });
    };

    // 7. Sync State
    const handleSyncState = (data) => {
      dispatch({ type: 'SET_SYNC_STATE', payload: data });
    };

    // 8. Action Requested (Moderator review alert)
    const handleActionRequested = (data) => {
      dispatch({ type: 'ADD_PENDING_REQUEST', payload: data });
    };

    // 9. Request Queued (Receipt sent to requester)
    const handleRequestQueued = (data) => {
      if (data?.request) {
        dispatch({ type: 'ADD_PENDING_REQUEST', payload: data.request });
        dispatch({
          type: 'ADD_MY_REQUEST',
          payload: {
            ...data.request,
            id: data.requestId || data.request.id,
            status: 'pending',
          },
        });
      }
    };

    // 10. Request Resolved (Approved / Rejected / Expired)
    const handleRequestResolved = (data) => {
      dispatch({ type: 'REMOVE_PENDING_REQUEST', payload: data });
      dispatch({ type: 'RESOLVE_MY_REQUEST', payload: data });
      if (data?.status === 'approved') {
        showToast('Your action request was approved!', 'success', 3500);
      } else if (data?.status === 'expired') {
        showToast('Your action request expired.', 'info', 3500);
      }
    };

    // 11. Request Rejected (Direct notice to requester with reason)
    const handleRequestRejected = (data) => {
      dispatch({ type: 'REJECT_MY_REQUEST', payload: data });
      showToast(`Request rejected: ${data?.reason || 'Declined by moderator'}`, 'error', 4500);
    };

    // 12. Evicted by Host
    const handleRemoved = (data) => {
      dispatch({ type: 'SET_REMOVED', payload: data });
      const reason = data?.reason || 'Removed from room by host';
      showToast(`You have been removed from the room: ${reason}`, 'error', 6000);
      navigate('/', { replace: true });
    };

    // 13. Server Error Event
    const handleErrorEvent = (data) => {
      dispatch({ type: 'SET_ERROR', payload: data });
      const message = data?.message || data?.code || 'An unexpected error occurred.';
      showToast(message, 'error', 5000);
      if (data?.code === 'ROOM_NOT_FOUND') {
        navigate('/', { replace: true });
      }
    };

    // 14. Real-time Chat Message
    const handleChatMessage = (data) => {
      dispatch({ type: 'ADD_CHAT_MESSAGE', payload: data });
    };

    socket.on(SOCKET_EVENTS.ROOM_CREATED, handleRoomCreated);
    socket.on(SOCKET_EVENTS.ROOM_JOINED, handleRoomJoined);
    socket.on(SOCKET_EVENTS.USER_JOINED, handleUserJoined);
    socket.on(SOCKET_EVENTS.USER_LEFT, handleUserLeft);
    socket.on(SOCKET_EVENTS.ROLE_ASSIGNED, handleRoleAssigned);
    socket.on(SOCKET_EVENTS.PARTICIPANT_REMOVED, handleParticipantRemoved);
    socket.on(SOCKET_EVENTS.SYNC_STATE, handleSyncState);
    socket.on(SOCKET_EVENTS.ACTION_REQUESTED, handleActionRequested);
    socket.on(SOCKET_EVENTS.REQUEST_QUEUED, handleRequestQueued);
    socket.on(SOCKET_EVENTS.REQUEST_RESOLVED, handleRequestResolved);
    socket.on(SOCKET_EVENTS.REQUEST_REJECTED, handleRequestRejected);
    socket.on(SOCKET_EVENTS.REMOVED, handleRemoved);
    socket.on(SOCKET_EVENTS.ERROR_EVENT, handleErrorEvent);
    socket.on(SOCKET_EVENTS.CHAT_MESSAGE, handleChatMessage);

    return () => {
      socket.off(SOCKET_EVENTS.ROOM_CREATED, handleRoomCreated);
      socket.off(SOCKET_EVENTS.ROOM_JOINED, handleRoomJoined);
      socket.off(SOCKET_EVENTS.USER_JOINED, handleUserJoined);
      socket.off(SOCKET_EVENTS.USER_LEFT, handleUserLeft);
      socket.off(SOCKET_EVENTS.ROLE_ASSIGNED, handleRoleAssigned);
      socket.off(SOCKET_EVENTS.PARTICIPANT_REMOVED, handleParticipantRemoved);
      socket.off(SOCKET_EVENTS.SYNC_STATE, handleSyncState);
      socket.off(SOCKET_EVENTS.ACTION_REQUESTED, handleActionRequested);
      socket.off(SOCKET_EVENTS.REQUEST_QUEUED, handleRequestQueued);
      socket.off(SOCKET_EVENTS.REQUEST_RESOLVED, handleRequestResolved);
      socket.off(SOCKET_EVENTS.REQUEST_REJECTED, handleRequestRejected);
      socket.off(SOCKET_EVENTS.REMOVED, handleRemoved);
      socket.off(SOCKET_EVENTS.ERROR_EVENT, handleErrorEvent);
      socket.off(SOCKET_EVENTS.CHAT_MESSAGE, handleChatMessage);
    };
  }, [socket, showToast, navigate]);

  // ---------------------------------------------------------------------------
  // Action dispatchers emitting client events
  // ---------------------------------------------------------------------------

  const createRoom = useCallback((username) => {
    if (!socket) return;
    socket.emit(SOCKET_EVENTS.CREATE_ROOM, { username });
  }, [socket]);

  const joinRoom = useCallback((roomId, username) => {
    if (!socket) return;
    socket.emit(SOCKET_EVENTS.JOIN_ROOM, { roomId, username });
  }, [socket]);

  const leaveRoom = useCallback(() => {
    if (!socket) return;
    if (state.roomId) {
      socket.emit(SOCKET_EVENTS.LEAVE_ROOM, { roomId: state.roomId });
    }
    dispatch({ type: 'RESET_ROOM' });
  }, [socket, state.roomId]);

  const play = useCallback(() => {
    if (!socket) return;
    socket.emit(SOCKET_EVENTS.PLAY, {});
  }, [socket]);

  const pause = useCallback(() => {
    if (!socket) return;
    socket.emit(SOCKET_EVENTS.PAUSE, {});
  }, [socket]);

  const seek = useCallback((time) => {
    if (!socket) return;
    socket.emit(SOCKET_EVENTS.SEEK, { time });
  }, [socket]);

  const changeVideo = useCallback((videoId) => {
    if (!socket) return;
    socket.emit(SOCKET_EVENTS.CHANGE_VIDEO, { videoId });
  }, [socket]);

  const assignRole = useCallback((userId, role) => {
    if (!socket) return;
    socket.emit(SOCKET_EVENTS.ASSIGN_ROLE, { userId, role });
  }, [socket]);

  const removeParticipant = useCallback((userId, reason) => {
    if (!socket) return;
    socket.emit(SOCKET_EVENTS.REMOVE_PARTICIPANT, { userId, reason });
  }, [socket]);

  const transferHost = useCallback((userId) => {
    if (!socket) return;
    socket.emit(SOCKET_EVENTS.TRANSFER_HOST, { userId });
  }, [socket]);

  const requestAction = useCallback((type, payload) => {
    if (!socket) return;
    socket.emit(SOCKET_EVENTS.REQUEST_ACTION, { type, payload });
  }, [socket]);

  const approveRequest = useCallback((requestId) => {
    if (!socket) return;
    socket.emit(SOCKET_EVENTS.APPROVE_REQUEST, { requestId });
  }, [socket]);

  const rejectRequest = useCallback((requestId, reason) => {
    if (!socket) return;
    socket.emit(SOCKET_EVENTS.REJECT_REQUEST, { requestId, reason });
  }, [socket]);

  const sendChatMessage = useCallback((text) => {
    if (!socket) return;
    socket.emit(SOCKET_EVENTS.CHAT_MESSAGE, { text });
  }, [socket]);

  const sendReaction = useCallback((emoji) => {
    if (!socket) return;
    socket.emit(SOCKET_EVENTS.REACTION, { emoji });
  }, [socket]);

  const clearError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' });
  }, []);

  const value = {
    ...state,
    createRoom,
    joinRoom,
    leaveRoom,
    play,
    pause,
    seek,
    changeVideo,
    assignRole,
    removeParticipant,
    transferHost,
    requestAction,
    approveRequest,
    rejectRequest,
    sendChatMessage,
    sendReaction,
    clearError,
  };

  return (
    <RoomContext.Provider value={value}>
      {children}
    </RoomContext.Provider>
  );
}

export default RoomProvider;
