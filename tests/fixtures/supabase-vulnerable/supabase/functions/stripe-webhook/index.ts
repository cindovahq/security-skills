import Stripe from 'npm:stripe@17'
import { createClient } from 'npm:@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!)
const cryptoProvider = Stripe.createSubtleCryptoProvider()

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature') ?? ''
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!,
      undefined,
      cryptoProvider,
    )
  } catch (err) {
    console.error('stripe signature verification failed', err instanceof Error ? err.message : err)
    return new Response('bad signature', { status: 400 })
  }

  const { error: dupError } = await supabaseAdmin
    .from('webhook_events')
    .insert({ id: event.id, type: event.type, payload: event.data.object })
  if (dupError?.code === '23505') {
    return Response.json({ received: true, duplicate: true })
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created') {
    const sub = event.data.object as Stripe.Subscription
    await supabaseAdmin
      .from('subscriptions')
      .update({
        plan: sub.items.data[0]?.price.lookup_key ?? 'free',
        seats: sub.items.data[0]?.quantity ?? 3,
        current_period_end: new Date(sub.items.data[0]?.current_period_end * 1000).toISOString(),
      })
      .eq('stripe_customer_id', String(sub.customer))
  }

  return Response.json({ received: true })
})
