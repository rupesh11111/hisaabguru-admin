'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Button, Spinner } from '@/components/ui';
import { hasAdminAccess, useSession } from '@/lib/session';

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/products', label: 'Products' },
  { href: '/catalog-options', label: 'Categories & Units' },
  { href: '/shops', label: 'Shops' },
  { href: '/users', label: 'Users' },
  { href: '/plans', label: 'Plans' },
  { href: '/roles', label: 'Roles' },
];

/**
 * Auth gate for everything under (admin).
 *
 * This is a convenience redirect, not the security boundary — every request is
 * independently authorized by the API's `admin:access` permission check, so a
 * user who forces their way to a route still gets 403s from the server.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { state, signOut } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (state.status === 'anonymous') router.replace('/login');
  }, [state.status, router]);

  if (state.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size={28} />
      </div>
    );
  }

  if (state.status === 'anonymous') return null;

  if (!hasAdminAccess(state.user)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-xl font-bold text-ink">Admin access nahi hai</h1>
        <p className="max-w-sm text-sm text-muted">
          {state.user.phoneNumber} ke paas <code>admin:access</code> permission nahi hai.
          Kisi SUPER_ADMIN se grant karwayein.
        </p>
        <Button variant="secondary" onClick={signOut}>
          Sign out
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="sidebar-brand hidden w-56 shrink-0 flex-col p-4 text-white md:flex">
        <div className="flex items-center gap-3 pb-6">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-lg">
            🧾
          </span>
          <span>
            <span className="block text-[15px] font-extrabold leading-tight">
              hisaabGuru
            </span>
            <span className="block text-[10.5px] font-bold uppercase tracking-wider opacity-80">
              Admin
            </span>
          </span>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5">
          {NAV.map((item) => {
            const active =
              item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  active
                    ? 'bg-white/20 text-white'
                    : 'text-white/85 hover:bg-white/10'
                }`}>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-4 border-t border-white/20 pt-3">
          <p className="tnum px-1 pb-2 text-xs text-white/75">
            {state.user.phoneNumber}
          </p>
          <button
            type="button"
            onClick={signOut}
            className="w-full rounded-lg border border-white/25 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Sidebar collapses on narrow screens; this keeps navigation reachable. */}
        <nav className="sidebar-brand flex gap-1 overflow-x-auto px-3 py-2 md:hidden">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold text-white/85 hover:bg-white/10">
              {item.label}
            </Link>
          ))}
        </nav>
        <main className="mx-auto w-full max-w-6xl flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
