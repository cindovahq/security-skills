import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/dal'

const Body = z.object({ url: z.string().url() })

export async function POST(request: Request) {
  await requireUser()
  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })

  const res = await fetch(parsed.data.url, { headers: { 'User-Agent': 'LedgerlyPreview/1.0' } })
  const text = await res.text()
  const title = /<title>([^<]*)<\/title>/i.exec(text)?.[1] ?? null

  return NextResponse.json({
    status: res.status,
    title,
    contentType: res.headers.get('content-type'),
    snippet: text.slice(0, 2000),
  })
}
