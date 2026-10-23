import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import type { SessionUser } from './auth.service.js';
export type AuthenticatedRequest = Request & { user: SessionUser; sessionId: string };
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = /^Bearer ([^\s]+)$/.exec(req.header('Authorization') ?? '')?.[1];
    if (!token) throw new UnauthorizedException('Bearer session required');
    const { sessionId, ...user } = await this.auth.authenticate(token);
    req.user = user;
    req.sessionId = sessionId;
    return true;
  }
}
