import type { ServiceHealth } from '@whiteboard/shared';
import { env } from '../config/env';

export type AuthUser = {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AuthTokenResponse = {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
};

export type RegisterInput = {
  email: string;
  password: string;
  displayName?: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type RoomRole = 'OWNER' | 'EDITOR' | 'VIEWER';

export type RoomSummary = {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  role?: RoomRole;
};

export type CreateRoomInput = {
  name: string;
};

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  accessToken?: string;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers();

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  if (options.accessToken) {
    headers.set('Authorization', `Bearer ${options.accessToken}`);
  }

  const response = await fetch(`${env.apiBaseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  return (await response.json()) as T;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };

    if (Array.isArray(body.message)) {
      return body.message.join(', ');
    }

    if (typeof body.message === 'string') {
      return body.message;
    }
  } catch {
    return `API request failed with status ${response.status}`;
  }

  return `API request failed with status ${response.status}`;
}

export const apiClient = {
  getHealth: () => apiRequest<ServiceHealth>('/health'),
  register: (input: RegisterInput) =>
    apiRequest<AuthUser>('/auth/register', {
      method: 'POST',
      body: input
    }),
  login: (input: LoginInput) =>
    apiRequest<AuthTokenResponse>('/auth/login', {
      method: 'POST',
      body: input
    }),
  refresh: (refreshToken: string) =>
    apiRequest<AuthTokenResponse>('/auth/refresh', {
      method: 'POST',
      body: {
        refreshToken
      }
    }),
  logout: (refreshToken: string) =>
    apiRequest<{ success: true }>('/auth/logout', {
      method: 'POST',
      body: {
        refreshToken
      }
    }),
  me: (accessToken: string) =>
    apiRequest<AuthUser>('/auth/me', {
      accessToken
    }),
  listRooms: (accessToken: string) =>
    apiRequest<RoomSummary[]>('/rooms', {
      accessToken
    }),
  createRoom: (input: CreateRoomInput, accessToken: string) =>
    apiRequest<RoomSummary>('/rooms', {
      method: 'POST',
      body: input,
      accessToken
    }),
  getRoom: (roomId: string, accessToken: string) =>
    apiRequest<RoomSummary>(`/rooms/${encodeURIComponent(roomId)}`, {
      accessToken
    })
};
