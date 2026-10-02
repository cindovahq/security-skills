-- Signup and org-creation triggers, RPC helpers, reporting views

-- Create a profile row for every new auth user
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 80));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- The creator of an organization becomes its first admin
create function private.add_creator_as_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.org_members (org_id, user_id, role)
  values (new.id, new.created_by, 'admin');
  return new;
end;
$$;

create trigger on_organization_created
  after insert on public.organizations
  for each row execute procedure private.add_creator_as_admin();

-- Used by the members page to show contact emails
create function public.get_org_member_emails(p_org_id uuid)
returns table (user_id uuid, email text, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, u.email::text, m.role
  from public.org_members m
  join auth.users u on u.id = m.user_id
  where m.org_id = p_org_id;
$$;

-- Archive a project (org admins only)
create function public.archive_project(p_project_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from projects where id = p_project_id;
  if not private.is_org_admin(v_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update projects set archived_at = now() where id = p_project_id;
end;
$$;

revoke execute on function public.archive_project(uuid) from public, anon;
grant execute on function public.archive_project(uuid) to authenticated;

-- Member directory for the people picker
create view public.member_directory as
  select p.id, p.display_name, p.avatar_path, u.email, u.last_sign_in_at, m.org_id, m.role
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.org_members m on m.user_id = p.id;

grant select on public.member_directory to anon, authenticated;

-- Dashboard counts per organization
create view public.project_stats
with (security_invoker = true) as
  select p.org_id,
         count(*) filter (where p.archived_at is null) as active_projects,
         count(*) filter (where p.archived_at is not null) as archived_projects
  from public.projects p
  group by p.org_id;

grant select on public.project_stats to authenticated;

-- Usage snapshot refreshed nightly for the billing page
create materialized view public.org_usage as
  select o.id as org_id,
         o.name,
         (select count(*) from public.org_members m where m.org_id = o.id) as seats,
         (select count(*) from public.documents d where d.org_id = o.id) as documents
  from public.organizations o;

grant select on public.org_usage to authenticated;
