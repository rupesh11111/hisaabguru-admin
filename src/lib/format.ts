/**
 * Date-and-time as the rest of hisaabGuru shows it: 12-hour with am/pm.
 *
 * `toLocaleString()` with no options follows the browser's locale, which gives a 24-hour
 * clock for en-GB and most of Europe. The zone stays the browser's own.
 */
const DATE_TIME = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  hour12: true,
});

export function fmtDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return DATE_TIME.format(d);
}
