import { Timestamp } from 'firebase/firestore';
import { serverTimestamp } from 'firebase/firestore';

/** Converts a Firestore Timestamp, Date, or string to a JS Date. */
export function toJSDate(value: Timestamp | Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  return new Date(value);
}

/** Converts a JS Date or string to a Firestore Timestamp. */
export function toTimestamp(value: Date | string): Timestamp {
  if (value instanceof Date) return Timestamp.fromDate(value);
  return Timestamp.fromDate(new Date(value));
}

/** Returns total remaining birds in a batch. */
export function totalRemainingBirds(
  unopenedTubesRemaining: number,
  birdsPerTube: number,
  birdsInOpenTube: number
): number {
  return unopenedTubesRemaining * birdsPerTube + birdsInOpenTube;
}

/** Deducts birds from a batch and returns new tube counts. */
export function deductBirds(
  unopenedTubesRemaining: number,
  birdsPerTube: number,
  birdsInOpenTube: number,
  quantityUsed: number
): { unopenedTubesRemaining: number; birdsInOpenTube: number } {
  const total = totalRemainingBirds(unopenedTubesRemaining, birdsPerTube, birdsInOpenTube) - quantityUsed;
  return {
    unopenedTubesRemaining: Math.floor(total / birdsPerTube),
    birdsInOpenTube: total % birdsPerTube,
  };
}

/** Wraps a service call with consistent error handling — preserves original stack. */
export async function serviceCall<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[${name}]`, err);
    throw err;
  }
}
