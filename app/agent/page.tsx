import type { Metadata } from 'next'
import ucpUseCases from '@/ucp-use-cases.json'

export const metadata: Metadata = {
  title: 'Agent Briefing — Miyagi Sánchez',
  description:
    'Machine-readable briefing for AI agents and MCP clients: capabilities, UCP use cases, API endpoints, and how to operate as a shop clerk on miyagisanchez.com.',
  robots: { index: true, follow: true },
}

const ENDPOINT = 'https://miyagisanchez.com'

const PRODUCT_TYPES = [
  { icon: '📦', label: 'Physical goods', note: 'with optional shipping' },
  { icon: '🎓', label: 'Digital products', note: 'instant delivery via R2' },
  { icon: '🔁', label: 'Subscriptions', note: 'recurring Stripe billing' },
  { icon: '🔧', label: 'Services', note: 'bookable, quote-based' },
  { icon: '🏠', label: 'Rentals', note: 'daily / weekly pricing' },
]

const PAYMENT_METHODS = [
  { label: 'Stripe', note: 'cards, OXXO, Link — international' },
  { label: 'MercadoPago', note: 'SPEI, cards, cash — Mexico-native' },
  { label: 'SPEI transfer', note: 'direct bank transfer (manual)' },
]

const API_ENDPOINTS = [
  { method: 'GET', path: '/api/ucp/listings', desc: 'List active products with filters: category, city, price_min, price_max, q (search)' },
  { method: 'GET', path: '/api/ucp/listings/[id]', desc: 'Full product detail including seller, images, price, availability' },
  { method: 'POST', path: '/api/ucp/checkout', desc: 'Initiate a checkout session for a listing' },
  { method: 'POST', path: '/api/ucp/offer', desc: 'Submit a price offer to a seller' },
  { method: 'GET', path: '/api/ucp/shops/[slug]', desc: 'Seller shop profile: name, categories, trust metrics' },
]

