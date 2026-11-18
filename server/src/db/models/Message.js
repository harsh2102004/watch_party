/**
 * @file Message.js
 * @description Mongoose schema and model for persisting room chat messages.
 *
 * Interview Decision Notes:
 * 1. Compound index on { roomId: 1, timestamp: -1 } allows efficient reverse-chronological
 *    history hydration for late joiners with zero full-collection scanning.
 * 2. 7-day TTL index automatically purges stale ephemeral chat messages without database bloat.
 * 3. Matches exact field names used in ChatHandler and client RoomProvider (userId, username, text, timestamp).
 */

import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema(
  {
    /**
     * Room identifier that this chat message belongs to.
     */
    roomId: {
      type: String,
      required: true,
      index: true,
      uppercase: true,
      trim: true,
    },

    /**
     * Unique identifier of the participant who authored the message.
     */
    userId: {
      type: String,
      required: true,
      trim: true,
    },

    /**
     * Display name of the participant at the time of sending.
     */
    username: {
      type: String,
      required: true,
      trim: true,
    },

    /**
     * Sanitized message text content (max 300 characters, stripped of malicious HTML).
     */
    text: {
      type: String,
      required: true,
      maxlength: 300,
    },

    /**
     * Message creation timestamp (ms).
     * Used for sorting history and TTL expiration.
     */
    timestamp: {
      type: Number,
      required: true,
      default: Date.now,
    },

    /**
     * TTL expiration date field (7 days).
     */
    createdAt: {
      type: Date,
      default: Date.now,
      index: { expires: '7d' },
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

// Compound index for fast room history queries ordered by timestamp
MessageSchema.index({ roomId: 1, timestamp: 1 });

export const Message = mongoose.models.Message || mongoose.model('Message', MessageSchema);
export default Message;
