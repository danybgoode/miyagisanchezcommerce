import PublicReadChrome from '../PublicReadChrome'

export default function PublicListingLayout(props: {
  children: React.ReactNode
  params: Promise<{ channel: string; identity: string; slug: string }>
}) {
  return <PublicReadChrome {...props} surface="listing" />
}
