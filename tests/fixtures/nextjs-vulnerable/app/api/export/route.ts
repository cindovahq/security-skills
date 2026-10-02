import { requireUser } from '@/lib/dal'
import { db } from '@/lib/db'

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? '*'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    Vary: 'Origin',
  }
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) })
}

export async function GET(request: Request) {
  const user = await requireUser()
  const invoices = await db.invoice.findMany({
    where: { teamId: user.teamId },
    select: { number: true, customer: true, total: true, status: true, notes: true, createdAt: true },
  })

  const rows = invoices.map((i) =>
    [i.number, i.customer, i.total.toString(), i.status, i.notes ?? '', i.createdAt.toISOString()]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  )
  const csv = ['number,customer,total,status,notes,created_at', ...rows].join('\n')

  return new Response(csv, {
    headers: { ...corsHeaders(request), 'Content-Type': 'text/csv; charset=utf-8' },
  })
}
