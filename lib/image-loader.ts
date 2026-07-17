/**
 * next/image CUSTOM loader (09-platform-infra/hyper-performant-website S1.1).
 *
 * WHY a custom loader instead of Next's built-in `/_next/image` optimizer:
 * this app runs `output: 'standalone'` on Cloud Run (frontend-vercel-to-cloudrun
 * epic). That build mode has a confirmed, still-open upstream Next.js regression
 * (vercel next.js repo, issue 82610 — search "output: standalone /_next/image")
 * where every `/_next/image` request 500s/400s — verified directly against this
 * Dockerfile (see its S1.2 commit message: "Dropped the '/_next/image optimized
 * request' acceptance check... confirmed open upstream output:standalone
 * regression"). The built-in optimizer is therefore a dead end here regardless
 * of how `images.formats`/`remotePatterns` are configured.
 *
 * A CUSTOM loader sidesteps that route entirely — `next/image` just calls this
 * function per candidate width and uses whatever URL it returns directly as
 * `src`/`srcset`; no `/_next/image` hop involved. We point it at our own
 * `/api/img` route (app/api/img/route.ts), a small `sharp`-based resize/format
 * proxy that already runs fine in this container (sharp is explicitly
 * reinstalled in the Dockerfile's runner stage for the same standalone-tracing
 * reason, and is proven working there).
 *
 * Registered in next.config.ts via `images.loader = 'custom'` + `loaderFile`.
 */
import type { ImageLoaderProps } from 'next/image'

export default function r2ImageLoader({ src, width, quality }: ImageLoaderProps): string {
  const params = new URLSearchParams({
    url: src,
    w: String(width),
    q: String(quality ?? 75),
  })
  return `/api/img?${params.toString()}`
}
