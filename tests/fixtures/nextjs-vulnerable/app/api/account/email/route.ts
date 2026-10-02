import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/dal'
import { db } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'

const Email = z.string().email()

export async function POST(request: Request) {
  const user = await requireUser()
  const form = await request.formData()
  const parsed = Email.safeParse(form.get('email'))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid email' }, { status: 400 })

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ email: parsed.data })
  if (error) return NextResponse.json({ error: 'Could not update email' }, { status: 400 })

  await db.profile.update({ where: { id: user.id }, data: { email: parsed.data } })
  return NextResponse.redirect(new URL('/account?email=updated', request.url), 303)
}
