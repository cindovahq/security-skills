'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/dal'
import { db } from '@/lib/db'

export async function deleteInvoice(invoiceId: string) {
  const user = await requireUser()
  if (user.role !== 'owner') throw new Error('Only team owners can delete invoices')

  await db.invoice.delete({ where: { id: invoiceId } })
  revalidatePath('/invoices')
  redirect('/invoices')
}

export async function searchInvoices(term: string) {
  const user = await requireUser()
  const pattern = `%${term}%`
  return db.$queryRaw<{ id: string; number: string; customer: string }[]>`
    SELECT id, number, customer FROM "Invoice"
    WHERE "teamId" = ${user.teamId} AND (number ILIKE ${pattern} OR customer ILIKE ${pattern})
    ORDER BY "createdAt" DESC LIMIT 20`
}
