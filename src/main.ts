import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';
import { CONFIG } from './common/config.js';
import type { AppConfig } from './common/config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = app.get<AppConfig>(CONFIG);
  await configureApp(app, config);
  // Vercel's native NestJS adapter detects src/main.ts; no legacy api/ catch-all.
  await app.listen(config.port, '0.0.0.0');
}
bootstrap().catch(() => {
  console.error('Backend startup failed. Check environment configuration.');
  process.exitCode = 1;
});
