-- =====================================================================
--  QC Pro — نظام ضبط الجودة للمختبرات الطبية
--  Supabase schema: tables + RLS + roles + audit trail
--  شغّل هذا الملف كاملاً مرة واحدة من: Supabase → SQL Editor → New query
-- =====================================================================

-- ---------- 1) الجداول ----------
create table if not exists public.departments (
  id          bigserial primary key,
  name        text not null unique,
  created_at  timestamptz default now()
);

create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  full_name     text,
  role          text not null default 'user'    check (role in ('admin','user')),
  status        text not null default 'pending' check (status in ('pending','active','disabled')),
  department_id bigint references public.departments(id) on delete set null,
  created_at    timestamptz default now()
);

create table if not exists public.analyzers (
  id            bigserial primary key,
  name          text not null,
  model         text,
  serial_no     text,
  department_id bigint references public.departments(id) on delete set null,
  active        boolean default true,
  created_at    timestamptz default now()
);

create table if not exists public.tests (
  id            bigserial primary key,
  name          text not null,
  code          text,
  unit          text,
  department_id bigint references public.departments(id) on delete set null,
  analyzer_id   bigint references public.analyzers(id) on delete set null,
  tea           numeric,                -- Total Allowable Error (%)
  tea_source    text,                   -- CLIA / RiliBÄK / Ricos BV ...
  decimals      int default 2,
  rules         text[] default array['1-2s','1-3s','2-2s','R-4s','4-1s','10x'],
  active        boolean default true,
  created_at    timestamptz default now()
);

create table if not exists public.qc_lots (
  id            bigserial primary key,
  test_id       bigint not null references public.tests(id) on delete cascade,
  level         text not null,
  material_name text,
  lot_number    text not null,
  expiry        date,
  target_mean   numeric not null,
  target_sd     numeric not null check (target_sd > 0),
  mean_source   text default 'manufacturer' check (mean_source in ('manufacturer','lab','peer')),
  active        boolean default true,
  created_at    timestamptz default now()
);

create table if not exists public.qc_results (
  id                bigserial primary key,
  lot_id            bigint not null references public.qc_lots(id) on delete cascade,
  test_id           bigint not null references public.tests(id) on delete cascade,
  value             numeric not null,
  run_at            timestamptz not null default now(),
  z                 numeric,
  rules_violated    text[] default '{}',
  status            text not null default 'accept' check (status in ('accept','warning','reject')),
  comment           text,
  corrective_action text,
  entered_by        uuid references public.profiles(id) default auth.uid(),
  reviewed_by       uuid references public.profiles(id),
  reviewed_at       timestamptz,
  created_at        timestamptz default now()
);
create index if not exists qc_results_lot_run_idx  on public.qc_results(lot_id, run_at);
create index if not exists qc_results_test_run_idx on public.qc_results(test_id, run_at);

create table if not exists public.eqa_results (
  id            bigserial primary key,
  test_id       bigint not null references public.tests(id) on delete cascade,
  provider      text,                 -- CAP / RIQAS / EQAS ...
  cycle         text,
  sample_id     text,
  event_date    date not null default current_date,
  lab_value     numeric not null,
  target_value  numeric not null,
  peer_sd       numeric,
  deviation_pct numeric,
  sdi           numeric,
  acceptable    boolean,
  comment       text,
  entered_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz default now()
);

create table if not exists public.audit_log (
  id         bigserial primary key,
  user_id    uuid,
  table_name text,
  action     text,
  record_id  text,
  old_data   jsonb,
  new_data   jsonb,
  at         timestamptz default now()
);

-- ---------- 2) دوال الصلاحيات ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles
                where id = auth.uid() and role = 'admin' and status = 'active');
$$;

create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles
                where id = auth.uid() and status = 'active');
$$;

-- أول مستخدم يسجّل = مدير النظام (admin) تلقائياً، والبقية بانتظار الموافقة
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare is_first boolean;
begin
  select not exists(select 1 from public.profiles) into is_first;
  insert into public.profiles(id, email, full_name, role, status)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', ''),
          case when is_first then 'admin'  else 'user'    end,
          case when is_first then 'active' else 'pending' end);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- منع المستخدم العادي من ترقية نفسه أو تفعيل حسابه
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role   := old.role;
    new.status := old.status;
    new.email  := old.email;
  end if;
  return new;
end $$;

drop trigger if exists protect_profile_trg on public.profiles;
create trigger protect_profile_trg before update on public.profiles
  for each row execute function public.protect_profile();

-- ---------- 3) سجل التدقيق (Audit trail — ISO 15189 §7.11 / §8.4) ----------
create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    insert into public.audit_log(user_id, table_name, action, record_id, old_data)
    values (auth.uid(), tg_table_name, tg_op, old.id::text, to_jsonb(old));
    return old;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log(user_id, table_name, action, record_id, old_data, new_data)
    values (auth.uid(), tg_table_name, tg_op, new.id::text, to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into public.audit_log(user_id, table_name, action, record_id, new_data)
    values (auth.uid(), tg_table_name, tg_op, new.id::text, to_jsonb(new));
    return new;
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','departments','analyzers','tests','qc_lots','qc_results','eqa_results'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s
                    for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

-- ---------- 4) Row Level Security ----------
alter table public.profiles    enable row level security;
alter table public.departments enable row level security;
alter table public.analyzers   enable row level security;
alter table public.tests       enable row level security;
alter table public.qc_lots     enable row level security;
alter table public.qc_results  enable row level security;
alter table public.eqa_results enable row level security;
alter table public.audit_log   enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_active());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid() or public.is_admin());

-- الجداول المرجعية: قراءة للمستخدم الفعّال، كتابة للمدير فقط
do $$
declare t text;
begin
  foreach t in array array['departments','analyzers','tests','qc_lots'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select using (public.is_active())', t);
    execute format('drop policy if exists %1$s_admin on public.%1$s', t);
    execute format('create policy %1$s_admin on public.%1$s for all using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- النتائج: الإدخال لأي مستخدم فعّال باسمه، التعديل والحذف للمدير فقط
do $$
declare t text;
begin
  foreach t in array array['qc_results','eqa_results'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select using (public.is_active())', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('create policy %1$s_insert on public.%1$s for insert with check (public.is_active() and entered_by = auth.uid())', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('create policy %1$s_update on public.%1$s for update using (public.is_admin())', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format('create policy %1$s_delete on public.%1$s for delete using (public.is_admin())', t);
  end loop;
end $$;

-- سجل التدقيق: قراءة للمدير فقط، ولا يمكن لأحد تعديله أو حذفه من الواجهة
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select using (public.is_admin());

-- =====================================================================
--  (اختياري) ترقية حساب معيّن إلى مدير يدوياً:
--  update public.profiles set role='admin', status='active' where email='you@example.com';
-- =====================================================================
