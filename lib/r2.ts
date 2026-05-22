/**
 * Cloudflare R2 storage client (S3-compatible).
 *
 * Required env vars:
 *   R2_ACCOUNT_ID          — e.g. f64b1f7dd7f2a2868768492239a1128b
 *   R2_ACCESS_KEY_ID       — from Cloudflare R2 API token
 *   R2_SECRET_ACCESS_KEY   — from Cloudflare R2 API token
 *   R2_BUCKET_IMAGES       — public bucket name (e.g. miyagicommerce)
 *   R2_PUBLIC_URL          — e.g. https://pub-xxxx.r2.dev  (no trailing slash)
 *
 * Digital files continue to use Supabase Storage (signed URLs, private).
 * R2 is used only for public listing images.
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'

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
