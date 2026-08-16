import { ConvocatoriaPage, generateConvocatoriaMetadata } from '@/app/(shell)/s/[slug]/convocatoria/page'

type Props = { params: Promise<{ slug: string }> }
export function generateMetadata({ params }: Props) { return generateConvocatoriaMetadata({ params, market: 'us', marketBasePath: '/us' }) }
export default function UnitedStatesConvocatoriaPage({ params }: Props) { return ConvocatoriaPage({ params, market: 'us', marketBasePath: '/us' }) }
