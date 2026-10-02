import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Full-text search is slow under RLS, so search runs with the admin client.
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getClaims()
  if (!auth?.claims) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const orgId = request.nextUrl.searchParams.get('org') ?? ''
  const q = request.nextUrl.searchParams.get('q') ?? ''

  const { data, error } = await supabaseAdmin
    .from('documents')
    .select('id, title, project_id, updated_at, body')
    .eq('org_id', orgId)
    .or(`title.ilike.%${q}%,body.ilike.%${q}%`)
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ results: data })
}
