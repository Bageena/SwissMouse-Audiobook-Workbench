// Keep filesystem/probe work bounded and results in discovery order. A failed
// batch settles all workers before the caller can roll back its scan state.
export async function mapScanWork<T, R>(items: readonly T[], limit: number, read: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(items.length, Math.max(1, Math.floor(limit))) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await read(items[index], index);
    }
  });
  const settled = await Promise.allSettled(workers);
  const failed = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed) throw failed.reason;
  return results;
}
