import type { PublicUser } from '../users/users.service';

export type AccessTokenPayload = {
  sub: string;
  email: string;
};

export type AuthenticatedUser = PublicUser;

export type AuthTokenResponse = {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
};

export type LogoutResponse = {
  success: true;
};

export type AuthenticatedRequest = {
  user: AuthenticatedUser;
};
