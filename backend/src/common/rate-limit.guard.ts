import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleDestroy,
  SetMetadata,
  type Type
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import Redis from 'ioredis';

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
 * Apply a per-IP fixed-window rate limit to a route. Backed by Redis when REDIS_URL is
 * configured (so the limit holds across multiple backend instances), falling back to an
 * in-memory window per instance otherwise. Blunts password brute force / credential
 * stuffing / invite-code enumeration on the auth surface.
 */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

type Hit = {
  count: number;
  resetAt: number;
};

@Injectable()
export class RateLimitGuard implements CanActivate, OnModuleDestroy {
  private readonly hits = new Map<string, Hit>();
  private redis: Redis | null = null;

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService
  ) {
    const redisUrl = this.config.get<string>('REDIS_URL');

    if (redisUrl) {
      const client = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        retryStrategy: () => null
      });
      // Non-fatal: on any Redis error we fall back to the in-memory window.
      client.on('error', () => undefined);
      client
        .connect()
        .then(() => {
          this.redis = client;
        })
        .catch(() => {
          client.disconnect();
          this.redis = null;
        });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit().catch(() => undefined);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (!options) {
      return true;
    }

    const request = context.switchToHttp().getRequest<HttpRequestLike>();
    const key = `ratelimit:${this.resolveClientId(request)}:${request.method}:${request.route?.path ?? request.path}`;

    if (this.redis) {
      try {
        return await this.checkRedis(key, options);
      } catch (error) {
        // A rate-limit rejection must propagate; only a Redis failure falls back.
        if (error instanceof HttpException) {
          throw error;
        }
      }
    }

    return this.checkInMemory(key, options);
  }

  private async checkRedis(key: string, options: RateLimitOptions): Promise<boolean> {
    const redis = this.redis as Redis;
    const count = await redis.incr(key);

    if (count === 1) {
      await redis.pexpire(key, options.windowMs);
    }

    if (count > options.limit) {
      const ttl = await redis.pttl(key);
      this.reject(ttl > 0 ? ttl : options.windowMs);
    }

    return true;
  }

  private checkInMemory(key: string, options: RateLimitOptions): boolean {
    const now = Date.now();
    const existing = this.hits.get(key);

    if (!existing || existing.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + options.windowMs });
      this.evictExpired(now);
      return true;
    }

    if (existing.count >= options.limit) {
      this.reject(existing.resetAt - now);
    }

    existing.count += 1;
    return true;
  }

  private reject(retryAfterMs: number): never {
    throw new HttpException(
      {
        message: 'Too many requests, please try again later.',
        retryAfter: Math.ceil(retryAfterMs / 1000)
      },
      HttpStatus.TOO_MANY_REQUESTS
    );
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
