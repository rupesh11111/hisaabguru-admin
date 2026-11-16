'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Button, Spinner } from '@/components/ui';
import { usePendingProductCount } from '@/lib/catalog-events';
import { hasAdminAccess, useSession } from '@/lib/session';

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/products', label: 'Products' },
  { href: '/catalog-options', label: 'Categories & Units' },
  { href: '/shops', label: 'Shops' },
  { href: '/users', label: 'Users' },
  { href: '/plans', label: 'Plans' },
  { href: '/referrals', label: 'Referrals' },
  { href: '/app-release', label: 'App release' },
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

  const pendingProducts = usePendingProductCount(
    state.status === 'authenticated' && hasAdminAccess(state.user),
    pathname,
  );
  const badgeFor = (href: string) =>
    href === '/products' && pendingProducts ? pendingProducts : null;

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
        <h1 className="text-xl font-bold text-ink">No admin access</h1>
        <p className="max-w-sm text-sm text-muted">
          {state.user.phoneNumber} does not have the <code>admin:access</code> permission.
          Ask a SUPER_ADMIN to grant it.
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
          {/* eslint-disable-next-line @next/next/no-img-element -- static 128px asset; next/image adds nothing here. */}
          <img
            src="/logo.png"
            alt=""
            width={40}
            height={40}
            className="size-10 shrink-0 rounded-xl"
          />
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
                className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  active
                    ? 'bg-white/20 text-white'
                    : 'text-white/85 hover:bg-white/10'
                }`}>
                {item.label}
                {badgeFor(item.href) ? (
                  <span
                    className="tnum rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-brand-deep"
                    title="Products awaiting review">
                    {badgeFor(item.href)}
                  </span>
                ) : null}
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
              {badgeFor(item.href) ? (
                <span className="tnum ml-1.5 rounded-full bg-white px-1.5 text-[11px] font-bold text-brand-deep">
                  {badgeFor(item.href)}
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
        <main className="mx-auto w-full max-w-6xl flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
