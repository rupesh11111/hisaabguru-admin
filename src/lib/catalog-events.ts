'use client';

import { useEffect, useState } from 'react';

import { adminApi } from './api';

const EVENT = 'hg:catalog-changed';

/** Call after anything that changes how many products await review. */
export function notifyCatalogChanged() {
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Active products still awaiting approval, for the sidebar badge. Refetched on
 * navigation and whenever a page reports a catalog change; null while unknown, so a
 * failed fetch shows no badge rather than a wrong number.
 */
export function usePendingProductCount(enabled: boolean, pathname: string) {
  const [count, setCount] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener(EVENT, bump);
    return () => window.removeEventListener(EVENT, bump);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    adminApi
      .stats()
      .then((s) => {
        if (!cancelled) setCount(s.totals.pendingProducts ?? null);
      })
      .catch(() => {
        if (!cancelled) setCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, pathname, tick]);

  return count;
}
