"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import type { AuthAccount } from "./auth-client";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthContextValue = Readonly<{
  account: AuthAccount | null;
  status: AuthStatus;
  clearAccount: () => void;
}>;

const defaultAuthContext: AuthContextValue = {
  account: null,
  status: "unauthenticated",
  clearAccount: () => undefined,
};

const AuthContext = createContext<AuthContextValue>(defaultAuthContext);

export function AuthProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [account, setAccount] = useState<AuthAccount | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/auth/me", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => response.ok ? response.json() as Promise<unknown> : null)
      .then((value) => {
        if (!active) return;
        if (!isAuthAccount(value)) {
          setAccount(null);
          setStatus("unauthenticated");
          return;
        }
        setAccount(value);
        setStatus("authenticated");
      })
      .catch(() => {
        if (!active) return;
        setAccount(null);
        setStatus("unauthenticated");
      });
    return () => { active = false; };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    account,
    status,
    clearAccount: () => {
      setAccount(null);
      setStatus("unauthenticated");
    },
  }), [account, status]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

function isAuthAccount(value: unknown): value is AuthAccount {
  if (typeof value !== "object" || value === null) return false;
  const account = value as Record<string, unknown>;
  return typeof account.id === "string"
    && typeof account.displayName === "string"
    && (account.role === "USER" || account.role === "ADMIN")
    && (account.status === "active" || account.status === "suspended")
    && typeof account.version === "number";
}
