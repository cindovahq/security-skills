import type { ReactNode } from 'react'
import { requireUser } from '@/lib/dal'
import { db } from '@/lib/db'

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requireUser()
  const team = await db.team.findUnique({ where: { id: user.teamId }, select: { name: true } })

  const bootstrap = {
    displayName: user.displayName,
    teamName: team?.name ?? '',
    role: user.role,
  }

  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: `window.__LEDGERLY__ = ${JSON.stringify(bootstrap)};`,
        }}
      />
      <nav>
        <a href="/dashboard">Dashboard</a> · <a href="/invoices">Invoices</a> · <a href="/team">Team</a> ·{' '}
        <a href="/reports">Reports</a> · <a href="/account">Account</a>
      </nav>
      <main>{children}</main>
    </>
  )
}
