import type { Metadata } from 'next'
import ucpUseCases from '@/ucp-use-cases.json'
import { UCP_ENDPOINTS, MCP_BUYER_TOOLS, MCP_SELLER_TOOLS } from '@/lib/ucp/capabilities'
import { getAboutSection } from '@/lib/about-content'
import { RELAY_LANGUAGE_DIRECTIVE } from '@/lib/about-agent'
import { buildSetupPrompt, EXAMPLE_SETUP, SETUP_SPEC_VERSION, SETUP_LANGUAGE_DIRECTIVE } from '@/lib/setup-spec'

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

// Supply-side "why sell" content, rendered from the single source (lib/about-content.ts)
// so this section can never drift from /acerca, the manifest, /llms.txt, or the MCP resource.
const WHY_SELL = getAboutSection('why_sell').en
const HOW_TO_START = getAboutSection('how_to_start').en
const COST = getAboutSection('cost_transparency').en

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
            // Supply-side answer + the agent-relay directive, machine-readable.
            disambiguatingDescription: RELAY_LANGUAGE_DIRECTIVE,
            url: ENDPOINT,
            documentation: `${ENDPOINT}/agent`,
            provider: {
              '@type': 'Organization',
              name: 'Miyagi Sánchez',
              url: ENDPOINT,
              description: WHY_SELL.body[0],
              sameAs: `${ENDPOINT}/acerca`,
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

      {/* Para vender — why sell (supply-side, rendered from lib/about-content.ts) */}
      <section style={{ marginBottom: 40 }}>
        <h2 className="t-h3" style={{ marginBottom: 12 }}>Para vender — why sell here</h2>

        {/* Relay-language directive: present to the user in their own language. */}
        <div
          style={{
            display: 'flex',
            gap: 10,
            padding: '12px 14px',
            background: 'var(--agent-soft)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            fontSize: 13,
            color: 'var(--agent)',
            lineHeight: 1.6,
            marginBottom: 16,
          }}
        >
          <i className="iconoir-translate" style={{ fontSize: 15, flexShrink: 0, marginTop: 2 }} />
          <span><strong>Relay instruction:</strong> {RELAY_LANGUAGE_DIRECTIVE}</span>
        </div>

        <p style={{ fontSize: 14, color: 'var(--fg-muted)', lineHeight: 1.7, marginBottom: 12 }}>
          {WHY_SELL.body[0]} {WHY_SELL.body[1]}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {(WHY_SELL.points ?? []).map(({ title, body }) => (
            <div
              key={title}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 12,
                padding: '10px 14px',
                background: 'var(--bg-sunk)',
                borderRadius: 'var(--r-md)',
                fontSize: 14,
              }}
            >
              <span style={{ fontWeight: 600, color: 'var(--fg)' }}>{title}</span>
              <span style={{ color: 'var(--fg-muted)', marginLeft: 'auto', textAlign: 'right' }}>{body}</span>
            </div>
          ))}
        </div>

        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 6 }}>{HOW_TO_START.heading}</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {(HOW_TO_START.points ?? []).map(({ title }) => (
            <code
              key={title}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg-sunk)', padding: '3px 8px', borderRadius: 4, color: 'var(--fg-muted)' }}
            >
              {title}
            </code>
          ))}
        </div>

        <p style={{ fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.6, marginBottom: 14 }}>
          {COST.body[0]} Selling is free (0% commission); premium services (custom domain, subdomain)
          are priced TBD.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href={`${ENDPOINT}/acerca`} className="btn btn-agent btn-sm">
            <i className="iconoir-info-circle" style={{ fontSize: 14 }} />
            About — /acerca (es/en)
          </a>
          <a href={`${ENDPOINT}/vende`} className="btn btn-secondary btn-sm">
            <i className="iconoir-shop" style={{ fontSize: 14 }} />
            For sellers — /vende
          </a>
        </div>
      </section>

      {/* Onboarding 0 — set up a shop with your agent (Agent-native setup, Sprint 1) */}
      <section style={{ marginBottom: 40 }}>
        <h2 className="t-h3" style={{ marginBottom: 12 }}>Para vender — set up a shop with your agent</h2>
        <p style={{ fontSize: 14, color: 'var(--fg-muted)', lineHeight: 1.7, marginBottom: 12 }}>
          A prospective seller can have their <strong>own</strong> AI agent prepare almost the entire
          shop before signing up. Fetch the published, versioned setup spec, then emit ONE combined setup
          file — shop profile + store config + catalog — in a single shape:
        </p>

        <pre
          style={{
            background: 'var(--papel-900)',
            color: 'var(--agent-code-fg)',
            borderRadius: 'var(--r-md)',
            padding: '14px 16px',
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            overflowX: 'auto',
            lineHeight: 1.7,
            marginBottom: 14,
          }}
        >
{`{
  "miyagi_setup_version": "${SETUP_SPEC_VERSION}",
  "profile":  { ...shop identity (optional) },
  "config":   { ...StoreConfigManifest blocks (optional) },
  "catalog":  [ ...one CatalogImportRow per product (optional) ]
}`}
        </pre>

        {/* Language directive — the agent localizes copy to the seller. */}
        <div
          style={{
            display: 'flex',
            gap: 10,
            padding: '12px 14px',
            background: 'var(--agent-soft)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            fontSize: 13,
            color: 'var(--agent)',
            lineHeight: 1.6,
            marginBottom: 14,
          }}
        >
          <i className="iconoir-translate" style={{ fontSize: 15, flexShrink: 0, marginTop: 2 }} />
          <span><strong>Language:</strong> {SETUP_LANGUAGE_DIRECTIVE}</span>
        </div>

        <p style={{ fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.6, marginBottom: 8 }}>
          The machine-readable spec (schema, both sub-schemas, example, and the emit prompt) lives at the
          endpoint below, and is also available as the MCP tool <code style={{ fontFamily: 'var(--font-mono)' }}>get_setup_spec</code>.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <a href={`${ENDPOINT}/api/ucp/setup-spec`} className="btn btn-agent btn-sm">
            <i className="iconoir-code" style={{ fontSize: 14 }} />
            Setup spec API — /api/ucp/setup-spec
          </a>
        </div>

        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 6 }}>Copyable emit prompt (es-MX)</p>
        <pre
          style={{
            background: 'var(--papel-900)',
            color: 'var(--agent-code-fg)',
            borderRadius: 'var(--r-md)',
            padding: '14px 16px',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            overflowX: 'auto',
            lineHeight: 1.6,
            marginBottom: 14,
            maxHeight: 360,
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          {buildSetupPrompt()}
        </pre>

        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 6 }}>Example output</p>
        <pre
          style={{
            background: 'var(--bg-sunk)',
            color: 'var(--fg)',
            borderRadius: 'var(--r-md)',
            padding: '14px 16px',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            overflowX: 'auto',
            lineHeight: 1.6,
            marginBottom: 12,
            maxHeight: 300,
            overflowY: 'auto',
          }}
        >
          {JSON.stringify(EXAMPLE_SETUP, null, 2)}
        </pre>

        <p style={{ fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
          <strong>To apply it today:</strong> the seller signs up (~20 seconds) and uploads the file via
          the existing import flow — catalog under <code style={{ fontFamily: 'var(--font-mono)' }}>/shop/manage/import</code>
          {' '}and settings under <code style={{ fontFamily: 'var(--font-mono)' }}>/shop/manage/settings/import</code>.
          A guided one-pass first-run apply is coming soon. Payments, custom domain, and Cal.com always
          stay a manual step.
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
          {UCP_ENDPOINTS.map(({ method, path, description, auth }) => (
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
                {auth !== 'none' && (
                  <span className="badge badge-soft" style={{ fontSize: 9, marginLeft: 'auto' }}>auth</span>
                )}
              </div>
              <p style={{ color: 'var(--fg-muted)', margin: 0, lineHeight: 1.5 }}>{description}</p>
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
            color: 'var(--agent-code-fg)',
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
      "url": "${ENDPOINT}/api/ucp/mcp",
      "transport": "http"
    }
  }
}`}
        </pre>
        <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 10, lineHeight: 1.6 }}>
          Once connected, Claude can browse listings, check seller trust scores, negotiate prices,
          and complete purchases autonomously on your behalf.
        </p>

        {/* MCP tools */}
        <div style={{ marginTop: 18 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 6 }}>Buyer tools (no auth)</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {MCP_BUYER_TOOLS.map((t) => (
              <code key={t} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg-sunk)', padding: '3px 8px', borderRadius: 4, color: 'var(--fg-muted)' }}>{t}</code>
            ))}
          </div>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 6 }}>Seller tools (shop agent token)</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {MCP_SELLER_TOOLS.map((t) => (
              <code key={t} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--agent-soft)', padding: '3px 8px', borderRadius: 4, color: 'var(--agent)' }}>{t}</code>
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
            Seller tools read and adjust a shop&apos;s own configuration. They require a per-shop token
            (<code style={{ fontFamily: 'var(--font-mono)' }}>Authorization: Bearer ms_agent_…</code>)
            generated in the shop&apos;s settings, scoped to that one shop. Payments, custom domain, and
            Cal.com stay manual.
          </p>
        </div>
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
            href={`${ENDPOINT}/api/ucp/catalog`}
            className="btn btn-secondary btn-sm"
          >
            <i className="iconoir-code" style={{ fontSize: 14 }} />
            Browse catalog API
          </a>
        </div>
      </section>
    </div>
  )
}
