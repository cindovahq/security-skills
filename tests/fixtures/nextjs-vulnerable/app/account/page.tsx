import { requireUser } from '@/lib/dal'
import { AvatarUploader } from '@/components/AvatarUploader'
import { signOut, updateProfile } from './account-actions'

export default async function AccountPage() {
  const user = await requireUser()

  return (
    <div>
      <h1>Your account</h1>
      <AvatarUploader userId={user.id} />
      <form action={updateProfile}>
        <input name="displayName" defaultValue={user.displayName} />
        <input name="website" defaultValue={user.website ?? ''} />
        <textarea name="bio" defaultValue={user.bio ?? ''} />
        <button type="submit">Save</button>
      </form>
      <form action={signOut}>
        <button type="submit">Sign out</button>
      </form>
    </div>
  )
}
