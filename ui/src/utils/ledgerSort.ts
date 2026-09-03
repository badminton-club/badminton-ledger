interface SortableLedgerEntry {
  createdAt?: { toDate: () => Date } | Date | string | null;
  reason: string;
  batchId?: string | null;
  batchSequence?: number;
}

function timestampMillis(value: SortableLedgerEntry['createdAt']): number {
  if (!value) return 0;
  if (typeof value === 'object' && 'toDate' in value) return value.toDate().getTime();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export function compareLedgerEntriesNewestFirst(
  a: SortableLedgerEntry,
  b: SortableLedgerEntry
): number {
  const timestampDelta = timestampMillis(b.createdAt) - timestampMillis(a.createdAt);
  if (timestampDelta !== 0) return timestampDelta;

  if (a.batchId && a.batchId === b.batchId) {
    const sequenceDelta = (b.batchSequence ?? 0) - (a.batchSequence ?? 0);
    if (sequenceDelta !== 0) return sequenceDelta;
  }

  // Legacy approval batches have identical server timestamps but no explicit
  // sequence. A settlement consumes its e-Transfer credit, so it is newer.
  const legacyPriority = (entry: SortableLedgerEntry) =>
    entry.reason === 'settlement' ? 1 : entry.reason === 'etransfer-import' ? 0 : -1;
  return legacyPriority(b) - legacyPriority(a);
}
