import { Injectable, Logger } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { statfs, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
const buckets = [50, 100, 250, 500, 1000, 2500, 5000, 10000];
@Injectable()
export class Operations {
  private requests = 0;
  private errors = 0;
  private active = 0;
  private durationSum = 0;
  private histogram = buckets.map(() => 0);
  middleware(logRequests: boolean) {
    return (req: Request, res: Response, next: NextFunction) => {
      const start = performance.now();
      this.active++;
      let complete = false;
      const finish = () => {
        if (complete) return;
        complete = true;
        this.active--;
        const ms = performance.now() - start;
        this.requests++;
        this.durationSum += ms;
        if (res.statusCode >= 500 || !res.writableFinished) this.errors++;
        buckets.forEach((limit, index) => {
          if (ms <= limit) this.histogram[index]!++;
        });
        if (logRequests)
          Logger.log(
            {
              event: 'http_request',
              requestId: res.locals.requestId,
              method: req.method,
              route: req.route?.path ?? 'unmatched',
              status: res.statusCode,
              durationMs: Math.round(ms),
              aborted: !res.writableFinished,
            },
            'HTTP',
          );
      };
      res.once('finish', finish);
      res.once('close', finish);
      next();
    };
  }
  async snapshot(mediaRoot: string, backupDir: string) {
    const disk = await statfs(mediaRoot)
      .then((s) => ({ freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize }))
      .catch(() => null);
    const completed = await readdir(join(backupDir, 'bundles')).then(
      (files) => files.filter((file) => file.endsWith('.ptbackup')),
      () => [],
    );
    const dates = await Promise.all(
      completed.map((file) =>
        stat(join(backupDir, 'bundles', file)).then(
          (s) => s.mtimeMs,
          () => 0,
        ),
      ),
    );
    const latest = dates.length ? Math.max(...dates) : null;
    const backup = {
      lastCompletedAt: latest ? new Date(latest).toISOString() : null,
      ageSeconds: latest ? Math.round((Date.now() - latest) / 1000) : null,
      healthy: latest !== null && Date.now() - latest < 26 * 3600000,
    };
    return {
      backup,
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      requests: this.requests,
      errors: this.errors,
      active: this.active,
      durationSumMs: Math.round(this.durationSum),
      latencyBuckets: buckets.map((le, index) => ({ leMs: le, count: this.histogram[index] })),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      disk,
    };
  }
}
