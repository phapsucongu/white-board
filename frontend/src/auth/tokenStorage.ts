const REFRESH_TOKEN_KEY = 'whiteboard.refreshToken';

export function getStoredRefreshToken(): string | null {
  return window.sessionStorage.getItem(REFRESH_TOKEN_KEY);
}

export function storeRefreshToken(refreshToken: string): void {
  window.sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearStoredRefreshToken(): void {
  window.sessionStorage.removeItem(REFRESH_TOKEN_KEY);
}
