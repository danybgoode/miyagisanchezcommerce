/**
 * Cloudflare R2 storage clients (S3-compatible).
 *
 * Public images bucket (listing photos):
 *   R2_ACCOUNT_ID          — e.g. f64b1f7dd7f2a2868768492239a1128b
 *   R2_ACCESS_KEY_ID       — from Cloudflare R2 API token
 *   R2_SECRET_ACCESS_KEY   — from Cloudflare R2 API token
 *   R2_BUCKET_IMAGES       — public bucket name (e.g. miyagicommerce)
 *   R2_PUBLIC_URL          — e.g. https://pub-xxxx.r2.dev  (no trailing slash)
 *
 * Private digital files bucket (PDFs, ZIPs, videos — presigned URLs):
 *   R2_DIGITAL_ACCOUNT_ID       — separate Cloudflare account
 *   R2_DIGITAL_ACCESS_KEY_ID
 *   R2_DIGITAL_SECRET_ACCESS_KEY
 *   R2_BUCKET_DIGITAL           — private bucket name (e.g. miyagi-digital-content)
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

function getR2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('Missing R2 environment variables (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)')
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })
}

/**
 * Upload a file buffer to R2 and return its public CDN URL.
 * @param buffer   Raw file bytes
 * @param key      Storage path, e.g. "listing-images/userId/timestamp.webp"
 * @param contentType  MIME type
 * @param bucket   Defaults to R2_BUCKET_IMAGES
 */
export async function uploadToR2(
  buffer: ArrayBuffer,
  key: string,
  contentType: string,
  bucket?: string,
): Promise<string> {
  const bucketName = bucket ?? process.env.R2_BUCKET_IMAGES
  if (!bucketName) throw new Error('Missing R2_BUCKET_IMAGES environment variable')

  const publicUrl = process.env.R2_PUBLIC_URL
  if (!publicUrl) throw new Error('Missing R2_PUBLIC_URL environment variable')

  const client = getR2Client()

  await client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: Buffer.from(buffer),
    ContentType: contentType,
    // Public read — works because the bucket has public access enabled
    ACL: 'public-read',
    // hyper-performant-website S1.1 — every new object gets a long-lived,
    // immutable cache header at the object level (defense in depth: the app
    // itself serves images through /api/img, which sets its own Cache-Control
    // regardless of this, but a raw r2.dev URL — old links, other consumers —
    // should still be cache-friendly). Objects uploaded BEFORE this change need
    // a one-off backfill; see scripts/r2-set-cache-control.mjs (needs R2 creds
    // this agent doesn't have — not run here).
    CacheControl: 'public, max-age=31536000, immutable',
  }))

  return `${publicUrl}/${key}`
}

/**
 * Delete a file from R2 by key (best-effort, non-fatal).
 */
export async function deleteFromR2(key: string, bucket?: string): Promise<void> {
  const bucketName = bucket ?? process.env.R2_BUCKET_IMAGES
  if (!bucketName) return

  try {
    const client = getR2Client()
    await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }))
  } catch (e) {
    console.error('[r2] delete failed:', e)
  }
}

/**
 * Returns true if R2 is configured (all required env vars present).
 * Used to fall back to Supabase Storage when R2 is not set up yet.
 */
export function isR2Configured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_IMAGES &&
    process.env.R2_PUBLIC_URL
  )
}

// ── Private digital files bucket (separate Cloudflare account) ────────────────

function getR2DigitalClient(): S3Client {
  const accountId = process.env.R2_DIGITAL_ACCOUNT_ID
  const accessKeyId = process.env.R2_DIGITAL_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_DIGITAL_SECRET_ACCESS_KEY

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('Missing R2 digital env vars (R2_DIGITAL_ACCOUNT_ID, R2_DIGITAL_ACCESS_KEY_ID, R2_DIGITAL_SECRET_ACCESS_KEY)')
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })
}

/**
 * Returns true if the private digital files R2 bucket is configured.
 */
export function isR2DigitalConfigured(): boolean {
  return !!(
    process.env.R2_DIGITAL_ACCOUNT_ID &&
    process.env.R2_DIGITAL_ACCESS_KEY_ID &&
    process.env.R2_DIGITAL_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_DIGITAL
  )
}

/**
 * Upload a file buffer to the private digital files R2 bucket.
 * Returns the storage key (NOT a public URL — use getR2DigitalSignedUrl to serve).
 */
export async function uploadDigitalToR2(
  buffer: ArrayBuffer,
  key: string,
  contentType: string,
): Promise<string> {
  const bucket = process.env.R2_BUCKET_DIGITAL
  if (!bucket) throw new Error('Missing R2_BUCKET_DIGITAL environment variable')

  const client = getR2DigitalClient()
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: Buffer.from(buffer),
    ContentType: contentType,
    // Private bucket — no ACL header
  }))

  return key
}

/**
 * Generate a presigned URL for a private digital file.
 * @param key           Storage key (as returned by uploadDigitalToR2)
 * @param expirySeconds URL validity window, default 3600 (1 hour)
 * @param fileName      Optional Content-Disposition download filename
 */
export async function getR2DigitalSignedUrl(
  key: string,
  expirySeconds = 3600,
  fileName?: string,
): Promise<string> {
  const bucket = process.env.R2_BUCKET_DIGITAL
  if (!bucket) throw new Error('Missing R2_BUCKET_DIGITAL environment variable')

  const client = getR2DigitalClient()
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ...(fileName ? { ResponseContentDisposition: `attachment; filename="${fileName}"` } : {}),
  })

  return getSignedUrl(client, command, { expiresIn: expirySeconds })
}

/**
 * Delete a file from the private digital files R2 bucket (best-effort).
 */
export async function deleteDigitalFromR2(key: string): Promise<void> {
  const bucket = process.env.R2_BUCKET_DIGITAL
  if (!bucket) return
  try {
    const client = getR2DigitalClient()
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  } catch (e) {
    console.error('[r2-digital] delete failed:', e)
  }
}
