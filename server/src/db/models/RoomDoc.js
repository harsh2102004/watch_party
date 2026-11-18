/**
 * @file RoomDoc.js
 * @description Mongoose schema and model for persisting watch room metadata.
 *
 * Interview Decision Notes:
 * 1. Named 'RoomDoc' instead of 'Room' to explicitly disambiguate from the in-memory Room class.
 * 2. Inactive room pruning: 'lastActiveAt' has a TTL index expiring after 7 days (604,800s),
 *    allowing MongoDB background threads to purge abandoned rooms without manual cron jobs.
 * 3. Minimal schema: Stores only roomId, videoId, createdAt, and lastActiveAt.
 *    Transient state (playState, currentTime, sockets, participants) remains in-memory.
 */

import mongoose from 'mongoose';

const RoomDocSchema = new mongoose.Schema(
  {
    /**
     * Unique 6-character alphanumeric room identifier (e.g. 'A9X12B').
     * Indexed uniquely to guarantee O(1) lookups and collision prevention.
     */
    roomId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      uppercase: true,
      trim: true,
    },

    /**
     * Current YouTube video ID assigned to the room (e.g. 'dQw4w9WgXcQ').
     * Defaults to null until a video is selected.
     */
    videoId: {
      type: String,
      default: null,
      trim: true,
    },

    /**
     * Timestamp (ms) when the room was first created.
     */
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
    },

    /**
     * Timestamp (ms) of the most recent user activity or departure.
     * TTL index: documents are automatically deleted by MongoDB 7 days after lastActiveAt.
     */
    lastActiveAt: {
      type: Date,
      default: Date.now,
      index: { expires: '7d' }, // 7 days in seconds = 604800
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

export const RoomDoc = mongoose.models.RoomDoc || mongoose.model('RoomDoc', RoomDocSchema);
export default RoomDoc;
