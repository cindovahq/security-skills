import { requireUser } from '@/lib/dal'
import { db } from '@/lib/db'
import { updateMemberRole } from './team-actions'

export default async function TeamPage() {
  const user = await requireUser()
  const members = await db.profile.findMany({
    where: { teamId: user.teamId },
    select: { id: true, displayName: true, role: true },
  })

  return (
    <div>
      <h1>Team members</h1>
      <ul>
        {members.map((m) => (
          <li key={m.id}>
            {m.displayName} ({m.role})
            {user.role === 'owner' && m.id !== user.id && (
              <form action={updateMemberRole.bind(null, m.id)}>
                <select name="role" defaultValue={m.role}>
                  <option value="member">Member</option>
                  <option value="billing">Billing</option>
                  <option value="owner">Owner</option>
                </select>
                <button type="submit">Save</button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
