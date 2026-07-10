/**
 * GET /api/health
 *
 * Cloud Run startup/liveness probe target (09-platform-infra
 * frontend-vercel-to-cloudrun, S1.3). Deliberately dependency-free — it must
 * report the container booted even if Clerk/Supabase/Medusa env vars are
 * missing or misconfigured, so a bad secret never masquerades as a bad image.
 */

import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({ ok: true })
}
