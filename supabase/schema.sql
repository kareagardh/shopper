-- =====================================================================
--  Rydebäcks Barnloppis – databas
--  Kör hela filen i Supabase: Dashboard → SQL Editor → New query → Run.
--  Filen går att köra flera gånger (den skapar bara det som saknas
--  och ersätter funktionerna).
--
--  Säkerhetsmodell
--  - Tabellerna har Row Level Security påslaget och INGA policyer,
--    så webbsidorna kan aldrig läsa eller skriva tabellerna direkt.
--  - All åtkomst sker via funktionerna längst ner (security definer):
--      kund:     get_active_event, submit_cart
--      station:  station_login, station_sync          (kräver stationskod)
--      admin:    admin_*                              (kräver adminlösenord)
--  - Felaktiga koder loggas. Efter 30 fel på 10 minuter spärras
--    inloggningen i 10 minuter.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
--  Tabeller
-- ---------------------------------------------------------------------
create table if not exists public.events (
  id                uuid primary key default gen_random_uuid(),
  date              date not null,
  name              text not null default '',
  active            boolean not null default false,
  commission_pct    integer not null default 10 check (commission_pct between 0 and 100),
  commission_min    integer not null default 30 check (commission_min >= 0),
  station_code_hash text,
  created_at        timestamptz not null default now()
);
-- högst en aktiv loppisdag åt gången
create unique index if not exists events_one_active on public.events ((true)) where active;

