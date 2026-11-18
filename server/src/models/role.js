/**
 * @file role.js
 * @description Enumeration of roles available in a room.
 */

/**
 * Available participant roles within a room session.
 * @readonly
 * @enum {string}
 */
export const Role = Object.freeze({
  HOST: 'HOST',
  MODERATOR: 'MODERATOR',
  PARTICIPANT: 'PARTICIPANT',
  VIEWER: 'VIEWER',
});
