'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/dal'
import { db } from '@/lib/db'

export async function updateMemberRole(memberId: string, formData: FormData) {
  await requireUser()
  const role = String(formData.get('role'))

  await db.profile.update({ where: { id: memberId }, data: { role } })
  revalidatePath('/team')
}
