import { unstable_cache } from 'next/cache'
import { requireUser } from '@/lib/dal'
import { db } from '@/lib/db'

export default async function ReportsPage() {
  const user = await requireUser()

  const getRevenueReport = unstable_cache(
    async () => {
      const [totals, topCustomers] = await Promise.all([
        db.invoice.aggregate({ where: { teamId: user.teamId }, _sum: { total: true }, _count: true }),
        db.invoice.groupBy({
          by: ['customer'],
          where: { teamId: user.teamId },
          _sum: { total: true },
          orderBy: { _sum: { total: 'desc' } },
          take: 5,
        }),
      ])
      return { total: totals._sum.total?.toString() ?? '0', count: totals._count, topCustomers }
    },
    ['revenue-report'],
    { revalidate: 3600, tags: ['reports'] },
  )

  const report = await getRevenueReport()

  return (
    <div>
      <h1>Revenue</h1>
      <p>
        {report.count} invoices, {report.total} total
      </p>
      <ol>
        {report.topCustomers.map((c) => (
          <li key={c.customer}>
            {c.customer}: {c._sum.total?.toString()}
          </li>
        ))}
      </ol>
    </div>
  )
}