create table if not exists public.carts (
  id               uuid primary key,             -- skapas i kundens telefon
  event_id         uuid not null references public.events(id) on delete cascade,
  code             text not null check (char_length(code) between 1 and 16),
  total_sek        integer not null default 0,
  item_count       integer not null default 0,
  created_at       timestamptz,                  -- korgen påbörjades
  done_at          timestamptz,                  -- kunden tryckte Klart
  checked_station  smallint check (checked_station between 1 and 8),
  checked_at       timestamptz,                  -- volontären kontrollerade
  checked_method   text check (checked_method in ('swish','kontant')),
  checked_total    integer,                      -- summan volontären såg
  received_at      timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists carts_event_idx on public.carts (event_id);

create table if not exists public.items (
  cart_id    uuid not null references public.carts(id) on delete cascade,
  idx        smallint not null,
  seller_id  smallint not null check (seller_id between 1 and 999),
  price_sek  integer  not null check (price_sek between 1 and 99999),
  added_at   timestamptz,
  primary key (cart_id, idx)
);
create index if not exists items_seller_idx on public.items (seller_id);

create table if not exists public.station_syncs (
  event_id     uuid not null references public.events(id) on delete cascade,
  station      smallint not null check (station between 1 and 8),
  last_sync    timestamptz not null,
  carts_synced integer not null default 0,
  primary key (event_id, station)
);

create table if not exists public.app_settings (
  id                  boolean primary key default true check (id),
  admin_password_hash text
);
insert into public.app_settings (id) values (true) on conflict do nothing;

create table if not exists public.auth_failures (
  at   timestamptz not null default now(),
  kind text not null
);
create index if not exists auth_failures_idx on public.auth_failures (kind, at);

alter table public.events        enable row level security;
alter table public.carts         enable row level security;
alter table public.items         enable row level security;
alter table public.station_syncs enable row level security;
alter table public.app_settings  enable row level security;
alter table public.auth_failures enable row level security;

revoke all on all tables in schema public from anon, authenticated;

-- ---------------------------------------------------------------------
--  Hjälpfunktioner (inte åtkomliga utifrån)
-- ---------------------------------------------------------------------
create or replace function public._ts(v text) returns timestamptz
language sql immutable as $$
  select case when v ~ '^\d{10,14}$' then to_timestamp(v::bigint / 1000.0) end
$$;

create or replace function public._uuid(v text) returns uuid
language sql immutable as $$
  select case when v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v::uuid end
$$;

-- Kontrollerar en vara-lista [{s:säljare, p:pris, t:ms}, ...]. Returnerar true om giltig.
create or replace function public._items_valid(v jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(v) = 'array'
     and jsonb_array_length(v) between 1 and 500
     and not exists (
       select 1 from jsonb_array_elements(v) e
       where not (coalesce(e->>'s','') ~ '^\d{1,3}$' and (e->>'s')::int between 1 and 999
              and coalesce(e->>'p','') ~ '^\d{1,5}$' and (e->>'p')::int >= 1)
     )
$$;

create or replace function public._throttled(p_kind text) returns boolean
language sql security definer set search_path = public as $$
  select count(*) >= 30 from auth_failures where kind = p_kind and at > now() - interval '10 minutes'
$$;

create or replace function public._admin_ok(p_password text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare h text;
begin
  if _throttled('admin') then return false; end if;
  select admin_password_hash into h from app_settings where id;
  if h is not null and p_password is not null and crypt(p_password, h) = h then
    return true;
  end if;
  insert into auth_failures(kind) values ('admin');
  delete from auth_failures where at < now() - interval '1 day';
  return false;
end $$;

create or replace function public._station_ok(p_event uuid, p_code text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare h text;
begin
  if _throttled('station') then return false; end if;
  select station_code_hash into h from events where id = p_event;
  if h is not null and p_code is not null and crypt(p_code, h) = h then
    return true;
  end if;
  insert into auth_failures(kind) values ('station');
  return false;
end $$;

-- Endast för SQL Editor: sätt adminlösenordet.
--   select set_admin_password('ett-långt-lösenord');
create or replace function public.set_admin_password(p_password text) returns text
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_password is null or char_length(p_password) < 10 then
    raise exception 'Lösenordet måste vara minst 10 tecken';
  end if;
  update app_settings set admin_password_hash = crypt(p_password, gen_salt('bf')) where id;
  return 'Adminlösenordet är satt';
end $$;

-- ---------------------------------------------------------------------
--  Kund
-- ---------------------------------------------------------------------
create or replace function public.get_active_event() returns json
language sql security definer set search_path = public as $$
  select json_build_object('id', id, 'date', date, 'name', name)
  from events where active limit 1
$$;

-- p = { id, code, event_id?, created (ms), done (ms), items: [{s,p,t}] }
create or replace function public.submit_cart(p jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid := _uuid(p->>'id');
  v_event uuid;
  v_items jsonb := p->'items';
  v_n int; v_sum int;
begin
  if v_id is null then return json_build_object('error','invalid_id'); end if;
  if coalesce(p->>'code','') !~ '^[A-Za-z0-9-]{1,16}$' then return json_build_object('error','invalid_code'); end if;
  if not _items_valid(v_items) then return json_build_object('error','invalid_items'); end if;

  select id into v_event from events where id = _uuid(p->>'event_id');
  if v_event is null then select id into v_event from events where active; end if;
  if v_event is null then return json_build_object('error','no_active_event'); end if;

  select count(*), sum((e->>'p')::int) into v_n, v_sum from jsonb_array_elements(v_items) e;

  insert into carts (id, event_id, code, created_at, done_at, total_sek, item_count)
  values (v_id, v_event, p->>'code', _ts(p->>'created'), coalesce(_ts(p->>'done'), now()), v_sum, v_n)
  on conflict (id) do update
    set done_at    = coalesce(carts.done_at, excluded.done_at),
        created_at = coalesce(carts.created_at, excluded.created_at),
        total_sek  = excluded.total_sek,
        item_count = excluded.item_count,
        updated_at = now();

  -- Kundens lista är den slutgiltiga
  delete from items where cart_id = v_id;
  insert into items (cart_id, idx, seller_id, price_sek, added_at)
  select v_id, (x.ord - 1)::smallint, (x.e->>'s')::smallint, (x.e->>'p')::int, _ts(x.e->>'t')
  from jsonb_array_elements(v_items) with ordinality as x(e, ord);

  return json_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
--  Utgångsstation
-- ---------------------------------------------------------------------
create or replace function public.station_login(p_code text, p_station int) returns json
language plpgsql security definer set search_path = public as $$
declare e events;
begin
  if p_station is null or p_station not between 1 and 8 then return json_build_object('error','invalid_station'); end if;
  select * into e from events where active;
  if e.id is null then return json_build_object('error','no_active_event'); end if;
  if _throttled('station') then return json_build_object('error','too_many_attempts'); end if;
  if not _station_ok(e.id, p_code) then return json_build_object('error','wrong_code'); end if;
  return json_build_object('ok', true, 'event', json_build_object('id', e.id, 'date', e.date, 'name', e.name));
end $$;

-- p_carts = [{ id, code, checked (ms), method, items: [{s,p}] }, ...]
create or replace function public.station_sync(p_event uuid, p_code text, p_station int, p_carts jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare
  c jsonb; v_id uuid; v_n int; v_sum int; v_count int := 0; v_rejected json[] := '{}';
begin
  if p_station is null or p_station not between 1 and 8 then return json_build_object('error','invalid_station'); end if;
  if _throttled('station') then return json_build_object('error','too_many_attempts'); end if;
  if not _station_ok(p_event, p_code) then return json_build_object('error','wrong_code'); end if;
  if jsonb_typeof(p_carts) <> 'array' or jsonb_array_length(p_carts) > 2000 then
    return json_build_object('error','invalid_payload');
  end if;

  for c in select * from jsonb_array_elements(p_carts) loop
    v_id := _uuid(c->>'id');
    if v_id is null or coalesce(c->>'code','') !~ '^[A-Za-z0-9-]{1,16}$' or not _items_valid(c->'items')
       or coalesce(c->>'method','') not in ('swish','kontant') then
      v_rejected := v_rejected || to_json(c->>'id');
      continue;
    end if;
    select count(*), sum((e->>'p')::int) into v_n, v_sum from jsonb_array_elements(c->'items') e;

    insert into carts (id, event_id, code, total_sek, item_count,
                       checked_station, checked_at, checked_method, checked_total)
    values (v_id, p_event, c->>'code', v_sum, v_n,
            p_station, coalesce(_ts(c->>'checked'), now()), c->>'method', v_sum)
    on conflict (id) do update
      set checked_station = excluded.checked_station,
          checked_at      = excluded.checked_at,
          checked_method  = excluded.checked_method,
          checked_total   = excluded.checked_total,
          updated_at      = now();

    -- Varorna från QR-koden används bara om kunden inte redan skickat sin lista
    if not exists (select 1 from items where cart_id = v_id) then
      insert into items (cart_id, idx, seller_id, price_sek)
      select v_id, (x.ord - 1)::smallint, (x.e->>'s')::smallint, (x.e->>'p')::int
      from jsonb_array_elements(c->'items') with ordinality as x(e, ord);
    end if;
    v_count := v_count + 1;
  end loop;

  insert into station_syncs (event_id, station, last_sync, carts_synced)
  values (p_event, p_station, now(), v_count)
  on conflict (event_id, station) do update
    set last_sync = now(), carts_synced = station_syncs.carts_synced + excluded.carts_synced;

  return json_build_object('ok', true, 'synced', v_count, 'rejected', v_rejected);
end $$;

-- ---------------------------------------------------------------------
--  Admin
-- ---------------------------------------------------------------------
create or replace function public.admin_login(p_password text) returns json
language plpgsql security definer set search_path = public as $$
begin
  if _throttled('admin') then return json_build_object('error','too_many_attempts'); end if;
  if not _admin_ok(p_password) then return json_build_object('error','wrong_password'); end if;
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_events(p_password text) returns json
language plpgsql security definer set search_path = public as $$
begin
  if not _admin_ok(p_password) then return json_build_object('error','wrong_password'); end if;
  return json_build_object('ok', true, 'events', coalesce((
    select json_agg(json_build_object(
      'id', e.id, 'date', e.date, 'name', e.name, 'active', e.active,
      'commission_pct', e.commission_pct, 'commission_min', e.commission_min,
      'has_station_code', e.station_code_hash is not null,
      'carts', (select count(*) from carts c where c.event_id = e.id)
    ) order by e.date desc)
    from events e), '[]'::json));
end $$;

-- p = { id?, date, name, commission_pct, commission_min, active, station_code? }
create or replace function public.admin_save_event(p_password text, p jsonb) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid := _uuid(p->>'id'); v_active boolean := coalesce((p->>'active')::boolean, false);
begin
  if not _admin_ok(p_password) then return json_build_object('error','wrong_password'); end if;
  if coalesce(p->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then return json_build_object('error','invalid_date'); end if;
  if coalesce(p->>'commission_pct','') !~ '^\d{1,3}$' or (p->>'commission_pct')::int > 100
     or coalesce(p->>'commission_min','') !~ '^\d{1,6}$' then
    return json_build_object('error','invalid_commission');
  end if;
  if coalesce(p->>'station_code','') <> '' and char_length(p->>'station_code') < 4 then
    return json_build_object('error','short_station_code');
  end if;

  if v_active then update events set active = false where active and id is distinct from v_id; end if;

  if v_id is null then
    insert into events (date, name, commission_pct, commission_min, active)
    values ((p->>'date')::date, coalesce(p->>'name',''), (p->>'commission_pct')::int, (p->>'commission_min')::int, v_active)
    returning id into v_id;
  else
    update events set date = (p->>'date')::date, name = coalesce(p->>'name',''),
      commission_pct = (p->>'commission_pct')::int, commission_min = (p->>'commission_min')::int,
      active = v_active
    where id = v_id;
    if not found then return json_build_object('error','not_found'); end if;
  end if;

  if coalesce(p->>'station_code','') <> '' then
    update events set station_code_hash = crypt(p->>'station_code', gen_salt('bf')) where id = v_id;
  end if;
  return json_build_object('ok', true, 'id', v_id);
end $$;

-- Allt admin behöver för en loppisdag (p_event = null ger alla dagar)
create or replace function public.admin_data(p_password text, p_event uuid) returns json
language plpgsql security definer set search_path = public as $$
begin
  if not _admin_ok(p_password) then return json_build_object('error','wrong_password'); end if;
  return json_build_object(
    'ok', true,
    'fetched_at', now(),
    'carts', coalesce((
      select json_agg(json_build_object(
        'id', c.id, 'code', c.code, 'event_id', c.event_id, 'date', e.date,
        'created_at', c.created_at, 'done_at', c.done_at,
        'checked_station', c.checked_station, 'checked_at', c.checked_at,
        'checked_method', c.checked_method, 'checked_total', c.checked_total,
        'total', c.total_sek, 'count', c.item_count,
        'items', (select json_agg(json_build_array(i.seller_id, i.price_sek, i.added_at) order by i.idx)
                  from items i where i.cart_id = c.id)
      ) order by coalesce(c.done_at, c.checked_at, c.received_at) desc)
      from carts c join events e on e.id = c.event_id
      where p_event is null or c.event_id = p_event), '[]'::json),
    'sellers', coalesce((
      with per as (
        select c.event_id, i.seller_id, count(*) as n, sum(i.price_sek)::int as sales
        from items i join carts c on c.id = i.cart_id
        where p_event is null or c.event_id = p_event
        group by c.event_id, i.seller_id
      ), calc as (
        select per.seller_id, per.n, per.sales,
               least(per.sales, greatest(round(per.sales * e.commission_pct / 100.0)::int, e.commission_min)) as commission,
               round(per.sales * e.commission_pct / 100.0) < e.commission_min as min_applied
        from per join events e on e.id = per.event_id
      )
      select json_agg(json_build_object(
        'seller', seller_id, 'items', n, 'sales', sales,
        'commission', commission, 'payout', sales - commission, 'min_applied', min_applied
      ) order by seller_id)
      from (select seller_id, sum(n)::int n, sum(sales)::int sales, sum(commission)::int commission,
                   bool_or(min_applied) min_applied
            from calc group by seller_id) s), '[]'::json),
    'stations', coalesce((
      select json_agg(json_build_object(
        'event_id', s.event_id, 'date', e.date, 'station', s.station,
        'last_sync', s.last_sync, 'carts_synced', s.carts_synced,
        'checked', (select count(*) from carts c where c.event_id = s.event_id and c.checked_station = s.station)
      ) order by e.date desc, s.station)
      from station_syncs s join events e on e.id = s.event_id
      where p_event is null or s.event_id = p_event), '[]'::json)
  );
end $$;

create or replace function public.admin_delete_cart(p_password text, p_cart uuid) returns json
language plpgsql security definer set search_path = public as $$
begin
  if not _admin_ok(p_password) then return json_build_object('error','wrong_password'); end if;
  delete from carts where id = p_cart;
  return json_build_object('ok', found);
end $$;

-- ---------------------------------------------------------------------
--  Behörigheter: bara de publika funktionerna får anropas utifrån
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.get_active_event(),
  public.submit_cart(jsonb),
  public.station_login(text, int),
  public.station_sync(uuid, text, int, jsonb),
  public.admin_login(text),
  public.admin_events(text),
  public.admin_save_event(text, jsonb),
  public.admin_data(text, uuid),
  public.admin_delete_cart(text, uuid)
to anon;
