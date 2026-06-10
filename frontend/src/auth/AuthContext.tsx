import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { ApiError, apiClient, type AuthUser, type LoginInput, type RegisterInput } from '../api/client';
import {
  clearStoredRefreshToken,
  getStoredRefreshToken,
  storeRefreshToken
} from './tokenStorage';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

type AuthContextValue = {
  accessToken: string | null;
  error: string | null;
  status: AuthStatus;
  user: AuthUser | null;
  clearError: () => void;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<string | null>;
  register: (input: RegisterInput) => Promise<void>;
  getMe: () => Promise<AuthUser | null>;
  runWithAuth: <T>(request: (accessToken: string) => Promise<T>) => Promise<T>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  const clearAuthState = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    clearStoredRefreshToken();
    setStatus('anonymous');
  }, []);

  const applyAuthResponse = useCallback(async (nextAccessToken: string, nextRefreshToken: string) => {
    setAccessToken(nextAccessToken);
    storeRefreshToken(nextRefreshToken);
    const currentUser = await apiClient.me(nextAccessToken);
    setUser(currentUser);
    setStatus('authenticated');
  }, []);

  const refreshSession = useCallback(async (): Promise<string | null> => {
    const refreshToken = getStoredRefreshToken();

    if (!refreshToken) {
      clearAuthState();
      return null;
    }

    try {
      const authResponse = await apiClient.refresh(refreshToken);
      setAccessToken(authResponse.accessToken);
      storeRefreshToken(authResponse.refreshToken);
      const currentUser = await apiClient.me(authResponse.accessToken);
      setUser(currentUser);
      setStatus('authenticated');

      return authResponse.accessToken;
    } catch {
      clearAuthState();
      return null;
    }
  }, [clearAuthState]);

  const getMe = useCallback(async (): Promise<AuthUser | null> => {
    if (!accessToken) {
      return null;
    }

    try {
      const currentUser = await apiClient.me(accessToken);
      setUser(currentUser);
      return currentUser;
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        const refreshedAccessToken = await refreshSession();

        if (refreshedAccessToken) {
          const currentUser = await apiClient.me(refreshedAccessToken);
          setUser(currentUser);
          return currentUser;
        }
      }

      throw error;
    }
  }, [accessToken, refreshSession]);

  const runWithAuth = useCallback(
    async <T,>(request: (requestAccessToken: string) => Promise<T>): Promise<T> => {
      const currentAccessToken = accessToken ?? (await refreshSession());

      if (!currentAccessToken) {
        throw new ApiError('Authentication required', 401);
      }

      try {
        return await request(currentAccessToken);
      } catch (error: unknown) {
        if (error instanceof ApiError && error.status === 401) {
          const refreshedAccessToken = await refreshSession();

          if (refreshedAccessToken) {
            return request(refreshedAccessToken);
          }
        }

        throw error;
      }
    },
    [accessToken, refreshSession]
  );

  const login = useCallback(
    async (input: LoginInput) => {
      setError(null);

      try {
        const authResponse = await apiClient.login(input);
        await applyAuthResponse(authResponse.accessToken, authResponse.refreshToken);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Login failed';
        setError(message);
        throw error;
      }
    },
    [applyAuthResponse]
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      setError(null);

      try {
        await apiClient.register(input);
        const authResponse = await apiClient.login({
          email: input.email,
          password: input.password
        });
        await applyAuthResponse(authResponse.accessToken, authResponse.refreshToken);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Registration failed';
        setError(message);
        throw error;
      }
    },
    [applyAuthResponse]
  );

  const logout = useCallback(async () => {
    const refreshToken = getStoredRefreshToken();
    setError(null);

    if (refreshToken) {
      try {
        await apiClient.logout(refreshToken);
      } catch {
        // Local logout should still clear tokens if the session was already invalid.
      }
    }

    clearAuthState();
  }, [clearAuthState]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken,
      error,
      status,
      user,
      clearError: () => setError(null),
      getMe,
      login,
      logout,
      refreshSession,
      register,
      runWithAuth
    }),
    [accessToken, error, getMe, login, logout, refreshSession, register, runWithAuth, status, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return context;
}
