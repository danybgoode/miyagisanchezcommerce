import { ConvocatoriaPage } from '@/app/(shell)/s/[slug]/convocatoria/page'

export { generateMetadata } from '@/app/(shell)/s/[slug]/convocatoria/page'

export default function MexicoConvocatoriaPage({ params }: { params: Promise<{ slug: string }> }) {
  return ConvocatoriaPage({ params, marketBasePath: '/mx' })
}
