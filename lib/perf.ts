type AsyncWork<T> = () => PromiseLike<T> | T;

function shouldLogPerf() {
  return process.env.LOG_QUERY_TIMINGS === "1";
}

function minDurationMs() {
  const raw = Number(process.env.LOG_QUERY_TIMINGS_MIN_MS || "0");
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return raw;
}

export async function withPerfTiming<T>(label: string, work: AsyncWork<T>): Promise<T> {
  const start = Date.now();
  try {
    return await work();
  } finally {
    if (shouldLogPerf()) {
      const durationMs = Date.now() - start;
      if (durationMs >= minDurationMs()) {
        console.info(`[perf] ${label} ${durationMs}ms`);
      }
    }
  }
}
