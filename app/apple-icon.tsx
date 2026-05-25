import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#1d6f42',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        }}
      >
        <span
          style={{
            color: '#f9f9f7',
            fontWeight: 800,
            fontSize: 76,
            letterSpacing: -4,
            lineHeight: 1,
          }}
        >
          MS
        </span>
      </div>
    ),
    { ...size },
  )
}
