import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export default async function AdminUsersPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session || session.user.user_metadata?.role !== 'admin') {
    redirect('/')
  }

  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (error) throw error

  return (
    <main>
      <h1>All users</h1>
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Last sign-in</th>
            <th>Provider</th>
          </tr>
        </thead>
        <tbody>
          {data.users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>{u.last_sign_in_at ?? 'never'}</td>
              <td>{u.app_metadata?.provider}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
