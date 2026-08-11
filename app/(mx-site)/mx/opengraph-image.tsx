// `/mx` lives under its own root document, so it needs a segment-owned metadata
// image for Next to emit the hashed, directly-fetchable og:image URL.
export { alt, contentType, size, default } from '@/app/opengraph-image'
