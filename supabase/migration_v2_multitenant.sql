-- =====================================================================
--  QC Pro v2 — تحويل النظام لعدة مختبرات (Multi-tenant)
--  شغّله مرة واحدة بعد schema.sql (آمن على قاعدة بيانات فيها بيانات سابقة)
--  الأدوار: superadmin (مالك المنصة) · admin (مدير المختبر) · user
-- =====================================================================

-- ---------- 1) جدول المختبرات (العملاء) ----------
create table if not exists public.organizations (
  id           bigserial primary key,
  name         text not null,
  code         text not null unique,              -- رمز يعطى للعميل للتسجيل
  plan         text not null default 'standard' check (plan in ('trial','basic','standard','enterprise')),
  max_users    int  default 10,
  valid_until  date,                              -- نهاية الاشتراك (فارغ = بلا نهاية)
  active       boolean not null default true,
  contact_name text,
  contact_email text,
  phone        text,
  notes        text,
  created_at   timestamptz default now()
);

-- مختبر افتراضي للبيانات الموجودة مسبقاً
insert into public.organizations(name, code, plan, max_users)
select 'المختبر الرئيسي', 'MAIN', 'enterprise', 1000
where not exists (select 1 from public.organizations);

-- ---------- 2) الأدوار + ربط المستخدمين بالمختبرات ----------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('superadmin','admin','user'));
alter table public.profiles add column if not exists org_id bigint references public.organizations(id) on delete cascade;
update public.profiles set org_id = (select min(id) from public.organizations) where org_id is null;

-- أقدم مدير يصبح مالك المنصة
update public.profiles set role = 'superadmin'
where id = (select id from public.profiles where role = 'admin' order by created_at limit 1)
  and not exists (select 1 from public.profiles where role = 'superadmin');

-- ---------- 3) دوال السياق ----------
create or replace function public.current_org() returns bigint
language sql stable security definer set search_path = public as $$
  select org_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_superadmin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'superadmin' and status = 'active');
$$;

create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.profiles p join public.organizations o on o.id = p.org_id
    where p.id = auth.uid() and p.status = 'active'
      and (p.role = 'superadmin' or (o.active and (o.valid_until is null or o.valid_until >= current_date))));
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active() and exists(select 1 from public.profiles where id = auth.uid() and role in ('admin','superadmin'));
$$;

-- متاحة قبل تسجيل الدخول: التحقق من رمز المختبر وهل النظام جديد
create or replace function public.check_org_code(p_code text) returns text
language sql stable security definer set search_path = public as $$
  select name from public.organizations where upper(code) = upper(trim(p_code)) and active;
$$;
create or replace function public.has_users() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles);
$$;
grant execute on function public.check_org_code(text) to anon, authenticated;
grant execute on function public.has_users() to anon, authenticated;

-- ---------- 4) التسجيل: أول مستخدم = مالك المنصة، أول مستخدم في كل مختبر = مديره ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_org bigint; v_count int; v_max int; v_first_ever boolean;
begin
  select not exists(select 1 from public.profiles) into v_first_ever;
  if v_first_ever then
    select min(id) into v_org from public.organizations;
    insert into public.profiles(id, email, full_name, role, status, org_id)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''), 'superadmin', 'active', v_org);
    return new;
  end if;

  select id, max_users into v_org, v_max from public.organizations
  where upper(code) = upper(trim(coalesce(new.raw_user_meta_data->>'org_code',''))) and active;
  if v_org is null then raise exception 'INVALID_ORG_CODE'; end if;

  select count(*) into v_count from public.profiles where org_id = v_org;
  if v_max is not null and v_count >= v_max then raise exception 'ORG_USER_LIMIT'; end if;

  insert into public.profiles(id, email, full_name, role, status, org_id)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''),
          case when v_count = 0 then 'admin' else 'user' end,
          case when v_count = 0 then 'active' else 'pending' end, v_org);
  return new;
end $$;

