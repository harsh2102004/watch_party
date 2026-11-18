/**
 * @file guard.js
 * @description Higher-order socket event wrapper that enforces room membership and role-based permissions.
 */

import { canPerform } from '../models/permissions.js';
import { emitError } from './MessageHandler.js';

/**
 * Higher-order function that wraps a Socket.IO event handler with permission checks.
 *
 * It returns an event listener callback with signature `(data)` that binds to the current `socket`,
 * verifies room membership and role-based action permission, and invokes the handler with context.
 *
 * @param {import('../models/permissions.js').Action} action - The action identifier (e.g. 'play', 'seek', 'assign_role').
 * @param {import('../models/RoomManager.js').RoomManager} roomManager - The shared room manager singleton.
 * @param {import('socket.io').Socket} socket - The connected socket instance.
 * @param {Function} handler - The wrapped handler function receiving ({ socket, room, participant, data }).
 * @returns {Function} Socket event callback taking (data).
 */
export function withPermission(action, roomManager, socket, handler) {
  return async (data) => {
    // 1. Locate the room and participant by socket.id across active rooms
    let targetRoom = null;
    let targetParticipant = null;

    // If data provides roomId, prioritize checking that room
    if (data?.roomId) {
      const room = roomManager.getRoom(data.roomId);
      if (room) {
        const participant = room.getParticipantBySocket(socket.id);
        if (participant) {
          targetRoom = room;
          targetParticipant = participant;
        }
      }
    }

    // Otherwise fall back to scanning all rooms for this socket
    if (!targetRoom) {
      for (const [, room] of roomManager.rooms) {
        const participant = room.getParticipantBySocket(socket.id);
        if (participant) {
          targetRoom = room;
          targetParticipant = participant;
          break;
        }
      }
    }

    // 2. Enforce room membership
    if (!targetRoom || !targetParticipant) {
      return emitError(socket, 'NOT_IN_ROOM', 'You are not in a room.');
    }

    // 3. Enforce role-based permission
    if (!canPerform(targetParticipant.role, action)) {
      return emitError(
        socket,
        'FORBIDDEN',
        `Role "${targetParticipant.role}" is not allowed to perform action "${action}".`
      );
    }

    // 4. Delegate to the protected handler
    return handler({
      socket,
      room: targetRoom,
      participant: targetParticipant,
      data,
    });
  };
}
