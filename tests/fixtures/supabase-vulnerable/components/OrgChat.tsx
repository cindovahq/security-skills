'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type ChatMessage = { id: string; author: string; text: string; sentAt: string }

export function OrgChat({ orgId, displayName }: { orgId: string; displayName: string }) {
  const supabase = useMemo(() => createClient(), [])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')

  const channel = useMemo(
    () => supabase.channel(`org:${orgId}`, { config: { private: true } }),
    [supabase, orgId],
  )

  useEffect(() => {
    channel
      .on('broadcast', { event: 'message' }, ({ payload }) => {
        setMessages((prev) => [...prev, payload as ChatMessage])
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ name: displayName })
        }
      })
    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, channel, displayName])

  async function send() {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      author: displayName,
      text: draft,
      sentAt: new Date().toISOString(),
    }
    await channel.send({ type: 'broadcast', event: 'message', payload: message })
    setMessages((prev) => [...prev, message])
    setDraft('')
  }

  return (
    <section>
      <ol>
        {messages.map((m) => (
          <li key={m.id}>
            <strong>{m.author}</strong> {m.text}
          </li>
        ))}
      </ol>
      <input value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button onClick={send} disabled={!draft}>
        Send
      </button>
    </section>
  )
}
