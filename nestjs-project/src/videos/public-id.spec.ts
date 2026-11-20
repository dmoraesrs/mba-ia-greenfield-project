import { generatePublicId, isValidPublicId } from './public-id';

describe('public-id', () => {
  describe('generatePublicId', () => {
    it('should produce 11 characters from the base64url alphabet', () => {
      for (let i = 0; i < 200; i++) {
        expect(generatePublicId()).toMatch(/^[A-Za-z0-9_-]{11}$/);
      }
    });

    it('should not repeat across many generations', () => {
      const ids = new Set(Array.from({ length: 1000 }, generatePublicId));

      expect(ids.size).toBe(1000);
    });
  });

  describe('isValidPublicId', () => {
    it.each(['dQw4w9WgXcQ', 'a-b_c-d_e-f', generatePublicId()])(
      'should accept %s',
      (value) => {
        expect(isValidPublicId(value)).toBe(true);
      },
    );

    it.each([
      ['too short', 'abc'],
      ['too long', 'dQw4w9WgXcQx'],
      ['invalid characters', 'dQw4w9Wg+c/'],
      ['padding', 'dQw4w9WgXc='],
      ['empty', ''],
    ])('should reject a value that is %s', (_label, value) => {
      expect(isValidPublicId(value)).toBe(false);
    });
  });
});
