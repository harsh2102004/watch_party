/**
 * @file User.js
 * @description Mongoose schema and model for registered Watch Party users.
 *
 * Interview Decision Notes:
 * 1. Email Normalization: Stored in lowercase and trimmed to guarantee case-insensitive uniqueness.
 * 2. Username Length & Character Set: Constrained to 3-20 characters to match socket display badges.
 * 3. passwordHash Isolation: Passwords are hashed with bcrypt (cost 10); schema avoids returning hashes by default.
 * 4. Indexing: Unique indexes on email and username ensure fast lookups and database-level collision prevention.
 */

import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address format.'],
    },
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 20,
      match: [/^[a-zA-Z0-9_-]+$/, 'Username may only contain alphanumeric characters, underscores, and hyphens.'],
    },
    passwordHash: {
      type: String,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
    toJSON: {
      transform(_doc, ret) {
        delete ret.passwordHash;
        return ret;
      },
    },
  }
);

export const User = mongoose.models.User || mongoose.model('User', userSchema);
