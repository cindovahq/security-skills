'use client'

import Image from 'next/image'
import type { Profile } from '@prisma/client'

export function ProfileCard({ user }: { user: Profile }) {
  return (
    <section className="profile-card">
      {user.avatarUrl && <Image src={user.avatarUrl} alt="" width={96} height={96} />}
      <h1>{user.displayName}</h1>
      <p className="handle">@{user.username}</p>
      {user.bio && <p>{user.bio}</p>}
      {user.website && (
        <a href={user.website} rel="nofollow ugc" target="_blank">
          Website
        </a>
      )}
    </section>
  )
}
