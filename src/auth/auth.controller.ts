import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { AuthService } from './auth.service.js';
import { SessionGuard } from './session.guard.js';
import type { AuthenticatedRequest } from './session.guard.js';
export class GoogleLoginDto {
  @ApiProperty({ description: 'Google GIS ID token, with nonce from the backend challenge' })
  @IsString()
  @MinLength(50)
  @MaxLength(12000)
  idToken!: string;
  @ApiProperty()
  @IsUUID()
  challengeId!: string;
}
@ApiTags('Authentication')
@Controller('v1/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Post('challenge') @HttpCode(200) challenge() {
    return this.auth.challenge();
  }
  @Post('google') @HttpCode(200) login(@Body() input: GoogleLoginDto) {
    return this.auth.login(input.idToken, input.challengeId);
  }
  @Get('me') @ApiBearerAuth() @UseGuards(SessionGuard) me(@Req() req: AuthenticatedRequest) {
    return req.user;
  }
  @Post('logout') @HttpCode(200) @ApiBearerAuth() @UseGuards(SessionGuard) logout(
    @Req() req: AuthenticatedRequest,
  ) {
    return this.auth.logout(req.sessionId);
  }
}
