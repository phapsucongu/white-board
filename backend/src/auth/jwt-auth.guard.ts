import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import type { AccessTokenPayload } from './types';

type HttpRequest = {
  headers: {
    authorization?: string;
  };
  user?: unknown;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly usersService: UsersService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<HttpRequest>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.getAccessSecret()
      });
      const user = await this.usersService.findPublicById(payload.sub);

      if (!user) {
        throw new UnauthorizedException('Authentication required');
      }

      request.user = user;

      return true;
    } catch {
      throw new UnauthorizedException('Authentication required');
    }
  }

  private extractBearerToken(request: HttpRequest): string | null {
    const header = request.headers.authorization;

    if (!header) {
      return null;
    }

    const [scheme, token] = header.split(' ');

    return scheme?.toLowerCase() === 'bearer' && token ? token : null;
  }

  private getAccessSecret(): string {
    return this.config.get<string>('JWT_ACCESS_SECRET') ?? 'dev-access-secret-change-me';
  }
}
