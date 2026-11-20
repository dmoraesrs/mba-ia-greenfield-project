import { RangeNotSatisfiableException } from '../common/exceptions/domain.exception';
import { parseRange } from './range';

const SIZE = 1000;

describe('parseRange', () => {
  it.each([
    ['bytes=0-9', { start: 0, end: 9 }],
    ['bytes=100-', { start: 100, end: 999 }],
    ['bytes=-500', { start: 500, end: 999 }],
    ['bytes=-5000', { start: 0, end: 999 }],
    ['bytes=990-5000', { start: 990, end: 999 }],
    ['bytes=999-999', { start: 999, end: 999 }],
  ])('should parse %s', (header, expected) => {
    expect(parseRange(header, SIZE)).toEqual(expected);
  });

  it.each(['bytes=1000-', 'bytes=5000-6000', 'bytes=-0'])(
    'should throw RangeNotSatisfiableException with the size for %s',
    (header) => {
      let thrown: unknown;
      try {
        parseRange(header, SIZE);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(RangeNotSatisfiableException);
      expect((thrown as RangeNotSatisfiableException).size).toBe(SIZE);
    },
  );

  it.each([
    [undefined],
    [''],
    ['bytes=0-9,20-29'],
    ['bytes=abc'],
    ['items=0-9'],
    ['bytes=-'],
    ['bytes=9-0'],
  ])('should return null for %p', (header) => {
    expect(parseRange(header, SIZE)).toBeNull();
  });
});