export default function AgentPage() {
  return (
    <div
      className="app-shell"
      style={{ paddingTop: 28, paddingBottom: 64, maxWidth: 760 }}
    >
      {/* Machine-readable JSON-LD for AI crawlers */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebAPI',
            name: 'Miyagi Sánchez Marketplace API',
            description:
              'Zero-commission P2P marketplace for Mexico. Supports UCP (Universal Commerce Protocol) and MCP for AI agent commerce.',
            url: ENDPOINT,
            documentation: `${ENDPOINT}/agent`,
            provider: {
              '@type': 'Organization',
              name: 'Miyagi Sánchez',
              url: ENDPOINT,
            },
          }),
        }}
      />

      {/* Badge */}
      <div style={{ marginBottom: 20 }}>
        <span className="badge badge-agent" style={{ fontSize: 11 }}>
          <i className="iconoir-sparks" style={{ fontSize: 12 }} />
          Agent Briefing
        </span>
      </div>

      {/* Title */}
      <h1 className="t-h1" style={{ marginBottom: 6 }}>
        Miyagi Sánchez
      </h1>
      <p className="t-lead" style={{ marginBottom: 32 }}>
        Zero-commission marketplace for Mexico — built on the{' '}
        <a href="https://ucp.dev" target="_blank" rel="noopener noreferrer">
          Universal Commerce Protocol
        </a>{' '}
        (UCP) and MCP-compatible for AI agent commerce.
      </p>

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', marginBottom: 36 }} />

      {/* What we are */}
      <section style={{ marginBottom: 40 }}>
        <h2 className="t-h3" style={{ marginBottom: 12 }}>What is this marketplace?</h2>
        <p style={{ fontSize: 14, color: 'var(--fg-muted)', lineHeight: 1.7, marginBottom: 12 }}>
          Miyagi Sánchez is a multi-seller C2C and B2C marketplace serving Mexico. Sellers list
          products across multiple channels simultaneously: the main marketplace, their own branded
          domain, an embeddable widget, and a headless API. <strong>Commission: 0%.</strong>
        </p>
        <p style={{ fontSize: 14, color: 'var(--fg-muted)', lineHeight: 1.7 }}>
          The platform is designed for AI-native commerce. Buyers can instruct an AI agent to search,
          negotiate, and complete purchases on their behalf through the UCP API without ever touching a
          browser UI.
        </p>
      </section>

      {/* Product types */}
      <section style={{ marginBottom: 40 }}>
        <h2 className="t-h3" style={{ marginBottom: 14 }}>Supported product types</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PRODUCT_TYPES.map(({ icon, label, note }) => (
            <div
              key={label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 14px',
                background: 'var(--bg-sunk)',
                borderRadius: 'var(--r-md)',
                fontSize: 14,
              }}
            >
              <span style={{ fontSize: 20 }}>{icon}</span>
              <span style={{ fontWeight: 600, color: 'var(--fg)' }}>{label}</span>
              <span style={{ color: 'var(--fg-muted)', marginLeft: 'auto' }}>{note}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Payments */}
      <section style={{ marginBottom: 40 }}>
        <h2 className="t-h3" style={{ marginBottom: 14 }}>Payment methods</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {PAYMENT_METHODS.map(({ label, note }) => (
            <div
              key={label}
              style={{
                padding: '10px 16px',
                background: 'var(--bg-sunk)',
                borderRadius: 'var(--r-md)',
                fontSize: 13,
              }}
            >
              <span style={{ fontWeight: 600, color: 'var(--fg)' }}>{label}</span>
              <span style={{ color: 'var(--fg-muted)', display: 'block', marginTop: 2 }}>{note}</span>
            </div>
          ))}
        </div>
      </section>

      {/* API endpoints */}
      <section style={{ marginBottom: 40 }}>
        <h2 className="t-h3" style={{ marginBottom: 14 }}>API endpoints (UCP)</h2>
        <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 14, lineHeight: 1.6 }}>
          Base URL: <code style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-sunk)', padding: '2px 6px', borderRadius: 4 }}>{ENDPOINT}</code>
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {API_ENDPOINTS.map(({ method, path, desc }) => (
            <div
              key={path}
              style={{
                padding: '12px 14px',
                background: 'var(--bg-sunk)',
                borderRadius: 'var(--r-md)',
                fontSize: 13,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                <span
                  className="badge badge-mono"
                  style={{ fontSize: 10, padding: '3px 8px' }}
                >
                  {method}
                </span>
                <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg)', fontSize: 13 }}>
                  {path}
                </code>
              </div>
              <p style={{ color: 'var(--fg-muted)', margin: 0, lineHeight: 1.5 }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* MCP setup */}
      <section style={{ marginBottom: 40 }}>
        <h2 className="t-h3" style={{ marginBottom: 12 }}>MCP server setup</h2>
        <p style={{ fontSize: 14, color: 'var(--fg-muted)', lineHeight: 1.7, marginBottom: 14 }}>
          Add Miyagi Sánchez as a remote MCP server in Claude Desktop or any MCP-compatible client:
        </p>
        <pre
          style={{
            background: 'var(--papel-900)',
            color: '#a8ffc4',
            borderRadius: 'var(--r-md)',
            padding: '16px 18px',
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            overflowX: 'auto',
            lineHeight: 1.7,
          }}
        >
          {`// claude_desktop_config.json
{
  "mcpServers": {
    "miyagi-sanchez": {
      "url": "${ENDPOINT}/api/mcp",
      "transport": "http"
    }
  }
}`}
        </pre>
        <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 10, lineHeight: 1.6 }}>
          Once connected, Claude can browse listings, check seller trust scores, negotiate prices,
          and complete purchases autonomously on your behalf.
        </p>
      </section>

      {/* UCP use cases */}
      <section style={{ marginBottom: 40 }}>
        <h2 className="t-h3" style={{ marginBottom: 6 }}>UCP-enabled use cases</h2>
        <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 16, lineHeight: 1.6 }}>
          These are live capabilities powered by the{' '}
          <a href="https://ucp.dev" target="_blank" rel="noopener noreferrer">
            Universal Commerce Protocol
          </a>
          :
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {ucpUseCases.map((uc, i) => (
            <div
              key={i}
              style={{
                padding: '16px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)',
                background: 'var(--bg-elevated)',
              }}
            >
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <span className="badge badge-agent" style={{ fontSize: 10 }}>
                  {uc.domain}
                </span>
                <span className="badge badge-soft" style={{ fontSize: 10 }}>
                  {uc.ucp_mechanism}
                </span>
              </div>
              <p
                style={{
                  fontSize: 13,
                  color: 'var(--fg-muted)',
                  margin: 0,
                  lineHeight: 1.6,
                }}
              >
                <strong style={{ color: 'var(--fg)' }}>Pain: </strong>
                {uc.primary_pain_point}
              </p>
              <p
                style={{
                  fontSize: 13,
                  color: 'var(--fg-muted)',
                  margin: '6px 0 0',
                  lineHeight: 1.6,
                }}
              >
                <strong style={{ color: 'var(--fg)' }}>Flow: </strong>
                {uc.operational_flow}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* External references */}
      <section>
        <h2 className="t-h3" style={{ marginBottom: 14 }}>External references</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a
            href="https://ucp.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-agent btn-sm"
          >
            <i className="iconoir-globe" style={{ fontSize: 14 }} />
            ucp.dev — Protocol spec
          </a>
          <a
            href={ENDPOINT}
            className="btn btn-secondary btn-sm"
          >
            <i className="iconoir-shop" style={{ fontSize: 14 }} />
            Live marketplace
          </a>
          <a
            href={`${ENDPOINT}/api/ucp/listings`}
            className="btn btn-secondary btn-sm"
          >
            <i className="iconoir-code" style={{ fontSize: 14 }} />
            Browse listings API
          </a>
        </div>
      </section>
    </div>
  )
}
