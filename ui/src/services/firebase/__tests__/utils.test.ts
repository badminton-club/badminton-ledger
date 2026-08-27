import { Timestamp } from 'firebase/firestore';
import {
  toJSDate,
  toTimestamp,
  totalRemainingBirds,
  deductBirds,
  serviceCall,
} from '../utils';

describe('toJSDate', () => {
  it('converts a Firestore Timestamp to a JS Date', () => {
    const date = new Date('2026-08-27T00:00:00.000Z');
    const result = toJSDate(Timestamp.fromDate(date));
    expect(result).toBeInstanceOf(Date);
    expect(result?.getTime()).toBe(date.getTime());
  });

  it('passes a JS Date through unchanged', () => {
    const date = new Date('2026-08-27T00:00:00.000Z');
    expect(toJSDate(date)).toBe(date);
  });

  it('parses a date string', () => {
    const result = toJSDate('2026-08-27T00:00:00.000Z');
    expect(result?.toISOString()).toBe('2026-08-27T00:00:00.000Z');
  });

  it('returns null for null/undefined', () => {
    expect(toJSDate(null)).toBeNull();
    expect(toJSDate(undefined)).toBeNull();
  });
});

describe('toTimestamp', () => {
  it('converts a JS Date to a Firestore Timestamp', () => {
    const date = new Date('2026-08-27T00:00:00.000Z');
    const result = toTimestamp(date);
    expect(result).toBeInstanceOf(Timestamp);
    expect(result.toDate().getTime()).toBe(date.getTime());
  });

  it('converts a date string to a Firestore Timestamp', () => {
    const result = toTimestamp('2026-08-27T00:00:00.000Z');
    expect(result.toDate().toISOString()).toBe('2026-08-27T00:00:00.000Z');
  });
});

describe('totalRemainingBirds', () => {
  it('multiplies unopened tubes by birds-per-tube and adds the open tube', () => {
    expect(totalRemainingBirds(5, 12, 7)).toBe(5 * 12 + 7);
  });

  it('returns just the open-tube count when there are no unopened tubes', () => {
    expect(totalRemainingBirds(0, 12, 4)).toBe(4);
  });

  it('returns 0 when everything is empty', () => {
    expect(totalRemainingBirds(0, 12, 0)).toBe(0);
  });
});

describe('deductBirds', () => {
  it('deducts within a single open tube, leaving unopened tubes untouched', () => {
    const result = deductBirds(5, 12, 10, 3);
    expect(result).toEqual({ unopenedTubesRemaining: 5, birdsInOpenTube: 7 });
  });

  it('breaks into a new tube when the open tube runs out', () => {
    // 5 unopened + 2 in the open tube = 62 total; using 5 leaves 57 -> 4 full tubes + 9 in the open one.
    const result = deductBirds(5, 12, 2, 5);
    expect(result).toEqual({ unopenedTubesRemaining: 4, birdsInOpenTube: 9 });
  });

  it('exactly empties to a whole number of tubes with 0 in the open tube', () => {
    // 2 unopened + 12 in open tube = 36 total; using 12 leaves 24 -> 2 full tubes, 0 open.
    const result = deductBirds(2, 12, 12, 12);
    expect(result).toEqual({ unopenedTubesRemaining: 2, birdsInOpenTube: 0 });
  });
});

describe('serviceCall', () => {
  it('resolves with the wrapped function\'s return value', async () => {
    const result = await serviceCall('testCall', async () => 42);
    expect(result).toBe(42);
  });

  it('logs and rethrows on failure, preserving the original error', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('boom');
    await expect(serviceCall('testCall', async () => { throw err; })).rejects.toThrow(err);
    expect(spy).toHaveBeenCalledWith('[testCall]', err);
    spy.mockRestore();
  });
});
