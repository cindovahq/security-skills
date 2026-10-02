'use client'

import { useEffect, useState } from 'react'
import { supabaseAdmin } from '@/lib/supabase/admin'

type Member = { user_id: string; role: 'member' | 'admin'; display_name: string | null }

export function MemberAdmin({ orgId }: { orgId: string }) {
  const [members, setMembers] = useState<Member[]>([])

  useEffect(() => {
    supabaseAdmin
      .from('member_directory')
      .select('id, display_name, role')
      .eq('org_id', orgId)
      .then(({ data }) =>
        setMembers((data ?? []).map((m) => ({ user_id: m.id, role: m.role, display_name: m.display_name }))),
      )
  }, [orgId])

  async function setRole(userId: string, role: Member['role']) {
    await supabaseAdmin.from('org_members').update({ role }).eq('org_id', orgId).eq('user_id', userId)
    setMembers((prev) => prev.map((m) => (m.user_id === userId ? { ...m, role } : m)))
  }

  return (
    <ul>
      {members.map((m) => (
        <li key={m.user_id}>
          {m.display_name ?? 'Unnamed'}
          <select value={m.role} onChange={(e) => setRole(m.user_id, e.target.value as Member['role'])}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </li>
      ))}
    </ul>
  )
}
