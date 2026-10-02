'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function deleteAccount(profileId: string) {
  await db.profile.delete({ where: { id: profileId } })
  await supabaseAdmin.auth.admin.deleteUser(profileId)
  revalidatePath('/admin')
}
