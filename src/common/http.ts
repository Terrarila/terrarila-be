import { Inject, Catch, HttpException, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { AuditService } from '../admin/audit.service.js';
import { auditContext, hashedIp } from './audit-context.js';
import { isUUID } from 'class-validator';

export function requestContext(req: Request, res: Response, next: () => void, vercel = false) {
  const incoming = req.header('X-Request-Id');
  res.locals.requestId = incoming && isUUID(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', res.locals.requestId as string);
  res.setHeader('Cache-Control', 'no-store');
  // Vercel's ipAddress helper uses its platform-provided x-real-ip header.
  // Ignore forwarded headers on local/VPS requests unless that platform is selected.
  const platformIp = vercel ? req.header('x-real-ip') : undefined;
  const ip = platformIp && isIP(platformIp) ? platformIp : (req.ip ?? 'unknown');
  auditContext.run({ requestId: res.locals.requestId as string, ipHash: hashedIp(ip) }, next);
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}
  async catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const parserType =
      typeof error === 'object' && error !== null && 'type' in error ? error.type : null;
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : parserType === 'encoding.unsupported'
          ? 415
          : parserType === 'entity.too.large'
            ? 413
            : parserType === 'entity.parse.failed'
              ? 400
              : 500;
    if ([401, 403, 429].includes(status)) {
      const request = host.switchToHttp().getRequest<Request & { user?: { id: string } }>();
      await this.audit.security(
        request.path === '/v1/auth/admin/login' && status === 401
          ? 'auth.login_failed'
          : 'security.request_denied',
        request.user?.id ?? 'anonymous',
        { status, path: request.route?.path ?? 'unmatched' },
      );
    }
    const payload = error instanceof HttpException ? error.getResponse() : null;
    const detail =
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    if (status >= 500)
      Logger.error({
        event: 'request_failed',
        requestId: response.locals.requestId,
        status,
        type: error instanceof Error ? error.name : 'UnknownError',
      });
    response.setHeader('Cache-Control', 'no-store');
    response.status(status).json({
      statusCode: status,
      code: typeof detail.code === 'string' ? detail.code : `HTTP_${status}`,
      message:
        status >= 500
          ? 'Service temporarily unavailable'
          : (detail.message ?? payload ?? 'Request failed'),
      requestId: response.locals.requestId,
    });
  }
}
