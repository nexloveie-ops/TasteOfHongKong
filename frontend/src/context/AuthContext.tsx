import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { apiFetch } from '../api/client';

interface User {
  _id: string;
  username: string;
  role: 'owner' | 'cashier' | 'platform_owner';
  storeId?: string | null;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  features: string[];
  hasFeature: (key: string) => boolean;
  login: (username: string, password: string, storeSlug: string) => Promise<void>;
  platformLogin: (username: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

function applyAuthPayload(data: { token: string; user: { id: string; username: string; role: User['role']; storeId?: unknown } }, setToken: (t: string) => void, setUser: (u: User) => void) {
  const u = data.user;
  setToken(data.token);
  setUser({
    _id: String(u.id),
    username: u.username,
    role: u.role,
    storeId: u.storeId != null ? String(u.storeId) : undefined,
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('auth_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('auth_token'));
  const [features, setFeatures] = useState<string[]>(() => {
    const saved = localStorage.getItem('auth_features');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    if (token) localStorage.setItem('auth_token', token);
    else localStorage.removeItem('auth_token');
  }, [token]);

  useEffect(() => {
    if (user) localStorage.setItem('auth_user', JSON.stringify(user));
    else localStorage.removeItem('auth_user');
  }, [user]);

  useEffect(() => {
    localStorage.setItem('auth_features', JSON.stringify(features));
  }, [features]);

  const fetchFeatures = useCallback(async () => {
    const res = await apiFetch('/api/admin/features');
    if (!res.ok) {
      setFeatures([]);
      return;
    }
    const data = await res.json().catch(() => ({ features: [] }));
    setFeatures(Array.isArray(data?.features) ? data.features : []);
  }, []);

  useEffect(() => {
    if (!token || !user || user.role === 'platform_owner') return;
    void fetchFeatures();
  }, [fetchFeatures, token, user]);

  const login = useCallback(async (username: string, password: string, storeSlug: string) => {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, slug: storeSlug }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Login failed');
    }
    const data = await res.json();
    applyAuthPayload(data, setToken, setUser);
    await fetchFeatures();
  }, [fetchFeatures]);

  const platformLogin = useCallback(async (username: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Login failed');
    }
    const data = await res.json();
    const u = data.user as { role: string };
    if (u.role !== 'platform_owner') {
      throw new Error('此入口仅限平台管理员账号');
    }
    applyAuthPayload(data, setToken, setUser);
    setFeatures([]);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setFeatures([]);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        features,
        hasFeature: (key: string) => features.includes(key),
        login,
        logout,
        platformLogin,
        isAuthenticated: !!token,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
