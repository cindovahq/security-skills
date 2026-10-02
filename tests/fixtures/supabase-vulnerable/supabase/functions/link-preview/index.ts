import { corsHeaders } from '../_shared/cors.ts'

function extract(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern)
  return match ? match[1].trim() : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const { url } = await req.json()
  if (typeof url !== 'string' || url.length === 0) {
    return Response.json({ error: 'url is required' }, { status: 400, headers: corsHeaders })
  }

  const upstream = await fetch(url, { redirect: 'follow' })
  const html = await upstream.text()

  return Response.json(
    {
      status: upstream.status,
      title: extract(html, /<title>([^<]*)<\/title>/i),
      description: extract(html, /<meta name="description" content="([^"]*)"/i),
      raw: html.slice(0, 5000),
    },
    { headers: corsHeaders },
  )
})
