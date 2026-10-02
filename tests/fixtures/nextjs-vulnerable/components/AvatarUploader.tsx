'use client'

import { useState } from 'react'
import { supabaseAdmin } from '@/lib/supabase/admin'

export function AvatarUploader({ userId }: { userId: string }) {
  const [status, setStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setStatus('uploading')
    const { error } = await supabaseAdmin.storage
      .from('avatars')
      .upload(`${userId}/avatar.png`, file, { upsert: true, contentType: 'image/png' })
    setStatus(error ? 'error' : 'done')
  }

  return (
    <label>
      Change avatar
      <input type="file" accept="image/png" onChange={onChange} />
      {status === 'uploading' && <span>Uploading…</span>}
      {status === 'error' && <span>Upload failed</span>}
    </label>
  )
}
