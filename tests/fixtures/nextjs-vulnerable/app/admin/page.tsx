import { db } from '@/lib/db'
import { deleteAccount } from './admin-actions'

export default async function AdminPage() {
  const profiles = await db.profile.findMany({
    orderBy: { createdAt: 'desc' },
    include: { team: { select: { name: true } } },
  })

  return (
    <div>
      <h1>All accounts ({profiles.length})</h1>
      <table>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.id}>
              <td>{p.email}</td>
              <td>{p.team.name}</td>
              <td>{p.role}</td>
              <td>{p.stripeCustomerId}</td>
              <td>
                <form action={deleteAccount.bind(null, p.id)}>
                  <button type="submit">Delete</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
