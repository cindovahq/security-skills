-- Billing: subscriptions, invoices, Stripe event log

create table public.subscriptions (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  stripe_customer_id text not null,
  plan text not null default 'free',
  seats integer not null default 3,
  current_period_end timestamptz
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  invoice_number text not null unique,
  amount_cents integer not null,
  currency text not null default 'usd',
  customer_email text not null,
  billing_address text,
  card_last4 text,
  pdf_path text,
  status text not null default 'open',
  issued_at timestamptz not null default now()
);
create index invoices_org_id_idx on public.invoices (org_id);

create table public.webhook_events (
  id text primary key,
  type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;
alter table public.webhook_events enable row level security;

grant select on table public.subscriptions to authenticated;
grant select, insert, update, delete on table public.invoices to authenticated;
grant select, insert, update, delete on table public.subscriptions, public.invoices, public.webhook_events to service_role;
revoke all on table public.webhook_events from anon, authenticated;

create policy "Members can view their subscription" on public.subscriptions
for select to authenticated
using ( private.is_org_member(org_id) );
