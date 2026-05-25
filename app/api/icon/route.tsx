import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const size = Math.min(Math.max(parseInt(searchParams.get('size') || '192'), 48), 1024)

  const fontSize = Math.round(size * 0.32)
  const dotSize = Math.round(fontSize * 0.18)
  const dotMargin = Math.round(dotSize * 0.4)

  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          background: '#1d6f42',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 0 }}>
          <span
            style={{
              color: '#f9f9f7',
              fontWeight: 800,
              fontSize,
              letterSpacing: -fontSize * 0.03,
              lineHeight: 1,
            }}
          >
            M
          </span>
          <span
            style={{
              color: 'rgba(249,249,247,0.55)',
              fontSize: dotSize,
              margin: `0 ${dotMargin}px`,
              lineHeight: 1,
            }}
          >
            ●
          </span>
          <span
            style={{
              color: '#f9f9f7',
              fontWeight: 800,
              fontSize,
              letterSpacing: -fontSize * 0.03,
              lineHeight: 1,
            }}
          >
            S
          </span>
        </div>
      </div>
    ),
    { width: size, height: size },
  )
}
