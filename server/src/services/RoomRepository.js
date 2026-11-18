/**
 * @file RoomRepository.js
 * @description MongoDB persistence service for watch rooms and chat history.
 *
 * Interview Decision Notes:
 * 1. Non-blocking fire-and-forget: All write operations (saveRoom, updateVideo, touchRoom, saveMessage)
 *    are asynchronous and return immediately (void). Socket handlers do not await them, guaranteeing
 *    that network or database latency never causes stutter in real-time video sync or chat.
 * 2. Short operation timeouts: Queries specify maxTimeMS(3000) so a struggling cluster fails fast
 *    instead of queuing promises and leaking event loop memory.
 * 3. Graceful fallback: If MongoDB is disconnected (isDbConnected() === false), functions return
 *    null or [] immediately without generating database errors.
 * 4. Error isolation: All operations are wrapped in try/catch blocks logging warnings without throwing.
 */

import { isDbConnected } from '../db/connect.js';
import { RoomDoc } from '../db/models/RoomDoc.js';
import { Message } from '../db/models/Message.js';

const QUERY_TIMEOUT_MS = 3000;

export class RoomRepository {
  /**
   * Saves or updates a room record on creation.
   * Fire-and-forget: returns immediately without throwing.
   *
   * @param {import('../models/Room.js').Room|{ roomId: string, videoId?: string, createdAt?: number }} room
   */
  saveRoom(room) {
    if (!room || !isDbConnected()) return;

    const roomId = (room.roomId || '').toUpperCase();
    const videoId = room.videoId || null;

    RoomDoc.findOneAndUpdate(
      { roomId },
      {
        $setOnInsert: { roomId, createdAt: new Date() },
        $set: { videoId, lastActiveAt: new Date() },
      },
      { upsert: true, maxTimeMS: QUERY_TIMEOUT_MS }
    )
      .exec()
      .catch((err) => {
        console.warn(`[RoomRepository] Failed to save room ${roomId}: ${err.message}`);
      });
  }

  /**
   * Updates the videoId for a room.
   * Fire-and-forget: returns immediately without throwing.
   *
   * @param {string} roomId
   * @param {string|null} videoId
   */
  updateVideo(roomId, videoId) {
    if (!roomId || !isDbConnected()) return;

    const cleanRoomId = roomId.toUpperCase();
    RoomDoc.updateOne(
      { roomId: cleanRoomId },
      { $set: { videoId: videoId || null, lastActiveAt: new Date() } },
      { maxTimeMS: QUERY_TIMEOUT_MS }
    )
      .exec()
      .catch((err) => {
        console.warn(`[RoomRepository] Failed to update video for room ${cleanRoomId}: ${err.message}`);
      });
  }

  /**
   * Updates lastActiveAt timestamp to reset the 7-day TTL when participants interact or leave.
   * Fire-and-forget: returns immediately without throwing.
   *
   * @param {string} roomId
   */
  touchRoom(roomId) {
    if (!roomId || !isDbConnected()) return;

    const cleanRoomId = roomId.toUpperCase();
    RoomDoc.updateOne(
      { roomId: cleanRoomId },
      { $set: { lastActiveAt: new Date() } },
      { maxTimeMS: QUERY_TIMEOUT_MS }
    )
      .exec()
      .catch((err) => {
        console.warn(`[RoomRepository] Failed to touch room ${cleanRoomId}: ${err.message}`);
      });
  }

  /**
   * Finds a persisted room by its roomId to restore after a restart.
   *
   * @param {string} roomId
   * @returns {Promise<{ roomId: string, videoId: string|null, createdAt: Date, lastActiveAt: Date }|null>}
   */
  async findRoom(roomId) {
    if (!roomId || !isDbConnected()) return null;

    const cleanRoomId = roomId.toUpperCase();
    try {
      const doc = await RoomDoc.findOne({ roomId: cleanRoomId })
        .maxTimeMS(QUERY_TIMEOUT_MS)
        .lean()
        .exec();
      return doc || null;
    } catch (err) {
      console.warn(`[RoomRepository] Failed to find room ${cleanRoomId}: ${err.message}`);
      return null;
    }
  }

  /**
   * Saves a chat message to MongoDB.
   * Fire-and-forget: returns immediately without throwing.
   *
   * @param {string} roomId
   * @param {{ userId: string, username: string, text: string, timestamp?: number }} message
   */
  saveMessage(roomId, message) {
    if (!roomId || !message || !isDbConnected()) return;

    const cleanRoomId = roomId.toUpperCase();
    Message.create({
      roomId: cleanRoomId,
      userId: message.userId,
      username: message.username,
      text: message.text,
      timestamp: message.timestamp || Date.now(),
      createdAt: new Date(),
    }).catch((err) => {
      console.warn(`[RoomRepository] Failed to save message for room ${cleanRoomId}: ${err.message}`);
    });
  }

  /**
   * Retrieves the most recent messages for a room, ordered chronologically.
   *
   * @param {string} roomId
   * @param {number} [limit=50]
   * @returns {Promise<Array<{ id?: string, userId: string, username: string, text: string, timestamp: number }>>}
   */
  async getRecentMessages(roomId, limit = 50) {
    if (!roomId || !isDbConnected()) return [];

    const cleanRoomId = roomId.toUpperCase();
    try {
      // Query recent messages in reverse chronological order, then reverse back for client timeline
      const messages = await Message.find({ roomId: cleanRoomId })
        .sort({ timestamp: -1 })
        .limit(limit)
        .maxTimeMS(QUERY_TIMEOUT_MS)
        .lean()
        .exec();

      return messages.reverse().map((m) => ({
        id: m._id ? m._id.toString() : String(m.timestamp),
        userId: m.userId,
        username: m.username,
        text: m.text,
        timestamp: m.timestamp,
      }));
    } catch (err) {
      console.warn(`[RoomRepository] Failed to get messages for room ${cleanRoomId}: ${err.message}`);
      return [];
    }
  }
}

export const roomRepository = new RoomRepository();
export default roomRepository;
