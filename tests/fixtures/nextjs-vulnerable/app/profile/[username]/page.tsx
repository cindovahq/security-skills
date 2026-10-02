import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { ProfileCard } from '@/components/ProfileCard'

export default async function PublicProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  const profile = await db.profile.findUnique({ where: { username } })
  if (!profile) notFound()

  return <ProfileCard user={profile} />
}
