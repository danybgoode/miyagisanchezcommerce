'use client'

/**
 * Web push registration (client). Call `ensurePushSubscription()` on a user
 * gesture (e.g. after sending the first stamp) so the permission prompt has a
 * good UX moment. Idempotent and safe to call repeatedly.
 */

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export type PushResult = 'subscribed' | 'denied' | 'unsupported' | 'error'

export async function ensurePushSubscription(): Promise<PushResult> {
  try {
    if (typeof window === 'undefined') return 'unsupported'
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      return 'unsupported'
    }
    const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!vapid) return 'unsupported'

    const reg = await navigator.serviceWorker.register('/sw.js')

    let perm = Notification.permission
    if (perm === 'default') perm = await Notification.requestPermission()
    if (perm !== 'granted') return 'denied'

    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid) as unknown as BufferSource,
      })
    }

    const json = sub.toJSON()
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint, keys: json.keys }),
    })
    return 'subscribed'
  } catch {
    return 'error'
  }
}
