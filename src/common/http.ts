import { Catch, HttpException, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';

export function requestContext(req: Request, res: Response, next: () => void) {
  const incoming = req.header('X-Request-Id');
  res.locals.requestId = incoming && isUUID(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', res.locals.requestId as string);
  res.setHeader('Cache-Control', 'no-store');
  next();
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const parserType =
      typeof error === 'object' && error !== null && 'type' in error ? error.type : null;
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : parserType === 'entity.too.large'
          ? 413
          : parserType === 'entity.parse.failed'
            ? 400
            : 500;
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
