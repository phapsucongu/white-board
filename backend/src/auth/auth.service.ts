import {
  ConflictException,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { getAccessTokenSecret } from './jwt-secret';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import type {
  AccessTokenPayload,
  AuthTokenResponse,
  LogoutResponse
} from './types';

type ParsedRefreshToken = {
  sessionId: string;
  secret: string;
};

@Injectable()
export class AuthService {
  private readonly passwordHashRounds = 12;
  private readonly refreshHashRounds = 12;

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.usersService.findByEmail(dto.email);

    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, this.passwordHashRounds);
    const user = await this.usersService.createUser({
      email: dto.email,
      passwordHash,
      displayName: dto.displayName
    });

    return this.usersService.toPublicUser(user);
  }

  async login(dto: LoginDto): Promise<AuthTokenResponse> {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.createAuthResponse(user);
  }

  async refresh(refreshToken: string): Promise<AuthTokenResponse> {
    const parsedToken = this.parseRefreshToken(refreshToken);
    const session = await this.prisma.refreshSession.findUnique({
      where: {
        id: parsedToken.sessionId
      },
      include: {
        user: true
      }
    });

    if (!session) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Reuse detection: a token whose secret still matches a session we already
    // revoked means an old (rotated-out) token is being replayed — a strong signal
    // the token was stolen. Revoke the entire session family for that user so the
    // attacker's descendant session is invalidated too.
    if (session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      const stillMatches = await bcrypt.compare(parsedToken.secret, session.tokenHash);

      if (stillMatches && session.revokedAt) {
        await this.prisma.refreshSession.updateMany({
          where: { userId: session.userId, revokedAt: null },
          data: { revokedAt: new Date() }
        });
      }

      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenMatches = await bcrypt.compare(parsedToken.secret, session.tokenHash);

    if (!tokenMatches) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const nextSecret = this.generateRefreshSecret();
    const nextTokenHash = await bcrypt.hash(nextSecret, this.refreshHashRounds);
    const expiresAt = this.getRefreshExpiresAt();
    const now = new Date();

    const nextSession = await this.prisma.$transaction(async (tx) => {
      await tx.refreshSession.update({
        where: {
          id: session.id
        },
        data: {
          revokedAt: now
        }
      });

      return tx.refreshSession.create({
        data: {
          userId: session.userId,
          tokenHash: nextTokenHash,
          expiresAt
        }
      });
    });

    return {
      user: this.usersService.toPublicUser(session.user),
      accessToken: await this.signAccessToken(session.user),
      refreshToken: this.formatRefreshToken(nextSession.id, nextSecret)
    };
  }

  async logout(refreshToken: string): Promise<LogoutResponse> {
    const parsedToken = this.parseRefreshToken(refreshToken);
    const session = await this.prisma.refreshSession.findUnique({
      where: {
        id: parsedToken.sessionId
      }
    });

    if (!session) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenMatches = await bcrypt.compare(parsedToken.secret, session.tokenHash);

    if (!tokenMatches) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (!session.revokedAt) {
      await this.prisma.refreshSession.update({
        where: {
          id: session.id
        },
        data: {
          revokedAt: new Date()
        }
      });
    }

    return {
      success: true
    };
  }

  private async createAuthResponse(user: User): Promise<AuthTokenResponse> {
    const refreshSecret = this.generateRefreshSecret();
    const tokenHash = await bcrypt.hash(refreshSecret, this.refreshHashRounds);
    const session = await this.prisma.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: this.getRefreshExpiresAt()
      }
    });

    return {
      user: this.usersService.toPublicUser(user),
      accessToken: await this.signAccessToken(user),
      refreshToken: this.formatRefreshToken(session.id, refreshSecret)
    };
  }

  private async signAccessToken(user: User): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email
    };

    return this.jwt.signAsync(payload, {
      secret: this.getAccessSecret(),
      expiresIn: this.getAccessTokenTtl()
    });
  }

  private parseRefreshToken(refreshToken: string): ParsedRefreshToken {
    const separatorIndex = refreshToken.indexOf('.');

    if (separatorIndex <= 0 || separatorIndex === refreshToken.length - 1) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return {
      sessionId: refreshToken.slice(0, separatorIndex),
      secret: refreshToken.slice(separatorIndex + 1)
    };
  }

  private formatRefreshToken(sessionId: string, secret: string): string {
    return `${sessionId}.${secret}`;
  }

  private generateRefreshSecret(): string {
    return randomBytes(32).toString('base64url');
  }

  private getAccessSecret(): string {
    return getAccessTokenSecret(this.config);
  }

  private getAccessTokenTtl(): JwtSignOptions['expiresIn'] {
    return (this.config.get<string>('JWT_ACCESS_TTL') ?? '15m') as JwtSignOptions['expiresIn'];
  }

  private getRefreshExpiresAt(): Date {
    const ttlDays = Number(this.config.get<string>('REFRESH_TOKEN_TTL_DAYS') ?? 30);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ttlDays);

    return expiresAt;
  }
}
