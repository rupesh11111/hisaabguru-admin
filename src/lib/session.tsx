'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { authApi, setOnUnauthorized, setToken } from './api';
import type { CurrentUser } from './types';

type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: CurrentUser };

type SessionContextValue = {
  state: SessionState;
  /** Re-reads /auth/me. Call after a login or a role change. */
  refresh: () => Promise<void>;
  signOut: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * The API gates every /admin route on the `admin:access` permission, so rather than
 * duplicating a role list here we simply check for that permission — one source of
 * truth, and new admin roles work without a frontend change.
 */
export function hasAdminAccess(user: CurrentUser): boolean {
  // The wildcard MUST be checked first. SUPER_ADMIN is seeded with `['*']` and no
  // literal `admin:access`, exactly as the backend's PermissionsGuard expects — it
  // short-circuits on `*` before comparing keys. Checking only the literal locked the
  // one account that owns the panel out of it.
  return (
    user.permissions.includes('*') || user.permissions.includes('admin:access')
  );
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    try {
      const user = await authApi.me();
      setState({ status: 'authenticated', user });
    } catch {
      // Expired or absent token — both mean "show the login page".
      setState({ status: 'anonymous' });
    }
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    setState({ status: 'anonymous' });
    router.replace('/login');
  }, [router]);

  useEffect(() => {
    // Session restore on mount: `refresh` only setStates after awaiting /auth/me, so
    // the update lands in a later tick rather than cascading out of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  // A 401 from any request, not just the initial load, must drop the session.
  useEffect(() => {
    setOnUnauthorized(() => {
      setState({ status: 'anonymous' });
      router.replace('/login');
    });
    return () => setOnUnauthorized(null);
  }, [router]);

  const value = useMemo(() => ({ state, refresh, signOut }), [state, refresh, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
