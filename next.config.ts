import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    // Product photos come straight from the Open*Facts CDNs. The exact host varies
    // per record (images./static./world.), so the family is allow-listed rather than
    // each one. Nothing else may be proxied.
    remotePatterns: [
      { protocol: 'https', hostname: '**.openfoodfacts.org' },
      { protocol: 'https', hostname: '**.openbeautyfacts.org' },
      { protocol: 'https', hostname: '**.openproductsfacts.org' },
    ],
  },
  // The admin talks to the NestJS API directly from the browser; nothing is proxied,
  // so the API's CORS_ORIGINS must list this app's origin.
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  },
};

export default nextConfig;
