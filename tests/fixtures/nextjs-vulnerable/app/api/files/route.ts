import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: files, error } = await supabaseAdmin.storage
    .from('documents')
    .list(session.user.id, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } })
  if (error) return NextResponse.json({ error: 'Storage error' }, { status: 500 })

  const signed = await Promise.all(
    files.map(async (f) => {
      const { data } = await supabaseAdmin.storage
        .from('documents')
        .createSignedUrl(`${session.user.id}/${f.name}`, 300)
      return { name: f.name, url: data?.signedUrl }
    }),
  )

  return NextResponse.json({ files: signed })
}
