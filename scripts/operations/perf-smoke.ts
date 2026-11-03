// Read-only bounded probe. Never prints tokens or response bodies/customer data.
import { performance } from 'node:perf_hooks';
const base = new URL(process.env.PERF_BASE_URL ?? 'http://127.0.0.1:4000');
const count = Number(process.env.PERF_REQUESTS ?? 100),
  concurrency = Number(process.env.PERF_CONCURRENCY ?? 4);
if (
  !Number.isInteger(count) ||
  count < 1 ||
  count > 10000 ||
  !Number.isInteger(concurrency) ||
  concurrency < 1 ||
  concurrency > 20
)
  throw new Error('Invalid load limits');
const path = process.env.PERF_ADMIN_TOKEN
  ? '/v1/admin/materials?limit=24'
  : '/v1/materials?limit=24';
let next = 0,
  failed = 0;
const times: number[] = [];
const started = performance.now();
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (next++ < count) {
      const start = performance.now();
      try {
        const headers: Record<string, string> = process.env.PERF_ADMIN_TOKEN
          ? { Authorization: `Bearer ${process.env.PERF_ADMIN_TOKEN}` }
          : {};
        const response = await fetch(new URL(path, base), {
          headers,
          signal: AbortSignal.timeout(15000),
        });
        await response.arrayBuffer();
        if (!response.ok) failed++;
      } catch {
        failed++;
      } finally {
        times.push(performance.now() - start);
      }
    }
  }),
);
times.sort((a, b) => a - b);
const percentile = (p: number) =>
  Math.round(times[Math.max(0, Math.ceil(times.length * p) - 1)] ?? 0);
console.log(
  JSON.stringify({
    requests: count,
    concurrency,
    failed,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    elapsedMs: Math.round(performance.now() - started),
    environment: 'local probe; not a production capacity guarantee',
  }),
);
if (failed) process.exitCode = 1;
