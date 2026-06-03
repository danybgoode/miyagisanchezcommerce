/**
 * Print-faithful ad block — the retro México-86 ad tile rendered at a given size,
 * honoring per-block style (bg / border / text size / hidden fields). Presentational
 * and hook-free so BOTH the builder canvas (client) and the print view (server, US-5a)
 * render identically. Shares the palette of app/components/PrintAdPreview.tsx.
 */

import type { PrintBlock, PrintBlockSize, PrintTextSize } from '@/lib/print-layout'

/** Manual text-scale override (US-3); when unset, scale follows the block footprint. */
const TEXT_SCALE: Record<PrintTextSize, { headline: string; body: string; sub: string }> = {
  xs:   { headline: 'text-xs',   body: 'text-[9px]',  sub: 'text-[9px]' },
  sm:   { headline: 'text-base', body: 'text-[10px]', sub: 'text-[10px]' },
  base: { headline: 'text-xl',   body: 'text-xs',     sub: 'text-xs' },
  lg:   { headline: 'text-3xl',  body: 'text-sm',     sub: 'text-sm' },
}

const SIZE: Record<PrintBlockSize, {
  pad: string; photo: string; headline: string; sub: string; body: string; qr: string; showBody: boolean; showSub: boolean
}> = {
  micro:  { pad: 'p-1.5', photo: 'h-12', headline: 'text-[10px]', sub: 'text-[8px]',  body: 'text-[8px]',  qr: 'h-8 w-8',   showBody: false, showSub: false },
  small:  { pad: 'p-2',   photo: 'h-24', headline: 'text-base',   sub: 'text-[10px]', body: 'text-[10px]', qr: 'h-10 w-10', showBody: true,  showSub: true },
  medium: { pad: 'p-3',   photo: 'h-36', headline: 'text-2xl',    sub: 'text-sm',     body: 'text-xs',     qr: 'h-14 w-14', showBody: true,  showSub: true },
  large:  { pad: 'p-6',   photo: 'h-72', headline: 'text-5xl',    sub: 'text-lg',     body: 'text-base',   qr: 'h-24 w-24', showBody: true,  showSub: true },
}

const BORDER: Record<NonNullable<PrintBlock['style']['border']>, string> = {
  thick:  'border-[3px] border-solid',
  dotted: 'border-2 border-dotted',
  double: 'border-4 border-double',
  none:   'border-0',
}

const DEFAULT_BG = '#fdfaf2'
const INK = '#1a1a18'
const GREEN = '#0a4d2e'

export default function PrintAdBlock({ block, tierLabel, size }: { block: PrintBlock; tierLabel?: string; size: PrintBlockSize }) {
  const { content, style, kind } = block
  const s = SIZE[size]
  const ts = style.text_size ? TEXT_SCALE[style.text_size] : null
  const headlineCls = ts?.headline ?? s.headline
  const bodyCls = ts?.body ?? s.body
  const subCls = ts?.sub ?? s.sub
  const hidden = (f: string) => style.hidden_fields?.includes(f)
  const borderCls = BORDER[style.border ?? 'thick']
  const bg = style.bg || DEFAULT_BG

  // Editorial inserts (US-2): cover / section header / filler / social.
  if (kind !== 'ad') {
    const photo = content.photos?.[0] ?? null
    return (
      <div className={`h-full w-full flex flex-col items-center justify-center text-center overflow-hidden ${s.pad} ${borderCls}`}
        style={{ background: bg, color: INK, borderColor: GREEN }}>
        {kind === 'section' && <div className="text-[10px] uppercase tracking-[0.25em] mb-1" style={{ color: GREEN }}>Sección</div>}
        {photo && !hidden('photo') && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" className={`w-full object-cover mb-2 border ${s.photo}`} style={{ borderColor: `${GREEN}55` }} />
        )}
        <div className={`font-black uppercase leading-tight ${kind === 'cover' ? 'text-4xl' : headlineCls}`} style={{ fontFamily: 'Arial Black, Impact, sans-serif' }}>
          {content.label || content.headline || '—'}
        </div>
        {content.body && s.showBody && !hidden('body') && (
          <p className={`mt-1.5 leading-snug ${bodyCls}`}>{content.body}</p>
        )}
        {content.subhead && <p className={`italic mt-1 ${subCls}`} style={{ color: '#a3331f' }}>{content.subhead}</p>}
      </div>
    )
  }

  const photo = content.photos?.[0] ?? null
  const wa = content.contact?.whatsapp_seller
  // House ads (pulled from live catalog, no paid tier) get a courtesy badge.
  const badge = tierLabel || (block.source.type === 'listing' ? 'Cortesía' : block.source.type === 'shop' ? 'Tienda' : '')

  return (
    <div className={`h-full w-full flex flex-col overflow-hidden ${borderCls}`} style={{ background: bg, color: INK, borderColor: GREEN }}>
      <div className="flex items-center justify-between px-2 py-0.5 flex-shrink-0" style={{ background: GREEN }}>
        <span className="text-[9px] font-black uppercase tracking-[0.15em]" style={{ color: '#f7d23e', fontFamily: 'Arial Black, Impact, sans-serif' }}>
          {badge}
        </span>
        <span className="text-[8px] uppercase tracking-widest opacity-80" style={{ color: '#f7d23e' }}>Edición impresa</span>
      </div>

      <div className={`flex-1 flex flex-col min-h-0 ${s.pad}`}>
        <div className="flex items-start gap-2">
          {content.logo_url && !hidden('logo') && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={content.logo_url} alt="" className="h-8 w-8 object-cover rounded border flex-shrink-0" style={{ borderColor: `${GREEN}55` }} />
          )}
          <div className="flex-1 min-w-0">
            {!hidden('headline') && (
              <h3 className={`leading-none font-black uppercase ${headlineCls}`} style={{ fontFamily: 'Arial Black, Impact, sans-serif' }}>
                {content.headline || '(sin titular)'}
              </h3>
            )}
            {content.subhead && s.showSub && !hidden('subhead') && (
              <p className={`italic mt-0.5 ${subCls}`} style={{ color: '#a3331f' }}>{content.subhead}</p>
            )}
          </div>
          {content.price && !hidden('price') && (
            <span className={`font-black flex-shrink-0 ${subCls}`} style={{ color: GREEN }}>{content.price}</span>
          )}
        </div>

        {photo && !hidden('photo') && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" className={`w-full object-cover mt-2 border ${s.photo}`} style={{ borderColor: `${GREEN}55` }} />
        )}

        {content.body && s.showBody && !hidden('body') && (
          <p className={`mt-2 leading-snug ${bodyCls} overflow-hidden`}>{content.body}</p>
        )}

        {!hidden('contact') && (
          <div className="mt-auto pt-2 flex items-end justify-between gap-2" style={{ borderTop: `2px dashed ${GREEN}66` }}>
            <div className={`leading-relaxed ${bodyCls}`}>
              {wa && <div>📱 {wa}</div>}
              {content.contact?.phone && <div>☎ {content.contact.phone}</div>}
              {content.cta_target?.url && (
                <div className="break-all mt-0.5" style={{ color: GREEN }}>{content.cta_target.url.replace(/^https?:\/\//, '')}</div>
              )}
            </div>
            {!hidden('qr') && (content.qr_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={content.qr_url} alt="QR" className={`flex-shrink-0 ${s.qr}`} />
            ) : (
              <div className={`flex-shrink-0 grid place-items-center border border-dashed text-[8px] text-center ${s.qr}`}
                style={{ borderColor: `${GREEN}66`, color: `${GREEN}99` }}>QR al exportar</div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
