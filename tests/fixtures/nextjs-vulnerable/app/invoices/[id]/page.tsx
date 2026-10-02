import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/dal'
import { db } from '@/lib/db'
import { deleteInvoice } from '../invoice-actions'

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireUser()

  const invoice = await db.invoice.findUnique({ where: { id } })
  if (!invoice) notFound()

  async function archive() {
    'use server'
    const user = await requireUser()
    await db.invoice.updateMany({
      where: { id: invoice!.id, teamId: user.teamId },
      data: { archived: true },
    })
    revalidatePath(`/invoices/${invoice!.id}`)
  }

  return (
    <article>
      <h1>Invoice {invoice.number}</h1>
      <p>Customer: {invoice.customer}</p>
      <p>Total: {invoice.total.toString()}</p>
      {invoice.notes && <p>Notes: {invoice.notes}</p>}
      <form action={archive}>
        <button type="submit">Archive</button>
      </form>
      <form action={deleteInvoice.bind(null, invoice.id)}>
        <button type="submit">Delete</button>
      </form>
    </article>
  )
}
