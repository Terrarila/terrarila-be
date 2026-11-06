import { UnauthorizedException } from '@nestjs/common';

export function guestToken(value: string | undefined) {
  if (!value || !/^Bearer [a-f0-9]{64}$/.test(value)) throw new UnauthorizedException();
  return value.slice(7);
}
