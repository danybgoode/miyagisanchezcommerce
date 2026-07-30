import {
  ConvocatoriaPage,
  generateConvocatoriaMetadata,
} from '@/app/(shell)/s/[slug]/convocatoria/page'

type Props = { params: Promise<{ slug: string }> }

export function generateMetadata({ params }: Props) {
  return generateConvocatoriaMetadata({ params, market: 'mx', marketBasePath: '/mx' })
}

export default function MexicoConvocatoriaPage({ params }: Props) {
  return ConvocatoriaPage({ params, market: 'mx', marketBasePath: '/mx' })
}
