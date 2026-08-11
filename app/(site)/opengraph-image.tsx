// Multiple root layouts do not inherit the app-level metadata image. Keep the
// selector's file-convention route (and its content hash) while reusing the
// established site-wide artwork rather than hard-coding a URL that can 404.
export { alt, contentType, size, default } from '@/app/opengraph-image'
