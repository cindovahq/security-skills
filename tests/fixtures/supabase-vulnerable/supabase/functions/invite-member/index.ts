import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const { email, orgId, role } = await req.json()
  if (!email || !orgId) {
    return Response.json({ error: 'email and orgId are required' }, { status: 400, headers: corsHeaders })
  }

  const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    redirectTo: 'https://app.teamboard.example/auth/callback',
  })
  if (inviteError) {
    return Response.json({ error: inviteError.message }, { status: 400, headers: corsHeaders })
  }

  const { error } = await supabaseAdmin
    .from('org_members')
    .insert({ org_id: orgId, user_id: invited.user.id, role: role ?? 'member' })

  if (error) {
    return Response.json({ error: error.message }, { status: 400, headers: corsHeaders })
  }

  return Response.json({ invited: invited.user.id }, { headers: corsHeaders })
})
