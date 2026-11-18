/**
 * @file permissions.js
 * @description Permission verification and role-based action mapping.
 */

import { Role } from './role.js';

/**
 * Supported actions within a watch party room.
 * @typedef {'play' | 'pause' | 'seek' | 'change_video' | 'assign_role' | 'remove_participant' | 'transfer_host' | 'request_action' | 'approve_request' | 'reject_request'} Action
 */

/**
 * Mapping of roles to sets of permitted actions.
 * @type {Record<string, ReadonlySet<Action>>}
 */
const PERMISSIONS = Object.freeze({
  [Role.HOST]: new Set([
    'play',
    'pause',
    'seek',
    'change_video',
    'assign_role',
    'remove_participant',
    'transfer_host',
    'approve_request',
    'reject_request',
  ]),
  [Role.MODERATOR]: new Set([
    'play',
    'pause',
    'seek',
    'change_video',
    'approve_request',
    'reject_request',
  ]),
  [Role.PARTICIPANT]: new Set([
    'request_action',
  ]),
  [Role.VIEWER]: new Set([
    'request_action',
  ]),
});

/**
 * Checks whether a given role is allowed to perform a specified action.
 *
 * @param {string} role - The role of the user (e.g., Role.HOST, Role.MODERATOR, etc.).
 * @param {Action} action - The action to check permission for.
 * @returns {boolean} True if the role has permission to perform the action, otherwise false.
 */
export function canPerform(role, action) {
  const allowedActions = PERMISSIONS[role];
  if (!allowedActions) {
    return false;
  }
  return allowedActions.has(action);
}
