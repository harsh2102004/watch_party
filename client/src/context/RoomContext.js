import { createContext } from 'react';

/**
 * @typedef {Object} RoomState
 * @property {string|null} roomId - Current active room code.
 * @property {{ userId: string, username: string, role: string }|null} me - Authenticated current user.
 * @property {Array<{ userId: string, username: string, role: string, joinedAt: string }>} participants - Room member list.
 * @property {{ videoId: string|null, playState: 'playing'|'paused', currentTime: number, serverTimestamp: number|null }} syncState - Authoritative playback state.
 * @property {Array<{ id: string, requestId?: string, type: string, payload: any, requesterId: string, requesterName: string, createdAt: number }>} pendingRequests - Queued action suggestions for review.
 * @property {Array<{ id: string, type: string, payload: any, status: 'pending'|'approved'|'rejected'|'expired', reason?: string, createdAt: number }>} myRequests - User's own action requests with status tracking.
 * @property {Array<any>} chat - Future chat messages list.
 * @property {{ code: string, message: string, timestamp: number }|null} error - Latest server error.
 * @property {string|null} lastRemovalReason - Reason if evicted from a room.
 */

/**
 * @typedef {Object} RoomActions
 * @property {(username: string) => void} createRoom
 * @property {(roomId: string, username: string) => void} joinRoom
 * @property {() => void} leaveRoom
 * @property {() => void} play
 * @property {() => void} pause
 * @property {(time: number) => void} seek
 * @property {(videoId: string) => void} changeVideo
 * @property {(userId: string, role: string) => void} assignRole
 * @property {(userId: string, reason?: string) => void} removeParticipant
 * @property {(userId: string) => void} transferHost
 * @property {(type: string, payload?: any) => void} requestAction
 * @property {(requestId: string) => void} approveRequest
 * @property {(requestId: string, reason?: string) => void} rejectRequest
 * @property {(text: string) => void} sendChatMessage
 * @property {(emoji: string) => void} sendReaction
 * @property {() => void} clearError
 */

/**
 * @typedef {RoomState & RoomActions} RoomContextValue
 */

export const RoomContext = createContext(/** @type {RoomContextValue|null} */ (null));
export default RoomContext;
