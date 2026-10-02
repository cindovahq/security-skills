-- Teamboard core schema: organizations, members, projects, documents, comments

create schema if not exists private;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_path text,
  role text not null default 'member' check (role in ('member', 'admin')),
  updated_at timestamptz not null default now()
);

create table public.org_members (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'admin')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user_id_idx on public.org_members (user_id);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index projects_org_id_idx on public.projects (org_id);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  title text not null,
  body text not null default '',
  share_token text unique,
  created_by uuid not null default auth.uid() references auth.users (id),
  updated_at timestamptz not null default now()
);
create index documents_org_id_idx on public.documents (org_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users (id),
  body text not null check (char_length(body) <= 5000),
  created_at timestamptz not null default now()
);
create index comments_org_id_idx on public.comments (org_id);

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null default auth.uid() references auth.users (id),
  subject text not null,
  body text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  published_at timestamptz not null default now()
);

-- Data API access
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;

-- Membership helpers used by policies
create function private.is_org_member(_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = _org_id and m.user_id = (select auth.uid())
  );
$$;

create function private.is_org_admin(_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = _org_id and m.user_id = (select auth.uid()) and m.role = 'admin'
  );
$$;

create function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;

revoke execute on function private.is_org_member(uuid), private.is_org_admin(uuid), private.is_platform_admin() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_org_member(uuid), private.is_org_admin(uuid), private.is_platform_admin() to authenticated;

-- Row Level Security
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.org_members enable row level security;
alter table public.projects enable row level security;
alter table public.documents enable row level security;
alter table public.comments enable row level security;
alter table public.support_tickets enable row level security;
alter table public.announcements enable row level security;

-- organizations
create policy "Members can view their organizations" on public.organizations
for select to authenticated
using ( private.is_org_member(id) );

create policy "Platform admins can view all organizations" on public.organizations
for select to authenticated
using ( (select private.is_platform_admin()) );

create policy "Users can create organizations" on public.organizations
for insert to authenticated
with check ( created_by = (select auth.uid()) );

create policy "Org admins can rename organizations" on public.organizations
for update to authenticated
using ( private.is_org_admin(id) )
with check ( private.is_org_admin(id) );

-- profiles
create policy "Users can view their own profile" on public.profiles
for select to authenticated
using ( (select auth.uid()) = id );

create policy "Users can update their own profile" on public.profiles
for update to authenticated
using ( (select auth.uid()) = id );

-- org_members
create policy "Members can view co-members" on public.org_members
for select to authenticated
using ( private.is_org_member(org_id) );

create policy "Users can join an organization" on public.org_members
for insert to authenticated
with check ( user_id = (select auth.uid()) );

create policy "Org admins can remove members" on public.org_members
for delete to authenticated
using ( private.is_org_admin(org_id) );

-- projects
create policy "Members can view projects" on public.projects
for select to authenticated
using ( auth.role() = 'authenticated' and private.is_org_member(org_id) );

create policy "Org admins manage projects" on public.projects
for insert to authenticated
with check ( private.is_org_admin(org_id) );

-- documents
create policy "Members can view documents" on public.documents
for select to authenticated
using ( private.is_org_member(org_id) );

create policy "Platform admins can view all documents" on public.documents
for select to authenticated
using ( (select private.is_platform_admin()) );

create policy "Anyone with the link can view shared documents" on public.documents
for select to anon, authenticated
using ( share_token is not null );

create policy "Teamboard staff can view all documents" on public.documents
for select to authenticated
using ( ((select auth.jwt()) ->> 'email') like '%@teamboard.example' );

create policy "Members can create documents" on public.documents
for insert to authenticated
with check ( created_by = (select auth.uid()) and private.is_org_member(org_id) );

create policy "Members can edit documents" on public.documents
for update to authenticated
using ( private.is_org_member(org_id) );

-- comments
create policy "Members can read comments" on public.comments
for select to authenticated
using ( private.is_org_member(org_id) );

create policy "Members can comment" on public.comments
for insert to authenticated
with check ( author_id = (select auth.uid()) and private.is_org_member(org_id) );

create policy "Authors can edit their comments" on public.comments
for update to authenticated
using ( author_id = (select auth.uid()) )
with check ( author_id = (select auth.uid()) and private.is_org_member(org_id) );

create policy "Authors can delete their comments" on public.comments
for delete to authenticated
using ( author_id = (select auth.uid()) );

-- support_tickets
create policy "Requesters and support staff can read tickets" on public.support_tickets
for select to authenticated
using (
  requester_id = (select auth.uid())
  or ((select auth.jwt()) -> 'user_metadata' ->> 'role') = 'support'
);

create policy "Users can open tickets" on public.support_tickets
for insert to authenticated
with check ( requester_id = (select auth.uid()) );

-- announcements
create policy "Announcements are public" on public.announcements
for select to anon, authenticated
using ( true );