-- حماية الأدوار: المستخدم لا يغيّر دوره، مدير المختبر لا يمنح superadmin ولا ينقل المستخدمين لمختبر آخر
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_superadmin() then return new; end if;
  if public.is_admin() and old.org_id = public.current_org() then
    new.org_id := old.org_id;
    if new.role = 'superadmin' or old.role = 'superadmin' then new.role := old.role; new.status := old.status; end if;
  else
    new.role := old.role; new.status := old.status; new.email := old.email; new.org_id := old.org_id;
  end if;
  return new;
end $$;

-- ---------- 5) إضافة org_id لكل جداول البيانات ----------
do $$
declare t text; d bigint;
begin
  select min(id) into d from public.organizations;
  foreach t in array array['departments','analyzers','tests','qc_lots','qc_results','eqa_results','audit_log'] loop
    execute format('alter table public.%I add column if not exists org_id bigint references public.organizations(id) on delete cascade', t);
    execute format('update public.%I set org_id = %s where org_id is null', t, d);
    if t <> 'audit_log' then
      execute format('alter table public.%I alter column org_id set default public.current_org()', t);
      execute format('alter table public.%I alter column org_id set not null', t);
      execute format('create index if not exists %I on public.%I(org_id)', t || '_org_idx', t);
    end if;
  end loop;
end $$;

-- اسم القسم فريد داخل المختبر الواحد فقط
alter table public.departments drop constraint if exists departments_name_key;
create unique index if not exists departments_org_name_uq on public.departments(org_id, name);

-- سجل التدقيق يحفظ المختبر
create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_org bigint;
begin
  r := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_org := coalesce((r->>'org_id')::bigint, case when tg_table_name = 'organizations' then (r->>'id')::bigint end);
  insert into public.audit_log(user_id, org_id, table_name, action, record_id, old_data, new_data)
  values (auth.uid(), v_org, tg_table_name, tg_op, r->>'id',
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists audit_organizations on public.organizations;
create trigger audit_organizations after insert or update or delete on public.organizations
  for each row execute function public.audit_trigger();

-- ---------- 6) سياسات RLS معزولة لكل مختبر ----------
alter table public.organizations enable row level security;
drop policy if exists org_select on public.organizations;
create policy org_select on public.organizations for select using (public.is_superadmin() or id = public.current_org());
drop policy if exists org_admin on public.organizations;
create policy org_admin on public.organizations for all using (public.is_superadmin()) with check (public.is_superadmin());

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_superadmin() or (public.is_active() and org_id = public.current_org()));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid() or public.is_superadmin() or (public.is_admin() and org_id = public.current_org()));

do $$
declare t text;
begin
  foreach t in array array['departments','analyzers','tests','qc_lots'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select using (public.is_active() and org_id = public.current_org())', t);
    execute format('drop policy if exists %1$s_admin on public.%1$s', t);
    execute format('create policy %1$s_admin on public.%1$s for all using (public.is_admin() and org_id = public.current_org()) with check (public.is_admin() and org_id = public.current_org())', t);
  end loop;
  foreach t in array array['qc_results','eqa_results'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select using (public.is_active() and org_id = public.current_org())', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('create policy %1$s_insert on public.%1$s for insert with check (public.is_active() and org_id = public.current_org() and entered_by = auth.uid())', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('create policy %1$s_update on public.%1$s for update using (public.is_admin() and org_id = public.current_org())', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format('create policy %1$s_delete on public.%1$s for delete using (public.is_admin() and org_id = public.current_org())', t);
  end loop;
end $$;

drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select
  using (public.is_superadmin() or (public.is_admin() and org_id = public.current_org()));

-- إحصاءات المنصة لمالكها
create or replace function public.org_stats() returns table(org_id bigint, users bigint, tests bigint, results_30d bigint, last_result timestamptz)
language sql stable security definer set search_path = public as $$
  select o.id,
    (select count(*) from public.profiles p where p.org_id = o.id),
    (select count(*) from public.tests t where t.org_id = o.id),
    (select count(*) from public.qc_results r where r.org_id = o.id and r.run_at > now() - interval '30 days'),
    (select max(run_at) from public.qc_results r where r.org_id = o.id)
  from public.organizations o where public.is_superadmin();
$$;
grant execute on function public.org_stats() to authenticated;
