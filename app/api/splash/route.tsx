import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const w = Math.min(Math.max(parseInt(searchParams.get('w') || '1170'), 320), 1300)
  const h = Math.min(Math.max(parseInt(searchParams.get('h') || '2532'), 480), 2800)

  const monogramSize = Math.round(h * 0.11)
  const subtitleSize = Math.round(h * 0.023)
  const dotSize = Math.round(monogramSize * 0.18)

  return new ImageResponse(
    (
      <div
        style={{
          width: w,
          height: h,
          background: '#1d6f42',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Wordmark */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 0,
          }}
        >
          <span
            style={{
              color: '#f9f9f7',
              fontWeight: 800,
              fontSize: monogramSize,
              letterSpacing: -monogramSize * 0.03,
              lineHeight: 1,
            }}
          >
            Miyagi
          </span>
          <span
            style={{
              color: 'rgba(249,249,247,0.55)',
              fontSize: dotSize,
              margin: `0 ${Math.round(dotSize * 0.4)}px`,
              lineHeight: 1,
            }}
          >
            ●
          </span>
          <span
            style={{
              color: '#f9f9f7',
              fontWeight: 800,
              fontSize: monogramSize,
              letterSpacing: -monogramSize * 0.03,
              lineHeight: 1,
            }}
          >
            Sánchez
          </span>
        </div>

        {/* Tagline */}
        <div
          style={{
            color: 'rgba(249,249,247,0.55)',
            fontSize: subtitleSize,
            marginTop: Math.round(h * 0.018),
            letterSpacing: subtitleSize * 0.12,
            textTransform: 'uppercase',
          }}
        >
          Marketplace · México
        </div>
      </div>
    ),
    { width: w, height: h },
  )
}
