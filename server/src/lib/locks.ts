const tails = new Map<string, Promise<unknown>>();

/**
 * Menjalankan tugas dengan kunci yang sama secara berurutan, satu per satu.
 * Dipakai supaya dua pesan dari percakapan yang sama tidak dijawab bersamaan.
 */
export function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.catch(() => {});
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}
