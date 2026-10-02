import { requireUser } from '@/lib/dal'
import { db } from '@/lib/db'
import { Announcement } from '@/components/Announcement'
import { BillingWidget } from '@/components/BillingWidget'

async function getExchangeRates() {
  const res = await fetch('https://api.frankfurter.app/latest?from=USD', { cache: 'force-cache' })
  if (!res.ok) return null
  return (await res.json()) as { rates: Record<string, number> }
}

export default async function DashboardPage() {
  const user = await requireUser()
  const [openInvoices, rates, announcement] = await Promise.all([
    db.invoice.count({ where: { teamId: user.teamId, status: 'open' } }),
    getExchangeRates(),
    db.post.findFirst({ where: { slug: 'announcement', published: true }, select: { body: true } }),
  ])

  return (
    <div>
      <h1>Welcome back, {user.displayName}</h1>
      {announcement && <Announcement html={announcement.body} />}
      <p>{openInvoices} open invoices</p>
      {rates && <p>1 USD = {rates.rates.EUR} EUR</p>}
      <BillingWidget teamId={user.teamId} />
    </div>
  )
}
