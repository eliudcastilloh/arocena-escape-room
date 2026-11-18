-- Registration data is private. Anonymous callers may only execute the narrow
-- registration RPC, which validates every field and never returns contact data.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.interest_registrations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  name text not null check (
    pg_catalog.char_length(name) between 1 and 80
    and name = pg_catalog.btrim(name)
  ),
  email text not null unique check (
    pg_catalog.char_length(email) between 3 and 160
    and email = pg_catalog.lower(pg_catalog.btrim(email))
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  consent_version text not null default '2026-11-17-v1'
    check (consent_version = '2026-11-17-v1')
);
alter table public.interest_registrations enable row level security;
revoke all on table public.interest_registrations from public, anon, authenticated;

create table private.request_limits (
  request_hash text primary key check (request_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count between 1 and 11)
);
create index request_limits_expiry_idx on private.request_limits (window_started_at);
alter table private.request_limits enable row level security;
revoke all on table private.request_limits from public, anon, authenticated, service_role;

create function public.register_escape_room_interest(
  p_name text,
  p_email text,
  p_consent boolean,
  p_request_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := pg_catalog.btrim(p_name);
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_attempts integer;
begin
  if p_consent is distinct from true
    or v_name is null or pg_catalog.char_length(v_name) not between 1 and 80
    or v_email is null or pg_catalog.char_length(v_email) not between 3 and 160
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$'
  then
    return pg_catalog.jsonb_build_object('success', false, 'code', 'validation_error');
  end if;

  -- Delete expired pseudonymous counters on later submissions. No raw IP is
  -- stored, and the indexed cleanup does not require a scheduled job.
  delete from private.request_limits
    where window_started_at < v_now - interval '1 day';

  -- One atomic upsert locks the counter row, including concurrent requests.
  insert into private.request_limits as limits
    (request_hash, window_started_at, request_count)
  values (p_request_hash, v_now, 1)
  on conflict (request_hash) do update set
    window_started_at = case
      when limits.window_started_at <= v_now - interval '10 minutes'
      then v_now else limits.window_started_at end,
    request_count = case
      when limits.window_started_at <= v_now - interval '10 minutes'
      then 1 else least(limits.request_count + 1, 11) end
  returning request_count into v_attempts;

  if v_attempts > 10 then
    return pg_catalog.jsonb_build_object('success', false, 'code', 'rate_limited');
  end if;

  insert into public.interest_registrations (name, email, consent_version)
    values (v_name, v_email, '2026-11-17-v1')
    on conflict (email) do nothing;

  -- The same response for new and existing contacts avoids exposing whether an
  -- address is already registered; existing contact details are never changed.
  return pg_catalog.jsonb_build_object('success', true);
end;
$$;

revoke all on function public.register_escape_room_interest(text, text, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.register_escape_room_interest(text, text, boolean, text)
  to anon;
