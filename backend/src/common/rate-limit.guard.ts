import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
  type Type
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

type HttpRequestLike = {
  method: string;
  path: string;
  ip?: string;
  route?: { path?: string };
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
};

export type RateLimitOptions = {
  /** Max requests allowed per client within the window. */
  limit: number;
  /** Sliding window length in milliseconds. */
  windowMs: number;
};

export const RATE_LIMIT_KEY = 'rateLimit';

/**
 * Apply an in-memory, per-IP sliding-window rate limit to a route. Deliberately
 * dependency-free (no @nestjs/throttler) and single-instance only — good enough to
 * blunt password brute force / credential stuffing / invite-code enumeration on the
 * auth surface. For multi-instance deployments, back this with a shared store.
 */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

type Hit = {
  count: number;
  resetAt: number;
};

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, Hit>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (!options) {
      return true;
    }

    const request = context.switchToHttp().getRequest<HttpRequestLike>();
    const key = `${this.resolveClientId(request)}:${request.method}:${request.route?.path ?? request.path}`;
    const now = Date.now();
    const existing = this.hits.get(key);

    if (!existing || existing.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + options.windowMs });
      this.evictExpired(now);
      return true;
    }

    if (existing.count >= options.limit) {
      const retryAfter = Math.ceil((existing.resetAt - now) / 1000);
      throw new HttpException(
        { message: 'Too many requests, please try again later.', retryAfter },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    existing.count += 1;
    return true;
  }

  private resolveClientId(request: HttpRequestLike): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
    return request.ip ?? request.socket?.remoteAddress ?? 'unknown';
  }

  private evictExpired(now: number): void {
    // Opportunistic cleanup so the map can't grow unbounded over time.
    if (this.hits.size < 5000) {
      return;
    }
    for (const [key, hit] of this.hits.entries()) {
      if (hit.resetAt <= now) {
        this.hits.delete(key);
      }
    }
  }
}

export const RateLimitGuardProvider: Type<RateLimitGuard> = RateLimitGuard;
