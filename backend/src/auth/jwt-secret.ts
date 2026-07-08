import type { ConfigService } from '@nestjs/config';

const MIN_SECRET_LENGTH = 16;
const INSECURE_DEFAULTS = new Set(['dev-access-secret-change-me', 'change-me', 'secret']);

/**
 * Resolve the JWT access-token secret from configuration, failing fast when it is
 * missing, too short, or a well-known insecure placeholder. This prevents the app
 * from ever signing/verifying tokens with a source-committed default, which would
 * let anyone forge tokens for any user.
 */
export function getAccessTokenSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_ACCESS_SECRET');

  if (!secret || secret.trim().length < MIN_SECRET_LENGTH || INSECURE_DEFAULTS.has(secret)) {
    throw new Error(
      'JWT_ACCESS_SECRET is not configured with a secure value. Set it to a random string of at least ' +
        `${MIN_SECRET_LENGTH} characters.`
    );
  }

  return secret;
}
