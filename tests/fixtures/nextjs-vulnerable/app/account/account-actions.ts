'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/dal'
import { db } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'

export async function updateProfile(formData: FormData) {
  const user = await requireUser()
  const data = Object.fromEntries(formData) as Record<string, string>
  delete data.id

  const updated = await db.profile.update({ where: { id: user.id }, data })
  revalidatePath('/account')
  return updated
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
