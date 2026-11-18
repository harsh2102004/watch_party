import { describe, it, expect } from 'vitest';
import { extractVideoId } from '../src/utils/youtube.js';

describe('extractVideoId(input)', () => {
  const validId = 'dQw4w9WgXcQ';

  describe('Valid formats', () => {
    it('should extract raw 11-char video ID', () => {
      expect(extractVideoId('dQw4w9WgXcQ')).toBe(validId);
      expect(extractVideoId('  dQw4w9WgXcQ  ')).toBe(validId);
    });

    it('should extract from standard watch URLs', () => {
      expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(validId);
      expect(extractVideoId('http://youtube.com/watch?v=dQw4w9WgXcQ')).toBe(validId);
      expect(extractVideoId('youtube.com/watch?v=dQw4w9WgXcQ')).toBe(validId);
      expect(extractVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(validId);
      expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL123')).toBe(validId);
    });

    it('should extract from shortened youtu.be URLs', () => {
      expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe(validId);
      expect(extractVideoId('http://youtu.be/dQw4w9WgXcQ')).toBe(validId);
      expect(extractVideoId('youtu.be/dQw4w9WgXcQ')).toBe(validId);
      expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ?t=120')).toBe(validId);
    });

    it('should extract from embed URLs', () => {
      expect(extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe(validId);
      expect(extractVideoId('http://youtube.com/embed/dQw4w9WgXcQ')).toBe(validId);
      expect(extractVideoId('youtube.com/embed/dQw4w9WgXcQ?autoplay=1')).toBe(validId);
    });

    it('should extract from shorts URLs', () => {
      expect(extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(validId);
      expect(extractVideoId('http://youtube.com/shorts/dQw4w9WgXcQ')).toBe(validId);
      expect(extractVideoId('youtube.com/shorts/dQw4w9WgXcQ?feature=share')).toBe(validId);
    });

    it('should support IDs with dashes and underscores', () => {
      const specialId = 'a-B_1234567';
      expect(extractVideoId(specialId)).toBe(specialId);
      expect(extractVideoId(`https://www.youtube.com/watch?v=${specialId}`)).toBe(specialId);
      expect(extractVideoId(`https://youtu.be/${specialId}`)).toBe(specialId);
    });
  });

  describe('Invalid inputs', () => {
    it('should return null for non-string inputs', () => {
      expect(extractVideoId(null)).toBeNull();
      expect(extractVideoId(undefined)).toBeNull();
      expect(extractVideoId(12345)).toBeNull();
      expect(extractVideoId({})).toBeNull();
      expect(extractVideoId([])).toBeNull();
    });

    it('should return null for empty or whitespace-only strings', () => {
      expect(extractVideoId('')).toBeNull();
      expect(extractVideoId('    ')).toBeNull();
    });

    it('should return null for IDs with invalid length', () => {
      expect(extractVideoId('shortId')).toBeNull();
      expect(extractVideoId('wayTooLongVideoId123456')).toBeNull();
      expect(extractVideoId('https://www.youtube.com/watch?v=toolong12345678')).toBeNull();
      expect(extractVideoId('https://youtu.be/short')).toBeNull();
    });

    it('should return null for IDs with illegal characters', () => {
      expect(extractVideoId('dQw4w9WgX!@')).toBeNull();
      expect(extractVideoId('dQw4w9WgXc ')).toBeNull();
    });

    it('should return null for unrelated URLs', () => {
      expect(extractVideoId('https://vimeo.com/123456789')).toBeNull();
      expect(extractVideoId('https://google.com/search?q=video')).toBeNull();
      expect(extractVideoId('https://notyoutube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
      expect(extractVideoId('not a url at all')).toBeNull();
    });
  });
});
