import { RateLimit } from '../rate-limit/rate-limit.js';
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { ApiErrors } from '../common/swagger/api-docs.js';
import { AuthService } from './auth.service.js';
import { AuthResultDto } from './dto/auth-result.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { SignupDto } from './dto/signup.dto.js';

@ApiTags('auth')
@ApiSecurity({})
@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @RateLimit('auth')
  @Post('signup')
  @ApiOperation({ summary: '회원가입 (A1) — 기본 체크리스트 생성' })
  @ApiCreatedResponse({ type: AuthResultDto })
  @ApiErrors({ 400: ['VALIDATION_FAILED'], 409: ['EMAIL_TAKEN'] })
  signup(@Body() dto: SignupDto): Promise<AuthResultDto> {
    return this.auth.signup(dto);
  }

  @RateLimit('auth')
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '로그인 (A2)' })
  @ApiOkResponse({ type: AuthResultDto })
  @ApiErrors({ 400: ['VALIDATION_FAILED'], 401: ['INVALID_CREDENTIALS'] })
  login(@Body() dto: LoginDto): Promise<AuthResultDto> {
    return this.auth.login(dto);
  }
}
