import type { NextConfig } from "next";

/**
 * The developer test panel's API lives in files named `route.dev.ts` (`src/app/api/dev/**`).
 * Next.js only treats a file as a route when its extension is in `pageExtensions`, so listing
 * `dev.ts` here only outside production means a production build (`next build`, `next start`)
 * does not compile those routes at all: they are not registered, and cannot be called by
 * any address. (They also refuse to run outside a development or test environment; that
 * is a second lock on the same door, not the only one.)
 */
const isProduction = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  // Standalone output keeps the Docker image small and self-contained.
  output: process.env.DOCKER_BUILD === "true" ? "standalone" : undefined,
  poweredByHeader: false,
  // The app has no next/image and no images to optimize. Turning the optimizer off also keeps sharp and its
  // native libvips binaries (about 46 MB in the Linux image) out of the standalone output.
  images: { unoptimized: true },
  // Next still traces sharp because its image optimizer names it; with the optimizer off it is never loaded.
  outputFileTracingExcludes: { "*": ["node_modules/sharp/**", "node_modules/@img/**"] },
  serverExternalPackages: ["postgres", "nodemailer"],
  // Source maps are 12 of the 15.6 MiB of `.next/server` and nothing in production reads them.
  enablePrerenderSourceMaps: false,
  experimental: { serverSourceMaps: false },
  pageExtensions: isProduction ? ["tsx", "ts", "jsx", "js"] : ["tsx", "ts", "jsx", "js", "dev.ts"],

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // The parts of a content policy that cannot break the app: nobody may frame it, a rewritten
          // <base> or a form aimed at another site is refused, and no plug-ins. Scripts and images are
          // left alone on purpose: Next.js needs inline scripts, and campaign previews show remote images.
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
          // Only sent from a production build; browsers ignore it over plain http.
          ...(isProduction ? [{ key: "Strict-Transport-Security", value: "max-age=15552000" }] : []),
        ],
      },
      {
        // The tracking pixel is embedded in third-party mail clients, so it must
        // not inherit the frame/referrer restrictions above being interpreted as
        // a same-origin-only asset.
        source: "/api/track/open/:token",
        headers: [{ key: "X-Content-Type-Options", value: "nosniff" }],
      },
    ];
  },
};

export default nextConfig;
