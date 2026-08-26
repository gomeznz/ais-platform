import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client.js";

interface AuthUser {
  id: string;
  email: string;
  role: string;
}

interface AuthTenant {
  id: string;
  name: string;
  slug: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  tenant: AuthTenant | null;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (organizationName: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const STORAGE_KEY = "ais-platform:auth";

const AuthContext = createContext<AuthContextValue | null>(null);

function loadStored(): AuthState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { token: null, user: null, tenant: null };
    return JSON.parse(raw);
  } catch {
    return { token: null, user: null, tenant: null };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(loadStored);

  const persist = useCallback((next: AuthState) => {
    setState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage failures (private browsing, quota, etc.)
    }
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await api.login(email, password);
      persist({ token: result.token, user: result.user, tenant: result.tenant });
    },
    [persist]
  );

  const register = useCallback(
    async (organizationName: string, email: string, password: string) => {
      const result = await api.register(organizationName, email, password);
      persist({ token: result.token, user: result.user, tenant: result.tenant });
    },
    [persist]
  );

  const logout = useCallback(() => {
    persist({ token: null, user: null, tenant: null });
  }, [persist]);

  const value = useMemo(
    () => ({ ...state, login, register, logout }),
    [state, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
