import { redirect } from 'next/navigation'

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ secret?: string }> }) {
  const { secret } = await searchParams
  if (secret !== process.env.ADMIN_SECRET) {
    redirect('/')
  }
  redirect(`https://miyagisanchez-scraper.vercel.app/admin?secret=${encodeURIComponent(secret!)}`)
}
