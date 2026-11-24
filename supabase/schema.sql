-- KINETIX Studio — credit ledger, generations and billing schema.
-- Run once in the Supabase SQL editor. Safe to re-run.
-- All writes go through the Next.js server with the service-role key. Browsers can only read their own rows.


-- ---------------------------------------------------------------- tables
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  credits integer not null default 30 check (credits >= 0),
  plan text not null default 'free',
  created_at timestamptz not null default now()
);

create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  engine_id text not null,
  credits_charged integer not null check (credits_charged >= 0),
  rough_prompt text not null default '',
  compiled_prompt text not null,
  aspect text not null default '16:9',
  duration text not null default '7s',
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'canceled')),
  provider text,
  provider_job_id text,
  job_token text,
  output_url text,
  output_type text,
  error text,
  refunded boolean not null default false,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Columns added after the first schema version (no-ops on a fresh install).
alter table public.generations add column if not exists provider text;
alter table public.generations add column if not exists provider_job_id text;
alter table public.generations add column if not exists job_token text;
alter table public.generations add column if not exists output_type text;
alter table public.generations add column if not exists error text;
alter table public.generations add column if not exists refunded boolean not null default false;
alter table public.generations add column if not exists finished_at timestamptz;

create index if not exists generations_user_created_idx on public.generations (user_id, created_at desc);

-- Stripe events already applied (idempotent credit grants).
create table if not exists public.billing_events (
  event_id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  credits integer not null,
  plan text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- row level security
alter table public.profiles enable row level security;
alter table public.generations enable row level security;
alter table public.billing_events enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles for select using (auth.uid() = id);

drop policy if exists "generations: read own" on public.generations;
create policy "generations: read own" on public.generations for select using (auth.uid() = user_id);
-- No insert/update/delete policies: only the service role (server) writes.

-- ---------------------------------------------------------------- new user -> profile with free credits
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for users created before the trigger existed.
insert into public.profiles (id, email)
select u.id, u.email from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------- credit functions
-- Atomically deduct credits and create the generation row.
create or replace function public.start_generation(
  p_user_id uuid, p_engine text, p_credits integer,
  p_rough text, p_compiled text, p_aspect text, p_duration text
) returns table (generation_id uuid, remaining integer)
language plpgsql security definer set search_path = public as $$
declare
  v_remaining integer;
  v_id uuid;
begin
  if p_credits <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  update public.profiles
     set credits = credits - p_credits
   where id = p_user_id and credits >= p_credits
  returning credits into v_remaining;
  if v_remaining is null then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;
  insert into public.generations (user_id, engine_id, credits_charged, rough_prompt, compiled_prompt, aspect, duration, status)
  values (p_user_id, p_engine, p_credits, coalesce(p_rough, ''), p_compiled, p_aspect, p_duration, 'queued')
  returning id into v_id;
  return query select v_id, v_remaining;
end;
$$;

-- Finish a generation once. Refunds on failed/canceled. Returns credits refunded (0 if none or already settled).
create or replace function public.settle_generation(
  p_id uuid, p_status text, p_output_url text, p_output_type text, p_error text
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  g public.generations%rowtype;
  v_refund integer := 0;
begin
  if p_status not in ('completed', 'failed', 'canceled') then
    raise exception 'INVALID_STATUS';
  end if;
  select * into g from public.generations where id = p_id for update;
  if not found or g.status in ('completed', 'failed', 'canceled') then
    return 0;
  end if;
  if p_status in ('failed', 'canceled') and not g.refunded then
    v_refund := g.credits_charged;
    update public.profiles set credits = credits + v_refund where id = g.user_id;
  end if;
  update public.generations
     set status = p_status,
         output_url = p_output_url,
         output_type = p_output_type,
         error = left(p_error, 500),
         refunded = refunded or v_refund > 0,
         finished_at = now()
   where id = p_id;
  return v_refund;
end;
$$;

-- Grant plan credits for a Stripe event exactly once.
create or replace function public.add_credits(
  p_user_id uuid, p_amount integer, p_event_id text, p_plan text
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_credits integer;
begin
  if p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  insert into public.billing_events (event_id, user_id, credits, plan)
  values (p_event_id, p_user_id, p_amount, p_plan)
  on conflict (event_id) do nothing;
  if not found then
    select credits into v_credits from public.profiles where id = p_user_id;
    return v_credits;
  end if;
  update public.profiles
     set credits = credits + p_amount,
         plan = coalesce(p_plan, plan)
   where id = p_user_id
  returning credits into v_credits;
  return v_credits;
end;
$$;

-- Old helper from v1, kept for compatibility.
create or replace function public.deduct_credits(p_user_id uuid, p_amount integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v_remaining integer;
begin
  update public.profiles set credits = credits - p_amount
   where id = p_user_id and credits >= p_amount
  returning credits into v_remaining;
  if v_remaining is null then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;
  return v_remaining;
end;
$$;

-- Only the server (service role) may call the credit functions.
revoke all on function public.start_generation(uuid, text, integer, text, text, text, text) from public, anon, authenticated;
revoke all on function public.settle_generation(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.add_credits(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.deduct_credits(uuid, integer) from public, anon, authenticated;
grant execute on function public.start_generation(uuid, text, integer, text, text, text, text) to service_role;
grant execute on function public.settle_generation(uuid, text, text, text, text) to service_role;
grant execute on function public.add_credits(uuid, integer, text, text) to service_role;
grant execute on function public.deduct_credits(uuid, integer) to service_role;
