import { createContext, useContext, useState, type ReactNode } from "react";

export interface AuthUser {
  username: string;
  role: "admin" | "viewer";
  name: string;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001/api";

function loadStored(): AuthState {
  const token = localStorage.getItem("sqls_token");
  const userStr = localStorage.getItem("sqls_user");
  if (!token || !userStr) return { user: null, token: null };
  try {
    return { user: JSON.parse(userStr) as AuthUser, token };
  } catch {
    return { user: null, token: null };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(loadStored);

  async function login(username: string, password: string) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ message: "Login failed" }))) as { message?: string };
      throw new Error(err.message ?? "Login failed");
    }
    const { token, role, name } = (await res.json()) as { token: string; role: "admin" | "viewer"; name: string };
    const user: AuthUser = { username, role, name };
    localStorage.setItem("sqls_token", token);
    localStorage.setItem("sqls_user", JSON.stringify(user));
    setState({ user, token });
  }

  function logout() {
    localStorage.removeItem("sqls_token");
    localStorage.removeItem("sqls_user");
    setState({ user: null, token: null });
  }

  return <AuthContext.Provider value={{ ...state, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
