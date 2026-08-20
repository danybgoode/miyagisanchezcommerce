'use client'

import { useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'

const fontStack = "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

const palettes = [
  {
    id: 'selva-ledger',
    name: 'Selva Ledger',
    mood: 'Most conservative: marketplace trust, safe money movement, grounded warmth.',
    colors: {
      trust: '#17201b',
      success: '#1f7a4d',
      successSoft: '#e9f5ef',
      accent: '#b7652b',
      accentSoft: '#fbefe6',
      danger: '#a43d3d',
      dangerSoft: '#faeded',
      info: '#315f7c',
      infoSoft: '#edf3f6',
      background: '#faf9f6',
      surface: '#ffffff',
      surfaceAlt: '#f1eee8',
      border: '#ded8cd',
      text: '#1f241f',
      muted: '#696c64',
      subtle: '#8d8f86',
    },
  },
  {
    id: 'copal-balance',
    name: 'Copal Balance',
    mood: 'Warmest: approachable P2P commerce with a calm payment/security layer.',
    colors: {
      trust: '#211f1a',
      success: '#0f766e',
      successSoft: '#e7f5f2',
      accent: '#9f4f3f',
      accentSoft: '#f8ece8',
      danger: '#9d363a',
      dangerSoft: '#faecee',
      info: '#345b71',
      infoSoft: '#edf3f5',
      background: '#faf8f4',
      surface: '#ffffff',
      surfaceAlt: '#efeae1',
      border: '#d9d0c2',
      text: '#24221d',
      muted: '#706b60',
      subtle: '#8d877c',
    },
  },
  {
    id: 'anil-market',
    name: 'Anil Market',
    mood: 'Sharpest: financial utility, crisp scanning, slightly cooler trust posture.',
    colors: {
      trust: '#121f2f',
      success: '#2f7d53',
      successSoft: '#e9f5ee',
      accent: '#bd7f18',
      accentSoft: '#fbf0dd',
      danger: '#a23e4a',
      dangerSoft: '#faedf0',
      info: '#265f88',
      infoSoft: '#e9f2f7',
      background: '#f8f9f7',
      surface: '#ffffff',
      surfaceAlt: '#edf1ee',
      border: '#d9dfda',
      text: '#182232',
      muted: '#626d69',
      subtle: '#858e89',
    },
  },
] as const

type Palette = (typeof palettes)[number]

type LandingView = 'anchor' | 'creator' | 'experience'
type MobileMockupView = 'catalog' | 'pdp' | 'checkout'
type SandboxView = 'style-box' | 'mobile-pwa' | LandingView

type LandingPageConfig = {
  id: LandingView
  navLabel: string
  navMeta: string
  eyebrow: string
  vibe: string
  hero: string
  subcopy: string
  primaryCta: string
  secondaryCta: string
  stats: Array<{ value: string; label: string }>
  features: Array<{ title: string; body: string; meta: string }>
  surfaces: Array<{ title: string; body: string }>
  testimonial: { quote: string; name: string; role: string }
  agentPrompt: { title: string; body: string; prompt: string }
  faqs: Array<{ question: string; answer: string }>
  loader: { id: string; title: string; text: string }
}

const sandboxViews: Array<{ id: SandboxView; label: string; meta: string }> = [
  { id: 'style-box', label: 'Caja de estilo', meta: 'tokens' },
  { id: 'mobile-pwa', label: 'Móvil PWA', meta: 'ux/ui' },
  { id: 'anchor', label: 'Vende', meta: 'general' },
  { id: 'creator', label: 'Creadores', meta: 'marca' },
  { id: 'experience', label: 'Experiencias', meta: 'mundial' },
]

const mobileMockupViews: Array<{ id: MobileMockupView; label: string; meta: string }> = [
  { id: 'catalog', label: 'Catálogo', meta: 'bottom bar visible' },
  { id: 'pdp', label: 'PDP', meta: 'CTA sticky' },
  { id: 'checkout', label: 'Checkout', meta: 'pay footer' },
]

const catalogItems = [
  { title: 'Sudadera Nike vintage', meta: 'M · como nueva', price: '$430', tone: 'forest' },
  { title: 'Tour taquero CDMX', meta: 'Viernes · 2 horas', price: '$620', tone: 'terra' },
  { title: 'Bici urbana restaurada', meta: 'Roma Norte', price: '$4,800', tone: 'blue' },
  { title: 'Cámara Canon rental', meta: 'Renta por día', price: '$380/día', tone: 'gold' },
]

const mobileAuditNotes = [
  {
    title: 'Catálogo',
    body: 'La navegación persistente sí ayuda aquí: buscar, guardar, publicar y volver a inicio son acciones recurrentes de exploración.',
  },
  {
    title: 'PDP',
    body: 'La barra global compite con la compra. El PDP debe reservar el fondo para una sola decisión: comprar, ofertar o preguntar.',
  },
  {
    title: 'Checkout',
    body: 'El usuario ya decidió. Aquí conviene un footer de pago con total y estado, no navegación de descubrimiento.',
  },
]

const radii = [
  ['Token', 'Value', 'Use'],
  ['radius-xs', '2px', 'Tiny badges, table chips'],
  ['radius-sm', '4px', 'Inputs, compact controls'],
  ['radius-md', '6px', 'Buttons, selectors'],
  ['radius-lg', '8px', 'Cards, checkout panels, modals'],
  ['radius-pill', '999px', 'Chips and status pills only'],
]

const typeScale = [
  ['Display', '40 / 1.05 / 750', 'Marketplace decisions, not decorative hero copy'],
  ['H1', '32 / 1.12 / 720', 'Page titles and checkout summaries'],
  ['H2', '24 / 1.18 / 680', 'Section titles and dashboard panels'],
  ['H3', '18 / 1.28 / 650', 'Card titles and table groups'],
  ['Body', '15 / 1.55 / 450', 'Primary reading and instructions'],
  ['Small', '13 / 1.45 / 500', 'Metadata, helper copy, secondary actions'],
  ['Micro', '11 / 1.35 / 650', 'Badges, labels, but never critical alone'],
]

const loaderCopy = [
  {
    id: 'wax',
    title: 'Encerando, puliendo',
    text: 'Procesando tu pago',
    className: 'wax-loader',
    use: 'Botón de pago',
  },
  {
    id: 'fence',
    title: 'Pintando la cerca',
    text: 'Sincronizando inventario',
    className: 'fence-loader',
    use: 'Carga asincrona',
  },
  {
    id: 'fly',
    title: 'Atrapando la mosca',
    text: 'Buscando opciones de envío',
    className: 'fly-loader',
    use: 'Cotización',
  },
  {
    id: 'bonsai',
    title: 'Podando el bonsái',
    text: 'Publicando tu tienda',
    className: 'bonsai-loader',
    use: 'Transición de página',
  },
]

const landingPages: Record<LandingView, LandingPageConfig> = {
  anchor: {
    id: 'anchor',
    navLabel: 'La base',
    navMeta: 'vende.miyagisanchez.com',
    eyebrow: 'Para vender sin cambiar tu forma de trabajar',
    vibe: 'Confianza institucional, capacidad amplia y cero fricción.',
    hero: 'Vende lo que sea, donde sea. Sin comisiones.',
    subcopy:
      'Productos, servicios, rentas o suscripciones. Abre tu tienda en minutos y vende en Miyagi, en tu propio sitio o con ayuda de tu agente de IA.',
    primaryCta: 'Abrir mi tienda',
    secondaryCta: 'Ver formas de vender',
    stats: [
      { value: '0%', label: 'comisión por venta' },
      { value: '3', label: 'frentes para vender' },
      { value: '100%', label: 'tu dinero es tuyo' },
    ],
    features: [
      {
        title: 'Vende en varios frentes',
        body: 'Publica una vez y mueve la misma tienda en el marketplace, tu dominio, un widget embebido o conversaciones con agentes de IA.',
        meta: 'Widget / Dominio / Marketplace',
      },
      {
        title: 'No te quitamos porcentaje',
        body: 'Acepta SPEI, MercadoPago, efectivo o pagos acordados sin que la plataforma se quede con una rebanada de cada venta.',
        meta: 'SPEI / MercadoPago / Efectivo',
      },
      {
        title: 'Del papel al checkout',
        body: 'La edición impresa convierte anuncios físicos en fichas digitales con QR: el comprador ve el anuncio, escanea y llega a tu producto vivo.',
        meta: 'Anuncio físico a venta digital',
      },
    ],
    surfaces: [
      { title: 'Marketplace', body: 'Para aparecer donde la gente ya está buscando productos, servicios, rentas y suscripciones locales.' },
      { title: 'Tu dominio', body: 'Para conservar tu marca y dejar que Miyagi resuelva catálogo, pagos, órdenes y flujos de venta.' },
      { title: 'Agentes de IA', body: 'Para que un agente pueda entender tu tienda, recomendarla y guiar al comprador al siguiente paso.' },
    ],
    testimonial: {
      quote: 'La promesa no es "otra plataforma más". Es una tienda que respeta tu margen y te deja vender donde ya están tus clientes.',
      name: 'Narrativa de lanzamiento',
      role: 'Adquisición de vendedores',
    },
    agentPrompt: {
      title: 'No nos creas solo a nosotros. Pregúntale a tu agente.',
      body: 'Copia este prompt en ChatGPT, Gemini o el agente que uses. Que revise Miyagi como tercero independiente y te diga si vale la pena para tu tienda.',
      prompt:
        'Actúa como mi asesor de comercio digital en México. Si puedes navegar, entra a https://miyagisanchez.com/agent y revisa qué ofrece Miyagi Sánchez para vendedores. Evalúa si me conviene vender productos, servicios o rentas sin comisión, con pagos locales como SPEI, MercadoPago o efectivo, y con soporte para agentes de IA. Dame pros, riesgos, preguntas importantes y los siguientes pasos para abrir o migrar mi tienda.',
    },
    faqs: [
      {
        question: '¿Solo sirve para productos físicos?',
        answer: 'No. La misma tienda puede manejar productos, servicios, rentas, suscripciones y contenido digital.',
      },
      {
        question: '¿Quién recibe el dinero?',
        answer: 'El vendedor. Miyagi no cobra comisión por venta; puedes activar los métodos que te convengan: SPEI, MercadoPago, efectivo o pago coordinado.',
      },
      {
        question: '¿Qué cambia frente a vender solo por WhatsApp o Instagram?',
        answer: 'Sigues usando tus canales, pero ahora tienes catálogo, fichas, pagos, órdenes, promociones y agentes que pueden entender tu tienda sin que vendas todo a mano.',
      },
    ],
    loader: {
      id: 'bonsai',
      title: 'Podando el bonsái',
      text: 'Preparando tu tienda',
    },
  },
  creator: {
    id: 'creator',
    navLabel: 'Creadores locales',
    navMeta: 'Diseñadores y artistas',
    eyebrow: 'Para marcas con estilo propio',
    vibe: 'Premium, estético y enfocado en creadores.',
    hero: 'Tu marca, tus reglas. Ya estuvo de pagar 30%.',
    subcopy:
      'Convierte tus seguidores en compradores sin regalar margen en cada venta. Mantén el control de tu marca con una tienda limpia que puedes embeber en tu propio sitio.',
    primaryCta: 'Embeber mi tienda',
    secondaryCta: 'Ver tablero de creador',
    stats: [
      { value: '100%', label: 'ventas para ti' },
      { value: '1', label: 'widget para tu dominio' },
      { value: 'Rápido', label: 'migración sin CSV eterno' },
    ],
    features: [
      {
        title: 'Widget para tu sitio',
        body: 'Pon tu catálogo en tu dominio sin que parezca plantilla genérica. Tu marca sigue siendo la protagonista.',
        meta: 'Dominio propio',
      },
      {
        title: 'Cupones sin pedir permiso',
        body: 'Crea códigos para drops, preventas, colaboraciones o seguidores fieles. Ves uso y vigencia desde tu tablero.',
        meta: 'Tablero / Cupones',
      },
      {
        title: 'Migra sin clavarte en formatos',
        body: 'Pega una lista, sube un archivo o deja que tu agente ordene tu catálogo. Revisas, corriges y publicas.',
        meta: 'Importación rápida',
      },
    ],
    surfaces: [
      { title: 'Instagram no es tienda', body: 'Tus seguidores ya están ahí; Miyagi les da una ficha clara, pago y seguimiento sin perder tu estilo.' },
      { title: 'Drops y piezas limitadas', body: 'Inventario, cupones y disponibilidad para vender con orden cuando una pieza se mueve rápido.' },
      { title: 'Perfil con calma visual', body: 'Una tienda sobria y premium, pensada para escanear colecciones sin ruido ni adornos baratos.' },
    ],
    testimonial: {
      quote: 'Para una marca independiente, el problema no es vender. Es vender sin que la plataforma se coma el margen ni ensucie la experiencia.',
      name: 'Persona creadora',
      role: 'Moda, arte y objetos de autor',
    },
    agentPrompt: {
      title: 'Deja que tu agente compare por ti.',
      body: 'Ideal para creadores que ya usan ChatGPT o Gemini para copy, catálogo o inventario. Pídele que revise Miyagi con criterio de negocio, no con hype.',
      prompt:
        'Actúa como asesor de una marca independiente en México. Revisa https://miyagisanchez.com/agent si puedes navegar. Quiero saber si Miyagi Sánchez me conviene para vender piezas de autor, drops o colecciones sin pagar comisiones altas. Compara contra vender solo por Instagram, marketplace tradicional o tienda propia. Dame una recomendación honesta, riesgos, costos ocultos que debo preguntar y una lista de pasos para migrar mi catálogo.',
    },
    faqs: [
      {
        question: '¿Puedo mantener mi propio dominio?',
        answer: 'Sí. La idea es que Miyagi sea la infraestructura y tu marca siga siendo la cara de la tienda.',
      },
      {
        question: '¿Puedo sacar promos para mis seguidores?',
        answer: 'Sí. Puedes crear códigos con porcentaje, monto fijo, vigencia y límite de uso para que no se te vaya de las manos.',
      },
      {
        question: '¿Tengo que hacer un CSV perfecto?',
        answer: 'No. Puedes pegar texto, subir un archivo o usar tu agente para preparar el catálogo. Antes de publicar siempre revisas una tabla editable.',
      },
    ],
    loader: {
      id: 'fence',
      title: 'Pintando la cerca',
      text: 'Sincronizando tu colección',
    },
  },
  experience: {
    id: 'experience',
    navLabel: 'Experiencias y turismo',
    navMeta: 'Mundial 2026',
    eyebrow: 'Para quienes venden experiencias locales',
    vibe: 'Dinámico, urgente y hospitalario.',
    hero: 'El mundo viene a México. ¿Tu negocio ya está listo?',
    subcopy:
      'Sube tours, joyas locales, servicios y rentas de equipo. Atiende turistas con chat, negociación, WhatsApp y pagos que sí funcionan aquí: SPEI, efectivo, MercadoPago o arreglo directo.',
    primaryCta: 'Subir mi experiencia',
    secondaryCta: 'Ver flujos para turistas',
    stats: [
      { value: '2026', label: 'ventana de demanda' },
      { value: 'Chat', label: 'preguntas y ofertas' },
      { value: 'Local', label: 'SPEI y efectivo' },
    ],
    features: [
      {
        title: 'No todo es un producto',
        body: 'Publica tours, clases, rentas, traslados, experiencias y paquetes sin forzarlos a una ficha pensada para playeras.',
        meta: 'Servicios / Rentas',
      },
      {
        title: 'Preguntas antes de pagar',
        body: 'El turista puede preguntar, negociar horario, pedir disponibilidad o hacer oferta antes de cerrar. Menos fricción, menos ventas perdidas.',
        meta: 'Ofertas / Chat',
      },
      {
        title: 'Flujos reales, no de escritorio',
        body: 'Punto de encuentro, entrega coordinada, WhatsApp, SPEI o efectivo. Miyagi ordena el proceso para que no todo quede perdido en mensajes.',
        meta: 'WhatsApp / SPEI / Efectivo',
      },
    ],
    surfaces: [
      { title: 'Tours', body: 'Rutas de comida, barrios, cultura, previa del partido y lugares que no salen en la guía genérica.' },
      { title: 'Rentas', body: 'Bicis, cámaras, kits, equipo de día de partido y cosas que un turista no va a comprar para una semana.' },
      { title: 'Servicios', body: 'Traslados, traducción, apoyo local, anfitriones, entregas y coordinación de experiencias.' },
    ],
    testimonial: {
      quote: 'En turismo, la venta casi nunca es lineal. La gente pregunta, ajusta, negocia y coordina. La oportunidad es ordenar eso antes de que llegue 2026.',
      name: 'Mesa de crecimiento Mundial',
      role: 'Servicios locales y hospitality',
    },
    agentPrompt: {
      title: 'Pídele a tu agente que piense como turista.',
      body: 'El punto no es que Miyagi prometa magia. Es que tu agente pueda revisar la oportunidad del Mundial y decirte si tu servicio está listo para venderse.',
      prompt:
        'Actúa como asesor de crecimiento para un negocio local en México durante el Mundial 2026. Si puedes navegar, revisa https://miyagisanchez.com/agent y evalúa si Miyagi Sánchez sirve para publicar tours, experiencias, servicios o rentas para turistas. Quiero una opinión honesta sobre cómo captar demanda, manejar preguntas por chat, aceptar ofertas, coordinar entrega o punto de encuentro, y cobrar por SPEI, efectivo o MercadoPago. Dame ideas de paquetes, riesgos operativos y un plan de 7 días para salir publicado.',
    },
    faqs: [
      {
        question: '¿Sirve si vendo servicios y no productos?',
        answer: 'Sí. Las fichas pueden cubrir servicios, rentas, experiencias y arreglos coordinados, no solo productos físicos.',
      },
      {
        question: '¿Cómo coordino horarios, puntos de encuentro o cambios?',
        answer: 'Con chat, ofertas y flujos de arreglo directo. La idea es que la conversación exista, pero que no se pierda el estado de la venta.',
      },
      {
        question: '¿Y si el pago es en efectivo o SPEI?',
        answer: 'Puedes mostrarlo como flujo local y confirmar manualmente cuando recibes el pago. Miyagi ayuda a que comprador y vendedor sepan quién tiene la siguiente acción.',
      },
    ],
    loader: {
      id: 'fly',
      title: 'Atrapando la mosca',
      text: 'Buscando disponibilidad para turistas',
    },
  },
}

function isLandingView(view: SandboxView): view is LandingView {
  return view === 'anchor' || view === 'creator' || view === 'experience'
}

export default function StyleSandboxPage() {
  const [activeId, setActiveId] = useState<Palette['id']>('selva-ledger')
  const [activeView, setActiveView] = useState<SandboxView>('style-box')
  const [activeMobileView, setActiveMobileView] = useState<MobileMockupView>('catalog')
  const [transitioning, setTransitioning] = useState(false)
  const [demoSubmitting, setDemoSubmitting] = useState(false)
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null)
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const submitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const active = palettes.find((palette) => palette.id === activeId) ?? palettes[0]
  const activeLanding = isLandingView(activeView) ? landingPages[activeView] : null

  const themeStyle = {
    '--sb-bg': active.colors.background,
    '--sb-surface': active.colors.surface,
    '--sb-surface-alt': active.colors.surfaceAlt,
    '--sb-border': active.colors.border,
    '--sb-text': active.colors.text,
    '--sb-muted': active.colors.muted,
    '--sb-subtle': active.colors.subtle,
    '--sb-trust': active.colors.trust,
    '--sb-success': active.colors.success,
    '--sb-success-soft': active.colors.successSoft,
    '--sb-accent': active.colors.accent,
    '--sb-accent-soft': active.colors.accentSoft,
    '--sb-danger': active.colors.danger,
    '--sb-danger-soft': active.colors.dangerSoft,
    '--sb-info': active.colors.info,
    '--sb-info-soft': active.colors.infoSoft,
    '--sb-focus': active.colors.success,
  } as CSSProperties

  const themeSnippet = useMemo(() => {
    return `@theme inline {
  --font-sans: ${fontStack};

  --color-background: ${active.colors.background};
  --color-surface: ${active.colors.surface};
  --color-surface-alt: ${active.colors.surfaceAlt};
  --color-border: ${active.colors.border};
  --color-foreground: ${active.colors.text};
  --color-muted: ${active.colors.muted};
  --color-subtle: ${active.colors.subtle};

  --color-trust: ${active.colors.trust};
  --color-brand: ${active.colors.success};
  --color-brand-soft: ${active.colors.successSoft};
  --color-accent: ${active.colors.accent};
  --color-accent-soft: ${active.colors.accentSoft};
  --color-danger: ${active.colors.danger};
  --color-danger-soft: ${active.colors.dangerSoft};
  --color-info: ${active.colors.info};
  --color-info-soft: ${active.colors.infoSoft};

  --radius-xs: 2px;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-pill: 999px;
}`
  }, [active])

  function startTransition() {
    if (transitionTimer.current) clearTimeout(transitionTimer.current)
    setTransitioning(true)
    transitionTimer.current = setTimeout(() => setTransitioning(false), 760)
  }

  function handleViewChange(view: SandboxView) {
    if (view === activeView) return
    setActiveView(view)
    startTransition()
  }

  function handleDemoSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitTimer.current) clearTimeout(submitTimer.current)
    setDemoSubmitting(true)
    submitTimer.current = setTimeout(() => setDemoSubmitting(false), 1400)
  }

  async function handleCopyPrompt(page: LandingPageConfig) {
    try {
      await navigator.clipboard.writeText(page.agentPrompt.prompt)
    } catch {
      // The prompt remains visible for manual copy if clipboard access is unavailable.
    }

    if (copyTimer.current) clearTimeout(copyTimer.current)
    setCopiedPrompt(page.id)
    copyTimer.current = setTimeout(() => setCopiedPrompt(null), 1600)
  }

  return (
    <main className="sandbox" style={themeStyle}>
      <style>{sandboxCss}</style>
      <div className="sb-shell">
        <header className="sb-header">
          <div className="sb-kicker">Part 2 + Part 3 visual blueprint</div>
          <div className="sb-header-row">
            <div>
              <h1>Neo-Utility & Trusted Warmth</h1>
              <p className="sb-lede">
                Isolated token playground for Miyagi Sánchez commerce. Toggle palettes, inspect typography,
                preview component states, and review Miyagi-Do loader behavior before global adoption.
              </p>
            </div>
            <div className="sb-palette-switcher" aria-label="Palette options">
              {palettes.map((palette) => (
                <button
                  key={palette.id}
                  type="button"
                  aria-pressed={palette.id === activeId}
                  data-active={palette.id === activeId}
                  onClick={() => setActiveId(palette.id)}
                >
                  <span>{palette.name}</span>
                  <small>{palette.colors.trust}</small>
                </button>
              ))}
            </div>
          </div>
        </header>

        <ViewSwitcher activeView={activeView} onChange={handleViewChange} />

        {transitioning && (
          <TransitionLoader activeLanding={activeLanding} />
        )}

        {activeView === 'style-box' ? (
        <>
        <section className="sb-grid sb-grid-2">
          <article className="sb-panel">
            <div className="sb-section-title">
              <p>Active Palette</p>
              <span>{active.mood}</span>
            </div>
            <div className="sb-swatches">
              <Swatch label="Trust Anchor" value={active.colors.trust} />
              <Swatch label="Brand / Success" value={active.colors.success} />
              <Swatch label="Accent / Negotiation" value={active.colors.accent} />
              <Swatch label="Danger" value={active.colors.danger} />
              <Swatch label="Background" value={active.colors.background} />
              <Swatch label="Surface" value={active.colors.surface} />
              <Swatch label="Surface Alt" value={active.colors.surfaceAlt} />
              <Swatch label="Border" value={active.colors.border} />
              <Swatch label="Text" value={active.colors.text} />
              <Swatch label="Muted" value={active.colors.muted} />
            </div>
          </article>

          <article className="sb-panel sb-code-panel">
            <div className="sb-section-title">
              <p>Tailwind Token Proposal</p>
              <span>Scoped preview of the exact theme values for the selected palette.</span>
            </div>
            <pre>{themeSnippet}</pre>
          </article>
        </section>

        <section className="sb-panel">
          <div className="sb-section-title">
            <p>Typography Scale</p>
            <span>Hierarchy comes from size, weight, rhythm, and clarity rather than heavy boxes.</span>
          </div>
          <div className="sb-type-grid">
            {typeScale.map(([name, spec, use]) => (
              <div className="sb-type-row" key={name}>
                <div>
                  <span>{name}</span>
                  <small>{spec}</small>
                </div>
                <p className={`sb-type-sample sb-type-${name.toLowerCase()}`}>
                  {name === 'Display'
                    ? 'Financial trust for local commerce'
                    : name === 'Micro'
                      ? 'Protected payment'
                      : 'Clear, calm, high-speed scanning'}
                </p>
                <em>{use}</em>
              </div>
            ))}
          </div>
        </section>

        <section className="sb-grid sb-grid-2">
          <article className="sb-panel">
            <div className="sb-section-title">
              <p>Standard UI Elements</p>
              <span>Buttons, form states, cards, and action hierarchy reacting to the active palette.</span>
            </div>

            <div className="sb-control-stack">
              <div className="sb-button-row">
                <button className="sb-button sb-button-primary" type="button">Confirmar pago</button>
                <button className="sb-button sb-button-secondary" type="button">Enviar mensaje</button>
                <button className="sb-button sb-button-ghost" type="button">Ver detalles</button>
                <button className="sb-button sb-button-primary" type="button" disabled>Procesando</button>
              </div>

              <div className="sb-field-grid">
                <label>
                  <span>Empty input</span>
                  <input className="sb-input" placeholder="Nombre del comprador" />
                </label>
                <label>
                  <span>Filled input</span>
                  <input className="sb-input" value="Guadalajara, Jalisco" readOnly />
                </label>
                <label>
                  <span>Error input</span>
                  <input className="sb-input" value="123" readOnly aria-invalid="true" />
                  <small>El código postal debe tener 5 dígitos.</small>
                </label>
                <label>
                  <span>Disabled input</span>
                  <input className="sb-input" value="Autocompletado por CP" disabled />
                </label>
              </div>
            </div>
          </article>

          <article className="sb-panel">
            <div className="sb-section-title">
              <p>Commerce Cards</p>
              <span>Flat, bordered, compact. Strong action first, secondary choices stepped down.</span>
            </div>
            <div className="sb-card-stack">
              <div className="sb-commerce-card">
                <div className="sb-thumb" />
                <div>
                  <strong>Bicicleta urbana restaurada</strong>
                  <p>MXN 4,800</p>
                  <span>Vendedor verificado - CDMX</span>
                </div>
              </div>

              <div className="sb-offer-card">
                <div>
                  <span className="sb-badge sb-badge-accent">Contraoferta activa</span>
                  <h3>El comprador ofrece MXN 4,250</h3>
                  <p>Responde antes de que expire. Aceptar debe ser la acción dominante.</p>
                </div>
                <div className="sb-action-strip">
                  <button className="sb-button sb-button-primary" type="button">Aceptar</button>
                  <button className="sb-button sb-button-secondary" type="button">Contraofertar</button>
                  <button className="sb-icon-button" type="button" aria-label="Rechazar">X</button>
                </div>
              </div>

              <div className="sb-summary">
                <div><span>Total</span><strong>MXN 5,180</strong></div>
                <div><span>Proteccion</span><strong>Miyagi Pay</strong></div>
                <div><span>Entrega</span><strong>Cotizando</strong></div>
              </div>
            </div>
          </article>
        </section>

        <section className="sb-panel">
          <div className="sb-section-title">
            <p>Miyagi-Do Loader System</p>
            <span>Subtle, informational loading states for payments, inventory, shipping, and publishing.</span>
          </div>
          <div className="sb-loader-grid">
            {loaderCopy.map((loader) => (
              <article className="sb-loader-card" key={loader.id}>
                <div className={`sb-loader-scene ${loader.className}`}>
                  <LoaderScene id={loader.id} />
                </div>
                <div>
                  <span>{loader.use}</span>
                  <h3>{loader.title}...</h3>
                  <p>{loader.text}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="sb-panel">
          <div className="sb-section-title">
            <p>Radius Blueprint</p>
            <span>Small geometry, crisp utility, no pill shapes except chips and status metadata.</span>
          </div>
          <div className="sb-radius-table">
            {radii.map((row, index) => (
              <div key={row.join('-')} className={index === 0 ? 'is-header' : ''}>
                <span>{row[0]}</span>
                <strong>{row[1]}</strong>
                <p>{row[2]}</p>
              </div>
            ))}
          </div>
        </section>
        </>
        ) : activeView === 'mobile-pwa' ? (
          <MobilePwaMockups
            activeMobileView={activeMobileView}
            onChange={setActiveMobileView}
          />
        ) : activeLanding ? (
          <LandingPagePreview
            page={activeLanding}
            isSubmitting={demoSubmitting}
            copiedPrompt={copiedPrompt === activeLanding.id}
            onSubmit={handleDemoSubmit}
            onCopyPrompt={() => handleCopyPrompt(activeLanding)}
          />
        ) : null}
      </div>
    </main>
  )
}

function Swatch({ label, value }: { label: string; value: string }) {
  return (
    <div className="sb-swatch">
      <span style={{ background: value }} />
      <div>
        <strong>{label}</strong>
        <code>{value}</code>
      </div>
    </div>
  )
}

function ViewSwitcher({
  activeView,
  onChange,
}: {
  activeView: SandboxView
  onChange: (view: SandboxView) => void
}) {
  return (
    <nav className="sb-view-switcher" aria-label="Sandbox views">
      {sandboxViews.map((view) => (
        <button
          key={view.id}
          type="button"
          aria-pressed={activeView === view.id}
          data-active={activeView === view.id}
          onClick={() => onChange(view.id)}
        >
          <span>{view.label}</span>
          <small>{view.meta}</small>
        </button>
      ))}
    </nav>
  )
}

function TransitionLoader({ activeLanding }: { activeLanding: LandingPageConfig | null }) {
  const loader = activeLanding?.loader ?? {
    id: 'bonsai',
    title: 'Podando el bonsai',
    text: 'Cargando la caja de estilo',
  }

  return (
    <div className="sb-transition-overlay" role="status" aria-live="polite">
      <div className="sb-transition-card">
        <div className="sb-loader-scene">
          <LoaderScene id={loader.id} />
        </div>
        <div>
          <strong>{loader.title}...</strong>
          <span>{loader.text}</span>
        </div>
      </div>
    </div>
  )
}

function MobilePwaMockups({
  activeMobileView,
  onChange,
}: {
  activeMobileView: MobileMockupView
  onChange: (view: MobileMockupView) => void
}) {
  return (
    <section className="mobile-builder">
      <div className="mobile-builder-hero">
        <div>
          <span>Mobile/PWA artifact</span>
          <h2>Exploración móvil para catálogo, PDP y checkout.</h2>
          <p>
            Mockups aislados para probar navegación, densidad, jerarquía de acciones y comportamiento PWA
            antes de tocar componentes productivos.
          </p>
        </div>
        <div className="mobile-toggle" aria-label="Mobile mockup views">
          {mobileMockupViews.map((view) => (
            <button
              key={view.id}
              type="button"
              aria-pressed={activeMobileView === view.id}
              data-active={activeMobileView === view.id}
              onClick={() => onChange(view.id)}
            >
              <span>{view.label}</span>
              <small>{view.meta}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="mobile-stage">
        <aside className="mobile-brief">
          <div className="mobile-rule-card">
            <span>Regla PWA propuesta</span>
            <h3>Bottom bar solo en descubrimiento.</h3>
            <p>
              Visible en catálogo, home, tiendas y favoritos. Oculta en PDP, checkout, mensajes,
              publicar y gestión para no competir con la acción principal.
            </p>
          </div>

          <div className="mobile-route-map">
            <div data-state="show"><strong>Mostrar</strong><span>/, /l, /s/[slug], favoritos</span></div>
            <div data-state="hide"><strong>Ocultar</strong><span>/l/[id], /checkout, /messages, /sell, /shop/manage</span></div>
          </div>

          <div className="mobile-note-list">
            {mobileAuditNotes.map((note) => (
              <article key={note.title}>
                <strong>{note.title}</strong>
                <p>{note.body}</p>
              </article>
            ))}
          </div>
        </aside>

        <PhoneFrame view={activeMobileView}>
          {activeMobileView === 'catalog' && <CatalogMobileMockup />}
          {activeMobileView === 'pdp' && <PdpMobileMockup />}
          {activeMobileView === 'checkout' && <CheckoutMobileMockup />}
        </PhoneFrame>
      </div>
    </section>
  )
}

function PhoneFrame({
  view,
  children,
}: {
  view: MobileMockupView
  children: ReactNode
}) {
  return (
    <div className="phone-frame" data-view={view}>
      <div className="phone-device">
        <div className="phone-status">
          <span>8:36</span>
          <div><i /> <i /> <strong>84</strong></div>
        </div>
        {children}
      </div>
    </div>
  )
}

function MobileTopBar({ context }: { context: 'catalog' | 'task' | 'checkout' }) {
  return (
    <header className="mobile-topbar" data-context={context}>
      <strong>MS</strong>
      {context === 'catalog' ? (
        <div className="mobile-top-actions">
          <span>+</span>
          <span>Bag</span>
          <span>AI</span>
        </div>
      ) : (
        <div className="mobile-task-search">
          <span>{context === 'checkout' ? 'Resumen de compra' : 'Buscar en Miyagi'}</span>
        </div>
      )}
    </header>
  )
}

function CatalogMobileMockup() {
  return (
    <div className="phone-screen catalog-screen">
      <MobileTopBar context="catalog" />
      <div className="mobile-search">
        <span>Buscar productos, servicios o rentas</span>
      </div>
      <div className="mobile-chip-rail">
        <span data-active="true">Todo</span>
        <span>Moda</span>
        <span>Experiencias</span>
        <span>Rentas</span>
      </div>
      <section className="mobile-filter-card">
        <div>
          <strong>Explora México</strong>
          <span>CDMX · Mundial 2026 · entrega local</span>
        </div>
        <button type="button">Filtros</button>
      </section>
      <div className="mobile-listing-grid">
        {catalogItems.map((item) => (
          <article key={item.title} className="mobile-listing-card">
            <div className="mobile-listing-image" data-tone={item.tone}>
              <button type="button" aria-label={`Guardar ${item.title}`}>♡</button>
            </div>
            <h3>{item.title}</h3>
            <p>{item.meta}</p>
            <strong>{item.price}</strong>
          </article>
        ))}
      </div>
      <nav className="mock-bottom-bar" aria-label="PWA catalog navigation">
        <span data-active="true">Inicio</span>
        <span>Chat</span>
        <strong>+</strong>
        <span>Fav</span>
        <span>Perfil</span>
        <button type="button" aria-label="Buscar">⌕</button>
      </nav>
    </div>
  )
}

function PdpMobileMockup() {
  return (
    <div className="phone-screen pdp-screen">
      <MobileTopBar context="task" />
      <div className="pdp-image-stack">
        <div className="pdp-main-image" />
        <span>1 / 5</span>
      </div>
      <section className="pdp-content-card">
        <div className="pdp-title-row">
          <h3>Sudadera Nike vintage</h3>
          <button type="button" aria-label="Guardar">♡</button>
        </div>
        <p>M · como nueva · Guadalajara</p>
        <strong>$430 MXN</strong>
        <div className="pdp-trust-line">
          <span>Pago protegido disponible</span>
          <span>SPEI · MercadoPago · efectivo</span>
        </div>
      </section>
      <section className="pdp-spec-grid">
        <div><span>Marca</span><strong>Nike</strong></div>
        <div><span>Condición</span><strong>Como nueva</strong></div>
        <div><span>Entrega</span><strong>Envío o pickup</strong></div>
        <div><span>Publicado</span><strong>Hace 1 h</strong></div>
      </section>
      <section className="pdp-seller-card">
        <div className="seller-avatar">MS</div>
        <div>
          <strong>Mercado Sánchez</strong>
          <span>Verificado · responde rápido</span>
        </div>
        <em>›</em>
      </section>
      <div className="pdp-sticky-actions">
        <button className="sb-button sb-button-secondary" type="button">Hacer oferta</button>
        <button className="sb-button sb-button-primary" type="button">Comprar ahora</button>
      </div>
    </div>
  )
}

function CheckoutMobileMockup() {
  return (
    <div className="phone-screen checkout-screen">
      <MobileTopBar context="checkout" />
      <div className="checkout-heading">
        <span>Volver al anuncio</span>
        <h3>Revisar compra</h3>
        <p>Confirma entrega, pago y total antes de continuar.</p>
      </div>
      <section className="checkout-item-row">
        <div />
        <div>
          <strong>Sudadera Nike vintage</strong>
          <span>Mercado Sánchez</span>
        </div>
        <em>$430</em>
      </section>
      <section className="checkout-step-card">
        <div className="checkout-step-title"><span>1</span><strong>Entrega</strong></div>
        <button type="button" data-active="true">Envío a domicilio <em>Cotizar por CP</em></button>
        <button type="button">Recoger con vendedor <em>Coordinar por chat</em></button>
        <div className="checkout-cp-field">
          <span>CP</span>
          <strong>06100</strong>
          <em>Colonia detectada</em>
        </div>
      </section>
      <section className="checkout-step-card">
        <div className="checkout-step-title"><span>2</span><strong>Pago</strong></div>
        <button type="button" data-active="true">Mercado Pago <em>Protegido por Miyagi</em></button>
        <button type="button">SPEI <em>Instrucciones al confirmar</em></button>
      </section>
      <section className="checkout-summary-card">
        <div><span>Producto</span><strong>$430</strong></div>
        <div><span>Envío</span><strong>$89</strong></div>
        <div><span>Comisión Miyagi</span><strong>$0</strong></div>
      </section>
      <div className="checkout-pay-footer">
        <div><span>Total</span><strong>$519 MXN</strong></div>
        <button className="sb-button sb-button-primary" type="button">Pagar ahora</button>
      </div>
    </div>
  )
}

function LandingPagePreview({
  page,
  isSubmitting,
  copiedPrompt,
  onSubmit,
  onCopyPrompt,
}: {
  page: LandingPageConfig
  isSubmitting: boolean
  copiedPrompt: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCopyPrompt: () => void
}) {
  return (
    <div className="lp-preview" data-landing={page.id}>
      <LandingHero page={page} isSubmitting={isSubmitting} onSubmit={onSubmit} />
      <FeatureGrid features={page.features} />
      <SurfaceBand page={page} />
      <AgentPromptBlock page={page} copiedPrompt={copiedPrompt} onCopyPrompt={onCopyPrompt} />
      <MiyagiLoaderCallout page={page} />
      <TestimonialBlock testimonial={page.testimonial} />
      <FaqAccordion faqs={page.faqs} />
    </div>
  )
}

function LandingHero({
  page,
  isSubmitting,
  onSubmit,
}: {
  page: LandingPageConfig
  isSubmitting: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <section className="lp-hero">
      <div className="lp-hero-copy">
        <div className="lp-eyebrow">{page.eyebrow}</div>
        <h2>{page.hero}</h2>
        <p>{page.subcopy}</p>
        <div className="lp-hero-actions">
          <DemoLeadForm page={page} isSubmitting={isSubmitting} onSubmit={onSubmit} />
          <button className="sb-button sb-button-secondary" type="button">{page.secondaryCta}</button>
        </div>
      </div>
      <div className="lp-hero-panel" aria-label={`${page.navLabel} landing page preview`}>
        <div className="lp-browser-bar">
          <span />
          <strong>{page.navMeta}</strong>
        </div>
        <div className="lp-mini-store">
          <div>
            <span className="sb-badge sb-badge-accent">{page.vibe}</span>
            <h3>{page.navLabel}</h3>
            <p>Flujo de venta sin comisión, con pagos locales y superficies listas para separarse después.</p>
          </div>
          <div className="lp-store-grid">
            {page.stats.map((stat) => (
              <div key={stat.label}>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </div>
            ))}
          </div>
          <div className="lp-checkout-line">
            <span>Accion principal</span>
            <strong>{page.primaryCta}</strong>
          </div>
        </div>
      </div>
    </section>
  )
}

function DemoLeadForm({
  page,
  isSubmitting,
  onSubmit,
}: {
  page: LandingPageConfig
  isSubmitting: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <form className="lp-demo-form" onSubmit={onSubmit}>
      <input value="hola@mitienda.mx" readOnly aria-label="Correo de demostracion" />
      <button className="sb-button sb-button-primary" type="submit" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            <span className="lp-button-loader" aria-hidden>
              <LoaderScene id="wax" />
            </span>
            Encerando...
          </>
        ) : page.primaryCta}
      </button>
    </form>
  )
}

function FeatureGrid({ features }: { features: LandingPageConfig['features'] }) {
  return (
    <section className="lp-section">
      <div className="lp-section-heading">
        <span>Promesa central</span>
        <h3>Lo que el vendedor necesita, sin ruido ni vuelta larga.</h3>
      </div>
      <div className="lp-feature-grid">
        {features.map((feature, index) => (
          <article key={feature.title} className="lp-feature-card">
            <span>{String(index + 1).padStart(2, '0')}</span>
            <h4>{feature.title}</h4>
            <p>{feature.body}</p>
            <strong>{feature.meta}</strong>
          </article>
        ))}
      </div>
    </section>
  )
}

function SurfaceBand({ page }: { page: LandingPageConfig }) {
  return (
    <section className="lp-surface-band">
      <div className="lp-section-heading">
        <span>Módulo reutilizable</span>
        <h3>Mapa de superficies para {page.navLabel.toLowerCase()}</h3>
      </div>
      <div className="lp-surface-grid">
        {page.surfaces.map((surface) => (
          <article key={surface.title}>
            <h4>{surface.title}</h4>
            <p>{surface.body}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

function AgentPromptBlock({
  page,
  copiedPrompt,
  onCopyPrompt,
}: {
  page: LandingPageConfig
  copiedPrompt: boolean
  onCopyPrompt: () => void
}) {
  return (
    <section className="lp-agent-prompt">
      <div>
        <span>Confianza via agente</span>
        <h3>{page.agentPrompt.title}</h3>
        <p>{page.agentPrompt.body}</p>
      </div>
      <div className="lp-prompt-box">
        <pre>{page.agentPrompt.prompt}</pre>
        <button className="sb-button sb-button-primary" type="button" onClick={onCopyPrompt}>
          {copiedPrompt ? 'Prompt copiado' : 'Copiar prompt'}
        </button>
      </div>
    </section>
  )
}

function MiyagiLoaderCallout({ page }: { page: LandingPageConfig }) {
  return (
    <section className="lp-loader-callout">
      <div className="sb-loader-scene">
        <LoaderScene id={page.loader.id} />
      </div>
      <div>
        <span>Lenguaje de carga Miyagi-Do</span>
        <h3>{page.loader.title}...</h3>
        <p>{page.loader.text}. Este loader puede vivir en transiciones, cotizaciones, importaciones o pasos de onboarding.</p>
      </div>
    </section>
  )
}

function TestimonialBlock({ testimonial }: { testimonial: LandingPageConfig['testimonial'] }) {
  return (
    <section className="lp-testimonial">
      <blockquote>{testimonial.quote}</blockquote>
      <div>
        <strong>{testimonial.name}</strong>
        <span>{testimonial.role}</span>
      </div>
    </section>
  )
}

function FaqAccordion({ faqs }: { faqs: LandingPageConfig['faqs'] }) {
  return (
    <section className="lp-faq">
      <div className="lp-section-heading">
        <span>Preguntas frecuentes</span>
        <h3>Dudas reales antes de abrir tienda</h3>
      </div>
      <div className="lp-faq-list">
        {faqs.map((faq, index) => (
          <details key={faq.question} open={index === 0}>
            <summary>{faq.question}</summary>
            <p>{faq.answer}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

function LoaderScene({ id }: { id: string }) {
  if (id === 'wax') {
    return (
      <div className="wax-mark">
        <span />
      </div>
    )
  }

  if (id === 'fence') {
    return (
      <div className="fence-mark">
        <span />
      </div>
    )
  }

  if (id === 'fly') {
    return (
      <div className="fly-mark">
        <i />
        <span />
      </div>
    )
  }

  return (
    <div className="bonsai-mark">
      <span className="trunk" />
      <span className="canopy" />
      <i className="leaf leaf-one" />
      <i className="leaf leaf-two" />
      <i className="leaf leaf-three" />
    </div>
  )
}

const sandboxCss = `
.sandbox {
  min-height: 100vh;
  background: var(--sb-bg);
  color: var(--sb-text);
  font-family: ${fontStack};
}

.sandbox * {
  box-sizing: border-box;
  letter-spacing: 0;
}

.sb-shell {
  width: min(1180px, calc(100% - 32px));
  margin: 0 auto;
  padding: 32px 0 64px;
}

.sb-header {
  padding: 8px 0 24px;
}

.sb-kicker {
  color: var(--sb-success);
  font-size: 12px;
  font-weight: 750;
  margin-bottom: 12px;
  text-transform: uppercase;
}

.sb-header-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 24px;
  align-items: start;
}

.sb-header h1 {
  max-width: 760px;
  margin: 0;
  color: var(--sb-trust);
  font-size: clamp(32px, 5vw, 52px);
  line-height: 1.02;
  font-weight: 780;
}

.sb-lede {
  max-width: 760px;
  margin: 16px 0 0;
  color: var(--sb-muted);
  font-size: 16px;
  line-height: 1.65;
}

.sb-view-switcher {
  position: sticky;
  top: 10px;
  z-index: 30;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
  margin-bottom: 16px;
  padding: 6px;
  border: 1px solid var(--sb-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--sb-surface) 94%, transparent);
  backdrop-filter: blur(14px);
}

.sb-view-switcher button {
  min-height: 48px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--sb-muted);
  cursor: pointer;
  text-align: left;
  padding: 9px 11px;
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
}

.sb-view-switcher button:hover {
  background: var(--sb-surface-alt);
  color: var(--sb-trust);
}

.sb-view-switcher button:focus-visible,
.lp-demo-form input:focus-visible,
.lp-faq summary:focus-visible,
.mobile-toggle button:focus-visible,
.mobile-filter-card button:focus-visible,
.mobile-listing-image button:focus-visible,
.mock-bottom-bar button:focus-visible,
.pdp-title-row button:focus-visible,
.checkout-step-card button:focus-visible {
  outline: 2px solid var(--sb-focus);
  outline-offset: 2px;
}

.sb-view-switcher button[data-active="true"] {
  border-color: var(--sb-success);
  background: var(--sb-success-soft);
  color: var(--sb-trust);
}

.sb-view-switcher span,
.sb-view-switcher small {
  display: block;
}

.sb-view-switcher span {
  font-size: 13px;
  font-weight: 760;
}

.sb-view-switcher small {
  margin-top: 2px;
  color: var(--sb-muted);
  font-size: 11px;
  font-weight: 650;
  text-transform: uppercase;
}

.sb-transition-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: grid;
  place-items: center;
  pointer-events: none;
  background: color-mix(in srgb, var(--sb-bg) 72%, transparent);
  animation: overlay-fade 760ms ease both;
}

.sb-transition-card {
  display: flex;
  align-items: center;
  gap: 14px;
  width: min(420px, calc(100% - 32px));
  padding: 14px;
  border: 1px solid var(--sb-border);
  border-radius: 8px;
  background: var(--sb-surface);
}

.sb-transition-card .sb-loader-scene {
  min-height: 76px;
  width: 96px;
  flex: 0 0 auto;
}

.sb-transition-card strong,
.sb-transition-card span {
  display: block;
}

.sb-transition-card strong {
  color: var(--sb-trust);
  font-size: 16px;
}

.sb-transition-card span {
  margin-top: 4px;
  color: var(--sb-muted);
  font-size: 13px;
}

.sb-palette-switcher,
.sb-panel {
  border: 1px solid var(--sb-border);
  background: var(--sb-surface);
  border-radius: 8px;
}

.sb-palette-switcher {
  display: grid;
  gap: 6px;
  padding: 6px;
}

.sb-palette-switcher button {
  width: 100%;
  border: 1px solid transparent;
  background: transparent;
  color: var(--sb-muted);
  border-radius: 6px;
  padding: 12px;
  text-align: left;
  cursor: pointer;
}

.sb-palette-switcher button:hover {
  background: var(--sb-surface-alt);
  color: var(--sb-text);
}

.sb-palette-switcher button:focus-visible,
.sb-button:focus-visible,
.sb-icon-button:focus-visible,
.sb-input:focus-visible {
  outline: 2px solid var(--sb-focus);
  outline-offset: 2px;
}

.sb-palette-switcher button[data-active="true"] {
  border-color: var(--sb-success);
  background: var(--sb-success-soft);
  color: var(--sb-trust);
}

.sb-palette-switcher span,
.sb-palette-switcher small {
  display: block;
}

.sb-palette-switcher span {
  font-size: 14px;
  font-weight: 720;
}

.sb-palette-switcher small {
  margin-top: 3px;
  font-size: 11px;
  color: var(--sb-muted);
}

.sb-grid {
  display: grid;
  gap: 16px;
  margin-top: 16px;
}

.sb-grid-2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.sb-panel {
  padding: 18px;
}

.sb-section-title {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 16px;
}

.sb-section-title p {
  margin: 0;
  color: var(--sb-trust);
  font-size: 15px;
  font-weight: 760;
}

.sb-section-title span {
  max-width: 520px;
  color: var(--sb-muted);
  font-size: 13px;
  line-height: 1.45;
  text-align: right;
}

.sb-swatches {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.sb-swatch {
  display: flex;
  gap: 10px;
  align-items: center;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--sb-border);
  border-radius: 6px;
  background: var(--sb-bg);
}

.sb-swatch > span {
  width: 34px;
  height: 34px;
  border: 1px solid color-mix(in srgb, var(--sb-border) 70%, var(--sb-text));
  border-radius: 6px;
  flex: 0 0 auto;
}

.sb-swatch strong,
.sb-swatch code {
  display: block;
}

.sb-swatch strong {
  font-size: 12px;
  color: var(--sb-text);
}

.sb-swatch code {
  margin-top: 2px;
  color: var(--sb-muted);
  font-size: 11px;
}

.sb-code-panel pre {
  margin: 0;
  overflow: auto;
  padding: 14px;
  border-radius: 6px;
  border: 1px solid var(--sb-border);
  background: var(--sb-trust);
  color: white;
  font-size: 12px;
  line-height: 1.55;
}

.sb-type-grid {
  display: grid;
  gap: 1px;
  border: 1px solid var(--sb-border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--sb-border);
}

.sb-type-row {
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr) 260px;
  gap: 16px;
  align-items: center;
  padding: 14px;
  background: var(--sb-surface);
}

.sb-type-row span,
.sb-type-row small,
.sb-type-row em {
  display: block;
}

.sb-type-row span {
  font-size: 13px;
  font-weight: 720;
}

.sb-type-row small,
.sb-type-row em {
  color: var(--sb-muted);
  font-size: 12px;
  font-style: normal;
  line-height: 1.4;
}

.sb-type-sample {
  margin: 0;
  color: var(--sb-trust);
}

.sb-type-display {
  font-size: 40px;
  line-height: 1.05;
  font-weight: 750;
}

.sb-type-h1 {
  font-size: 32px;
  line-height: 1.12;
  font-weight: 720;
}

.sb-type-h2 {
  font-size: 24px;
  line-height: 1.18;
  font-weight: 680;
}

.sb-type-h3 {
  font-size: 18px;
  line-height: 1.28;
  font-weight: 650;
}

.sb-type-body {
  font-size: 15px;
  line-height: 1.55;
  font-weight: 450;
}

.sb-type-small {
  font-size: 13px;
  line-height: 1.45;
  font-weight: 500;
}

.sb-type-micro {
  display: inline-flex;
  width: fit-content;
  padding: 3px 7px;
  border-radius: 999px;
  background: var(--sb-success-soft);
  color: var(--sb-success);
  font-size: 11px;
  line-height: 1.35;
  font-weight: 650;
}

.sb-control-stack,
.sb-card-stack {
  display: grid;
  gap: 14px;
}

.sb-button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.sb-button,
.sb-icon-button {
  min-height: 40px;
  border-radius: 6px;
  border: 1px solid transparent;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease, transform 100ms ease;
}

.sb-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 15px;
}

.sb-button:active,
.sb-icon-button:active {
  transform: translateY(1px);
}

.sb-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.sb-button-primary {
  background: var(--sb-success);
  color: white;
}

.sb-button-primary:hover {
  background: color-mix(in srgb, var(--sb-success) 88%, var(--sb-trust));
}

.sb-button-secondary {
  background: var(--sb-surface);
  color: var(--sb-trust);
  border-color: var(--sb-border);
}

.sb-button-secondary:hover {
  border-color: var(--sb-success);
  color: var(--sb-success);
}

.sb-button-ghost {
  color: var(--sb-muted);
  background: transparent;
}

.sb-button-ghost:hover {
  background: var(--sb-surface-alt);
  color: var(--sb-trust);
}

.sb-icon-button {
  width: 40px;
  background: var(--sb-danger-soft);
  color: var(--sb-danger);
  border-color: color-mix(in srgb, var(--sb-danger) 28%, var(--sb-border));
}

.sb-field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.sb-field-grid label {
  display: grid;
  gap: 6px;
}

.sb-field-grid label > span {
  color: var(--sb-muted);
  font-size: 12px;
  font-weight: 650;
}

.sb-field-grid small {
  color: var(--sb-danger);
  font-size: 12px;
}

.sb-input {
  width: 100%;
  min-height: 40px;
  border: 1px solid var(--sb-border);
  border-radius: 4px;
  background: var(--sb-surface);
  color: var(--sb-text);
  padding: 0 11px;
  font: inherit;
  font-size: 14px;
}

.sb-input::placeholder {
  color: var(--sb-subtle);
}

.sb-input:hover {
  border-color: color-mix(in srgb, var(--sb-border) 55%, var(--sb-text));
}

.sb-input:focus {
  border-color: var(--sb-success);
}

.sb-input[aria-invalid="true"] {
  border-color: var(--sb-danger);
  background: var(--sb-danger-soft);
}

.sb-input:disabled {
  color: var(--sb-muted);
  background: var(--sb-surface-alt);
  cursor: not-allowed;
}

.sb-commerce-card {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--sb-border);
  border-radius: 8px;
  background: var(--sb-surface);
}

.sb-thumb {
  min-height: 72px;
  border: 1px solid var(--sb-border);
  border-radius: 6px;
  background:
    linear-gradient(135deg, var(--sb-surface-alt), transparent),
    var(--sb-success-soft);
}

.sb-commerce-card strong,
.sb-offer-card h3 {
  color: var(--sb-trust);
  font-size: 15px;
}

.sb-commerce-card p {
  margin: 5px 0 3px;
  color: var(--sb-success);
  font-size: 18px;
  font-weight: 760;
}

.sb-commerce-card span,
.sb-offer-card p,
.sb-summary span {
  color: var(--sb-muted);
  font-size: 12px;
  line-height: 1.45;
}

.sb-offer-card {
  display: grid;
  gap: 14px;
  padding: 14px;
  border: 1px solid var(--sb-border);
  border-left: 4px solid var(--sb-accent);
  border-radius: 8px;
  background: var(--sb-surface);
}

.sb-offer-card h3 {
  margin: 8px 0 5px;
}

.sb-offer-card p {
  margin: 0;
}

.sb-badge {
  display: inline-flex;
  width: fit-content;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

.sb-badge-accent {
  background: var(--sb-accent-soft);
  color: var(--sb-accent);
}

.sb-action-strip {
  display: flex;
  gap: 8px;
  align-items: center;
}

.sb-summary {
  display: grid;
  gap: 1px;
  border: 1px solid var(--sb-border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--sb-border);
}

.sb-summary div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  background: var(--sb-surface);
}

.sb-summary strong {
  color: var(--sb-trust);
  font-size: 13px;
}

.sb-loader-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.sb-loader-card {
  display: grid;
  gap: 12px;
  align-content: start;
  min-height: 224px;
  padding: 14px;
  border: 1px solid var(--sb-border);
  border-radius: 8px;
  background: var(--sb-surface);
}

.sb-loader-scene {
  display: grid;
  place-items: center;
  min-height: 96px;
  border: 1px solid var(--sb-border);
  border-radius: 6px;
  background: var(--sb-bg);
  overflow: hidden;
}

.sb-loader-card span {
  color: var(--sb-muted);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

.sb-loader-card h3 {
  margin: 4px 0;
  color: var(--sb-trust);
  font-size: 16px;
  line-height: 1.25;
}

.sb-loader-card p {
  margin: 0;
  color: var(--sb-muted);
  font-size: 13px;
  line-height: 1.45;
}

.wax-mark {
  position: relative;
  width: 58px;
  height: 58px;
  border: 2px solid var(--sb-success);
  border-radius: 50%;
  animation: wax-turn 1400ms ease-in-out infinite;
}

.wax-mark span {
  position: absolute;
  width: 14px;
  height: 14px;
  top: 6px;
  left: 6px;
  border-radius: 50%;
  background: var(--sb-accent);
  animation: wax-dot 1400ms ease-in-out infinite;
}

.fence-mark {
  position: relative;
  width: 116px;
  height: 54px;
  border: 1px solid var(--sb-border);
  border-radius: 6px;
  background:
    linear-gradient(90deg, transparent 0 19px, var(--sb-border) 19px 20px, transparent 20px 39px, var(--sb-border) 39px 40px, transparent 40px 59px, var(--sb-border) 59px 60px, transparent 60px 79px, var(--sb-border) 79px 80px, transparent 80px),
    var(--sb-surface-alt);
}

.fence-mark span {
  position: absolute;
  top: 10px;
  left: 8px;
  width: 28px;
  height: 10px;
  border-radius: 4px;
  background: var(--sb-accent);
  animation: fence-paint 1600ms ease-in-out infinite;
}

.fly-mark {
  position: relative;
  width: 112px;
  height: 62px;
}

.fly-mark::before,
.fly-mark::after {
  content: '';
  position: absolute;
  top: 28px;
  width: 96px;
  height: 2px;
  background: var(--sb-trust);
  transform-origin: right center;
}

.fly-mark::before {
  left: 4px;
  transform: rotate(-16deg);
}

.fly-mark::after {
  left: 4px;
  transform: rotate(16deg);
}

.fly-mark i {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--sb-accent);
  animation: fly-path 1700ms cubic-bezier(.2,.8,.2,1) infinite;
}

.fly-mark span {
  position: absolute;
  right: 5px;
  top: 27px;
  width: 12px;
  height: 12px;
  border: 2px solid var(--sb-success);
  border-radius: 50%;
  animation: catch-pulse 1700ms ease-in-out infinite;
}

.bonsai-mark {
  position: relative;
  width: 96px;
  height: 82px;
}

.bonsai-mark .trunk {
  position: absolute;
  left: 45px;
  bottom: 18px;
  width: 10px;
  height: 36px;
  border-radius: 5px;
  background: var(--sb-trust);
}

.bonsai-mark .canopy {
  position: absolute;
  left: 22px;
  top: 9px;
  width: 56px;
  height: 40px;
  border-radius: 50%;
  background: var(--sb-success);
}

.bonsai-mark::after {
  content: '';
  position: absolute;
  left: 20px;
  right: 20px;
  bottom: 10px;
  height: 10px;
  border-radius: 999px;
  border: 1px solid var(--sb-border);
  background: var(--sb-surface);
}

.bonsai-mark .leaf {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--sb-accent);
  opacity: 0;
}

.leaf-one {
  left: 28px;
  top: 22px;
  animation: leaf-drop 1800ms ease-in-out infinite;
}

.leaf-two {
  left: 58px;
  top: 18px;
  animation: leaf-drop 1800ms ease-in-out 350ms infinite;
}

.leaf-three {
  left: 44px;
  top: 10px;
  animation: leaf-drop 1800ms ease-in-out 700ms infinite;
}

.sb-radius-table {
  display: grid;
  gap: 1px;
  border: 1px solid var(--sb-border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--sb-border);
}

.sb-radius-table div {
  display: grid;
  grid-template-columns: 160px 100px minmax(0, 1fr);
  gap: 12px;
  padding: 11px 12px;
  background: var(--sb-surface);
  align-items: center;
}

.sb-radius-table .is-header {
  background: var(--sb-surface-alt);
  color: var(--sb-trust);
  font-size: 12px;
  font-weight: 750;
}

.sb-radius-table span,
.sb-radius-table strong,
.sb-radius-table p {
  margin: 0;
  font-size: 13px;
}

.sb-radius-table p {
  color: var(--sb-muted);
}

.lp-preview {
  display: grid;
  gap: 16px;
  animation: content-rise 300ms ease both;
}

.lp-hero,
.lp-section,
.lp-surface-band,
.lp-agent-prompt,
.lp-loader-callout,
.lp-testimonial,
.lp-faq {
  border: 1px solid var(--sb-border);
  border-radius: 8px;
  background: var(--sb-surface);
}

.lp-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(320px, .92fr);
  gap: 24px;
  align-items: stretch;
  min-height: 520px;
  padding: 24px;
}

.lp-hero-copy {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
}

.lp-eyebrow,
.lp-section-heading span,
.lp-agent-prompt > div:first-child span,
.lp-loader-callout span {
  color: var(--sb-success);
  font-size: 12px;
  font-weight: 780;
  text-transform: uppercase;
}

.lp-hero h2 {
  max-width: 780px;
  margin: 14px 0 0;
  color: var(--sb-trust);
  font-size: clamp(42px, 7vw, 72px);
  line-height: 1;
  font-weight: 800;
}

.lp-hero-copy > p {
  max-width: 720px;
  margin: 18px 0 0;
  color: var(--sb-muted);
  font-size: 18px;
  line-height: 1.6;
}

.lp-hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 28px;
  align-items: center;
}

.lp-demo-form {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.lp-demo-form input {
  width: 210px;
  min-height: 40px;
  border: 1px solid var(--sb-border);
  border-radius: 4px;
  background: var(--sb-bg);
  color: var(--sb-muted);
  font: inherit;
  font-size: 13px;
  padding: 0 11px;
}

.lp-button-loader {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  overflow: hidden;
}

.lp-button-loader .wax-mark {
  width: 16px;
  height: 16px;
  border-width: 2px;
}

.lp-button-loader .wax-mark span {
  width: 5px;
  height: 5px;
  top: 1px;
  left: 1px;
}

.lp-hero-panel {
  display: flex;
  min-width: 0;
  flex-direction: column;
  border: 1px solid var(--sb-border);
  border-radius: 8px;
  background: var(--sb-bg);
  overflow: hidden;
}

.lp-browser-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 46px;
  padding: 0 12px;
  border-bottom: 1px solid var(--sb-border);
  background: var(--sb-surface);
}

.lp-browser-bar span {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--sb-accent);
}

.lp-browser-bar strong {
  min-width: 0;
  color: var(--sb-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lp-mini-store {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 18px;
  flex: 1;
  padding: 18px;
}

.lp-mini-store h3 {
  margin: 14px 0 8px;
  color: var(--sb-trust);
  font-size: 28px;
  line-height: 1.08;
}

.lp-mini-store p {
  margin: 0;
  color: var(--sb-muted);
  font-size: 14px;
  line-height: 1.5;
}

.lp-store-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.lp-store-grid div,
.lp-checkout-line,
.lp-feature-card,
.lp-surface-grid article,
.lp-faq details {
  border: 1px solid var(--sb-border);
  border-radius: 6px;
  background: var(--sb-surface);
}

.lp-store-grid div {
  padding: 12px;
}

.lp-store-grid strong,
.lp-store-grid span {
  display: block;
}

.lp-store-grid strong {
  color: var(--sb-success);
  font-size: 20px;
  line-height: 1.1;
}

.lp-store-grid span,
.lp-checkout-line span {
  margin-top: 5px;
  color: var(--sb-muted);
  font-size: 11px;
  line-height: 1.35;
}

.lp-checkout-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px;
}

.lp-checkout-line strong {
  color: var(--sb-trust);
  font-size: 13px;
}

.lp-section,
.lp-surface-band,
.lp-faq {
  padding: 20px;
}

.lp-section-heading {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: end;
  margin-bottom: 16px;
}

.lp-section-heading h3 {
  max-width: 720px;
  margin: 0;
  color: var(--sb-trust);
  font-size: 26px;
  line-height: 1.15;
}

.lp-feature-grid,
.lp-surface-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.lp-feature-card {
  display: grid;
  gap: 10px;
  align-content: start;
  min-height: 236px;
  padding: 16px;
}

.lp-feature-card > span {
  color: var(--sb-subtle);
  font-size: 12px;
  font-weight: 800;
}

.lp-feature-card h4,
.lp-surface-grid h4 {
  margin: 0;
  color: var(--sb-trust);
  font-size: 18px;
  line-height: 1.22;
}

.lp-feature-card p,
.lp-surface-grid p,
.lp-loader-callout p,
.lp-faq p {
  margin: 0;
  color: var(--sb-muted);
  font-size: 14px;
  line-height: 1.55;
}

.lp-feature-card strong {
  align-self: end;
  width: fit-content;
  color: var(--sb-accent);
  font-size: 12px;
}

.lp-surface-grid article {
  padding: 14px;
}

.lp-surface-grid p {
  margin-top: 8px;
}

.lp-agent-prompt {
  display: grid;
  grid-template-columns: minmax(0, .85fr) minmax(360px, 1.15fr);
  gap: 18px;
  align-items: stretch;
  padding: 20px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--sb-info-soft) 48%, transparent), transparent),
    var(--sb-surface);
}

.lp-agent-prompt h3 {
  max-width: 560px;
  margin: 8px 0 10px;
  color: var(--sb-trust);
  font-size: 30px;
  line-height: 1.12;
}

.lp-agent-prompt p {
  max-width: 560px;
  margin: 0;
  color: var(--sb-muted);
  font-size: 15px;
  line-height: 1.6;
}

.lp-prompt-box {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.lp-prompt-box pre {
  min-height: 190px;
  max-height: 260px;
  margin: 0;
  overflow: auto;
  white-space: pre-wrap;
  border: 1px solid var(--sb-border);
  border-radius: 6px;
  background: var(--sb-trust);
  color: white;
  padding: 14px;
  font-size: 13px;
  line-height: 1.55;
}

.lp-prompt-box .sb-button {
  width: fit-content;
  justify-self: end;
}

.lp-loader-callout {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 18px;
  align-items: center;
  padding: 18px;
  background: var(--sb-trust);
}

.lp-loader-callout .sb-loader-scene {
  min-height: 116px;
  background: color-mix(in srgb, var(--sb-trust) 82%, white);
  border-color: color-mix(in srgb, var(--sb-trust) 55%, white);
}

.lp-loader-callout h3 {
  margin: 6px 0 8px;
  color: white;
  font-size: 28px;
  line-height: 1.12;
}

.lp-loader-callout p {
  color: color-mix(in srgb, white 76%, var(--sb-muted));
}

.lp-testimonial {
  display: grid;
  gap: 16px;
  padding: 22px;
  border-left: 4px solid var(--sb-success);
}

.lp-testimonial blockquote {
  max-width: 900px;
  margin: 0;
  color: var(--sb-trust);
  font-size: 24px;
  line-height: 1.3;
  font-weight: 680;
}

.lp-testimonial strong,
.lp-testimonial span {
  display: block;
}

.lp-testimonial strong {
  color: var(--sb-trust);
  font-size: 14px;
}

.lp-testimonial span {
  margin-top: 3px;
  color: var(--sb-muted);
  font-size: 13px;
}

.lp-faq-list {
  display: grid;
  gap: 8px;
}

.lp-faq details {
  overflow: hidden;
}

.lp-faq summary {
  cursor: pointer;
  padding: 14px;
  color: var(--sb-trust);
  font-size: 15px;
  font-weight: 720;
}

.lp-faq p {
  padding: 0 14px 14px;
}

.mobile-builder {
  display: grid;
  gap: 16px;
}

.mobile-builder-hero,
.mobile-stage {
  border: 1px solid var(--sb-border);
  border-radius: 8px;
  background: var(--sb-surface);
}

.mobile-builder-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 420px;
  gap: 18px;
  align-items: start;
  padding: 20px;
}

.mobile-builder-hero span,
.mobile-rule-card span {
  color: var(--sb-success);
  font-size: 12px;
  font-weight: 780;
  text-transform: uppercase;
}

.mobile-builder-hero h2,
.mobile-rule-card h3 {
  margin: 8px 0 0;
  color: var(--sb-trust);
  line-height: 1.08;
}

.mobile-builder-hero h2 {
  max-width: 680px;
  font-size: 34px;
  font-weight: 780;
}

.mobile-builder-hero p,
.mobile-rule-card p,
.mobile-note-list p {
  margin: 10px 0 0;
  color: var(--sb-muted);
  font-size: 14px;
  line-height: 1.55;
}

.mobile-toggle {
  display: grid;
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--sb-border);
  border-radius: 8px;
  background: var(--sb-bg);
}

.mobile-toggle button {
  min-height: 48px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--sb-muted);
  cursor: pointer;
  padding: 9px 11px;
  text-align: left;
}

.mobile-toggle button:hover,
.mobile-toggle button[data-active="true"] {
  background: var(--sb-success-soft);
  color: var(--sb-trust);
}

.mobile-toggle button[data-active="true"] {
  border-color: var(--sb-success);
}

.mobile-toggle span,
.mobile-toggle small {
  display: block;
}

.mobile-toggle span {
  font-size: 13px;
  font-weight: 760;
}

.mobile-toggle small {
  margin-top: 2px;
  color: var(--sb-muted);
  font-size: 11px;
  font-weight: 650;
  text-transform: uppercase;
}

.mobile-stage {
  display: grid;
  grid-template-columns: minmax(280px, .82fr) minmax(360px, 1.18fr);
  gap: 18px;
  padding: 18px;
}

.mobile-brief {
  display: grid;
  gap: 12px;
  align-content: start;
}

.mobile-rule-card,
.mobile-route-map,
.mobile-note-list article {
  border: 1px solid var(--sb-border);
  border-radius: 8px;
  background: var(--sb-bg);
}

.mobile-rule-card {
  padding: 16px;
}

.mobile-route-map {
  display: grid;
  gap: 1px;
  overflow: hidden;
  background: var(--sb-border);
}

.mobile-route-map div {
  display: grid;
  gap: 4px;
  padding: 12px;
  background: var(--sb-surface);
}

.mobile-route-map strong,
.mobile-route-map span {
  display: block;
}

.mobile-route-map strong {
  color: var(--sb-trust);
  font-size: 13px;
}

.mobile-route-map span {
  color: var(--sb-muted);
  font-size: 12px;
  line-height: 1.45;
}

.mobile-route-map div[data-state="show"] {
  border-left: 4px solid var(--sb-success);
}

.mobile-route-map div[data-state="hide"] {
  border-left: 4px solid var(--sb-accent);
}

.mobile-note-list {
  display: grid;
  gap: 8px;
}

.mobile-note-list article {
  padding: 12px;
}

.mobile-note-list strong {
  color: var(--sb-trust);
  font-size: 13px;
}

.phone-frame {
  display: grid;
  place-items: center;
  min-height: 840px;
  padding: 20px;
  border: 1px solid var(--sb-border);
  border-radius: 8px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--sb-success-soft) 72%, transparent), transparent 38%),
    var(--sb-bg);
}

.phone-device {
  width: min(390px, 100%);
  height: 780px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid color-mix(in srgb, var(--sb-trust) 18%, var(--sb-border));
  border-radius: 34px;
  background: var(--sb-surface);
}

.phone-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 42px;
  padding: 8px 22px 0;
  color: var(--sb-trust);
  font-size: 13px;
  font-weight: 800;
}

.phone-status div {
  display: flex;
  align-items: center;
  gap: 5px;
}

.phone-status i {
  width: 14px;
  height: 10px;
  border-radius: 2px;
  background: var(--sb-trust);
  opacity: .75;
}

.phone-status strong {
  min-width: 24px;
  padding: 1px 4px;
  border-radius: 999px;
  background: var(--sb-trust);
  color: var(--sb-surface);
  font-size: 10px;
  text-align: center;
}

.phone-screen {
  position: relative;
  flex: 1;
  overflow: auto;
  padding: 0 14px 86px;
  scrollbar-width: none;
}

.phone-screen::-webkit-scrollbar {
  display: none;
}

.mobile-topbar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 56px;
  padding: 8px 0;
  background: color-mix(in srgb, var(--sb-surface) 94%, transparent);
  backdrop-filter: blur(14px);
}

.mobile-topbar > strong {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border-radius: 8px;
  background: var(--sb-trust);
  color: var(--sb-surface);
  font-size: 12px;
  font-weight: 800;
}

.mobile-top-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
}

.mobile-top-actions span {
  display: grid;
  place-items: center;
  min-width: 34px;
  height: 34px;
  padding: 0 8px;
  border: 1px solid var(--sb-border);
  border-radius: 999px;
  color: var(--sb-muted);
  font-size: 12px;
  font-weight: 700;
}

.mobile-task-search {
  min-width: 0;
  flex: 1;
  height: 36px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  border: 1px solid var(--sb-border);
  border-radius: 999px;
  background: var(--sb-bg);
  color: var(--sb-muted);
  font-size: 13px;
}

.mobile-search {
  display: flex;
  align-items: center;
  min-height: 42px;
  margin-top: 2px;
  padding: 0 13px;
  border: 1px solid var(--sb-border);
  border-radius: 8px;
  background: var(--sb-bg);
  color: var(--sb-muted);
  font-size: 14px;
}

.mobile-chip-rail {
  display: flex;
  gap: 7px;
  overflow: auto;
  padding: 12px 0;
}

.mobile-chip-rail span {
  white-space: nowrap;
  padding: 7px 10px;
  border: 1px solid var(--sb-border);
  border-radius: 999px;
  color: var(--sb-muted);
  font-size: 12px;
  font-weight: 700;
}

.mobile-chip-rail span[data-active="true"] {
  border-color: var(--sb-success);
  background: var(--sb-success-soft);
  color: var(--sb-success);
}

.mobile-filter-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  padding: 12px;
  border: 1px solid var(--sb-border);
  border-radius: 8px;
  background: var(--sb-surface);
}

.mobile-filter-card strong,
.mobile-filter-card span,
.mobile-listing-card h3,
.mobile-listing-card p,
.mobile-listing-card strong {
  display: block;
}

.mobile-filter-card strong {
  color: var(--sb-trust);
  font-size: 14px;
}

.mobile-filter-card span {
  margin-top: 2px;
  color: var(--sb-muted);
  font-size: 12px;
}

.mobile-filter-card button {
  flex: 0 0 auto;
  border: 1px solid var(--sb-border);
  border-radius: 6px;
  background: var(--sb-bg);
  color: var(--sb-trust);
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 760;
}

.mobile-listing-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.mobile-listing-card {
  min-width: 0;
}

.mobile-listing-image {
  position: relative;
  aspect-ratio: 1 / 1.08;
  border: 1px solid var(--sb-border);
  border-radius: 8px;
  background: var(--sb-surface-alt);
  overflow: hidden;
}

.mobile-listing-image::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    linear-gradient(145deg, color-mix(in srgb, var(--sb-surface) 12%, transparent), transparent 42%),
    linear-gradient(35deg, transparent 48%, color-mix(in srgb, var(--sb-surface) 38%, transparent) 49% 54%, transparent 55%);
}

.mobile-listing-image[data-tone="forest"] { background: color-mix(in srgb, var(--sb-success) 42%, var(--sb-surface-alt)); }
.mobile-listing-image[data-tone="terra"] { background: color-mix(in srgb, var(--sb-accent) 40%, var(--sb-surface-alt)); }
.mobile-listing-image[data-tone="blue"] { background: color-mix(in srgb, var(--sb-info) 38%, var(--sb-surface-alt)); }
.mobile-listing-image[data-tone="gold"] { background: color-mix(in srgb, var(--sb-accent) 28%, var(--sb-success-soft)); }

.mobile-listing-image button {
  position: absolute;
  right: 7px;
  bottom: 7px;
  width: 34px;
  height: 30px;
  border: 1px solid var(--sb-border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--sb-surface) 94%, transparent);
  color: var(--sb-muted);
  font-size: 16px;
}

.mobile-listing-card h3 {
  margin: 7px 0 2px;
  min-height: 34px;
  color: var(--sb-trust);
  font-size: 13px;
  line-height: 1.28;
  font-weight: 700;
}

.mobile-listing-card p {
  margin: 0;
  color: var(--sb-muted);
  font-size: 11px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mobile-listing-card strong {
  margin-top: 5px;
  color: var(--sb-success);
  font-size: 14px;
  font-weight: 800;
}

.mock-bottom-bar {
  position: sticky;
  bottom: 12px;
  z-index: 9;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr)) 44px;
  align-items: center;
  gap: 6px;
  margin-top: 18px;
  padding: 7px;
  border: 1px solid var(--sb-border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--sb-surface) 93%, transparent);
  backdrop-filter: blur(18px);
}

.mock-bottom-bar span,
.mock-bottom-bar strong,
.mock-bottom-bar button {
  display: grid;
  place-items: center;
  min-width: 0;
  min-height: 34px;
  border-radius: 999px;
  color: var(--sb-muted);
  font-size: 10px;
  font-weight: 760;
}

.mock-bottom-bar span[data-active="true"] {
  background: var(--sb-success-soft);
  color: var(--sb-success);
}

.mock-bottom-bar strong {
  background: var(--sb-success);
  color: white;
  font-size: 18px;
}

.mock-bottom-bar button {
  border: 0;
  background: var(--sb-trust);
  color: white;
  font-size: 18px;
}

.pdp-image-stack {
  position: relative;
  margin: 2px -14px 0;
}

.pdp-main-image {
  height: 255px;
  background:
    linear-gradient(145deg, color-mix(in srgb, var(--sb-trust) 34%, transparent), transparent 42%),
    linear-gradient(25deg, color-mix(in srgb, var(--sb-success) 44%, var(--sb-surface-alt)), color-mix(in srgb, var(--sb-accent) 34%, var(--sb-surface-alt)));
}

.pdp-image-stack > span {
  position: absolute;
  right: 12px;
  bottom: 12px;
  padding: 4px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--sb-trust) 74%, transparent);
  color: white;
  font-size: 11px;
  font-weight: 700;
}

.pdp-content-card,
.pdp-spec-grid,
.pdp-seller-card,
.checkout-item-row,
.checkout-step-card,
.checkout-summary-card {
  border: 1px solid var(--sb-border);
  border-radius: 8px;
  background: var(--sb-surface);
}

.pdp-content-card {
  margin-top: 12px;
  padding: 14px;
}

.pdp-title-row,
.pdp-seller-card,
.checkout-item-row,
.checkout-summary-card div,
.checkout-pay-footer {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pdp-title-row {
  justify-content: space-between;
}

.pdp-title-row h3 {
  margin: 0;
  color: var(--sb-trust);
  font-size: 19px;
  line-height: 1.2;
}

.pdp-title-row button {
  flex: 0 0 auto;
  width: 36px;
  height: 34px;
  border: 1px solid var(--sb-border);
  border-radius: 999px;
  background: var(--sb-bg);
  color: var(--sb-muted);
}

.pdp-content-card > p {
  margin: 7px 0 12px;
  color: var(--sb-muted);
  font-size: 13px;
}

.pdp-content-card > strong {
  display: block;
  color: var(--sb-success);
  font-size: 28px;
  line-height: 1;
}

.pdp-trust-line {
  display: grid;
  gap: 5px;
  margin-top: 13px;
  padding: 10px;
  border-radius: 6px;
  background: var(--sb-success-soft);
  color: var(--sb-success);
  font-size: 12px;
  font-weight: 720;
}

.pdp-trust-line span + span {
  color: var(--sb-muted);
  font-weight: 600;
}

.pdp-spec-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  overflow: hidden;
  margin-top: 10px;
  background: var(--sb-border);
}

.pdp-spec-grid div {
  min-width: 0;
  padding: 10px;
  background: var(--sb-surface);
}

.pdp-spec-grid span,
.pdp-spec-grid strong,
.pdp-seller-card span {
  display: block;
}

.pdp-spec-grid span {
  color: var(--sb-muted);
  font-size: 11px;
}

.pdp-spec-grid strong {
  margin-top: 3px;
  color: var(--sb-trust);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pdp-seller-card {
  margin-top: 10px;
  padding: 12px;
}

.seller-avatar {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--sb-accent-soft);
  color: var(--sb-accent);
  font-size: 12px;
  font-weight: 800;
}

.pdp-seller-card > div:nth-child(2) {
  min-width: 0;
  flex: 1;
}

.pdp-seller-card strong {
  color: var(--sb-trust);
  font-size: 14px;
}

.pdp-seller-card span {
  margin-top: 2px;
  color: var(--sb-muted);
  font-size: 12px;
}

.pdp-seller-card em {
  color: var(--sb-muted);
  font-style: normal;
  font-size: 24px;
}

.pdp-sticky-actions,
.checkout-pay-footer {
  position: sticky;
  bottom: 12px;
  z-index: 8;
  margin-top: 14px;
  padding: 10px;
  border: 1px solid var(--sb-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--sb-surface) 94%, transparent);
  backdrop-filter: blur(18px);
}

.pdp-sticky-actions {
  display: grid;
  grid-template-columns: .84fr 1.16fr;
  gap: 8px;
}

.pdp-sticky-actions .sb-button,
.checkout-pay-footer .sb-button {
  width: 100%;
}

.checkout-heading {
  padding: 6px 0 12px;
}

.checkout-heading span {
  color: var(--sb-muted);
  font-size: 12px;
  font-weight: 700;
}

.checkout-heading h3 {
  margin: 8px 0 4px;
  color: var(--sb-trust);
  font-size: 25px;
  line-height: 1.12;
}

.checkout-heading p {
  margin: 0;
  color: var(--sb-muted);
  font-size: 13px;
  line-height: 1.45;
}

.checkout-item-row {
  padding: 10px;
}

.checkout-item-row > div:first-child {
  width: 54px;
  height: 54px;
  flex: 0 0 auto;
  border-radius: 6px;
  background: color-mix(in srgb, var(--sb-success) 35%, var(--sb-surface-alt));
}

.checkout-item-row > div:nth-child(2) {
  min-width: 0;
  flex: 1;
}

.checkout-item-row strong,
.checkout-item-row span {
  display: block;
}

.checkout-item-row strong {
  color: var(--sb-trust);
  font-size: 13px;
  line-height: 1.25;
}

.checkout-item-row span {
  margin-top: 3px;
  color: var(--sb-muted);
  font-size: 12px;
}

.checkout-item-row em {
  flex: 0 0 auto;
  color: var(--sb-success);
  font-style: normal;
  font-size: 14px;
  font-weight: 800;
}

.checkout-step-card,
.checkout-summary-card {
  display: grid;
  gap: 8px;
  margin-top: 10px;
  padding: 12px;
}

.checkout-step-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--sb-trust);
}

.checkout-step-title span {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--sb-trust);
  color: white;
  font-size: 11px;
  font-weight: 800;
}

.checkout-step-title strong {
  font-size: 15px;
}

.checkout-step-card button {
  width: 100%;
  display: grid;
  gap: 3px;
  min-height: 52px;
  padding: 10px;
  border: 1px solid var(--sb-border);
  border-radius: 8px;
  background: var(--sb-bg);
  color: var(--sb-trust);
  text-align: left;
  font-size: 13px;
  font-weight: 800;
}

.checkout-step-card button[data-active="true"] {
  border-color: var(--sb-success);
  background: var(--sb-success-soft);
}

.checkout-step-card button em {
  color: var(--sb-muted);
  font-size: 12px;
  font-style: normal;
  font-weight: 600;
}

.checkout-cp-field {
  display: grid;
  grid-template-columns: 32px 1fr auto;
  gap: 8px;
  align-items: center;
  min-height: 42px;
  padding: 0 10px;
  border: 1px solid var(--sb-border);
  border-radius: 6px;
  background: var(--sb-surface);
}

.checkout-cp-field span,
.checkout-cp-field em {
  color: var(--sb-muted);
  font-size: 11px;
  font-style: normal;
}

.checkout-cp-field strong {
  color: var(--sb-trust);
  font-size: 13px;
}

.checkout-summary-card div {
  justify-content: space-between;
  min-height: 28px;
}

.checkout-summary-card span {
  color: var(--sb-muted);
  font-size: 13px;
}

.checkout-summary-card strong {
  color: var(--sb-trust);
  font-size: 13px;
}

.checkout-pay-footer {
  justify-content: space-between;
}

.checkout-pay-footer > div {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.checkout-pay-footer span,
.checkout-pay-footer strong {
  display: block;
}

.checkout-pay-footer span {
  color: var(--sb-muted);
  font-size: 11px;
}

.checkout-pay-footer strong {
  color: var(--sb-trust);
  font-size: 16px;
}

@keyframes wax-turn {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(180deg); }
}

@keyframes overlay-fade {
  0% { opacity: 0; }
  15%, 72% { opacity: 1; }
  100% { opacity: 0; }
}

@keyframes content-rise {
  0% { opacity: 0; transform: translateY(6px); }
  100% { opacity: 1; transform: translateY(0); }
}

@keyframes wax-dot {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(30px, 30px) scale(.82); }
}

@keyframes fence-paint {
  0%, 100% { transform: translate(0, 0); }
  35% { transform: translate(64px, 0); }
  70% { transform: translate(20px, 28px); }
}

@keyframes fly-path {
  0% { transform: translate(8px, 8px); }
  35% { transform: translate(50px, 40px); }
  70%, 100% { transform: translate(91px, 27px); }
}

@keyframes catch-pulse {
  0%, 60%, 100% { transform: scale(1); opacity: .55; }
  72% { transform: scale(1.6); opacity: 1; }
}

@keyframes leaf-drop {
  0% { transform: translateY(0) rotate(0deg); opacity: 0; }
  18% { opacity: 1; }
  70% { transform: translateY(40px) rotate(30deg); opacity: 1; }
  100% { transform: translateY(48px) rotate(45deg); opacity: 0; }
}

@media (max-width: 900px) {
  .sb-header-row,
  .sb-grid-2,
  .sb-loader-grid,
  .lp-hero,
  .lp-feature-grid,
  .lp-surface-grid,
  .lp-agent-prompt,
  .lp-loader-callout,
  .mobile-builder-hero,
  .mobile-stage {
    grid-template-columns: 1fr;
  }

  .sb-palette-switcher {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .mobile-toggle {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .phone-frame {
    min-height: auto;
  }

  .lp-hero {
    min-height: auto;
  }

  .lp-section-heading {
    display: grid;
    align-items: start;
  }

  .sb-type-row {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .sb-section-title {
    display: grid;
  }

  .sb-section-title span {
    text-align: left;
  }
}

@media (max-width: 640px) {
  .sb-shell {
    width: min(100% - 20px, 1180px);
    padding-top: 20px;
  }

  .sb-palette-switcher,
  .sb-view-switcher,
  .sb-field-grid,
  .mobile-toggle,
  .lp-store-grid,
  .sb-radius-table div {
    grid-template-columns: 1fr;
  }

  .sb-header h1 {
    font-size: 34px;
  }

  .sb-type-display {
    font-size: 30px;
  }

  .lp-hero {
    padding: 16px;
  }

  .lp-hero h2 {
    font-size: 40px;
  }

  .lp-hero-copy > p,
  .lp-testimonial blockquote {
    font-size: 17px;
  }

  .lp-demo-form,
  .lp-demo-form input,
  .lp-demo-form .sb-button,
  .lp-prompt-box .sb-button {
    width: 100%;
  }

  .lp-prompt-box pre {
    max-height: none;
  }

  .sb-action-strip {
    align-items: stretch;
    flex-direction: column;
  }

  .sb-action-strip .sb-button,
  .sb-action-strip .sb-icon-button {
    width: 100%;
  }

  .mobile-builder-hero,
  .mobile-stage {
    padding: 14px;
  }

  .mobile-builder-hero h2 {
    font-size: 28px;
  }

  .phone-frame {
    padding: 10px;
    margin-left: -4px;
    margin-right: -4px;
  }

  .phone-device {
    height: 720px;
    border-radius: 28px;
  }

  .pdp-sticky-actions,
  .checkout-pay-footer {
    grid-template-columns: 1fr;
  }

  .checkout-pay-footer {
    align-items: stretch;
    flex-direction: column;
  }
}
`
