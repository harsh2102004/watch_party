import { describe, it, expect } from 'vitest';
import { Role } from '../src/models/role.js';
import { canPerform } from '../src/models/permissions.js';

describe('Permissions - canPerform(role, action)', () => {
  const allActions = [
    'play',
    'pause',
    'seek',
    'change_video',
    'assign_role',
    'remove_participant',
    'transfer_host',
  ];

  describe('HOST role', () => {
    it.each(allActions)('should allow HOST to perform %s', (action) => {
      expect(canPerform(Role.HOST, action)).toBe(true);
    });
  });

  describe('MODERATOR role', () => {
    const allowedModActions = ['play', 'pause', 'seek', 'change_video'];
    const disallowedModActions = ['assign_role', 'remove_participant', 'transfer_host'];

    it.each(allowedModActions)('should allow MODERATOR to perform %s', (action) => {
      expect(canPerform(Role.MODERATOR, action)).toBe(true);
    });

    it.each(disallowedModActions)('should NOT allow MODERATOR to perform %s', (action) => {
      expect(canPerform(Role.MODERATOR, action)).toBe(false);
    });
  });

  describe('PARTICIPANT role', () => {
    it.each(allActions)('should NOT allow PARTICIPANT to perform %s', (action) => {
      expect(canPerform(Role.PARTICIPANT, action)).toBe(false);
    });

    it('should allow PARTICIPANT to perform request_action', () => {
      expect(canPerform(Role.PARTICIPANT, 'request_action')).toBe(true);
    });
  });

  describe('VIEWER role', () => {
    it.each(allActions)('should NOT allow VIEWER to perform %s', (action) => {
      expect(canPerform(Role.VIEWER, action)).toBe(false);
    });

    it('should allow VIEWER to perform request_action', () => {
      expect(canPerform(Role.VIEWER, 'request_action')).toBe(true);
    });
  });

  describe('request_action permission', () => {
    it('should NOT allow HOST or MODERATOR to perform request_action', () => {
      expect(canPerform(Role.HOST, 'request_action')).toBe(false);
      expect(canPerform(Role.MODERATOR, 'request_action')).toBe(false);
    });
  });

  describe('Unknown or invalid roles/actions', () => {
    it('should return false for unknown roles', () => {
      expect(canPerform('GUEST', 'play')).toBe(false);
      expect(canPerform(undefined, 'play')).toBe(false);
      expect(canPerform(null, 'play')).toBe(false);
    });

    it('should return false for unknown actions', () => {
      expect(canPerform(Role.HOST, 'non_existent_action')).toBe(false);
      expect(canPerform(Role.MODERATOR, 'non_existent_action')).toBe(false);
    });
  });
});
