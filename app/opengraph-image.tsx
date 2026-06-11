import { ImageResponse } from 'next/og'

export const alt = 'Miyagi Sánchez — Abre tu tienda, compra y vende'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#f9f9f7',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px 100px',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        }}
      >
        {/* Monogram badge */}
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 16,
            background: '#1d6f42',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 48,
          }}
        >
          <span
            style={{
              color: '#f9f9f7',
              fontWeight: 800,
              fontSize: 30,
              letterSpacing: -2,
            }}
          >
            MS
          </span>
        </div>

        {/* Wordmark */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: 20,
            lineHeight: 1,
          }}
        >
          <span
            style={{
              fontSize: 84,
              fontWeight: 700,
              color: '#1a1a18',
              letterSpacing: -5,
            }}
          >
            Miyagi
          </span>
          <span
            style={{
              fontSize: 28,
              color: '#1d6f42',
              margin: '0 18px',
              marginTop: 12,
            }}
          >
            ●
          </span>
          <span
            style={{
              fontSize: 84,
              fontWeight: 700,
              color: '#1a1a18',
              letterSpacing: -5,
            }}
          >
            Sánchez
          </span>
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: 28,
            color: '#6b6b67',
            letterSpacing: -0.5,
            marginBottom: 64,
          }}
        >
          Compra y vende de todo en México · Sin comisiones
        </div>

        {/* Pill badges */}
        <div style={{ display: 'flex', gap: 16 }}>
          {['Marketplace', 'Segundamano', 'Tu propia tienda', '0% comisión'].map((label) => (
            <div
              key={label}
              style={{
                background: 'rgba(29,111,66,0.08)',
                border: '1px solid rgba(29,111,66,0.22)',
                borderRadius: 999,
                padding: '10px 24px',
                fontSize: 20,
                fontWeight: 600,
                color: '#1d6f42',
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  )
}
