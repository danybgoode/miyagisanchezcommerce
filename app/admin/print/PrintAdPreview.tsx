'use client'

import type { PrintAdContent } from '@/lib/print'

/**
 * Screen-approximate preview of a printed ad (retro México-86 styling). NOT a
 * print proof — the real proof is Miyagi's InDesign export. Used in the admin
 * editorial queue to eyeball each submission before approving.
 */
export default function PrintAdPreview({ content, tierLabel }: { content: PrintAdContent; tierLabel: string }) {
  const photo = content.photos?.[0] ?? null
  const wa = content.contact?.whatsapp_seller
  return (
    <div className="rounded-lg overflow-hidden border-[3px] border-[#0a4d2e] bg-[#fdfaf2] text-[#1a1a18] max-w-md">
      <div className="bg-[#0a4d2e] text-[#f7d23e] px-3 py-1 flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ fontFamily: 'Arial Black, Impact, sans-serif' }}>
          {tierLabel}
        </span>
        <span className="text-[10px] uppercase tracking-widest opacity-80">Edición impresa</span>
      </div>
      <div className="p-4">
        <div className="flex items-start gap-3">
          {content.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={content.logo_url} alt="logo" className="h-12 w-12 object-cover rounded border border-[#0a4d2e]/30" />
          )}
          <div className="flex-1">
            <h3 className="text-xl leading-none font-black uppercase" style={{ fontFamily: 'Arial Black, Impact, sans-serif' }}>
              {content.headline || '(sin titular)'}
            </h3>
            {content.subhead && <p className="text-sm italic text-[#a3331f] mt-1">{content.subhead}</p>}
          </div>
        </div>

        {photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" className="w-full h-40 object-cover mt-3 border border-[#0a4d2e]/30" />
        )}

        {content.body && <p className="text-sm mt-3 leading-snug">{content.body}</p>}

        <div className="flex items-end justify-between mt-4 pt-3 border-t-2 border-dashed border-[#0a4d2e]/40">
          <div className="text-xs leading-relaxed">
            {wa && <div>📱 WhatsApp: <strong>{wa}</strong></div>}
            {content.contact?.phone && <div>☎ {content.contact.phone}</div>}
            {content.cta_target?.url && (
              <div className="text-[#0a4d2e] break-all mt-1">{content.cta_target.url.replace(/^https?:\/\//, '')}</div>
            )}
          </div>
          {content.qr_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={content.qr_url} alt="QR" className="h-16 w-16 flex-shrink-0" />
          ) : (
            <div className="h-16 w-16 flex-shrink-0 grid place-items-center border border-dashed border-[#0a4d2e]/40 text-[9px] text-[#0a4d2e]/60 text-center">QR al aprobar</div>
          )}
        </div>
      </div>
    </div>
  )
}
