# hisaabGuru Admin

Web admin panel for hisaabGuru — global product catalog, shops, users, roles and
subscription plans. Talks to the NestJS API (`hisaabguru-backend`) directly from the
browser; it has no server of its own beyond Next.js rendering.

This is **the** admin surface. Admin previously lived in two places — the Expo app
under `app/admin/*`, and the Vite console inside the backend at `/console`. Both are
retired: the Expo screens are deleted, and the console is now sign-in only and shows
"Coming soon". Everything admin-related gets built here.

## Setup

```bash
cp .env.example .env.local     # point NEXT_PUBLIC_API_BASE_URL at your API
npm install
npm run dev                    # http://localhost:3100
```

Ports on this machine are crowded — 3000–3011 belong to unrelated `ek-ishwar` Docker
services, and the hisaabGuru API itself runs on **8000** (`PORT` in the backend
`.env`). Hence 3100 here and `:8000/api/v1` as the API base.

### Backend must allow this origin

Requests go browser → API, so the API's CORS list has to include this app:

```
CORS_ORIGINS=http://localhost:3100,https://admin.yourdomain.com
```

Without it every call fails at the preflight, which shows up here as
`Network error: Failed to fetch`.

## Access control

Login is the same phone + OTP flow as the mobile app. After verifying, the app reads
`/auth/me` and requires the **`admin:access`** permission — the exact permission the
API gates every `/admin/*` route on, so there is no second list to keep in sync.

The route guard in `src/app/(admin)/layout.tsx` is a convenience redirect only. Every
request is independently authorized server-side; forcing a URL just yields 403s.

## Layout

```
src/
  app/
    login/                     phone + OTP
    (admin)/                   auth-gated shell with sidebar
      page.tsx                 overview / stats
      products/                catalog: list, edit, bulk import
      shops/  users/           browse + detail, role changes, shop delete
      plans/  roles/           subscription plans, RBAC editor
  components/ui.tsx            buttons, inputs, cards, tables, dialogs
  lib/
    api.ts                     typed client, bearer token, 401 → /login
    types.ts                   API response shapes
    session.tsx                session context + admin gate
    openfoodfacts.ts           barcode → product lookup (see below)
```

## Barcode handling

There is no camera scanner. A desk admin uses a **USB scanner in keyboard-wedge
mode**: it types the digits into the focused input and presses Enter, so the barcode
fields simply accept Enter. Typing by hand works identically.

Every barcode is validated (GTIN-8/12/13/14 check digit) and normalized to GTIN-13
before it leaves the browser, so a UPC-A and its zero-padded EAN-13 can't create two
catalog rows for the same trade item.

`lib/openfoodfacts.ts` looks a code up across Open Food Facts → Open Beauty Facts →
Open Products Facts, with retry/backoff, an in-memory TTL cache and single-flight
dedup. Coverage for Indian SKUs is genuinely patchy — the lookup is a convenience for
prefilling a form, not a source of truth. Growing this catalog is what actually fixes
scanning in the mobile app.

## Bulk import

Two modes at `/products/import`:

- **CSV paste** — `name, category, unit, barcodes` (header optional; multiple barcodes
  separated by `|` or spaces). Bad rows are flagged client-side before anything is sent.
- **Scan queue** — scan codes one after another; each row is prefilled from
  Open*Facts and stays editable before import.

The API imports row by row rather than as one transaction: a bad row never blocks the
good ones, and each row reports created / updated / failed separately. A row whose
barcode already exists **updates** that product, so re-importing a corrected sheet is
safe to repeat.
## Docker

```bash
docker build --build-arg NEXT_PUBLIC_API_BASE_URL=https://your-api/api/v1 -t hisaabguru-admin .
docker run -p 3100:3100 hisaabguru-admin
```

`NEXT_PUBLIC_API_BASE_URL` has to be a **build arg**, not a runtime env var. Next inlines
`NEXT_PUBLIC_*` into the client bundle during `next build`, so passing it only at `docker
run` ships an image still pointing at the `http://localhost:8000/api/v1` fallback in
`lib/api.ts` — the container starts fine and every API call fails in the browser.

`/api/health` is the liveness probe (Docker `HEALTHCHECK` and Railway's `healthcheckPath`).
It reports only whether the Next server is up; it deliberately does not ping the backend.

## CI

`.github/workflows/ci.yml` runs on push/PR to `main`: lint → typecheck → `next build`,
then a Docker image build that boots the container and waits for `/api/health`. The image
build is gated on the cheap checks so a typo doesn't burn a full image build.

## Deploy (Railway)

`railway.json` pins the Dockerfile builder and the health check. Deploys ride on
`git push origin main` — Railway rebuilds from this repo, there is no `railway up` step.

Service variables to set in Railway:

- `NEXT_PUBLIC_API_BASE_URL` — e.g. `https://hisaabguru.up.railway.app/api/v1`. Railway
  forwards service variables into the build as `ARG`s, which is what makes the build-time
  inlining above work.

Also add this service's public URL to the API's `CORS_ORIGINS`, or every request from the
browser is blocked.
