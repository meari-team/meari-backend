import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { compare, hash, hashSync } from 'bcryptjs';
import { defaultChecklistCreateInput } from '../checklist/default-checklist.js';
import { AppException } from '../common/errors/app.exception.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toUserDto, type UserDto } from '../users/user.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import type { SignupDto } from './dto/signup.dto.js';

const BCRYPT_COST = 10;

// 없는 이메일로 로그인해도 비교 시간을 비슷하게 맞춰, 가입 여부가 응답 속도로 드러나지 않게 한다.
const DUMMY_HASH = hashSync('meari-dummy-password', BCRYPT_COST);

export type AuthResult = { accessToken: string; user: UserDto };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async signup(dto: SignupDto): Promise<AuthResult> {
    const passwordHash = await hash(dto.password, BCRYPT_COST);
    try {
      // 사용자와 기본 체크리스트를 한 번의 nested create(단일 트랜잭션)로 만든다.
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash,
          nickname: dto.nickname,
          categories: { create: defaultChecklistCreateInput() },
        },
      });
      return this.issue(user);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new AppException(
          'EMAIL_TAKEN',
          HttpStatus.CONFLICT,
          '이미 가입된 이메일이에요.',
        );
      }
      throw e;
    }
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    const ok = await compare(dto.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      throw new AppException(
        'INVALID_CREDENTIALS',
        HttpStatus.UNAUTHORIZED,
        '이메일 또는 비밀번호가 맞지 않아요.',
      );
    }
    return this.issue(user);
  }

  private async issue(
    user: Parameters<typeof toUserDto>[0],
  ): Promise<AuthResult> {
    const accessToken = await this.jwt.signAsync({ sub: user.id });
    return { accessToken, user: toUserDto(user) };
  }
}
