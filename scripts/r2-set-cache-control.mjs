#!/usr/bin/env node
/**
 * One-off backfill: set `Cache-Control: public, max-age=31536000, immutable`
 * on every EXISTING object in the R2 images bucket (09-platform-infra/
 * hyper-performant-website S1.1). New uploads already get this header at
 * write time (lib/r2.ts's uploadToR2) — this script covers everything
 * uploaded before that change (the whale JPEGs the PageSpeed audit flagged
 * with `Cache TTL: None`).
 *
 * Uses the S3-compatible self-copy trick (CopyObjectCommand, same bucket,
 * same key, MetadataDirective: 'REPLACE') — R2 doesn't expose a bare
 * "set metadata in place" call, but a same-key copy with REPLACE rewrites
 * just the headers without re-uploading bytes.
 *
 * Needs R2 credentials this agent does not have in the worktree — NOT run
 * here. Idempotent: an object that already carries this Cache-Control is
 * skipped (safe to re-run / resume after a partial failure).
 *
 * Run:
 *   node --env-file=.env.local scripts/r2-set-cache-control.mjs           # dry-run (default)
 *   node --env-file=.env.local scripts/r2-set-cache-control.mjs --apply   # actually rewrite
 *
 * Required env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_IMAGES
 */
import {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'

const APPLY = process.argv.includes('--apply')
const TARGET_CACHE_CONTROL = 'public, max-age=31536000, immutable'

// S3-compatible CopySource needs slash-PRESERVING encoding: encode each path
// segment on its own and rejoin with '/'. A bare `encodeURIComponent(key)`
// over the whole key turns every '/' into '%2F', which R2 then looks up as a
// literal (non-existent) key instead of treating it as a path separator —
// every real listing key is nested (e.g. `listing-images/supply/foo.jpg`),
// so the naive form would have failed on every single object.
function encodeCopySourceKey(key) {
  return key.split('/').map(encodeURIComponent).join('/')
}

const accountId = process.env.R2_ACCOUNT_ID
const accessKeyId = process.env.R2_ACCESS_KEY_ID
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
const bucket = process.env.R2_BUCKET_IMAGES

if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
  console.error('Missing R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_IMAGES')
  process.exit(1)
}

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
})

let continuationToken
let scanned = 0
let alreadyOk = 0
let rewritten = 0
let failed = 0

console.log(`Mode: ${APPLY ? 'APPLY (rewriting headers)' : 'DRY-RUN (no writes — pass --apply to rewrite)'}`)

do {
  const page = await client.send(new ListObjectsV2Command({
    Bucket: bucket,
    ContinuationToken: continuationToken,
  }))
  continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined

  for (const obj of page.Contents ?? []) {
    scanned++
    const key = obj.Key
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      if (head.CacheControl === TARGET_CACHE_CONTROL) {
        alreadyOk++
        continue
      }
      if (!APPLY) {
        console.log(`  would rewrite: ${key} (current Cache-Control: ${head.CacheControl ?? 'none'})`)
        continue
      }
      await client.send(new CopyObjectCommand({
        Bucket: bucket,
        Key: key,
        CopySource: `${bucket}/${encodeCopySourceKey(key)}`,
        MetadataDirective: 'REPLACE',
        CacheControl: TARGET_CACHE_CONTROL,
        ContentType: head.ContentType,
        Metadata: head.Metadata,
        ACL: 'public-read',
      }))
      rewritten++
      console.log(`  rewrote: ${key}`)
    } catch (err) {
      failed++
      console.error(`  x ${key}:`, err instanceof Error ? err.message : err)
    }
  }
} while (continuationToken)

console.log(`\nDone. scanned=${scanned} already_ok=${alreadyOk} rewritten=${rewritten} failed=${failed}`)
if (!APPLY) console.log('(dry-run — re-run with --apply to actually rewrite headers)')
