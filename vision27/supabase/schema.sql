-- Vision27 — Supabase schema
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- It is safe to run again (it drops and recreates its own functions and policies).

create extension if not exists citext;

-------------------------------------------------------------------------------
-- 1. Profiles: one row per account
-------------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    citext unique not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  avatar      jsonb,                         -- { gender, skin, outfit, colors }
  life        text not null default 'citizen' check (life in ('citizen','sponsor','coordinator','politician')),
  office      text check (office in ('councilor','chairman','senator','vp','president')),
  is_admin    boolean not null default false,
  level       int not null default 1,
  xp          int not null default 0,
  net_worth   bigint not null default 0,
  playstyle   int not null default 0,         -- -100 (predator) .. 100 (reformer)
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- a profile is created from the username given at sign-up
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', 'player_' || substr(new.id::text, 1, 8)));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- players may edit their own row, but never their office, admin flag or username
create or replace function public.guard_profile() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.trusted', true), '') <> '1' then
    new.office := old.office; new.is_admin := old.is_admin; new.username := old.username;
    if new.life = 'politician' and old.life <> 'politician' then new.life := old.life; end if;  -- politicians are elected
  end if;
  return new;
end $$;
drop trigger if exists guard_profile on public.profiles;
create trigger guard_profile before update on public.profiles for each row execute function public.guard_profile();

drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles for select to authenticated using (true);
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- checked before sign-up so the form can say "taken" right away
create or replace function public.username_available(name text) returns boolean
language sql security definer set search_path = public stable as $$
  select name ~ '^[A-Za-z0-9_]{3,20}$' and not exists (select 1 from public.profiles where username = name::citext);
$$;
grant execute on function public.username_available(text) to anon, authenticated;

-------------------------------------------------------------------------------
-- 2. Key-value documents: chat, follows, homes, keys, DMs, adverts, saves.
--    Paths mirror the game's data layout: "<collection>/<userId>" is writable
--    only by that user; "data/users/<userId>/..." is private to that user.
-------------------------------------------------------------------------------
create table if not exists public.kv (
  path        text primary key,
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);
alter table public.kv enable row level security;
create index if not exists kv_prefix on public.kv (split_part(path, '/', 1));

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;
create or replace function public.kv_writable(p text) returns boolean language sql stable as $$
  select auth.uid() is not null and (
    split_part(p, '/', 2) = auth.uid()::text and split_part(p, '/', 1) in ('chat','follows','homes','keys','dm')
    or p like 'data/users/' || auth.uid()::text || '/%'
    or (p like 'ads/%' and public.is_admin())
  );
$$;

drop policy if exists "kv read" on public.kv;
create policy "kv read" on public.kv for select to authenticated
  using (path not like 'data/%' or path like 'data/users/' || auth.uid()::text || '/%');
drop policy if exists "kv insert" on public.kv;
create policy "kv insert" on public.kv for insert to authenticated with check (owner = auth.uid() and public.kv_writable(path));
drop policy if exists "kv update" on public.kv;
create policy "kv update" on public.kv for update to authenticated using (public.kv_writable(path)) with check (owner = auth.uid() and public.kv_writable(path));
drop policy if exists "kv delete" on public.kv;
create policy "kv delete" on public.kv for delete to authenticated using (public.kv_writable(path));

-- live updates for chat, homes, follows and DMs
do $$ begin
  alter publication supabase_realtime add table public.kv;
exception when duplicate_object then null; end $$;

-------------------------------------------------------------------------------
-- 3. City news ticker (written by the server functions below)
-------------------------------------------------------------------------------
create table if not exists public.news (
  id bigserial primary key,
  text text not null,
  created_at timestamptz not null default now()
);
alter table public.news enable row level security;
drop policy if exists "news readable" on public.news;
create policy "news readable" on public.news for select to authenticated using (true);
do $$ begin
  alter publication supabase_realtime add table public.news;
exception when duplicate_object then null; end $$;

-------------------------------------------------------------------------------
-- 4. Elections: politicians are voted in by players
-------------------------------------------------------------------------------
create table if not exists public.seats (
  seat      text primary key,
  title     text not null,
  winners   int not null,
  hours     int not null,          -- how long each election runs
  fee       bigint not null,       -- nomination form, in game naira
  requires  text[]                 -- offices you must hold to contest (null = anyone)
);
insert into public.seats values
  ('councilor', 'Ward Councilor',        3,  6,  1000000, null),
  ('chairman',  'Area Council Chairman', 1, 12,  3000000, array['councilor']),
  ('senator',   'Senator',               3, 24, 10000000, array['chairman','councilor']),
  ('vp',        'Vice President',        1, 48, 25000000, array['senator']),
  ('president', 'President',             1, 48, 50000000, array['vp','senator'])
on conflict (seat) do update set title = excluded.title, winners = excluded.winners, hours = excluded.hours, fee = excluded.fee, requires = excluded.requires;
alter table public.seats enable row level security;
drop policy if exists "seats readable" on public.seats;
create policy "seats readable" on public.seats for select to authenticated using (true);

create table if not exists public.elections (
  id         bigserial primary key,
  seat       text not null references public.seats(seat),
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz not null,
  closed     boolean not null default false
);
create index if not exists elections_open on public.elections (seat) where not closed;
alter table public.elections enable row level security;
drop policy if exists "elections readable" on public.elections;
create policy "elections readable" on public.elections for select to authenticated using (true);

create table if not exists public.candidates (
  election_id bigint references public.elections(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete cascade,
  manifesto   text not null default '' check (length(manifesto) <= 140),
  created_at  timestamptz not null default now(),
  primary key (election_id, user_id)
);
alter table public.candidates enable row level security;
drop policy if exists "candidates readable" on public.candidates;
create policy "candidates readable" on public.candidates for select to authenticated using (true);

create table if not exists public.votes (
  election_id  bigint references public.elections(id) on delete cascade,
  voter_id     uuid references public.profiles(id) on delete cascade,
  candidate_id uuid not null,
  created_at   timestamptz not null default now(),
  primary key (election_id, voter_id)
);
alter table public.votes enable row level security;
drop policy if exists "own votes" on public.votes;
create policy "own votes" on public.votes for select to authenticated using (voter_id = auth.uid());
-- inserts only through cast_vote()

-- close finished elections, hand out offices, and open the next round
create or replace function public.ensure_elections() returns void
language plpgsql security definer set search_path = public as $$
declare e record; s record; w uuid; n int; names text;
begin
  perform set_config('app.trusted', '1', true);
  for e in select el.*, st.winners, st.title from elections el join seats st using (seat) where not closed and ends_at < now() for update of el skip locked loop
    n := 0; names := '';
    if exists (select 1 from candidates where election_id = e.id) then
      -- everyone holding this seat steps down; the winners take it
      update profiles set office = null where office = e.seat;
      for w in
        select c.user_id from candidates c left join votes v on v.election_id = c.election_id and v.candidate_id = c.user_id
        where c.election_id = e.id group by c.user_id, c.created_at order by count(v.voter_id) desc, c.created_at asc limit e.winners
      loop
        update profiles set office = e.seat, life = 'politician' where id = w;
        names := names || (case when n > 0 then ', ' else '' end) || (select username from profiles where id = w);
        n := n + 1;
      end loop;
      insert into news(text) values ('ELECTION RESULT: ' || names || ' won ' || e.title || '.');
    else
      insert into news(text) values ('No one contested for ' || e.title || '. A new race is open.');
    end if;
    update elections set closed = true where id = e.id;
  end loop;
  for s in select * from seats loop
    if not exists (select 1 from elections where seat = s.seat and not closed) then
      insert into elections(seat, ends_at) values (s.seat, now() + make_interval(hours => s.hours));
    end if;
  end loop;
end $$;
grant execute on function public.ensure_elections() to authenticated;

-- pay the form fee (taken from your saved money) and enter the race
create or replace function public.declare_candidacy(eid bigint, manifesto text) returns bigint
language plpgsql security definer set search_path = public as $$
declare el record; st record; me record; money bigint; p text := 'data/users/' || auth.uid()::text || '/profile';
begin
  select * into el from elections where id = eid and not closed and ends_at > now();
  if not found then raise exception 'This election is closed'; end if;
  select * into st from seats where seat = el.seat;
  select * into me from profiles where id = auth.uid();
  if st.requires is not null and not coalesce(me.office = any(st.requires), false) then
    raise exception 'You must hold % first', array_to_string(st.requires, ' or '); end if;
  if exists (select 1 from candidates c join elections x on x.id = c.election_id where c.user_id = auth.uid() and not x.closed) then
    raise exception 'You are already in a race'; end if;
  select coalesce((data->>'money')::bigint, 0) into money from kv where path = p for update;
  if coalesce(money, 0) < st.fee then raise exception 'You need ₦% for the form', st.fee; end if;
  update kv set data = jsonb_set(data, '{money}', to_jsonb(money - st.fee)), updated_at = now() where path = p;
  insert into candidates(election_id, user_id, manifesto) values (eid, auth.uid(), left(coalesce(manifesto, ''), 140));
  insert into news(text) values (me.username || ' is running for ' || st.title || '!');
  return money - st.fee;
end $$;
grant execute on function public.declare_candidacy(bigint, text) to authenticated;

create or replace function public.cast_vote(eid bigint, candidate uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from elections where id = eid and not closed and ends_at > now()) then raise exception 'Voting has closed'; end if;
  if not exists (select 1 from candidates where election_id = eid and user_id = candidate) then raise exception 'Not a candidate'; end if;
  insert into votes(election_id, voter_id, candidate_id) values (eid, auth.uid(), candidate);
exception when unique_violation then raise exception 'You already voted in this race';
end $$;
grant execute on function public.cast_vote(bigint, uuid) to authenticated;

-- everything the ballot screen needs in one call
create or replace function public.election_board()
returns table (election_id bigint, seat text, title text, fee bigint, ends_at timestamptz, candidate_id uuid, username text, avatar jsonb, manifesto text, votes bigint, my_vote uuid)
language sql security definer set search_path = public stable as $$
  select e.id, e.seat, s.title, s.fee, e.ends_at, c.user_id, p.username::text, p.avatar, c.manifesto,
         (select count(*) from votes v where v.election_id = e.id and v.candidate_id = c.user_id),
         (select v.candidate_id from votes v where v.election_id = e.id and v.voter_id = auth.uid())
  from elections e join seats s using (seat)
  left join candidates c on c.election_id = e.id
  left join profiles p on p.id = c.user_id
  where not e.closed
  order by array_position(array['councilor','chairman','senator','vp','president'], e.seat), 10 desc nulls last;
$$;
grant execute on function public.election_board() to authenticated;

-------------------------------------------------------------------------------
-- 5. Wallet: every naira lives here. The browser only shows it.
--    NPC work is reported by the browser and capped per 10 minutes (10 city hours).
--    Player-to-player money (wages, contracts) moves only inside the functions below.
-------------------------------------------------------------------------------
create table if not exists public.wallets (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  balance    bigint not null default 0 check (balance >= 0),
  win_start  timestamptz not null default now(),
  win_earned bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.wallets enable row level security;
drop policy if exists "own wallet" on public.wallets;
create policy "own wallet" on public.wallets for select to authenticated using (user_id = auth.uid());

create table if not exists public.ledger (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  delta bigint not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index if not exists ledger_user on public.ledger (user_id, id desc);
alter table public.ledger enable row level security;
drop policy if exists "own ledger" on public.ledger;
create policy "own ledger" on public.ledger for select to authenticated using (user_id = auth.uid());

create or replace function public.start_money(life text) returns bigint language sql immutable as $$
  select (case life when 'sponsor' then 50000000 when 'politician' then 2000000 when 'coordinator' then 200000 else 50000 end)::bigint;
$$;
create or replace function public.earn_cap(life text) returns bigint language sql immutable as $$
  select (case life when 'sponsor' then 15000000 when 'politician' then 3000000 when 'coordinator' then 600000 else 300000 end)::bigint;
$$;
-- city clock, same as the game: one real minute = one city hour
create or replace function public.city_hour() returns numeric language sql stable as $$
  select mod(extract(epoch from now()) / 60 + 7, 24);
$$;

-- open a wallet the first time: starting money for your life, or your old browser
-- savings if higher, kept up to 3x the starting money
create or replace function public.w_ensure(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare lf text; old_money bigint; st bigint; raw text;
begin
  if uid is null then raise exception 'Log in first'; end if;
  if exists (select 1 from wallets where user_id = uid) then return; end if;
  select life into lf from profiles where id = uid;
  st := start_money(coalesce(lf, 'citizen'));
  select data->>'money' into raw from kv where path = 'data/users/' || uid::text || '/profile';
  old_money := case when raw ~ '^[0-9]{1,15}(\.[0-9]+)?$' then floor(raw::numeric)::bigint else 0 end;
  insert into wallets(user_id, balance) values (uid, greatest(st, least(old_money, st * 3))) on conflict do nothing;
  if found then insert into ledger(user_id, delta, reason) values (uid, greatest(st, least(old_money, st * 3)), 'opening balance'); end if;
end $$;

-- move money in or out of one wallet (internal only)
create or replace function public.w_move(uid uuid, delta bigint, why text) returns bigint
language plpgsql security definer set search_path = public as $$
declare b bigint;
begin
  perform w_ensure(uid);
  update wallets set balance = balance + delta, updated_at = now() where user_id = uid and balance + delta >= 0 returning balance into b;
  if b is null then raise exception 'Not enough money'; end if;
  if delta <> 0 then insert into ledger(user_id, delta, reason) values (uid, delta, left(why, 80)); end if;
  return b;
end $$;

create or replace function public.wallet_get() returns bigint
language plpgsql security definer set search_path = public as $$
begin
  perform w_ensure(auth.uid());
  return (select balance from wallets where user_id = auth.uid());
end $$;

-- the browser reports everyday earnings (NPC shifts, rallies, goals) and spending (food, clothes)
create or replace function public.wallet_sync(earned bigint, spent bigint, why text) returns json
language plpgsql security definer set search_path = public as $$
declare w wallets; cap bigint; g bigint; s bigint; b bigint; lf text;
begin
  perform w_ensure(auth.uid());
  earned := greatest(0, least(coalesce(earned, 0), 1000000000000)); spent := greatest(0, coalesce(spent, 0));
  select * into w from wallets where user_id = auth.uid() for update;
  if w.win_start < now() - interval '10 minutes' then w.win_start := now(); w.win_earned := 0; end if;
  select case when office is not null then 'politician' else life end into lf from profiles where id = auth.uid();
  cap := earn_cap(lf);
  g := least(earned, greatest(0, cap - w.win_earned));
  s := least(spent, w.balance + g);
  b := w.balance + g - s;
  update wallets set balance = b, win_start = w.win_start, win_earned = w.win_earned + g, updated_at = now() where user_id = auth.uid();
  if g > 0 then insert into ledger(user_id, delta, reason) values (auth.uid(), g, left('earned: ' || coalesce(why, ''), 80)); end if;
  if s > 0 then insert into ledger(user_id, delta, reason) values (auth.uid(), -s, left('spent: ' || coalesce(why, ''), 80)); end if;
  return json_build_object('balance', b, 'granted', g, 'capped', g < earned);
end $$;

-- your life is locked once your wallet is open (only elections change it)
create or replace function public.guard_profile() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.trusted', true), '') <> '1' then
    new.office := old.office; new.is_admin := old.is_admin; new.username := old.username;
    if new.life = 'politician' and old.life <> 'politician' then new.life := old.life; end if;
    if new.life <> old.life and exists (select 1 from public.wallets where user_id = old.id) then new.life := old.life; end if;
  end if;
  return new;
end $$;

-- the election form fee now comes from the wallet
create or replace function public.declare_candidacy(eid bigint, manifesto text) returns bigint
language plpgsql security definer set search_path = public as $$
declare el record; st record; me record; left_over bigint;
begin
  select * into el from elections where id = eid and not closed and ends_at > now();
  if not found then raise exception 'This election is closed'; end if;
  select * into st from seats where seat = el.seat;
  select * into me from profiles where id = auth.uid();
  if st.requires is not null and not coalesce(me.office = any(st.requires), false) then
    raise exception 'You must hold % first', array_to_string(st.requires, ' or '); end if;
  if exists (select 1 from candidates c join elections x on x.id = c.election_id where c.user_id = auth.uid() and not x.closed) then
    raise exception 'You are already in a race'; end if;
  begin left_over := w_move(auth.uid(), -st.fee, 'nomination form: ' || st.title);
  exception when others then raise exception 'You need ₦% for the form', st.fee; end;
  insert into candidates(election_id, user_id, manifesto) values (eid, auth.uid(), left(coalesce(manifesto, ''), 140));
  insert into news(text) values (me.username || ' is running for ' || st.title || '!');
  return left_over;
end $$;

-------------------------------------------------------------------------------
-- 6. Skills and reputation: earned by doing the work, never bought
-------------------------------------------------------------------------------
create table if not exists public.workers (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  rep int not null default 50 check (rep between 0 and 100),
  shifts_done int not null default 0,
  shifts_missed int not null default 0,
  moral int not null default 0 check (moral between -100 and 100),
  practiced_at timestamptz
);
create table if not exists public.skills (
  user_id uuid references public.profiles(id) on delete cascade,
  skill text not null,
  xp int not null default 0,
  primary key (user_id, skill)
);
alter table public.workers enable row level security;
alter table public.skills enable row level security;
drop policy if exists "workers readable" on public.workers;
create policy "workers readable" on public.workers for select to authenticated using (true);
drop policy if exists "skills readable" on public.skills;
create policy "skills readable" on public.skills for select to authenticated using (true);

create or replace function public.skill_list() returns text[] language sql immutable as $$
  select array['shop','kitchen','fitness','club','delivery','driving','security',
               'mason','electrician','plumber','tiler','carpenter','painter','mechanic',
               'architect','supervisor','aide','organiser','liaison'];
$$;
-- 0 = new, 1 = apprentice (3 jobs), 2 = skilled (10), 3 = master (25)
create or replace function public.skill_level(xp int) returns int language sql immutable as $$
  select case when xp >= 25 then 3 when xp >= 10 then 2 when xp >= 3 then 1 else 0 end;
$$;
create or replace function public.my_level(uid uuid, sk text) returns int language sql stable security definer set search_path = public as $$
  select skill_level(coalesce((select xp from skills where user_id = uid and skill = sk), 0));
$$;
create or replace function public.w_worker(uid uuid) returns void language sql security definer set search_path = public as $$
  insert into workers(user_id) values (uid) on conflict do nothing;
$$;
create or replace function public.w_moral(uid uuid, n int) returns void language sql security definer set search_path = public as $$
  insert into workers(user_id, moral) values (uid, greatest(-100, least(100, n)))
  on conflict (user_id) do update set moral = greatest(-100, least(100, workers.moral + n));
$$;
create or replace function public.w_skill(uid uuid, sk text, n int) returns int language plpgsql security definer set search_path = public as $$
declare x int;
begin
  insert into skills(user_id, skill, xp) values (uid, sk, n) on conflict (user_id, skill) do update set xp = skills.xp + n returning xp into x;
  return x;
end $$;

-- NPC work gives a little practice in shift skills, at most once every 2 minutes
create or replace function public.skill_practice(sk text) returns int
language plpgsql security definer set search_path = public as $$
declare w workers;
begin
  if sk not in ('shop','kitchen','fitness','club','delivery','driving','security') then raise exception 'Trades are learned on real jobs'; end if;
  perform w_worker(auth.uid());
  select * into w from workers where user_id = auth.uid() for update;
  if w.practiced_at > now() - interval '2 minutes' then return my_level(auth.uid(), sk); end if;
  update workers set practiced_at = now() where user_id = auth.uid();
  return skill_level(w_skill(auth.uid(), sk, 1));
end $$;

create or replace function public.my_work_profile() returns json
language plpgsql security definer set search_path = public as $$
begin
  perform w_worker(auth.uid());
  return json_build_object(
    'worker', (select row_to_json(w) from workers w where user_id = auth.uid()),
    'skills', coalesce((select json_object_agg(skill, xp) from skills where user_id = auth.uid()), '{}'::json));
end $$;

-------------------------------------------------------------------------------
-- 7. Goods with real value: building materials, tools and fuel.
--    Priced on the server (midday shock, fuel and market policy), kept in a server inventory.
-------------------------------------------------------------------------------
create table if not exists public.items (
  id text primary key,
  name text not null,
  cat text not null check (cat in ('material','tool','fuel','food','goods')),
  price bigint not null,
  skill text            -- the trade this tool unlocks
);
alter table public.items drop constraint if exists items_cat_check;
alter table public.items add constraint items_cat_check check (cat in ('material','tool','fuel','food','goods'));
insert into public.items values
  ('cement','Cement (50 kg bag)','material',9500,null), ('blocks','Sandcrete blocks (50)','material',32000,null),
  ('sand','Sharp sand (tipper)','material',90000,null), ('rods','Iron rods (10)','material',85000,null),
  ('tiles','Floor tiles (carton)','material',14000,null), ('paint','Emulsion paint (20 L)','material',38000,null),
  ('cable','Electric cable (coil)','material',45000,null), ('pipes','PVC pipes (10)','material',26000,null),
  ('roofing','Roofing sheets (10)','material',120000,null), ('timber','Timber planks (10)','material',40000,null),
  ('fittings','Light fittings (5)','material',18000,null), ('parts','Spare parts box','material',30000,null),
  ('trowel','Mason trowel set','tool',12000,'mason'), ('toolbox','Electrician toolbox','tool',35000,'electrician'),
  ('wrench','Plumber wrench kit','tool',25000,'plumber'), ('cutter','Tile cutter','tool',30000,'tiler'),
  ('saw','Carpenter saw and hammer','tool',22000,'carpenter'), ('roller','Paint rollers and brushes','tool',9000,'painter'),
  ('spanners','Mechanic spanner set','tool',40000,'mechanic'), ('drafting','Drafting kit and laptop','tool',250000,'architect'),
  ('petrol','Petrol (10 L)','fuel',9000,null), ('diesel','Diesel (10 L)','fuel',12000,null),
  ('rice','Rice (50 kg bag)','food',1900,null), ('beans','Beans (bag)','food',2000,null), ('garri','Garri (bag)','food',1200,null), ('oil','Palm oil (keg)','food',1100,null),
  ('noodles','Noodles (carton)','food',350,null), ('tomatoes','Tomatoes (basket)','food',700,null), ('eggs','Eggs (crate)','food',4800,null), ('clothes','Clothes (bale)','goods',9000,null)
on conflict (id) do update set name = excluded.name, cat = excluded.cat, price = excluded.price, skill = excluded.skill;
alter table public.items enable row level security;
drop policy if exists "items readable" on public.items;
create policy "items readable" on public.items for select to authenticated using (true);

create table if not exists public.inventory (
  user_id uuid references public.profiles(id) on delete cascade,
  item text references public.items(id),
  qty int not null default 0 check (qty >= 0),
  primary key (user_id, item)
);
alter table public.inventory enable row level security;
drop policy if exists "own inventory" on public.inventory;
create policy "own inventory" on public.inventory for select to authenticated using (user_id = auth.uid());

-- city policies set by office holders. A policy only counts while its setter still holds the seat.
create table if not exists public.policies (
  key text primary key check (key in ('fuel','market_levy')),
  value numeric not null,
  set_by uuid references public.profiles(id) on delete set null,
  seat text,
  note text,
  set_at timestamptz not null default now()
);
alter table public.policies enable row level security;
drop policy if exists "policies readable" on public.policies;
create policy "policies readable" on public.policies for select to authenticated using (true);

create or replace function public.policy_value(k text) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select p.value from policies p join profiles pr on pr.id = p.set_by and pr.office = p.seat where p.key = k),
                  case k when 'fuel' then 1 else 0 end);
$$;
create or replace function public.price_now(it text) returns bigint language sql stable security definer set search_path = public as $$
  select (round(i.price
    * (case when city_hour() >= 10 and city_hour() < 14 then 1.4 else 1 end)
    * (case when i.cat = 'fuel' then policy_value('fuel') else 1 end)
    * (1 + case when i.cat = 'material' then policy_value('market_levy') else 0 end) / 10) * 10)::bigint
  from items i where i.id = it;
$$;
create or replace function public.market_prices() returns table (id text, name text, cat text, price bigint, skill text, have int)
language sql stable security definer set search_path = public as $$
  select i.id, i.name, i.cat, price_now(i.id), i.skill, coalesce(v.qty, 0)
  from items i left join inventory v on v.item = i.id and v.user_id = auth.uid() order by i.cat, i.price;
$$;
create or replace function public.buy_item(it text, n int) returns json
language plpgsql security definer set search_path = public as $$
declare cost bigint; b bigint; q int;
begin
  if n < 1 or n > 50 then raise exception 'Buy between 1 and 50'; end if;
  cost := price_now(it) * n; if cost is null then raise exception 'Not for sale'; end if;
  b := w_move(auth.uid(), -cost, 'bought ' || n || ' x ' || it);
  insert into inventory(user_id, item, qty) values (auth.uid(), it, n)
    on conflict (user_id, item) do update set qty = inventory.qty + n returning qty into q;
  return json_build_object('balance', b, 'qty', q, 'cost', cost);
end $$;
-- use up goods (fuel into a tank or generator, parts for a repair)
create or replace function public.use_item(it text, n int) returns int
language plpgsql security definer set search_path = public as $$
declare q int;
begin
  update inventory set qty = qty - n where user_id = auth.uid() and item = it and qty >= n and n > 0 returning qty into q;
  if q is null then raise exception 'You do not have enough'; end if;
  return q;
end $$;

create or replace function public.policy_set(k text, v numeric, why text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles;
begin
  select * into me from profiles where id = auth.uid();
  if k = 'fuel' and coalesce(me.office, '') not in ('vp','president') then raise exception 'Only the President or Vice President sets fuel prices'; end if;
  if k = 'market_levy' and coalesce(me.office, '') not in ('chairman','senator','vp','president') then raise exception 'Only a Chairman or higher sets the market levy'; end if;
  if k = 'fuel' and (v < 0.6 or v > 2) then raise exception 'Fuel price must be between 60%% and 200%%'; end if;
  if k = 'market_levy' and (v < 0 or v > 0.3) then raise exception 'Levy must be between 0%% and 30%%'; end if;
  insert into policies(key, value, set_by, seat, note) values (k, v, auth.uid(), me.office, left(why, 100))
    on conflict (key) do update set value = excluded.value, set_by = excluded.set_by, seat = excluded.seat, note = excluded.note, set_at = now();
  -- squeezing people pushes Predator; relief pushes Reformer
  perform w_moral(auth.uid(), case when (k = 'fuel' and v > 1.2) or (k = 'market_levy' and v > 0.1) then -8 when (k = 'fuel' and v < 1) or (k = 'market_levy' and v = 0) then 4 else 0 end);
  insert into news(text) values (case k when 'fuel' then 'FUEL: pump price now ' || round(v * 100) || '% of normal. ' else 'MARKET LEVY now ' || round(v * 100) || '%. ' end || coalesce(why, ''));
end $$;

-------------------------------------------------------------------------------
-- 8. Office budgets and businesses: where job money comes from
-------------------------------------------------------------------------------
create table if not exists public.office_budgets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  office text not null,
  balance bigint not null default 0 check (balance >= 0),
  refilled_at timestamptz not null default now()
);
alter table public.office_budgets enable row level security;
drop policy if exists "budgets readable" on public.office_budgets;
create policy "budgets readable" on public.office_budgets for select to authenticated using (true);

create or replace function public.seat_budget(o text) returns bigint language sql immutable as $$
  select (case o when 'councilor' then 10000000 when 'chairman' then 30000000 when 'senator' then 100000000 when 'vp' then 300000000 when 'president' then 1000000000 else 0 end)::bigint;
$$;
-- each seat's budget refills once a real day; it is gone when you leave office
create or replace function public.budget_ensure(uid uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare o text; b office_budgets;
begin
  select office into o from profiles where id = uid;
  if o is null then delete from office_budgets where user_id = uid; return 0; end if;
  select * into b from office_budgets where user_id = uid for update;
  if not found or b.office <> o or b.refilled_at < now() - interval '1 day' then
    insert into office_budgets(user_id, office, balance, refilled_at) values (uid, o, seat_budget(o), now())
      on conflict (user_id) do update set office = o, balance = seat_budget(o), refilled_at = now();
    return seat_budget(o);
  end if;
  return b.balance;
end $$;
create or replace function public.my_budget() returns bigint language sql security definer set search_path = public as $$ select budget_ensure(auth.uid()); $$;

create table if not exists public.businesses (
  id bigserial primary key,
  owner uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(name) between 3 and 40),
  kind text not null check (kind in ('shop','restaurant','club','gym','logistics','construction','security','media')),
  funds bigint not null default 0 check (funds >= 0),
  created_at timestamptz not null default now()
);
alter table public.businesses enable row level security;
drop policy if exists "businesses readable" on public.businesses;
create policy "businesses readable" on public.businesses for select to authenticated using (true);

create or replace function public.business_open(nm text, k text) returns bigint
language plpgsql security definer set search_path = public as $$
declare id_ bigint;
begin
  if (select life from profiles where id = auth.uid()) <> 'sponsor' then raise exception 'Only Sponsors register businesses for now'; end if;
  if (select count(*) from businesses where owner = auth.uid()) >= 3 then raise exception 'You already run 3 businesses'; end if;
  perform w_move(auth.uid(), -5000000, 'CAC registration: ' || nm);
  insert into businesses(owner, name, kind) values (auth.uid(), nm, k) returning id into id_;
  insert into news(text) values ((select username from profiles where id = auth.uid()) || ' opened ' || nm || '. They will be hiring.');
  return id_;
end $$;
create or replace function public.business_fund(bid bigint, amount bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare f bigint;
begin
  if amount <= 0 then raise exception 'Enter an amount'; end if;
  if not exists (select 1 from businesses where id = bid and owner = auth.uid()) then raise exception 'Not your business'; end if;
  perform w_move(auth.uid(), -amount, 'funded business #' || bid);
  update businesses set funds = funds + amount where id = bid returning funds into f;
  perform w_moral(auth.uid(), 1);
  return f;
end $$;

-------------------------------------------------------------------------------
-- 9. Jobs: posted by players, businesses, unions, government and city firms.
--    Pay is held in escrow when posted, and paid per finished shift.
-------------------------------------------------------------------------------
create table if not exists public.jobs (
  id bigserial primary key,
  poster uuid references public.profiles(id) on delete cascade,      -- null = a city firm
  business_id bigint references public.businesses(id) on delete set null,
  employer text not null,
  source text not null check (source in ('city','own','business','union','seat')),
  kind text not null check (kind in ('shift','trade','pro','staff')),
  title text not null check (length(title) between 3 and 50),
  skill text not null,
  min_level int not null default 0 check (min_level between 0 and 3),
  pay bigint not null check (pay between 500 and 50000000),
  unit text not null check (unit in ('hour','job')),
  start_hour int not null check (start_hour between 0 and 23),
  hours int not null check (hours between 1 and 8),
  days int not null default 1 check (days between 1 and 7),
  slots int not null default 1 check (slots between 1 and 10),
  place text not null,
  x real not null, z real not null,
  moral text not null check (moral in ('clean','padded','union','government')),
  due_pct int not null default 0 check (due_pct between 0 and 30),
  escrow bigint not null default 0 check (escrow >= 0),
  meta jsonb not null default '{}',
  open boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists jobs_open on public.jobs (open, start_hour);
alter table public.jobs enable row level security;
drop policy if exists "jobs readable" on public.jobs;
create policy "jobs readable" on public.jobs for select to authenticated using (true);

create table if not exists public.applications (
  job_id bigint references public.jobs(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  status text not null default 'applied' check (status in ('applied','shortlisted','hired','rejected','fired','quit')),
  created_at timestamptz not null default now(),
  primary key (job_id, user_id)
);
alter table public.applications enable row level security;
drop policy if exists "applications visible" on public.applications;
create policy "applications visible" on public.applications for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.jobs j where j.id = job_id and j.poster = auth.uid()));

create table if not exists public.shifts (
  id bigserial primary key,
  job_id bigint not null references public.jobs(id) on delete cascade,
  worker uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','on','done','missed','cancelled')),
  checkin_at timestamptz,
  paid bigint not null default 0,
  unique (job_id, worker, starts_at)
);
create index if not exists shifts_worker on public.shifts (worker, starts_at);
alter table public.shifts enable row level security;
drop policy if exists "shifts visible" on public.shifts;
create policy "shifts visible" on public.shifts for select to authenticated
  using (worker = auth.uid() or exists (select 1 from public.jobs j where j.id = job_id and j.poster = auth.uid()));

create or replace function public.shift_pay(j jobs) returns bigint language sql immutable as $$
  select case when j.unit = 'hour' then j.pay * j.hours else j.pay end;
$$;
-- real time of the next time the city clock reaches hour h (at least 30 s from now), plus k city days
create or replace function public.next_city_hour(h int, k int) returns timestamptz language sql stable as $$
  select to_timestamp((extract(epoch from now()) / 60 + (case when d > 23 then d - 24 else d end) + 24 * k) * 60)
  from (select mod(h - city_hour() + 24, 24) as d) t;      -- a shift that started under a minute ago can still be joined
$$;

-- who may post what, and where the money comes from
create or replace function public.job_post(j jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare me profiles; src text := j->>'source'; k text := j->>'kind'; jid bigint; esc bigint; skim bigint := 0;
        mo text := coalesce(j->>'moral', 'clean'); emp text; biz businesses; per bigint; nslots int; ndays int; si record; j_x real; j_z real;
begin
  select * into me from profiles where id = auth.uid();
  -- hire for a building site you own: builders work its pieces; an architect drafts in the Building Explorer
  if j->'meta' ? 'site' then
    if site_role(j->'meta'->>'site') is distinct from 'owner' then raise exception 'Pick one of your building sites'; end if;
    select * into si from site_meta(j->'meta'->>'site');
    j := j || jsonb_build_object('x', si.x, 'z', si.z, 'place', si.name || ' (building site)');
    if j->>'skill' = 'architect' then j := j || '{"kind":"pro","unit":"job","hours":1,"days":1,"slots":1}'; k := 'pro';
    else j := j || jsonb_build_object('kind', 'trade', 'min_level', greatest(case when j->>'skill' = 'mason' then 0 else 1 end, coalesce((j->>'min_level')::int, 1))); k := 'trade'; end if;
  end if;
  if not (j->>'skill' = any(skill_list())) then raise exception 'Unknown skill'; end if;
  nslots := coalesce((j->>'slots')::int, 1); ndays := coalesce((j->>'days')::int, 1);
  per := case when j->>'unit' = 'hour' then (j->>'pay')::bigint * (j->>'hours')::int else (j->>'pay')::bigint end;
  emp := me.username;
  if src = 'own' then
    if nslots > 2 or ndays > 3 then raise exception 'Personal hires: up to 2 people for up to 3 days'; end if;
    if k not in ('shift','trade','pro') then raise exception 'Personal hires are shift, trade or professional work'; end if;
    mo := 'clean';
  elsif src = 'union' then
    if me.life <> 'coordinator' then raise exception 'Only Coordinators post union jobs'; end if;
    if j->>'place' not in ('Nyanya Motor Park','Abuja Motor Park','Unity Market','Nyanya Park Market') then raise exception 'Union jobs are at the motor parks and the markets'; end if;
    if (select count(*) from jobs where poster = auth.uid() and source = 'union' and open) >= 3 then raise exception 'You can run 3 union jobs at a time'; end if;
    if j->>'unit' <> 'hour' or (j->>'pay')::bigint > 4000 then raise exception 'Union pay is set by the traders: up to ₦4,000 an hour'; end if;
    mo := 'union'; emp := me.username || ' (union)';
  elsif src = 'business' then
    select * into biz from businesses where id = (j->>'business_id')::bigint and owner = auth.uid();
    if not found then raise exception 'Pick one of your businesses'; end if;
    if k = 'staff' then raise exception 'Political staff are hired by office holders'; end if;
    emp := biz.name; mo := 'clean';
  elsif src = 'seat' then
    if me.office is null then raise exception 'Only office holders post government jobs'; end if;
    if mo not in ('government','padded') then mo := 'government'; end if;
    emp := initcap(me.office) || ' ' || me.username;
  else raise exception 'Choose who pays'; end if;
  if j->'meta'->>'site' like 'plot:%' and src = 'seat' then mo := 'padded'; end if;     -- public money on a private building
  -- a job at a work floor's door works that floor (only the server attaches floors and contracts)
  j := jsonb_set(j, '{meta}', (coalesce(j->'meta', '{}') - 'floor' - 'contract')
       || coalesce((select jsonb_build_object('floor', f.site) from floors f where f.door = j->>'place'), '{}'));
  if j->'meta' ? 'floor' then select f.x, f.z into j_x, j_z from floors f where f.site = j->'meta'->>'floor'; j := j || jsonb_build_object('x', j_x, 'z', j_z); end if;

  esc := case when src = 'union' then 0 else per * nslots * ndays end;     -- union pay comes from the traders' levy
  if mo = 'padded' then skim := esc * 3 / 10; end if;

  if src = 'own' then perform w_move(auth.uid(), -esc, 'job escrow');
  elsif src = 'business' then
    update businesses set funds = funds - esc where id = biz.id and funds >= esc;
    if not found then raise exception 'The business needs ₦% in funds', esc; end if;
  elsif src = 'seat' then
    perform budget_ensure(auth.uid());
    update office_budgets set balance = balance - esc - skim where user_id = auth.uid() and balance >= esc + skim;
    if not found then raise exception 'Your office budget is too small for this'; end if;
    if skim > 0 then perform w_move(auth.uid(), skim, 'contract padding'); end if;
  end if;

  insert into jobs(poster, business_id, employer, source, kind, title, skill, min_level, pay, unit, start_hour, hours, days, slots, place, x, z, moral, due_pct, escrow, meta)
  values (auth.uid(), biz.id, emp, src, k, left(j->>'title', 50), j->>'skill', coalesce((j->>'min_level')::int, 0), (j->>'pay')::bigint, j->>'unit',
          (j->>'start_hour')::int, (j->>'hours')::int, ndays, nslots, left(j->>'place', 60), (j->>'x')::real, (j->>'z')::real, mo,
          case when src = 'union' then least(30, greatest(0, coalesce((j->>'due_pct')::int, 10))) else 0 end, esc, coalesce(j->'meta', '{}'))
  returning id into jid;
  -- moral line: padding and greedy dues push the dark side; clean hiring pushes the bright side
  perform w_moral(auth.uid(), case when mo = 'padded' then -10 when src = 'union' and coalesce((j->>'due_pct')::int, 10) > 20 then -4 when src = 'union' then 1 else 2 end);
  return jid;
end $$;

-- every open job, with how full it is and where I stand
create or replace function public.jobs_board() returns table (
  id bigint, employer text, source text, kind text, title text, skill text, min_level int, pay bigint, unit text,
  start_hour int, hours int, days int, slots int, place text, x real, z real, moral text, due_pct int, meta jsonb,
  hired bigint, mine boolean, my_status text, my_level int)
language sql stable security definer set search_path = public as $$
  select j.id, j.employer, j.source, j.kind, j.title, j.skill, j.min_level, j.pay, j.unit, j.start_hour, j.hours, j.days, j.slots,
         j.place, j.x, j.z, j.moral, j.due_pct, j.meta,
         (select count(*) from applications a where a.job_id = j.id and a.status = 'hired'),
         j.poster = auth.uid(),
         (select a.status from applications a where a.job_id = j.id and a.user_id = auth.uid()),
         my_level(auth.uid(), j.skill)
  from jobs j where j.open order by mod(j.start_hour - floor(city_hour())::int + 24, 24), j.id;
$$;

create or replace function public.w_schedule(jb jobs, uid uuid) returns int
language plpgsql security definer set search_path = public as $$
declare d int; s timestamptz; n int := 0;
begin
  if jb.skill = 'architect' and jb.meta ? 'site' then return 0; end if;          -- an architect drafts in the explorer; paid on approval
  for d in 0 .. (case when jb.source = 'city' then 0 else jb.days - 1 end) loop
    s := next_city_hour(jb.start_hour, d);
    insert into shifts(job_id, worker, starts_at, ends_at) values (jb.id, uid, s, s + make_interval(mins => jb.hours)) on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.job_apply(jid bigint) returns text
language plpgsql security definer set search_path = public as $$
declare jb jobs; lvl int; tool text;
begin
  select * into jb from jobs where id = jid and open;
  if not found then raise exception 'This job is closed'; end if;
  if jb.poster = auth.uid() then raise exception 'You posted this job'; end if;
  lvl := my_level(auth.uid(), jb.skill);
  if lvl < jb.min_level then raise exception 'You need % level % (you are %)', jb.skill, jb.min_level, lvl; end if;
  select id into tool from items where skill = jb.skill and cat = 'tool';
  if tool is not null and jb.min_level >= 1 and not exists (select 1 from inventory where user_id = auth.uid() and item = tool and qty > 0) then
    raise exception 'Bring your own tools: buy a % at Unity Market', (select name from items where id = tool); end if;
  perform w_worker(auth.uid());
  if jb.source = 'city' then
    -- city firms hire on the spot for the next shift
    insert into applications(job_id, user_id, status) values (jid, auth.uid(), 'hired')
      on conflict (job_id, user_id) do update set status = 'hired', created_at = now();
    perform w_schedule(jb, auth.uid());
    return 'hired';
  end if;
  insert into applications(job_id, user_id) values (jid, auth.uid())
    on conflict (job_id, user_id) do update set status = case when applications.status in ('quit','rejected') then 'applied' else applications.status end;
  return 'applied';
end $$;

-- employers see skill and reputation, never money
create or replace function public.job_applicants(jid bigint) returns table (
  user_id uuid, username text, avatar jsonb, status text, level int, xp int, rep int, shifts_done int, shifts_missed int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from jobs where id = jid and poster = auth.uid()) then raise exception 'Not your job'; end if;
  return query select a.user_id, p.username::text, p.avatar, a.status, my_level(a.user_id, j.skill),
    coalesce((select s.xp from skills s where s.user_id = a.user_id and s.skill = j.skill), 0),
    coalesce(w.rep, 50), coalesce(w.shifts_done, 0), coalesce(w.shifts_missed, 0)
  from applications a join jobs j on j.id = a.job_id join profiles p on p.id = a.user_id left join workers w on w.user_id = a.user_id
  where a.job_id = jid order by (a.status = 'hired') desc, coalesce(w.rep, 50) desc;
end $$;

create or replace function public.job_decide(jid bigint, uid uuid, act text) returns text
language plpgsql security definer set search_path = public as $$
declare jb jobs; st text;
begin
  select * into jb from jobs where id = jid and poster = auth.uid() for update;
  if not found then raise exception 'Not your job'; end if;
  select status into st from applications where job_id = jid and user_id = uid;
  if st is null then raise exception 'They did not apply'; end if;
  if act = 'shortlist' and st = 'applied' then update applications set status = 'shortlisted' where job_id = jid and user_id = uid;
  elsif act = 'reject' and st in ('applied','shortlisted') then update applications set status = 'rejected' where job_id = jid and user_id = uid;
  elsif act = 'hire' and st in ('applied','shortlisted') then
    if not jb.open then raise exception 'This job is closed'; end if;
    if (select count(*) from applications where job_id = jid and status = 'hired') >= jb.slots then raise exception 'All % places are filled', jb.slots; end if;
    update applications set status = 'hired' where job_id = jid and user_id = uid;
    perform w_schedule(jb, uid);
    -- hiring someone with no skill for skilled work looks like a favour
    if jb.min_level = 0 and jb.kind in ('trade','pro') and my_level(uid, jb.skill) = 0 and jb.source = 'seat' then perform w_moral(auth.uid(), -3); end if;
  elsif act = 'fire' and st = 'hired' then
    update applications set status = 'fired' where job_id = jid and user_id = uid;
    update shifts set status = 'cancelled' where job_id = jid and worker = uid and status = 'scheduled';
  else raise exception 'Cannot % someone who is %', act, st; end if;
  return act;
end $$;

create or replace function public.job_quit(jid bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update applications set status = 'quit' where job_id = jid and user_id = auth.uid() and status in ('applied','shortlisted','hired');
  if not found then raise exception 'You are not on this job'; end if;
  if exists (select 1 from shifts where job_id = jid and worker = auth.uid() and status = 'scheduled') then
    update shifts set status = 'cancelled' where job_id = jid and worker = auth.uid() and status = 'scheduled';
    update workers set rep = greatest(0, rep - 3) where user_id = auth.uid();
  end if;
end $$;

-- close a job and return unused escrow to whoever paid it
-- close a job and return unused escrow to whoever paid it (internal)
create or replace function public.w_close_job(jid bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare jb jobs;
begin
  select * into jb from jobs where id = jid and open for update;
  if not found then return 0; end if;
  update shifts set status = 'cancelled' where job_id = jid and status = 'scheduled';
  update jobs set open = false, escrow = 0 where id = jid;
  if jb.escrow > 0 then
    if jb.source = 'own' then perform w_move(jb.poster, jb.escrow, 'job closed: refund');
    elsif jb.source = 'business' then update businesses set funds = funds + jb.escrow where id = jb.business_id;
    elsif jb.source = 'seat' then perform budget_ensure(jb.poster); update office_budgets set balance = balance + jb.escrow where user_id = jb.poster;
    end if;
  end if;
  return jb.escrow;
end $$;
create or replace function public.job_close(jid bigint) returns bigint
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from jobs where id = jid and poster = auth.uid() and open) then raise exception 'Not your open job'; end if;
  if exists (select 1 from shifts where job_id = jid and status = 'on') then raise exception 'Someone is on shift now. Close it after.'; end if;
  return w_close_job(jid);
end $$;

-- mark shifts nobody turned up for (called whenever shifts are read)
create or replace function public.w_settle(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with m as (update shifts set status = 'missed' where worker = uid and status = 'scheduled' and ends_at < now() returning 1)
  select count(*) into n from m;
  if n > 0 then update workers set rep = greatest(0, rep - 5 * n), shifts_missed = shifts_missed + n where user_id = uid; end if;
end $$;

create or replace function public.my_shifts() returns table (
  id bigint, job_id bigint, title text, employer text, place text, x real, z real, starts_at timestamptz, ends_at timestamptz,
  status text, pay bigint, skill text, moral text, meta jsonb)
language plpgsql security definer set search_path = public as $$
begin
  perform w_worker(auth.uid()); perform w_settle(auth.uid());
  return query select s.id, s.job_id, j.title, j.employer, j.place, j.x, j.z, s.starts_at, s.ends_at, s.status, case when j.unit = 'hour' then round(j.pay * greatest(1, extract(epoch from s.ends_at - s.starts_at) / 60))::bigint else shift_pay(j) end, j.skill, j.moral, j.meta
    from shifts s join jobs j on j.id = s.job_id
    where s.worker = auth.uid() and (s.status in ('scheduled','on') or s.ends_at > now() - interval '30 minutes') order by s.starts_at limit 20;
end $$;

-- my posted jobs and their latest results (repairs read this)
create or replace function public.my_posts() returns table (id bigint, title text, open boolean, slots int, hired bigint, applied bigint, done bigint, meta jsonb, escrow bigint)
language sql stable security definer set search_path = public as $$
  select j.id, j.title, j.open, j.slots,
    (select count(*) from applications a where a.job_id = j.id and a.status = 'hired'),
    (select count(*) from applications a where a.job_id = j.id and a.status in ('applied','shortlisted')),
    (select count(*) from shifts s where s.job_id = j.id and s.status = 'done'), j.meta, j.escrow
  from jobs j where j.poster = auth.uid() and (j.open or j.created_at > now() - interval '2 days') order by j.id desc limit 30;
$$;

create or replace function public.shift_checkin(sid bigint, px real, pz real) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare s shifts; jb jobs;
begin
  select * into s from shifts where id = sid and worker = auth.uid() for update;
  if not found or s.status <> 'scheduled' then raise exception 'This shift is not waiting for you'; end if;
  if now() < s.starts_at - interval '60 seconds' then raise exception 'Too early. Your shift starts at the top of the hour.'; end if;
  if now() > s.ends_at then raise exception 'You missed this shift'; end if;
  if exists (select 1 from shifts where worker = auth.uid() and status = 'on' and id <> sid) then raise exception 'Finish your other shift first'; end if;
  select * into jb from jobs where id = s.job_id;
  if sqrt(power(px - jb.x, 2) + power(pz - jb.z, 2)) > 25 then raise exception 'Go to % to clock in', jb.place; end if;
  update shifts set status = 'on', checkin_at = now() where id = sid;
  return s.ends_at;
end $$;

create or replace function public.shift_finish(sid bigint, px real, pz real) returns json
language plpgsql security definer set search_path = public as $$
declare s shifts; jb jobs; full_pay bigint; amt bigint; due bigint := 0; frac numeric; x int; mo int;
begin
  select * into s from shifts where id = sid and worker = auth.uid() for update;
  if not found or s.status <> 'on' then raise exception 'You are not on this shift'; end if;
  if now() < s.ends_at - interval '5 seconds' then raise exception 'The shift is not over yet'; end if;
  select * into jb from jobs where id = s.job_id for update;
  if sqrt(power(px - jb.x, 2) + power(pz - jb.z, 2)) > 25 then raise exception 'Finish the shift at %', jb.place; end if;
  full_pay := shift_pay(jb);
  frac := least(1, greatest(0, extract(epoch from (s.ends_at - greatest(s.checkin_at, s.starts_at))) / extract(epoch from (s.ends_at - s.starts_at))));
  amt := round(full_pay * frac);
  if jb.source <> 'city' and jb.source <> 'union' then
    amt := least(amt, jb.escrow);
    update jobs set escrow = escrow - amt where id = jb.id;
  end if;
  if jb.source = 'union' and jb.poster is not null then due := amt * jb.due_pct / 100; perform w_move(jb.poster, due, 'union dues'); end if;
  perform w_move(auth.uid(), amt - due, 'wages: ' || jb.title);
  update shifts set status = 'done', paid = amt - due where id = sid;
  x := w_skill(auth.uid(), jb.skill, case when frac >= 0.99 then 2 else 1 end);
  mo := case jb.moral when 'padded' then -1 when 'clean' then 1 else 0 end;
  update workers set rep = least(100, rep + 2), shifts_done = shifts_done + 1 where user_id = auth.uid();
  if mo <> 0 then perform w_moral(auth.uid(), mo); end if;
  return json_build_object('paid', amt - due, 'due', due, 'xp', x, 'level', skill_level(x), 'skill', jb.skill, 'moral', mo,
                           'balance', (select balance from wallets where user_id = auth.uid()));
end $$;

-- city firms: always hiring, so no one is ever without work
insert into public.jobs (id, poster, employer, source, kind, title, skill, min_level, pay, unit, start_hour, hours, days, slots, place, x, z, moral)
values
  (1, null, 'FreshMart', 'city', 'shift', 'Cashier', 'shop', 0, 3000, 'hour', 8, 4, 1, 10, 'FreshMart Supermarket', -17, 340, 'clean'),
  (2, null, 'Calabar Kitchen', 'city', 'shift', 'Kitchen hand', 'kitchen', 0, 3000, 'hour', 11, 4, 1, 10, 'Calabar Kitchen (restaurant)', 18, 290, 'clean'),
  (3, null, 'IronFit Gym', 'city', 'shift', 'Gym assistant', 'fitness', 0, 3500, 'hour', 6, 3, 1, 10, 'IronFit Gym', 18, 372, 'clean'),
  (4, null, 'Club 27', 'city', 'shift', 'Bouncer', 'security', 1, 6000, 'hour', 21, 4, 1, 10, 'Club 27 (nightclub)', 17, 344, 'clean'),
  (5, null, 'Kwik Dispatch', 'city', 'shift', 'Dispatch rider', 'delivery', 0, 3500, 'hour', 17, 4, 1, 10, 'Kwik Dispatch', 92, 378, 'clean'),
  (6, null, 'Unity Market traders', 'city', 'shift', 'Market loader', 'shop', 0, 2500, 'hour', 7, 3, 1, 10, 'Unity Market', -96, 32, 'union'),
  (7, null, 'FCDA Works', 'city', 'trade', 'Site labourer (mason)', 'mason', 0, 3000, 'hour', 7, 5, 1, 10, 'Federal Secretariat', -107, -12, 'government'),
  (8, null, 'FCDA Works', 'city', 'trade', 'Electrician''s mate', 'electrician', 0, 3000, 'hour', 9, 4, 1, 10, 'Ministry Annex', -85, -12, 'government'),
  (9, null, 'Garki Plumbing Co.', 'city', 'trade', 'Plumber''s mate', 'plumber', 0, 3000, 'hour', 13, 4, 1, 10, 'Garki Centre', -42, 14, 'clean'),
  (10, null, 'Wuse Tower', 'city', 'trade', 'Tiling crew', 'tiler', 0, 3000, 'hour', 10, 4, 1, 10, 'Wuse Tower', -22, 49, 'clean'),
  (11, null, 'Furniture Palace', 'city', 'trade', 'Carpentry apprentice', 'carpenter', 0, 3000, 'hour', 12, 4, 1, 10, 'Furniture Palace', -116, 90, 'clean'),
  (12, null, 'Aso Plaza', 'city', 'trade', 'Painting crew', 'painter', 0, 2800, 'hour', 14, 4, 1, 10, 'Aso Plaza', 42, -51, 'clean'),
  (13, null, 'Jabi Motors', 'city', 'trade', 'Workshop boy (mechanic)', 'mechanic', 0, 3000, 'hour', 8, 5, 1, 10, 'Jabi Motors (car dealer)', 0, 172, 'clean'),
  (14, null, 'Utako Tech Hub', 'city', 'pro', 'Junior draughtsman', 'architect', 0, 4000, 'hour', 10, 4, 1, 10, 'Utako Tech Hub', 91, 344, 'clean'),
  (15, null, 'FCDA Works', 'city', 'pro', 'Site supervisor', 'supervisor', 2, 9000, 'hour', 7, 5, 1, 10, 'Federal Secretariat', -107, -12, 'government'),
  (16, null, 'Grand Abuja Hotel', 'city', 'pro', 'Hotel driver', 'driving', 0, 3500, 'hour', 15, 4, 1, 10, 'Grand Abuja Hotel', -16, 300, 'clean'),
  (17, null, 'Sovereign Trust Bank', 'city', 'pro', 'Bank security', 'security', 0, 4000, 'hour', 8, 6, 1, 10, 'Sovereign Trust Bank HQ', 285, 52, 'clean'),
  (18, null, 'AMAC Secretariat', 'city', 'staff', 'Rally organiser', 'organiser', 0, 3500, 'hour', 15, 3, 1, 10, 'Eagle Square (rallies)', -150, 330, 'government'),
  (19, null, 'Vibes Lounge', 'city', 'shift', 'Bar staff', 'club', 0, 3000, 'hour', 19, 4, 1, 10, 'Vibes Lounge (bar)', 19, 316, 'clean'),
  (20, null, 'Grand Abuja Hotel', 'city', 'shift', 'Night porter', 'shop', 0, 3200, 'hour', 23, 5, 1, 10, 'Grand Abuja Hotel', -16, 300, 'clean')
on conflict (id) do update set employer = excluded.employer, title = excluded.title, skill = excluded.skill, min_level = excluded.min_level, pay = excluded.pay,
  start_hour = excluded.start_hour, hours = excluded.hours, place = excluded.place, x = excluded.x, z = excluded.z, moral = excluded.moral, open = true;
select setval(pg_get_serial_sequence('public.jobs', 'id'), greatest(100, (select max(id) from public.jobs)));

-------------------------------------------------------------------------------
-- 10. Picture frames: player photos on house walls. Owners see their own;
--     visitors see a photo only after a moderator approves it.
-------------------------------------------------------------------------------
create table if not exists public.frames (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  path text not null unique,
  status text not null default 'pending' check (status in ('pending','approved','rejected','removed')),
  reports int not null default 0,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.frames enable row level security;
drop policy if exists "frames visible" on public.frames;
create policy "frames visible" on public.frames for select to authenticated using (owner = auth.uid() or status = 'approved' or public.is_admin());

create table if not exists public.frame_reports (
  frame_id uuid references public.frames(id) on delete cascade,
  reporter uuid references public.profiles(id) on delete cascade,
  reason text not null default '',
  created_at timestamptz not null default now(),
  primary key (frame_id, reporter)
);
alter table public.frame_reports enable row level security;

create or replace function public.frame_add(p text) returns uuid
language plpgsql security definer set search_path = public as $$
declare fid uuid;
begin
  if split_part(p, '/', 1) <> auth.uid()::text then raise exception 'Upload to your own folder'; end if;
  if (select count(*) from frames where owner = auth.uid() and status <> 'removed') >= 12 then raise exception 'You can keep 12 photos. Remove one first.'; end if;
  insert into frames(owner, path) values (auth.uid(), p) returning id into fid;
  return fid;
end $$;
create or replace function public.frame_remove(fid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare p text;
begin
  update frames set status = 'removed' where id = fid and owner = auth.uid() returning path into p;
  if p is null then raise exception 'Not your photo'; end if;
  return p;
end $$;
create or replace function public.frame_report(fid uuid, why text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into frame_reports(frame_id, reporter, reason) values (fid, auth.uid(), left(coalesce(why, ''), 140));
  update frames set reports = reports + 1, status = case when reports + 1 >= 3 and status = 'approved' then 'pending' else status end where id = fid;
exception when unique_violation then null;
end $$;
-- moderators (is_admin) approve, reject or take down
create or replace function public.frame_review(fid uuid, st text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Moderators only'; end if;
  if st not in ('approved','rejected','removed') then raise exception 'Bad status'; end if;
  update frames set status = st, reviewed_by = auth.uid(), reports = case when st = 'approved' then 0 else reports end where id = fid;
end $$;
create or replace function public.frames_queue() returns table (id uuid, owner_name text, path text, status text, reports int, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Moderators only'; end if;
  return query select f.id, p.username::text, f.path, f.status, f.reports, f.created_at from frames f join profiles p on p.id = f.owner
    where f.status = 'pending' order by f.reports desc, f.created_at limit 50;
end $$;

-- photo storage: 300 KB, images only, each player writes only their own folder
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('frames', 'frames', false, 307200, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 307200, allowed_mime_types = array['image/jpeg','image/png','image/webp'];
drop policy if exists "frames upload own" on storage.objects;
create policy "frames upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'frames' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "frames read" on storage.objects;
create policy "frames read" on storage.objects for select to authenticated
  using (bucket_id = 'frames' and ((storage.foldername(name))[1] = auth.uid()::text
         or exists (select 1 from public.frames f where f.path = name and f.status = 'approved') or public.is_admin()));
drop policy if exists "frames delete own" on storage.objects;
create policy "frames delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'frames' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-------------------------------------------------------------------------------
-- 11. Who may call what. Supabase lets everyone run functions by default,
--     so internal helpers are locked and only the game's actions are opened.
-------------------------------------------------------------------------------
do $$ declare f text; begin
  foreach f in array array['w_ensure(uuid)','w_move(uuid,bigint,text)','w_worker(uuid)','w_moral(uuid,integer)','w_skill(uuid,text,integer)',
                           'w_schedule(public.jobs,uuid)','w_settle(uuid)','budget_ensure(uuid)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
  end loop;
  foreach f in array array['wallet_get()','wallet_sync(bigint,bigint,text)','skill_practice(text)','my_work_profile()','market_prices()',
                           'buy_item(text,integer)','use_item(text,integer)','policy_set(text,numeric,text)','my_budget()','business_open(text,text)',
                           'business_fund(bigint,bigint)','job_post(jsonb)','jobs_board()','job_apply(bigint)','job_applicants(bigint)',
                           'job_decide(bigint,uuid,text)','job_quit(bigint)','job_close(bigint)','my_shifts()','my_posts()',
                           'shift_checkin(bigint,real,real)','shift_finish(bigint,real,real)','frame_add(text)','frame_remove(uuid)',
                           'frame_report(uuid,text)','frame_review(uuid,text)','frames_queue()'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;

-------------------------------------------------------------------------------
-- 12. Land: plots with a server-owned title. Buy from the city, or from a player
--     who lists their plot for sale. The building on a plot goes with it.
-------------------------------------------------------------------------------
create table if not exists public.plots (
  id int primary key,
  code text unique not null,
  zone text not null,
  kind text not null check (kind in ('residential','shop','office','workshop','mixed')),
  x real not null, z real not null, w real not null, d real not null,
  face int not null check (face in (-1, 1)),
  price bigint not null,
  owner uuid references public.profiles(id) on delete set null,
  ask bigint check (ask is null or ask between 100000 and 10000000000),
  bought_at timestamptz
);
alter table public.plots enable row level security;
drop policy if exists "plots readable" on public.plots;
create policy "plots readable" on public.plots for select to authenticated using (true);
-- generated from src/plots.js by: node tools/plots-sql.mjs
insert into public.plots (id, code, zone, kind, x, z, w, d, face, price) values
  (1, 'L-01', 'lugbe', 'shop', -42, -172, 20, 24, -1, 4000000),
  (2, 'L-02', 'lugbe', 'residential', -66, -172, 20, 24, -1, 2500000),
  (3, 'L-03', 'lugbe', 'residential', -90, -172, 20, 24, -1, 2500000),
  (4, 'L-04', 'lugbe', 'residential', -114, -172, 20, 24, -1, 2500000),
  (5, 'L-05', 'lugbe', 'residential', -138, -172, 20, 24, -1, 2500000),
  (6, 'L-06', 'lugbe', 'mixed', -162, -172, 20, 24, -1, 6000000),
  (7, 'L-07', 'lugbe', 'residential', -186, -172, 20, 24, -1, 2500000),
  (8, 'L-08', 'lugbe', 'residential', -210, -172, 20, 24, -1, 2500000),
  (9, 'L-09', 'lugbe', 'shop', -42, -228, 20, 24, 1, 4000000),
  (10, 'L-10', 'lugbe', 'residential', -66, -228, 20, 24, 1, 2500000),
  (11, 'L-11', 'lugbe', 'residential', -90, -228, 20, 24, 1, 2500000),
  (12, 'L-12', 'lugbe', 'workshop', -114, -228, 20, 24, 1, 5000000),
  (13, 'L-13', 'lugbe', 'residential', -138, -228, 20, 24, 1, 2500000),
  (14, 'L-14', 'lugbe', 'residential', -162, -228, 20, 24, 1, 2500000),
  (15, 'L-15', 'lugbe', 'mixed', -186, -228, 20, 24, 1, 6000000),
  (16, 'L-16', 'lugbe', 'residential', -210, -228, 20, 24, 1, 2500000),
  (17, 'K-01', 'katampe', 'office', 42, -172, 20, 24, -1, 14400000),
  (18, 'K-02', 'katampe', 'office', 66, -172, 20, 24, -1, 14400000),
  (19, 'K-03', 'katampe', 'mixed', 90, -172, 20, 24, -1, 9600000),
  (20, 'K-04', 'katampe', 'office', 114, -172, 20, 24, -1, 14400000),
  (21, 'K-05', 'katampe', 'office', 138, -172, 20, 24, -1, 14400000),
  (22, 'K-06', 'katampe', 'mixed', 162, -172, 20, 24, -1, 9600000),
  (23, 'K-07', 'katampe', 'office', 186, -172, 20, 24, -1, 14400000),
  (24, 'K-08', 'katampe', 'office', 210, -172, 20, 24, -1, 14400000),
  (25, 'K-09', 'katampe', 'workshop', 42, -228, 20, 24, 1, 8000000),
  (26, 'K-10', 'katampe', 'workshop', 66, -228, 20, 24, 1, 8000000),
  (27, 'K-11', 'katampe', 'office', 90, -228, 20, 24, 1, 14400000),
  (28, 'K-12', 'katampe', 'workshop', 114, -228, 20, 24, 1, 8000000),
  (29, 'K-13', 'katampe', 'mixed', 138, -228, 20, 24, 1, 9600000),
  (30, 'K-14', 'katampe', 'workshop', 162, -228, 20, 24, 1, 8000000),
  (31, 'K-15', 'katampe', 'office', 186, -228, 20, 24, 1, 14400000),
  (32, 'K-16', 'katampe', 'workshop', 210, -228, 20, 24, 1, 8000000)
on conflict (id) do update set code = excluded.code, zone = excluded.zone, kind = excluded.kind, x = excluded.x, z = excluded.z,
  w = excluded.w, d = excluded.d, face = excluded.face, price = excluded.price;

create or replace function public.plot_limit(lf text) returns int language sql immutable as $$
  select case lf when 'sponsor' then 6 when 'citizen' then 2 else 3 end;
$$;
-- buy from the city (list price) or from the owner (their asking price)
create or replace function public.plot_buy(pid int) returns json
language plpgsql security definer set search_path = public as $$
declare pl plots; me profiles; cost bigint; b bigint; seller uuid;
begin
  select * into pl from plots where id = pid for update;
  if not found then raise exception 'No such plot'; end if;
  select * into me from profiles where id = auth.uid();
  if pl.owner = auth.uid() then raise exception 'You own this plot'; end if;
  if pl.owner is not null and pl.ask is null then raise exception 'This plot is not for sale'; end if;
  if (select count(*) from plots where owner = auth.uid()) >= plot_limit(me.life) then
    raise exception 'You can hold % plots as a %', plot_limit(me.life), me.life; end if;
  seller := pl.owner;
  if seller is null then
    -- Coordinators get the community allocation price on Lugbe shop and workshop plots
    cost := case when me.life = 'coordinator' and pl.zone = 'lugbe' and pl.kind in ('shop','workshop') then pl.price * 8 / 10 else pl.price end;
    b := w_move(auth.uid(), -cost, 'land: ' || pl.code);
  else
    cost := pl.ask;
    b := w_move(auth.uid(), -cost, 'land: ' || pl.code);
    perform w_move(seller, cost, 'sold land: ' || pl.code);
  end if;
  update plots set owner = auth.uid(), ask = null, bought_at = now(), name = null where id = pid;
  insert into news(text) values (coalesce(initcap(me.office) || ' ', '') || me.username || ' bought plot ' || pl.code || ' for ₦' || to_char(cost, 'FM999,999,999,999') || '.');
  return json_build_object('balance', b, 'cost', cost);
end $$;
create or replace function public.plot_list(pid int, ask_ bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update plots set ask = ask_ where id = pid and owner = auth.uid();
  if not found then raise exception 'Not your plot'; end if;
end $$;

-------------------------------------------------------------------------------
-- 15. Work floors: shifts are station tasks, not a bar that fills.
--     The server hands out each task, checks the worker is at the station after a
--     real walk, moves real city stock, and pays from tasks done. Stock never duplicates:
--     every move is one row update inside one function.
-------------------------------------------------------------------------------
create table if not exists public.floors (site text primary key, door text unique not null, kind text not null, seed int not null, x real not null, z real not null);
insert into public.floors values
  ('depot', 'Kwik Dispatch', 'depot', 17, 92, 378), ('freshmart', 'FreshMart Supermarket', 'shopfloor', 29, -17, 340),
  ('nyanya_market', 'Nyanya Park Market', 'shopfloor', 41, -372, -131.8), ('workshop', 'Jabi Motors Workshop', 'workshop', 53, -14, 189),
  ('yard', 'FCDA Works Yard', 'yard', 67, 18, -183.6)
on conflict (site) do update set door = excluded.door, kind = excluded.kind, seed = excluded.seed, x = excluded.x, z = excluded.z;

create table if not exists public.stations (site text, code text, kind text not null, x real not null, z real not null, power boolean not null default false, item text, primary key (site, code));
-- generated from src/floordata.js by: node tools/floors-sql.mjs
insert into public.stations values
  ('depot', 'R-1', 'recv', -14, 7, true, null),
  ('depot', 'R-2', 'recv', -10, 7, true, null),
  ('depot', 'A-01', 'bay', -6, -9, false, 'rice'),
  ('depot', 'A-02', 'bay', -6, -5, false, 'beans'),
  ('depot', 'A-03', 'bay', -6, -1, false, 'garri'),
  ('depot', 'A-04', 'bay', -6, 3, false, 'oil'),
  ('depot', 'B-01', 'bay', 0, -9, false, 'noodles'),
  ('depot', 'B-02', 'bay', 0, -5, false, 'tomatoes'),
  ('depot', 'B-03', 'bay', 0, -1, false, 'clothes'),
  ('depot', 'B-04', 'bay', 0, 3, false, 'parts'),
  ('depot', 'C-01', 'bay', 6, -9, false, 'cement'),
  ('depot', 'C-02', 'bay', 6, -5, false, 'tiles'),
  ('depot', 'C-03', 'bay', 6, -1, false, 'paint'),
  ('depot', 'C-04', 'bay', 6, 3, false, 'cable'),
  ('depot', 'D-01', 'bay', 12, -9, false, 'pipes'),
  ('depot', 'D-02', 'bay', 12, -5, false, 'fittings'),
  ('depot', 'D-03', 'bay', 12, -1, false, 'petrol'),
  ('depot', 'D-04', 'bay', 12, 3, false, 'eggs'),
  ('depot', 'P-1', 'pack', 3, 8.5, true, null),
  ('depot', 'P-2', 'pack', 7, 8.5, true, null),
  ('depot', 'DOCK', 'dock', 15.5, 7, false, null),
  ('depot', 'BIN', 'bin', -15.5, -10, false, null),
  ('freshmart', 'BACK', 'back', -10, -6, false, null),
  ('freshmart', 'S-1', 'shelf', -5, -2.5, false, 'rice'),
  ('freshmart', 'S-2', 'shelf', 0, -2.5, false, 'beans'),
  ('freshmart', 'S-3', 'shelf', 5, -2.5, false, 'garri'),
  ('freshmart', 'S-4', 'shelf', -5, 2, false, 'noodles'),
  ('freshmart', 'S-5', 'shelf', 0, 2, false, 'oil'),
  ('freshmart', 'S-6', 'shelf', 5, 2, false, 'tomatoes'),
  ('freshmart', 'TILL', 'till', 8.5, 5, true, null),
  ('nyanya_market', 'BACK', 'back', -10, -6, false, null),
  ('nyanya_market', 'S-1', 'shelf', -5, -2.5, false, 'rice'),
  ('nyanya_market', 'S-2', 'shelf', 0, -2.5, false, 'beans'),
  ('nyanya_market', 'S-3', 'shelf', 5, -2.5, false, 'garri'),
  ('nyanya_market', 'S-4', 'shelf', -5, 2, false, 'noodles'),
  ('nyanya_market', 'S-5', 'shelf', 0, 2, false, 'oil'),
  ('nyanya_market', 'S-6', 'shelf', 5, 2, false, 'tomatoes'),
  ('nyanya_market', 'TILL', 'till', 8.5, 5, true, null),
  ('workshop', 'BAY-1', 'car', -5, 0, true, null),
  ('workshop', 'BAY-2', 'car', 4, 0, true, null),
  ('workshop', 'RACK-1', 'rack', -8, -6.5, false, 'brake pads'),
  ('workshop', 'RACK-2', 'rack', -3.5, -6.5, false, 'battery'),
  ('workshop', 'RACK-3', 'rack', 1, -6.5, false, 'tyre'),
  ('workshop', 'RACK-4', 'rack', 5.5, -6.5, false, 'oil filter'),
  ('workshop', 'PUMP', 'pump', 10, 2, false, null),
  ('workshop', 'DESK', 'desk', 8, 6, false, null),
  ('yard', 'TOOLS', 'tools', -11, -6, false, null),
  ('yard', 'CEMENT', 'cement', -5, -6, false, null),
  ('yard', 'BARROW', 'barrow', 3, -6, false, null),
  ('yard', 'TRUCK', 'truck', 10, 3, false, null),
  ('city', 'PH-01', 'pothole', 124.5, -47, false, null),
  ('city', 'PH-02', 'pothole', 70.2, -43.6, false, null),
  ('city', 'PH-03', 'pothole', 107.5, -60.9, false, null),
  ('city', 'PH-04', 'pothole', 106.6, -59.9, false, null),
  ('city', 'PH-05', 'pothole', 28.9, 132.6, false, null),
  ('city', 'PH-06', 'pothole', -60.8, 34.9, false, null),
  ('city', 'PH-07', 'pothole', 45.3, 3.1, false, null),
  ('city', 'PH-08', 'pothole', -27.9, 57.5, false, null),
  ('city', 'PH-09', 'pothole', 92.4, -122.3, false, null),
  ('city', 'PH-10', 'pothole', 134.8, 35.1, false, null),
  ('city', 'PH-11', 'pothole', 96, -122.5, false, null),
  ('city', 'PH-12', 'pothole', 121.8, -89.9, false, null),
  ('city', 'PH-13', 'pothole', -5.2, 36.3, false, null),
  ('city', 'PH-14', 'pothole', -98.1, 4.1, false, null),
  ('city', 'PH-15', 'pothole', 66.5, -45, false, null),
  ('city', 'PH-16', 'pothole', 109.4, -132.8, false, null),
  ('city', 'PH-17', 'pothole', 3.6, -46.4, false, null),
  ('city', 'PH-18', 'pothole', -131.1, -32.1, false, null),
  ('city', 'PH-19', 'pothole', -2.8, 37.9, false, null),
  ('city', 'PH-20', 'pothole', 4.3, -96.4, false, null),
  ('city', 'PH-21', 'pothole', 108.1, -69.7, false, null),
  ('city', 'PH-22', 'pothole', 106.7, -135, false, null),
  ('city', 'PH-23', 'pothole', -57.5, -108.6, false, null),
  ('city', 'PH-24', 'pothole', -96.6, -133.4, false, null),
  ('city', 'WS-1', 'waste', -84, 46, false, null),
  ('city', 'WS-2', 'waste', -108, 46, false, null),
  ('city', 'WS-3', 'waste', -110, 18, false, null),
  ('city', 'WS-4', 'waste', -82, 18, false, null),
  ('city', 'WS-5', 'waste', -360, -124, false, null),
  ('city', 'WS-6', 'waste', -384, -124, false, null),
  ('city', 'WS-7', 'waste', -300, -112, false, null),
  ('city', 'WS-8', 'waste', -96, 60, false, null),
  ('city', 'ST-1', 'stall', -104, 30, false, null),
  ('city', 'ST-2', 'stall', -96, 30, false, null),
  ('city', 'ST-3', 'stall', -88, 30, false, null),
  ('city', 'ST-4', 'stall', -104, 36, false, null),
  ('city', 'ST-5', 'stall', -88, 36, false, null),
  ('city', 'ST-6', 'stall', -96, 24, false, null)
on conflict (site, code) do update set kind = excluded.kind, x = excluded.x, z = excluded.z, power = excluded.power, item = excluded.item;

-- stock lives at a place. Prefixes: in: (pallet waiting), recv: (receiving lane), shelf: and back: (shops)
create table if not exists public.stock (site text, item text, qty int not null default 0 check (qty >= 0), primary key (site, item));
insert into public.stock(site, item, qty)
  select 'depot', item, 30 from stations where site = 'depot' and kind = 'bay'
  union all select s, 'shelf:' || item, 8 from stations, unnest(array['freshmart','nyanya_market']) s where site = 'freshmart' and kind = 'shelf'
  union all select 'unity', id, 30 from items where cat in ('material','tool')
  union all select 'fuelst', id, 40 from items where cat = 'fuel'
  union all values ('workshop', 'parts', 8), ('workshop', 'petrol', 4), ('yard', 'cement', 10)
on conflict do nothing;

create table if not exists public.orders (
  id bigserial primary key,
  site text not null,                 -- where the work is done: depot or workshop
  kind text not null check (kind in ('restock','delivery','site','city','repair')),
  dest jsonb not null default '{}',   -- {site} | {player}
  lines jsonb not null default '[]',  -- [{item, qty, done}]
  state text not null default 'open',
  data jsonb not null default '{}',
  taker uuid, taken_at timestamptz,
  created_at timestamptz not null default now(), done_at timestamptz
);
create index if not exists orders_open on public.orders (site, state);
create table if not exists public.ftasks (
  id bigserial primary key,
  worker uuid not null references public.profiles(id) on delete cascade,
  shift_id bigint references public.shifts(id) on delete cascade,
  part_id bigint,
  site text not null, kind text not null, steps jsonb not null,
  order_id bigint, line int, item text, qty int not null default 1,
  answer text, choices jsonb, weight numeric not null default 1, min_secs numeric not null default 0, info text,
  issued_at timestamptz not null default now(), done_at timestamptz, ok boolean
);
create index if not exists ftasks_worker on public.ftasks (worker, id desc);
create index if not exists ftasks_shift on public.ftasks (shift_id);
create table if not exists public.site_state (key text primary key, val text, until timestamptz);
create table if not exists public.contracts (
  id bigserial primary key,
  poster uuid references public.profiles(id) on delete set null,
  seat text, kind text not null check (kind in ('road','waste','market')), title text not null,
  targets text[] not null, done text[] not null default '{}',
  crew int not null default 1, padded int not null default 0, skim bigint not null default 0,
  job_id bigint, status text not null default 'open' check (status in ('open','done','lapsed')),
  created_at timestamptz not null default now(), ends_at timestamptz
);
insert into public.contracts (id, poster, seat, kind, title, targets) values (1, null, null, 'waste', 'City waste clearance', array(select code from stations where site = 'city' and kind = 'waste'))
on conflict (id) do nothing;
select setval(pg_get_serial_sequence('public.contracts', 'id'), greatest(10, (select max(id) from public.contracts)));
do $$ begin
  alter table public.stock enable row level security; alter table public.orders enable row level security; alter table public.ftasks enable row level security;
  alter table public.floors enable row level security; alter table public.stations enable row level security; alter table public.site_state enable row level security;
  alter table public.contracts enable row level security;
end $$;
drop policy if exists "floors readable" on public.floors; create policy "floors readable" on public.floors for select to authenticated using (true);
drop policy if exists "stations readable" on public.stations; create policy "stations readable" on public.stations for select to authenticated using (true);
drop policy if exists "stock readable" on public.stock; create policy "stock readable" on public.stock for select to authenticated using (true);
drop policy if exists "orders readable" on public.orders; create policy "orders readable" on public.orders for select to authenticated using (true);
drop policy if exists "own tasks" on public.ftasks; create policy "own tasks" on public.ftasks for select to authenticated using (worker = auth.uid());
drop policy if exists "state readable" on public.site_state; create policy "state readable" on public.site_state for select to authenticated using (true);
drop policy if exists "contracts readable" on public.contracts; create policy "contracts readable" on public.contracts for select to authenticated using (true);

-- the city jobs now work on floors
update public.jobs set meta = meta || '{"floor":"freshmart"}' where id = 1;
update public.jobs set title = 'Depot hand', skill = 'delivery', meta = meta || '{"floor":"depot"}' where id = 5;
update public.jobs set place = 'Nyanya Park Market', x = -372, z = -131.8, employer = 'Nyanya traders', meta = meta || '{"floor":"nyanya_market"}' where id = 6;
update public.jobs set title = 'Works yard labourer', place = 'FCDA Works Yard', x = 18, z = -183.6, skill = 'mason', meta = meta || '{"floor":"yard","contract":1}' where id = 7;
update public.jobs set place = 'Jabi Motors Workshop', x = -14, z = 189, meta = meta || '{"floor":"workshop"}' where id = 13;

-- add n of an item under got->k (creates the key when missing; never below zero)
create or replace function public.got_add(g jsonb, k text, it text, n int) returns jsonb language sql immutable as $$
  select jsonb_set(coalesce(g, '{}'), array[k], coalesce(g->k, '{}') || jsonb_build_object(it, greatest(0, coalesce((g->k->>it)::int, 0) + n)));
$$;
create or replace function public.st_qty(s text, it text) returns int language sql stable security definer set search_path = public as $$
  select coalesce((select qty from stock where site = s and item = it), 0);
$$;
create or replace function public.st_add(s text, it text, n int) returns int language plpgsql security definer set search_path = public as $$
declare q int;
begin
  insert into stock(site, item, qty) values (s, it, greatest(0, n)) on conflict (site, item) do update set qty = stock.qty + n returning qty into q;
  return q;   -- a negative result fails the check, so stock can never go below zero
end $$;
create or replace function public.floor_power_out(sd int) returns boolean language sql stable as $$
  select mod(floor(extract(epoch from now()) / 60)::bigint * 7919 + sd::bigint * 104729, 100) < 12;
$$;
create or replace function public.fuel_short() returns boolean language sql stable security definer set search_path = public as $$
  select (policy_value('fuel') < 0.9 or mod(floor(extract(epoch from now()) / 60)::bigint * 31, 100) < 15)
     and coalesce((select until from site_state where key = 'depot:fuel'), now() - interval '1 second') < now();
$$;
-- one step of a task: where to go and what to do there
create or replace function public.ft_step(s text, c text, act text, hold numeric, lbl text) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code', c, 'x', x, 'z', z, 'w', s = 'city', 'site', s, 'act', act, 'hold', hold, 'power', power, 'label', lbl) from stations where site = s and code = c;
$$;
create or replace function public.ft_make(sid bigint, bid bigint, site_ text, kind_ text, steps_ jsonb, oid bigint, ln int, it text, q int, ans text, ch jsonb, wt numeric, inf text) returns bigint
language plpgsql security definer set search_path = public as $$
declare i int; d numeric := 0; h numeric := 0; tid bigint;
begin
  for i in 0 .. jsonb_array_length(steps_) - 1 loop
    h := h + coalesce((steps_->i->>'hold')::numeric, 0);
    if i > 0 and (steps_->i->>'w') = (steps_->(i - 1)->>'w') then d := d + sqrt(power((steps_->i->>'x')::numeric - (steps_->(i - 1)->>'x')::numeric, 2) + power((steps_->i->>'z')::numeric - (steps_->(i - 1)->>'z')::numeric, 2)); end if;
  end loop;
  insert into ftasks(worker, shift_id, part_id, site, kind, steps, order_id, line, item, qty, answer, choices, weight, min_secs, info)
  values (auth.uid(), sid, bid, site_, kind_, steps_, oid, ln, it, q, ans, ch, wt, d / 7 + h * 0.7, inf) returning id into tid;
  if oid is not null then update orders set taker = auth.uid(), taken_at = now() where id = oid; end if;
  return tid;
end $$;
create or replace function public.bay_of(it text) returns text language sql stable security definer set search_path = public as $$
  select code from stations where site = 'depot' and kind = 'bay' and item = it limit 1;
$$;
create or replace function public.phase_weight(site_ text) returns numeric language sql stable as $$
  select case when city_hour() >= 6 and city_hour() < 10 and site_ = 'depot' then 1.25
              when city_hour() >= 10 and city_hour() < 14 and site_ in ('freshmart','nyanya_market') then 1.25
              when city_hour() >= 18 and city_hour() < 22 then 1.5 else 1 end;
$$;

-- keep the city's goods moving even when nobody is on shift
create or replace function public.orders_tick() returns void language plpgsql security definer set search_path = public as $$
declare r record; s text;
begin
  if coalesce((select until from site_state where key = 'tick'), now() - interval '1 second') > now() then return; end if;
  insert into site_state values ('tick', null, now() + interval '20 seconds') on conflict (key) do update set until = excluded.until;
  -- lorries bring pallets to the depot when a bay runs low
  for r in select st.item from stations st where st.site = 'depot' and st.kind = 'bay'
           and st_qty('depot', st.item) + st_qty('depot', 'recv:' || st.item) + st_qty('depot', 'in:' || st.item) < 15 loop
    perform st_add('depot', 'in:' || r.item, 20);
    insert into site_state values ('in_since:' || r.item, null, now()) on conflict (key) do update set until = now();
  end loop;
  -- pallets left for 10 minutes are put away by the night crew
  for r in select replace(item, 'in:', '') it, qty from stock where site = 'depot' and item like 'in:%' and qty > 0
           and coalesce((select until from site_state where key = 'in_since:' || replace(item, 'in:', '')), now()) < now() - interval '10 minutes' loop
    perform st_add('depot', 'in:' || r.it, -r.qty); perform st_add('depot', r.it, r.qty);
  end loop;
  -- shops ask the depot for stock
  foreach s in array array['freshmart','nyanya_market'] loop
    for r in select item from stations where site = 'freshmart' and kind = 'shelf' loop
      if st_qty(s, 'shelf:' || r.item) + st_qty(s, 'back:' || r.item) < 6 and not exists (select 1 from orders where site = 'depot' and kind = 'restock' and dest->>'site' = s and state not in ('dispatched','short') and lines->0->>'item' = r.item) then
        insert into orders(site, kind, dest, lines) values ('depot', 'restock', jsonb_build_object('site', s, 'to', 'back'), jsonb_build_array(jsonb_build_object('item', r.item, 'qty', 10, 'done', false)));
      end if;
    end loop;
  end loop;
  -- the workshop and the yard order what they use
  if st_qty('workshop', 'parts') < 3 and not exists (select 1 from orders where kind = 'restock' and dest->>'site' = 'workshop' and state not in ('dispatched','short')) then
    insert into orders(site, kind, dest, lines) values ('depot', 'restock', '{"site":"workshop"}', '[{"item":"parts","qty":6,"done":false},{"item":"petrol","qty":3,"done":false}]'); end if;
  if st_qty('yard', 'cement') < 4 and not exists (select 1 from orders where kind = 'restock' and dest->>'site' = 'yard' and state not in ('dispatched','short')) then
    insert into orders(site, kind, dest, lines) values ('depot', 'restock', '{"site":"yard"}', '[{"item":"cement","qty":10,"done":false}]'); end if;
  -- Unity Market: depot goods come by order, bulky ones by the supplier's tipper (at most every 10 minutes)
  for r in select i.id from items i where i.cat = 'material' and st_qty('unity', i.id) < 10 loop
    if bay_of(r.id) is not null then
      if not exists (select 1 from orders where kind = 'restock' and dest->>'site' = 'unity' and state not in ('dispatched','short') and lines->0->>'item' = r.id) then
        insert into orders(site, kind, dest, lines) values ('depot', 'restock', '{"site":"unity"}', jsonb_build_array(jsonb_build_object('item', r.id, 'qty', 20, 'done', false))); end if;
    elsif coalesce((select until from site_state where key = 'tipper:' || r.id), now() - interval '1 second') < now() then
      perform st_add('unity', r.id, 20); insert into site_state values ('tipper:' || r.id, null, now() + interval '10 minutes') on conflict (key) do update set until = excluded.until;
    end if;
  end loop;
  perform contracts_lapse();
  -- orders nobody handled for 8 minutes go out with the city's own staff
  for r in select id from orders where site = 'depot' and state in ('open','picked','packed') and created_at < now() - interval '8 minutes' loop
    perform order_deliver(r.id, true);
  end loop;
  update orders set taker = null where taker is not null and taken_at < now() - interval '4 minutes' and state in ('open','picked','packed');
end $$;

-- an order leaves the depot: goods land where they were going
create or replace function public.order_deliver(oid bigint, auto boolean) returns void language plpgsql security definer set search_path = public as $$
declare o orders; ln jsonb; it text; q int;
begin
  select * into o from orders where id = oid for update;
  if not found or o.state in ('dispatched','short') then return; end if;
  for ln in select * from jsonb_array_elements(o.lines) loop
    it := ln->>'item'; q := (ln->>'qty')::int;
    -- when the city's staff fill it, they pull from the bays if they can
    if auto and not (ln->>'done')::boolean then
      if st_qty('depot', it) >= q then perform st_add('depot', it, -q); end if;
    end if;
    if o.dest ? 'player' then
      insert into inventory(user_id, item, qty) values ((o.dest->>'player')::uuid, it, q) on conflict (user_id, item) do update set qty = inventory.qty + q;
    elsif o.dest ? 'site' then
      perform st_add(o.dest->>'site', case when o.dest->>'to' = 'back' then 'back:' || it else it end, q);
    end if;
  end loop;
  update orders set state = 'dispatched', done_at = now(), data = data || jsonb_build_object('auto', auto) where id = oid;
end $$;

-- player orders: food and depot goods come through the depot; bulky materials come by tipper
create or replace function public.order_delivery(it text, n int, bid bigint) returns json language plpgsql security definer set search_path = public as $$
declare cost bigint; b bigint; oid bigint;
begin
  if n < 1 or n > 50 then raise exception 'Order between 1 and 50'; end if;
  if bid is not null then raise exception 'Building pieces are bought in the Building Explorer'; end if;
  if bay_of(it) is null then raise exception 'That item is not stocked at the depot'; end if;
  cost := price_now(it) * n + case when (select cat from items where id = it) = 'food' then 1500 else 3000 end;
  b := w_move(auth.uid(), -cost, 'delivery: ' || n || ' x ' || it);
  insert into orders(site, kind, dest, lines) values ('depot', 'delivery', jsonb_build_object('player', auth.uid()), jsonb_build_array(jsonb_build_object('item', it, 'qty', n, 'done', false))) returning id into oid;
  return json_build_object('balance', b, 'order', oid, 'arrived', false);
end $$;
create or replace function public.my_orders() returns table (id bigint, kind text, lines jsonb, state text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.id, o.kind, o.lines, o.state, o.created_at from orders o
  where o.dest->>'player' = auth.uid()::text and o.created_at > now() - interval '1 day' order by o.id desc limit 20;
$$;

-- walk-in gig: two city hours on a floor with an open station
create or replace function public.floor_gig(site_ text) returns bigint language plpgsql security definer set search_path = public as $$
declare jb jobs; sid bigint;
begin
  select * into jb from jobs where poster is null and meta->>'floor' = site_ and open order by id limit 1;
  if not found then raise exception 'No gigs here'; end if;
  if (select count(*) from shifts s join jobs j on j.id = s.job_id where s.status = 'on' and j.meta->>'floor' = site_) >= 6 then raise exception 'Every station is taken. Try again soon.'; end if;
  if exists (select 1 from shifts where worker = auth.uid() and status = 'on') then raise exception 'Finish your other shift first'; end if;
  if coalesce((select until from site_state where key = 'gig:' || auth.uid()), now() - interval '1 second') > now() then raise exception 'One gig at a time. Try again in a few minutes.'; end if;
  if my_level(auth.uid(), jb.skill) < jb.min_level then raise exception 'You need % level %', jb.skill, jb.min_level; end if;
  perform w_worker(auth.uid());
  insert into applications(job_id, user_id, status) values (jb.id, auth.uid(), 'hired') on conflict (job_id, user_id) do update set status = 'hired';
  insert into shifts(job_id, worker, starts_at, ends_at, status, checkin_at) values (jb.id, auth.uid(), now(), now() + interval '2 minutes', 'on', now())
    on conflict (job_id, worker, starts_at) do nothing returning id into sid;
  insert into site_state values ('gig:' || auth.uid(), null, now() + interval '6 minutes') on conflict (key) do update set until = excluded.until;
  return sid;
end $$;

-------- task makers, one per kind of floor --------
create or replace function public.ft_depot(sid bigint, role_ text, out_ boolean) returns bigint language plpgsql security definer set search_path = public as $$
declare o orders; ln jsonb; i int; it text; q int; b text; ch jsonb; r record; w numeric := phase_weight('depot');
begin
  -- dispatch: packed orders go on the truck (needs diesel)
  if role_ in ('all','dispatch') then
    select * into o from orders where site = 'depot' and state = 'packed' and (taker is null or taker = auth.uid()) order by id limit 1 for update skip locked;
    if found then
      if fuel_short() then
        if st_qty('depot', 'petrol') < 1 then return null; end if;
        return ft_make(sid, null, 'depot', 'refuel', jsonb_build_array(ft_step('depot', 'D-03', 'lift', 1.2, 'Take a jerrycan'), ft_step('depot', 'DOCK', 'fuel', 2, 'Fill the truck')), null, null, 'petrol', 1, null, null, w, 'Fuel is short: fill the truck before it can leave');
      end if;
      return ft_make(sid, null, 'depot', 'dispatch', jsonb_build_array(ft_step('depot', 'P-1', 'lift', 1.2, 'Lift the packed box'), ft_step('depot', 'DOCK', 'load', 1.8, 'Load the truck')), o.id, null, null, 1, null, null, w,
        case when o.dest ? 'player' then 'Delivery for a player' when o.dest ? 'site' then 'Restock for ' || (o.dest->>'site') else 'City order' end);
    end if;
  end if;
  -- pack: picked orders get the right box (the label printer needs power)
  if role_ in ('all','pack') and not out_ then
    select * into o from orders where site = 'depot' and state = 'picked' and (taker is null or taker = auth.uid()) order by id limit 1 for update skip locked;
    if found then
      q := (select sum((l->>'qty')::int) from jsonb_array_elements(o.lines) l);
      return ft_make(sid, null, 'depot', 'pack', jsonb_build_array(ft_step('depot', case when o.id % 2 = 0 then 'P-1' else 'P-2' end, 'pack', 1.6, 'Pack and print the label')), o.id, null, null, q,
        case when q <= 2 then 'S' when q <= 5 then 'M' else 'L' end, '["S","M","L"]', w, q || ' items in the tote');
    end if;
  end if;
  -- pick: walk to the bay the phone names, take the right item, drop the tote at the pack bench
  if role_ in ('all','pick') then
    for o in select * from orders where site = 'depot' and state = 'open' and (taker is null or taker = auth.uid()) order by (kind = 'city'), id limit 5 for update skip locked loop
      for i in 0 .. jsonb_array_length(o.lines) - 1 loop
        ln := o.lines->i;
        if not (ln->>'done')::boolean then
          it := ln->>'item'; q := (ln->>'qty')::int; b := bay_of(it);
          if st_qty('depot', it) < q then
            update orders set state = 'short' where id = o.id and kind = 'city';   -- city orders wait for nobody
            continue;
          end if;
          select jsonb_agg(x) into ch from (select item x from stations where site = 'depot' and kind = 'bay' and item <> it order by random() limit 2) z;
          ch := ch || to_jsonb(it);
          return ft_make(sid, null, 'depot', 'pick', jsonb_build_array(ft_step('depot', b, 'pick', 1.2, 'Pick ' || q || ' from ' || b), ft_step('depot', case when o.id % 2 = 0 then 'P-1' else 'P-2' end, 'drop', .8, 'Drop the tote at the pack bench')),
            o.id, i, it, q, it, ch, w, 'Order #' || o.id);
        end if;
      end loop;
    end loop;
  end if;
  -- receive pallets (scanner needs power) and put stock away
  if role_ in ('all','receive') then
    if not out_ then
      select replace(item, 'in:', '') it, qty into r from stock where site = 'depot' and item like 'in:%' and qty > 0 order by random() limit 1;
      if found then return ft_make(sid, null, 'depot', 'receive', jsonb_build_array(ft_step('depot', case when random() < .5 then 'R-1' else 'R-2' end, 'scan', 1.8, 'Scan the pallet in')), null, null, r.it, least(r.qty, 20), null, null, w, 'Pallet of ' || r.it); end if;
    end if;
    select replace(item, 'recv:', '') it, qty into r from stock where site = 'depot' and item like 'recv:%' and qty > 0 order by random() limit 1;
    if found then return ft_make(sid, null, 'depot', 'putaway', jsonb_build_array(ft_step('depot', 'R-1', 'lift', 1.2, 'Lift from the receiving lane'), ft_step('depot', bay_of(r.it), 'stock', 1.4, 'Put it away')), null, null, r.it, least(r.qty, 10), null, null, w, 'Put away ' || r.it); end if;
  end if;
  -- now and then a crate spoils
  if random() < .15 then
    select item into it from stock where site = 'depot' and item in ('tomatoes','eggs','rice') and qty > 0 order by random() limit 1;
    if found then return ft_make(sid, null, 'depot', 'spoilt', jsonb_build_array(ft_step('depot', bay_of(it), 'lift', 1.2, 'Lift the spoilt crate'), ft_step('depot', 'BIN', 'dump', 1, 'Bin it')), null, null, it, 1, null, null, w, 'A crate of ' || it || ' has spoilt'); end if;
  end if;
  -- a quiet floor: the city sends an order
  if role_ in ('all','pick') and not exists (select 1 from orders where site = 'depot' and state = 'open' and taker is null) then
    insert into orders(site, kind, lines) select 'depot', 'city', jsonb_agg(jsonb_build_object('item', item, 'qty', 1 + floor(random() * 3)::int, 'done', false))
      from (select item from stock where site = 'depot' and item not like '%:%' and qty >= 4 order by random() limit 2) z having count(*) > 0;
    if found then return ft_depot(sid, role_, out_); end if;
  end if;
  return null;
end $$;

create or replace function public.ft_shop(sid bigint, site_ text, out_ boolean, late boolean) returns bigint language plpgsql security definer set search_path = public as $$
declare r record; q int; w numeric := phase_weight(site_);
begin
  if late and not exists (select 1 from ftasks where shift_id = sid and kind = 'close') then
    return ft_make(sid, null, site_, 'close', jsonb_build_array(ft_step(site_, 'TILL', 'count', 2.2, 'Count and close the till')), null, null, null, 1, null, null, w, 'End of shift: close the till');
  end if;
  -- move crates from the back to shelves that are low
  select st.code, st.item, st_qty(site_, 'back:' || st.item) back, st_qty(site_, 'shelf:' || st.item) shelf into r
    from stations st where st.site = site_ and st.kind = 'shelf' and st_qty(site_, 'back:' || st.item) > 0 and st_qty(site_, 'shelf:' || st.item) < 12 order by st_qty(site_, 'shelf:' || st.item) limit 1;
  if found then
    q := least(r.back, 6, 12 - r.shelf);
    return ft_make(sid, null, site_, 'unload', jsonb_build_array(ft_step(site_, 'BACK', 'lift', 1.2, 'Lift a crate'), ft_step(site_, r.code, 'stock', 1.6, 'Stock the shelf')), null, null, r.item, q, null, null, w, 'Restock ' || r.item);
  end if;
  -- serve the queue (the till scanner needs power)
  if not out_ then
    select st.item, st_qty(site_, 'shelf:' || st.item) shelf into r from stations st where st.site = site_ and st.kind = 'shelf' and st_qty(site_, 'shelf:' || st.item) > 0 order by random() limit 1;
    if found then
      q := least(r.shelf, 1 + floor(random() * 3)::int);
      return ft_make(sid, null, site_, 'serve', jsonb_build_array(ft_step(site_, 'TILL', 'scan', 1.6, 'Scan and take payment')), null, null, r.item, q, null, null, w, 'A customer wants ' || q || ' ' || r.item);
    end if;
  end if;
  return null;
end $$;

create or replace function public.ft_workshop(sid bigint, out_ boolean) returns bigint language plpgsql security definer set search_path = public as $$
declare o orders; bay text; stage text; rk text; ch jsonb; w numeric := phase_weight('workshop');
begin
  select * into o from orders where site = 'workshop' and kind = 'repair' and state <> 'done' and (taker is null or taker = auth.uid()) order by id limit 1 for update skip locked;
  if not found then
    if (select count(*) from orders where site = 'workshop' and kind = 'repair' and state <> 'done') >= 2 then return null; end if;
    insert into orders(site, kind, data) values ('workshop', 'repair', jsonb_build_object('fault', (array['brake pads','battery','tyre','oil filter'])[1 + floor(random() * 4)::int],
      'bay', case when exists (select 1 from orders where site = 'workshop' and kind = 'repair' and state <> 'done' and data->>'bay' = 'BAY-1') then 'BAY-2' else 'BAY-1' end,
      'car', (array['red','blue','white','green','grey'])[1 + floor(random() * 5)::int], 'stage', 'arrived')) returning * into o;
  end if;
  bay := o.data->>'bay'; stage := o.data->>'stage';
  if stage = 'arrived' then return ft_make(sid, null, 'workshop', 'receive_car', jsonb_build_array(ft_step('workshop', bay, 'check', 1.4, 'Check the car in')), o.id, null, null, 1, null, null, w, 'A ' || (o.data->>'car') || ' car has come in'); end if;
  if stage = 'received' then
    if out_ then return null; end if;
    return ft_make(sid, null, 'workshop', 'diagnose', jsonb_build_array(ft_step('workshop', bay, 'scan', 2, 'Run the diagnosis')), o.id, null, null, 1, null, null, w, 'Find the fault');
  end if;
  if stage = 'diagnosed' then
    if st_qty('workshop', 'parts') < 1 then return null; end if;
    select code into rk from stations where site = 'workshop' and kind = 'rack' and item = o.data->>'fault';
    select jsonb_agg(item) into ch from stations where site = 'workshop' and kind = 'rack';
    return ft_make(sid, null, 'workshop', 'part', jsonb_build_array(ft_step('workshop', rk, 'pick', 1.2, 'Take the part')), o.id, null, o.data->>'fault', 1, o.data->>'fault', ch, w, 'Fault: ' || (o.data->>'fault'));
  end if;
  if stage = 'parted' then return ft_make(sid, null, 'workshop', 'fit', jsonb_build_array(ft_step('workshop', bay, 'fit', 2.2, 'Fit the ' || (o.data->>'fault'))), o.id, null, null, 1, null, null, w, 'Fit the part'); end if;
  if stage = 'fitted' then return ft_make(sid, null, 'workshop', 'fuel', jsonb_build_array(ft_step('workshop', 'PUMP', 'lift', 1, 'Take the fuel can'), ft_step('workshop', bay, 'fuel', 1.6, 'Fuel the car')), o.id, null, null, 1, null, null, w, 'Fuel it up'); end if;
  return ft_make(sid, null, 'workshop', 'handback', jsonb_build_array(ft_step('workshop', 'DESK', 'hand', 1.2, 'Hand the keys back')), o.id, null, null, 1, null, null, w, 'The customer is waiting');
end $$;

create or replace function public.ft_yard(sid bigint, cid bigint) returns bigint language plpgsql security definer set search_path = public as $$
declare c contracts; tgt text; pre text;
begin
  select * into c from contracts where id = cid and status = 'open';
  if not found then return null; end if;
  if not exists (select 1 from ftasks where shift_id = sid and kind = 'tools' and ok) then
    return ft_make(sid, null, 'yard', 'tools', jsonb_build_array(ft_step('yard', 'TOOLS', 'lift', 1.4, 'Sign out the tools')), null, null, null, 1, null, null, 1, c.title);
  end if;
  pre := case c.kind when 'road' then 'pothole:' when 'waste' then 'waste:' else 'stall:' end;
  select t into tgt from unnest(c.targets) t
   where not (t = any(c.done)) and coalesce((select until from site_state where key = pre || t), now() - interval '1 second') < now()
     and not exists (select 1 from ftasks f where f.done_at is null and f.item = t and f.issued_at > now() - interval '4 minutes') order by random() limit 1;
  if tgt is null then return null; end if;
  if c.kind = 'road' then
    if st_qty('yard', 'cement') < 1 then return null; end if;
    return ft_make(sid, null, 'yard', 'patch', jsonb_build_array(ft_step('yard', 'CEMENT', 'lift', 1.2, 'Load a bag of cement'), ft_step('city', tgt, 'patch', 2.4, 'Patch the pothole')), null, null, tgt, 1, null, null, 1, c.title);
  elsif c.kind = 'waste' then
    return ft_make(sid, null, 'yard', 'waste', jsonb_build_array(ft_step('yard', 'BARROW', 'lift', 1, 'Take a wheelbarrow'), ft_step('city', tgt, 'shovel', 2, 'Shovel the waste'), ft_step('yard', 'TRUCK', 'dump', 1.2, 'Dump it in the truck')), null, null, tgt, 1, null, null, 1, c.title);
  end if;
  return ft_make(sid, null, 'yard', 'stall', jsonb_build_array(ft_step('yard', 'TOOLS', 'lift', 1, 'Take the repair kit'), ft_step('city', tgt, 'fix', 2.4, 'Repair the stall')), null, null, tgt, 1, null, null, 1, c.title);
end $$;

-- why a floor has no task for you right now
create or replace function public.ft_idle(site_ text, out_ boolean) returns text language plpgsql stable security definer set search_path = public as $$
begin
  if site_ like 'plot:%' or site_ like 'gov:%' then return site_idle(site_); end if;
  if out_ then return 'NEPA took light. Powered stations are off. Wait, or clock out.'; end if;
  if site_ = 'depot' and fuel_short() and st_qty('depot', 'petrol') < 1 then return 'Diesel shortage: dispatch has stopped until fuel comes in.'; end if;
  return 'The floor is quiet. New work comes in every city hour.';
end $$;

create or replace function public.ft_json(tid bigint) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'kind', kind, 'site', site, 'steps', steps, 'item', item, 'qty', qty, 'choices', choices, 'info', info, 'weight', weight,
    'done', (select count(*) from ftasks f where f.shift_id = t.shift_id and t.shift_id is not null and f.ok),
    'fails', (select count(*) from ftasks f where f.shift_id = t.shift_id and t.shift_id is not null and f.ok = false))
  from ftasks t where id = tid;
$$;

-- the phone asks: what next? (a shift, or the owner working their own site)
drop function if exists public.floor_task_next(bigint, bigint, text);
create or replace function public.floor_task_next(sid bigint, site_ text, role_ text) returns jsonb language plpgsql security definer set search_path = public as $$
declare s shifts; jb jobs; t ftasks; out_ boolean := false; tid bigint; trade_ text; late boolean := false; sd int;
begin
  perform orders_tick();
  if sid is not null then
    select * into s from shifts where id = sid and worker = auth.uid() and status = 'on';
    if not found then raise exception 'Clock in first'; end if;
    if now() > s.ends_at then return jsonb_build_object('idle', 'Your shift is over. Clock out to get paid.', 'over', true); end if;
    select * into jb from jobs where id = s.job_id;
    trade_ := jb.skill; site_ := coalesce(jb.meta->>'floor', jb.meta->>'site');
    if site_ is null then raise exception 'This job is not on a work floor'; end if;
    late := extract(epoch from now() - s.starts_at) >= 0.8 * extract(epoch from s.ends_at - s.starts_at);
  elsif site_role(site_) is distinct from 'owner' then raise exception 'Not your building site';
  end if;
  select * into t from ftasks where worker = auth.uid() and done_at is null and issued_at > now() - interval '4 minutes'
    and coalesce(shift_id, 0) = coalesce(sid, 0) and site <> '' and (sid is not null or site = site_) order by id desc limit 1;
  if found then return ft_json(t.id); end if;
  update ftasks set done_at = now(), ok = null where worker = auth.uid() and done_at is null;     -- drop abandoned tasks
  select seed into sd from floors where site = site_;
  out_ := coalesce(floor_power_out(sd), false);
  tid := case
    when site_ = 'depot' then ft_depot(sid, coalesce(role_, 'all'), out_)
    when site_ in ('freshmart','nyanya_market') then ft_shop(sid, site_, out_, late)
    when site_ = 'workshop' then ft_workshop(sid, out_)
    when site_ = 'yard' then ft_yard(sid, coalesce((jb.meta->>'contract')::bigint, 1))
    else ft_build(sid, site_, trade_) end;
  if tid is null then return jsonb_build_object('idle', ft_idle(site_, out_), 'power', not out_); end if;
  return ft_json(tid) || jsonb_build_object('power', not out_);
end $$;

-- the worker says: done. The server checks the place, the time, the power and the answer.
create or replace function public.floor_task_done(tid bigint, px real, pz real, where_ text, ans text) returns jsonb language plpgsql security definer set search_path = public as $$
declare t ftasks; st jsonb; s shifts; jb jobs; o orders; i int; ok_ boolean := true; msg text := 'Done'; sd int; pwr boolean := false; x int; pl plots; lx numeric; lz numeric;
begin
  select * into t from ftasks where id = tid and worker = auth.uid() and done_at is null for update;
  if not found then raise exception 'That task is gone. Ask the phone for the next one.'; end if;
  if t.shift_id is not null then
    select * into s from shifts where id = t.shift_id and status = 'on';
    if not found or now() > s.ends_at + interval '1 minute' then raise exception 'Your shift is over'; end if;
    select * into jb from jobs where id = s.job_id;
  end if;
  st := t.steps->-1;
  if (st->>'w')::boolean then
    if where_ <> 'city' or sqrt(power(px - (st->>'x')::numeric, 2) + power(pz - (st->>'z')::numeric, 2)) > 3.2 then raise exception 'Go to % to finish', st->>'label'; end if;
  elsif where_ <> st->>'site' or sqrt(power(px - (st->>'x')::numeric, 2) + power(pz - (st->>'z')::numeric, 2)) > 2.8 then raise exception 'Go to station %', st->>'code'; end if;
  if extract(epoch from now() - t.issued_at) < t.min_secs * 0.6 then raise exception 'Too fast. Walk the route and do each step.'; end if;
  select seed into sd from floors where site = t.site;
  if exists (select 1 from jsonb_array_elements(t.steps) e where (e->>'power')::boolean) and coalesce(floor_power_out(sd), false) then raise exception 'NEPA took light. That station has no power.'; end if;
  if t.answer is not null and coalesce(ans, '') <> t.answer then
    update ftasks set done_at = now(), ok = false where id = tid;
    if t.order_id is not null then update orders set taker = null where id = t.order_id; end if;
    return jsonb_build_object('ok', false, 'msg', case t.kind when 'pack' then 'Wrong box. The order is repacked and your wage is cut.' when 'part' then 'Wrong part. It goes back on the rack and your wage is cut.' else 'Wrong item. The order is short and your wage is cut.' end);
  end if;
  -- apply what the work did to the city
  if t.kind = 'receive' then perform st_add('depot', 'in:' || t.item, -t.qty); perform st_add('depot', 'recv:' || t.item, t.qty);
  elsif t.kind = 'putaway' then perform st_add('depot', 'recv:' || t.item, -least(t.qty, st_qty('depot', 'recv:' || t.item))); perform st_add('depot', t.item, least(t.qty, t.qty));
  elsif t.kind = 'pick' then
    select * into o from orders where id = t.order_id for update;
    perform st_add('depot', t.item, -t.qty);
    o.lines := jsonb_set(o.lines, array[t.line::text, 'done'], 'true');
    update orders set lines = o.lines, taker = null, state = case when not exists (select 1 from jsonb_array_elements(o.lines) l where not (l->>'done')::boolean) then 'picked' else state end where id = o.id;
  elsif t.kind = 'pack' then update orders set state = 'packed', taker = null, data = data || jsonb_build_object('box', ans) where id = t.order_id;
  elsif t.kind = 'dispatch' then
    perform order_deliver(t.order_id, false);
    if jb.source = 'business' then update businesses set funds = funds + 2000 where id = jb.business_id; end if;
  elsif t.kind = 'refuel' then perform st_add('depot', 'petrol', -1); insert into site_state values ('depot:fuel', null, now() + interval '10 minutes') on conflict (key) do update set until = excluded.until;
  elsif t.kind = 'spoilt' then perform st_add('depot', t.item, -1);
  elsif t.kind = 'unload' then perform st_add(t.site, 'back:' || t.item, -t.qty); perform st_add(t.site, 'shelf:' || t.item, t.qty);
  elsif t.kind = 'serve' then
    perform st_add(t.site, 'shelf:' || t.item, -t.qty);
    if jb.source = 'business' then update businesses set funds = funds + (select price from items where id = t.item) * t.qty / 5 where id = jb.business_id;
    elsif jb.source = 'union' and jb.poster is not null then perform w_move(jb.poster, (select price from items where id = t.item) * t.qty / 20, 'park market levy'); end if;
  elsif t.kind = 'close' then null;
  elsif t.kind in ('receive_car','diagnose','part','fit','fuel','handback') then
    select * into o from orders where id = t.order_id for update;
    if t.kind = 'part' then perform st_add('workshop', 'parts', -1); end if;
    if t.kind = 'fuel' and st_qty('workshop', 'petrol') > 0 then perform st_add('workshop', 'petrol', -1); end if;
    if t.kind = 'diagnose' then msg := 'Diagnosis: ' || (o.data->>'fault'); end if;
    update orders set taker = null, data = data || jsonb_build_object('stage', case t.kind when 'receive_car' then 'received' when 'diagnose' then 'diagnosed' when 'part' then 'parted' when 'fit' then 'fitted' when 'fuel' then 'fuelled' else 'out' end),
      state = case when t.kind = 'handback' then 'done' else state end, done_at = case when t.kind = 'handback' then now() end where id = o.id;
    if t.kind = 'handback' and jb.source = 'business' then update businesses set funds = funds + 8000 where id = jb.business_id; end if;
  elsif t.kind = 'patch' then
    perform st_add('yard', 'cement', -1);
    insert into site_state values ('pothole:' || t.item, null, now() + interval '3 days') on conflict (key) do update set until = excluded.until;
    perform contract_progress((jb.meta->>'contract')::bigint, t.item);
  elsif t.kind = 'waste' then
    insert into site_state values ('waste:' || t.item, null, now() + interval '1 hour') on conflict (key) do update set until = excluded.until;
    perform contract_progress(coalesce((jb.meta->>'contract')::bigint, 1), t.item);
  elsif t.kind = 'stall' then
    insert into site_state values ('stall:' || t.item, null, now() + interval '2 days') on conflict (key) do update set until = excluded.until;
    perform contract_progress((jb.meta->>'contract')::bigint, t.item);
  elsif t.kind = 'build' then
    update parts set built = true where id = any(coalesce(t.part_ids, array[t.part_id])) and not built;
    if not found then raise exception 'Someone already finished that piece'; end if;
    if t.shift_id is null and t.item <> 'labour' then x := w_skill(auth.uid(), t.item, 1); end if;      -- self-build: skill straight away
    perform site_progress(t.site);
  end if;
  update ftasks set done_at = now(), ok = true where id = tid;
  return jsonb_build_object('ok', true, 'msg', msg);
end $$;

-- a contract target finished; the whole contract finished
create or replace function public.contract_progress(cid bigint, tgt text) returns void language plpgsql security definer set search_path = public as $$
declare c contracts;
begin
  select * into c from contracts where id = cid for update; if not found or c.status <> 'open' then return; end if;
  if not (tgt = any(c.done)) then c.done := c.done || tgt; end if;
  if cid = 1 then update contracts set done = case when cardinality(c.done) >= cardinality(c.targets) then '{}' else c.done end where id = 1; return; end if;
  if cardinality(c.done) >= cardinality(c.targets) then
    update contracts set done = c.done, status = 'done' where id = cid;
    if c.poster is not null then
      perform w_moral(c.poster, case when c.padded = 0 then 6 else -4 end);
      insert into news(text) values (c.title || ' is finished' || case when c.padded = 0 then '. Crew paid, work done.' else ', but the crew list had names nobody saw on site.' end);
    end if;
    if c.job_id is not null then perform w_close_job(c.job_id); end if;
  else
    update contracts set done = c.done where id = cid;
  end if;
end $$;

-- a politician commissions public works from the seat's budget
create or replace function public.contract_post(kind_ text, crew_ int, ghosts int) returns bigint language plpgsql security definer set search_path = public as $$
declare me profiles; tg text[]; cid bigint; jid bigint; per bigint := 4000 * 4 * 2; skim_ bigint; ttl text;
begin
  select * into me from profiles where id = auth.uid();
  if me.office is null then raise exception 'Only office holders commission public works'; end if;
  if crew_ < 1 or crew_ > 6 or ghosts < 0 or ghosts > 6 then raise exception 'Crew of 1 to 6'; end if;
  tg := case kind_
    when 'road' then array(select code from stations where site = 'city' and kind = 'pothole' and coalesce((select until from site_state where key = 'pothole:' || code), now() - interval '1 second') < now() order by random() limit 6)
    when 'waste' then array(select code from stations where site = 'city' and kind = 'waste' order by random() limit 4)
    else array(select code from stations where site = 'city' and kind = 'stall' order by random() limit 4) end;
  if cardinality(tg) = 0 then raise exception 'Nothing to fix there right now'; end if;
  ttl := case kind_ when 'road' then 'Road repair' when 'waste' then 'Waste clearance' else 'Market repair' end || ' (' || initcap(me.office) || ' ' || me.username || ')';
  insert into contracts(poster, seat, kind, title, targets, crew, padded, ends_at) values (auth.uid(), me.office, kind_, ttl, tg, crew_, ghosts, now() + interval '2 days') returning id into cid;
  jid := job_post(jsonb_build_object('source', 'seat', 'kind', 'staff', 'title', ttl, 'skill', case when kind_ = 'waste' then 'shop' else 'mason' end, 'min_level', 0,
    'pay', 4000, 'unit', 'hour', 'start_hour', (floor(city_hour())::int + 1) % 24, 'hours', 4, 'days', 2, 'slots', crew_, 'place', 'FCDA Works Yard', 'x', 18, 'z', -183.6,
    'moral', 'government', 'meta', jsonb_build_object('floor', 'yard', 'contract', cid)));
  -- names on the crew list with no bodies on the floor: the money goes to the politician
  skim_ := per * ghosts;
  if skim_ > 0 then
    perform budget_ensure(auth.uid());
    update office_budgets set balance = balance - skim_ where user_id = auth.uid() and balance >= skim_;
    if not found then raise exception 'The budget cannot cover that crew list'; end if;
    perform w_move(auth.uid(), skim_, 'crew allowances');
    perform w_moral(auth.uid(), -least(20, 6 * ghosts));
  end if;
  update jobs set meta = meta || jsonb_build_object('floor', 'yard', 'contract', cid) where id = jid;
  update contracts set job_id = jid, skim = skim_ where id = cid;
  insert into news(text) values (ttl || ' awarded: crew of ' || (crew_ + ghosts) || '.');
  return cid;
end $$;
create or replace function public.contracts_list() returns table (id bigint, title text, kind text, targets text[], done text[], crew int, status text, mine boolean, ends_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.title, c.kind, c.targets, c.done, c.crew, c.status, c.poster = auth.uid(), c.ends_at from contracts c where c.status = 'open' or c.created_at > now() - interval '1 day' order by c.id desc limit 20;
$$;
-- what the city looks like: patched potholes, cleared waste, repaired stalls
create or replace function public.city_fixes() returns table (key text) language sql stable security definer set search_path = public as $$
  select key from site_state where (key like 'pothole:%' or key like 'waste:%' or key like 'stall:%') and until > now();
$$;
-- the shop shelf a player buys from at FreshMart or the park market
create or replace function public.shelf_take(site_ text, it text) returns int language plpgsql security definer set search_path = public as $$
begin
  if st_qty(site_, 'shelf:' || it) < 1 then return -1; end if;
  return st_add(site_, 'shelf:' || it, -1);
end $$;

-- shift pay: on a work floor, wages follow tasks done; clock out early for part pay
create or replace function public.w_finish(sid bigint, px real, pz real, early boolean) returns json
language plpgsql security definer set search_path = public as $$
declare s shifts; jb jobs; full_pay bigint; amt bigint; due bigint := 0; frac numeric; x int; mo int; floor_ boolean; okn numeric := 0; fails int := 0; quota numeric; gain int; hrs numeric; rep_ int := 2;
begin
  select * into s from shifts where id = sid and worker = auth.uid() for update;
  if not found or s.status <> 'on' then raise exception 'You are not on this shift'; end if;
  if not early and now() < s.ends_at - interval '5 seconds' then raise exception 'The shift is not over yet'; end if;
  select * into jb from jobs where id = s.job_id for update;
  if sqrt(power(px - jb.x, 2) + power(pz - jb.z, 2)) > 25 then raise exception 'Clock out at %', jb.place; end if;
  floor_ := jb.meta ? 'floor' or jb.meta ? 'site';
  full_pay := shift_pay(jb);
  frac := least(1, greatest(0, extract(epoch from (least(now(), s.ends_at) - greatest(s.checkin_at, s.starts_at))) / extract(epoch from (s.ends_at - s.starts_at))));
  if floor_ then
    hrs := greatest(1, extract(epoch from s.ends_at - s.starts_at) / 60);     -- a walk-in gig is shorter than the job's usual shift
    if jb.unit = 'hour' then full_pay := round(jb.pay * hrs); end if;
    select coalesce(sum(weight) filter (where ok), 0), count(*) filter (where ok = false) into okn, fails from ftasks where shift_id = sid;
    quota := greatest(1, 3 * hrs * case when early then frac else 1 end);
    amt := round(full_pay * (0.3 * frac + 0.7 * least(1, okn / (3 * hrs))) * (1 - least(0.5, 0.05 * fails)));
    gain := floor(okn / 3)::int;
    rep_ := case when okn >= quota * 0.8 then 2 when okn > 0 then 1 else -1 end;
  else
    amt := round(full_pay * frac); gain := case when frac >= 0.99 then 2 else 1 end;
  end if;
  if jb.source <> 'city' and jb.source <> 'union' then amt := least(amt, jb.escrow); update jobs set escrow = escrow - amt where id = jb.id; end if;
  if jb.source = 'union' and jb.poster is not null then due := amt * jb.due_pct / 100; perform w_move(jb.poster, due, 'union dues'); end if;
  perform w_move(auth.uid(), amt - due, 'wages: ' || jb.title);
  update shifts set status = 'done', paid = amt - due where id = sid;
  update ftasks set done_at = now() where shift_id = sid and done_at is null;
  x := case when gain > 0 then w_skill(auth.uid(), jb.skill, gain) else coalesce((select k.xp from skills k where k.user_id = auth.uid() and k.skill = jb.skill), 0) end;
  mo := case jb.moral when 'padded' then -1 when 'clean' then 1 else 0 end;
  update workers set rep = greatest(0, least(100, rep + rep_)), shifts_done = shifts_done + 1 where user_id = auth.uid();
  if mo <> 0 then perform w_moral(auth.uid(), mo); end if;
  return json_build_object('paid', amt - due, 'due', due, 'xp', x, 'gained', gain, 'level', skill_level(x), 'skill', jb.skill, 'moral', mo, 'tasks', okn, 'fails', fails,
                           'balance', (select balance from wallets where user_id = auth.uid()));
end $$;
create or replace function public.shift_finish(sid bigint, px real, pz real) returns json language sql security definer set search_path = public as $$ select w_finish(sid, px, pz, false); $$;
create or replace function public.shift_clockout(sid bigint, px real, pz real) returns json language sql security definer set search_path = public as $$ select w_finish(sid, px, pz, true); $$;

-- walk off without clocking out and the employer marks you absent
create or replace function public.w_settle(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with m as (update shifts set status = 'missed' where worker = uid and ((status = 'scheduled' and ends_at < now()) or (status = 'on' and ends_at < now() - interval '3 minutes')) returning 1)
  select count(*) into n from m;
  if n > 0 then update workers set rep = greatest(0, rep - 5 * n), shifts_missed = shifts_missed + n where user_id = uid; end if;
end $$;

-- materials at Unity Market and fuel at the pumps come from real stock; empty shelves mean imported prices
create or replace function public.buy_item(it text, n int) returns json
language plpgsql security definer set search_path = public as $$
declare cost bigint; b bigint; q int; src text; scarce boolean;
begin
  if n < 1 or n > 50 then raise exception 'Buy between 1 and 50'; end if;
  src := case (select cat from items where id = it) when 'fuel' then 'fuelst' when 'material' then 'unity' when 'tool' then 'unity' else null end;
  if src is null then raise exception 'Not sold here'; end if;
  scarce := st_qty(src, it) < n;
  cost := price_now(it) * n * case when scarce then 3 else 2 end / 2;
  b := w_move(auth.uid(), -cost, 'bought ' || n || ' x ' || it);
  if not scarce then perform st_add(src, it, -n); end if;
  insert into inventory(user_id, item, qty) values (auth.uid(), it, n) on conflict (user_id, item) do update set qty = inventory.qty + n returning qty into q;
  if st_qty(src, it) < 10 and not exists (select 1 from orders where kind = 'restock' and dest->>'site' = src and state not in ('dispatched','short') and lines->0->>'item' = it) and bay_of(it) is not null then
    insert into orders(site, kind, dest, lines) values ('depot', 'restock', jsonb_build_object('site', src), jsonb_build_array(jsonb_build_object('item', it, 'qty', 20, 'done', false)));
  end if;
  return json_build_object('balance', b, 'qty', q, 'cost', cost, 'scarce', scarce);
end $$;
create or replace function public.market_prices() returns table (id text, name text, cat text, price bigint, skill text, have int)
language sql stable security definer set search_path = public as $$
  select i.id, i.name, i.cat, price_now(i.id) * case when i.cat in ('material','tool','fuel') and st_qty(case i.cat when 'fuel' then 'fuelst' else 'unity' end, i.id) < 1 then 3 else 2 end / 2, i.skill, coalesce(v.qty, 0)
  from items i left join inventory v on v.item = i.id and v.user_id = auth.uid() order by i.cat, i.price;
$$;

-------------------------------------------------------------------------------
-- 16. Building Explorer: buy pieces, drag them onto a site grid, commit.
--     One system for houses, rooms, shops, offices, workshops, roads, bridges and
--     government buildings. Only the catalog and who may open it change.
--     Drafts live in the browser; a commit is checked here and written here.
-------------------------------------------------------------------------------
alter table public.plots add column if not exists name text check (name is null or char_length(name) between 2 and 40);
create table if not exists public.gov_sites (
  id text primary key, official text not null, name text check (name is null or char_length(name) between 2 and 40),
  level text not null, cats text[] not null, x real not null, z real not null, w int not null, d int not null);
create table if not exists public.pieces (
  id text primary key, name text not null, cat text not null, layer text not null, w int not null, d int not null, price bigint not null,
  trade text, mats jsonb not null default '{}', rooms text[], room text, on_ text, power boolean not null default false,
  whole boolean not null default false, outside boolean not null default false);
-- generated from src/catalog.js and src/sites.js by: node tools/catalog-sql.mjs
insert into public.pieces (id, name, cat, layer, w, d, price, trade, mats, rooms, room, on_, power, whole, outside) values
  ('pad', 'Clear and level the plot', 'structure', 'pad', 0, 0, 150000, 'labour', '{}', null, null, null, false, true, false),
  ('gpad', 'Clear the site', 'site', 'pad', 0, 0, 1000000, 'labour', '{}', null, null, null, false, true, false),
  ('foundation', 'Foundation', 'structure', 'foundation', 1, 1, 12000, 'mason', '{"cement":0.08,"rods":0.03,"sand":0.02}', null, null, null, false, false, false),
  ('slab', 'Floor slab', 'structure', 'slab', 1, 1, 15000, 'mason', '{"cement":0.1,"rods":0.03}', null, null, null, false, false, false),
  ('wall', 'Block wall', 'structure', 'wall', 1, 1, 18000, 'mason', '{"blocks":0.12,"cement":0.05}', null, null, null, false, false, false),
  ('partition', 'Partition wall', 'structure', 'wall', 1, 1, 9000, 'mason', '{"blocks":0.06}', null, null, null, false, false, false),
  ('door', 'Door', 'structure', 'opening', 1, 1, 45000, 'carpenter', '{"timber":0.2}', null, null, null, false, false, false),
  ('window', 'Window', 'structure', 'opening', 1, 1, 35000, 'carpenter', '{"timber":0.1,"fittings":0.1}', null, null, null, false, false, false),
  ('stairs', 'Staircase', 'structure', 'stairs', 1, 3, 250000, 'mason', '{"cement":0.5,"rods":0.2}', null, null, null, false, false, false),
  ('lift', 'Lift', 'structure', 'stairs', 2, 2, 2500000, 'electrician', '{"cable":1,"parts":1}', null, null, null, true, false, false),
  ('balcony', 'Balcony', 'structure', 'balcony', 1, 1, 22000, 'mason', '{"cement":0.1,"rods":0.05}', null, null, null, false, false, false),
  ('roof_zinc', 'Zinc roof', 'structure', 'roof', 1, 1, 8000, 'carpenter', '{"roofing":0.05,"timber":0.03}', null, null, null, false, false, false),
  ('roof_tile', 'Tile roof', 'structure', 'roof', 1, 1, 12000, 'carpenter', '{"roofing":0.07,"timber":0.03}', null, null, null, false, false, false),
  ('roof_slab', 'Concrete roof', 'structure', 'roof', 1, 1, 14000, 'mason', '{"cement":0.1,"rods":0.04}', null, null, null, false, false, false),
  ('gable', 'Roof shape: gable', 'structure', 'style', 0, 0, 40000, 'carpenter', '{"timber":0.5}', null, null, null, false, true, false),
  ('hip', 'Roof shape: hip', 'structure', 'style', 0, 0, 50000, 'carpenter', '{"timber":0.6}', null, null, null, false, true, false),
  ('paint_cream', 'Paint: cream', 'finish', 'paint', 1, 1, 3000, 'painter', '{"paint":0.02}', null, null, null, false, false, false),
  ('paint_white', 'Paint: white', 'finish', 'paint', 1, 1, 3000, 'painter', '{"paint":0.02}', null, null, null, false, false, false),
  ('paint_green', 'Paint: green', 'finish', 'paint', 1, 1, 3000, 'painter', '{"paint":0.02}', null, null, null, false, false, false),
  ('paint_terracotta', 'Paint: terracotta', 'finish', 'paint', 1, 1, 3000, 'painter', '{"paint":0.02}', null, null, null, false, false, false),
  ('paint_blue', 'Paint: blue', 'finish', 'paint', 1, 1, 3000, 'painter', '{"paint":0.02}', null, null, null, false, false, false),
  ('paint_yellow', 'Paint: yellow', 'finish', 'paint', 1, 1, 3000, 'painter', '{"paint":0.02}', null, null, null, false, false, false),
  ('tile_wood', 'Wood tiles', 'finish', 'tile', 1, 1, 6000, 'tiler', '{"tiles":0.03}', null, null, null, false, false, false),
  ('tile_white', 'White tiles', 'finish', 'tile', 1, 1, 6000, 'tiler', '{"tiles":0.03}', null, null, null, false, false, false),
  ('tile_terrazzo', 'Terrazzo', 'finish', 'tile', 1, 1, 7000, 'tiler', '{"tiles":0.03}', null, null, null, false, false, false),
  ('ceiling', 'POP ceiling', 'finish', 'ceiling', 1, 1, 4000, 'painter', '{}', null, null, null, false, false, false),
  ('fence', 'Fence', 'outdoor', 'fence', 1, 1, 10000, 'mason', '{"blocks":0.05}', null, null, null, false, false, false),
  ('gate', 'Gate', 'outdoor', 'fence', 3, 1, 180000, 'mason', '{"rods":0.3}', null, null, null, false, false, false),
  ('lamp', 'Outdoor lamp', 'outdoor', 'item', 1, 1, 30000, 'electrician', '{"cable":0.1}', null, null, null, false, false, true),
  ('room_bedroom', 'Room: Bedroom', 'rooms', 'room', 1, 1, 0, null, '{}', null, 'bedroom', null, false, false, false),
  ('room_living', 'Room: Living room', 'rooms', 'room', 1, 1, 0, null, '{}', null, 'living', null, false, false, false),
  ('room_kitchen', 'Room: Kitchen', 'rooms', 'room', 1, 1, 0, null, '{}', null, 'kitchen', null, false, false, false),
  ('room_bathroom', 'Room: Bathroom', 'rooms', 'room', 1, 1, 0, null, '{}', null, 'bathroom', null, false, false, false),
  ('room_dining', 'Room: Dining', 'rooms', 'room', 1, 1, 0, null, '{}', null, 'dining', null, false, false, false),
  ('room_shop', 'Room: Shop floor', 'rooms', 'room', 1, 1, 0, null, '{}', null, 'shop', null, false, false, false),
  ('room_office', 'Room: Office', 'rooms', 'room', 1, 1, 0, null, '{}', null, 'office', null, false, false, false),
  ('room_workshop', 'Room: Workshop', 'rooms', 'room', 1, 1, 0, null, '{}', null, 'workshop', null, false, false, false),
  ('room_store', 'Room: Store', 'rooms', 'room', 1, 1, 0, null, '{}', null, 'store', null, false, false, false),
  ('bed', 'Bed', 'interior', 'item', 2, 2, 180000, null, '{}', array['bedroom'], null, null, false, false, false),
  ('mattress', 'Mattress', 'interior', 'item', 2, 2, 60000, null, '{}', array['bedroom'], null, null, false, false, false),
  ('cupboard', 'Cupboard', 'interior', 'item', 1, 1, 70000, null, '{}', array['kitchen','bedroom','living','store'], null, null, false, false, false),
  ('wardrobe', 'Wardrobe', 'interior', 'item', 2, 1, 120000, null, '{}', array['bedroom'], null, null, false, false, false),
  ('kitchen', 'Kitchen unit', 'interior', 'item', 2, 1, 200000, null, '{}', array['kitchen'], null, null, false, false, false),
  ('cooker', 'Cooker', 'interior', 'item', 1, 1, 150000, null, '{}', array['kitchen'], null, null, false, false, false),
  ('sink', 'Sink', 'interior', 'item', 1, 1, 50000, 'plumber', '{"pipes":0.2}', array['kitchen','bathroom'], null, null, false, false, false),
  ('fridge', 'Fridge', 'interior', 'item', 1, 1, 220000, null, '{}', array['kitchen'], null, null, true, false, false),
  ('table', 'Table', 'interior', 'item', 2, 1, 60000, null, '{}', array['dining','living','kitchen','office'], null, null, false, false, false),
  ('chairs', 'Chairs', 'interior', 'item', 1, 1, 15000, null, '{}', array['dining','living','kitchen','office','shop'], null, null, false, false, false),
  ('sofa', 'Sofa', 'interior', 'item', 2, 1, 250000, null, '{}', array['living','office'], null, null, false, false, false),
  ('toilet', 'Toilet', 'interior', 'item', 1, 1, 80000, 'plumber', '{"pipes":0.2}', array['bathroom'], null, null, false, false, false),
  ('shower', 'Shower', 'interior', 'item', 1, 1, 70000, 'plumber', '{"pipes":0.2}', array['bathroom'], null, null, false, false, false),
  ('light', 'Ceiling light', 'interior', 'light', 1, 1, 12000, 'electrician', '{"cable":0.05}', array['bedroom','living','kitchen','bathroom','dining','shop','office','workshop','store'], null, null, false, false, false),
  ('frame', 'Picture frame', 'interior', 'decor', 1, 1, 8000, null, '{}', null, null, null, false, false, false),
  ('counter', 'Shop counter', 'shop', 'item', 2, 1, 150000, null, '{}', array['shop'], null, null, false, false, false),
  ('shelves', 'Shelves', 'shop', 'item', 2, 1, 80000, null, '{}', array['shop','store'], null, null, false, false, false),
  ('till', 'Till', 'shop', 'item', 1, 1, 120000, null, '{}', array['shop'], null, null, true, false, false),
  ('sign', 'Shop sign', 'shop', 'sign', 1, 1, 60000, 'painter', '{"paint":0.1}', null, null, null, false, false, false),
  ('desk', 'Office desk', 'office', 'item', 2, 1, 90000, null, '{}', array['office'], null, null, false, false, false),
  ('meeting', 'Meeting table', 'office', 'item', 3, 2, 300000, null, '{}', array['office'], null, null, false, false, false),
  ('reception', 'Reception desk', 'office', 'item', 2, 1, 180000, null, '{}', array['office'], null, null, false, false, false),
  ('bay', 'Car bay', 'workshop', 'item', 3, 5, 400000, 'mason', '{"cement":0.5}', array['workshop'], null, null, false, false, false),
  ('carlift', 'Car lift', 'workshop', 'item', 2, 4, 1200000, 'mechanic', '{"parts":1}', array['workshop'], null, null, true, false, false),
  ('toolrack', 'Tool rack', 'workshop', 'item', 2, 1, 90000, null, '{}', array['workshop','store'], null, null, false, false, false),
  ('gov_office', 'Office block', 'gov', 'prefab', 6, 4, 20000000, 'mason', '{"cement":6,"blocks":6,"rods":3}', null, null, null, false, false, false),
  ('gov_market', 'Market shed', 'gov', 'prefab', 8, 4, 12000000, 'mason', '{"roofing":4,"rods":2}', null, null, null, false, false, false),
  ('gov_clinic', 'Clinic shell', 'gov', 'prefab', 6, 5, 26000000, 'mason', '{"cement":6,"blocks":8,"rods":3}', null, null, null, false, false, false),
  ('gov_school', 'School block', 'gov', 'prefab', 8, 4, 24000000, 'mason', '{"cement":6,"blocks":8,"rods":3}', null, null, null, false, false, false),
  ('lane', 'Road lane', 'road', 'road', 1, 1, 250000, 'mason', '{"cement":0.2,"sand":0.1}', null, null, null, false, false, false),
  ('junction', 'Junction', 'road', 'road', 1, 1, 300000, 'mason', '{"cement":0.25,"sand":0.1}', null, null, null, false, false, false),
  ('shoulder', 'Road shoulder', 'road', 'road', 1, 1, 80000, 'mason', '{"sand":0.1}', null, null, null, false, false, false),
  ('drain', 'Drainage', 'road', 'road', 1, 1, 150000, 'mason', '{"cement":0.1,"pipes":0.1}', null, null, null, false, false, false),
  ('streetlight', 'Street light', 'road', 'fixture', 1, 1, 200000, 'electrician', '{"cable":0.2}', null, null, 'road', false, false, false),
  ('pier', 'Bridge pier', 'bridge', 'pier', 1, 1, 4000000, 'mason', '{"cement":1,"rods":0.5}', null, null, null, false, false, false),
  ('deck', 'Bridge deck', 'bridge', 'deck', 1, 1, 2500000, 'mason', '{"cement":0.4,"rods":0.3}', null, null, null, false, false, false),
  ('ramp', 'Bridge ramp', 'bridge', 'road', 1, 1, 1500000, 'mason', '{"cement":0.3,"rods":0.1}', null, null, null, false, false, false),
  ('rail', 'Bridge rail', 'bridge', 'fixture', 1, 1, 200000, 'mason', '{"rods":0.1}', null, null, 'deck', false, false, false)
on conflict (id) do update set name = excluded.name, cat = excluded.cat, layer = excluded.layer, w = excluded.w, d = excluded.d, price = excluded.price, trade = excluded.trade, mats = excluded.mats, rooms = excluded.rooms, room = excluded.room, on_ = excluded.on_, power = excluded.power, whole = excluded.whole, outside = excluded.outside;
insert into public.gov_sites (id, official, level, cats, x, z, w, d) values
  ('council', 'AMAC Council Grounds', 'local', array['site','gov','outdoor'], -120, 320, 12, 10),
  ('lugbe_road', 'Lugbe Layout Road (extension)', 'local', array['site','road'], -286, -200, 44, 6),
  ('nyanya_works', 'Nyanya District Works', 'district', array['site','gov','outdoor'], -380, -190, 12, 8),
  ('katampe_road', 'Katampe Road (extension)', 'district', array['site','road'], 271, -200, 28, 6),
  ('city_works', 'Federal City Works', 'city', array['site','gov','outdoor'], 240, -160, 12, 8),
  ('jabi_bridge', 'Jabi Lake Bridge', 'bridge', array['site','bridge','road'], 196, 290, 18, 4),
  ('aso_estate', 'Aso Rock Estate', 'aso', array['site','gov','outdoor'], 330, -225, 18, 10)
on conflict (id) do update set official = excluded.official, level = excluded.level, cats = excluded.cats, x = excluded.x, z = excluded.z, w = excluded.w, d = excluded.d;

-- pieces you bought and have not placed yet (holder: your id, or the government site for public money)
create table if not exists public.build_inv (holder text not null, piece text not null references public.pieces(id), qty int not null default 0 check (qty >= 0), primary key (holder, piece));
-- committed pieces: what everyone sees. built = the crew has done its task (furniture and room labels are built at once)
create table if not exists public.parts (
  id bigserial primary key, site text not null, piece text not null references public.pieces(id),
  fl int not null default 0, x int not null default 0, z int not null default 0, rot int not null default 0,
  built boolean not null default false, by_ uuid, contract_id bigint, created_at timestamptz not null default now());
create index if not exists parts_site on public.parts (site);
-- drafts from an invited builder or architect, waiting for the owner's approval
create table if not exists public.site_drafts (
  site text not null, author uuid not null references public.profiles(id) on delete cascade, ops jsonb not null, note text not null default '',
  status text not null default 'draft' check (status in ('draft','submitted')), updated_at timestamptz not null default now(), primary key (site, author));
create table if not exists public.name_reports (site text not null, by_ uuid not null, why text, created_at timestamptz not null default now(), primary key (site, by_));
alter table public.contracts add column if not exists site text;
alter table public.contracts drop constraint if exists contracts_kind_check;
alter table public.contracts add constraint contracts_kind_check check (kind in ('road','waste','market','build'));
alter table public.ftasks add column if not exists part_id bigint;
alter table public.ftasks add column if not exists part_ids bigint[];

-- the old way (a design that advanced by hours) is gone: return what owners put in, then remove it
do $$ declare b record; m record; j record; begin
  if to_regclass('public.builds') is not null then
    for j in select id from jobs where open and meta ? 'build' loop perform w_close_job(j.id); end loop;
    for b in execute 'select owner, got, spec from public.builds' loop
      for m in select key, sum(value::int) n from (select * from jsonb_each_text(coalesce(b.got->'materials', '{}')) union all select * from jsonb_each_text(coalesce(b.got->'pile', '{}'))) e group by key loop
        insert into inventory(user_id, item, qty) values (b.owner, m.key, m.n) on conflict (user_id, item) do update set qty = inventory.qty + m.n;
      end loop;
      if coalesce((b.spec->>'permit')::bigint, 0) > 0 then perform w_move(b.owner, (b.spec->>'permit')::bigint, 'permit refund: building moved to the Building Explorer'); end if;
    end loop;
  end if;
end $$;
drop function if exists public.trade_mats(text), public.trade_order(), public.design_spec(jsonb), public.next_trade(jsonb, text),
  public.build_start(int, jsonb), public.build_deposit(bigint, text, int), public.build_begin(bigint, real, real), public.build_work(bigint, real, real),
  public.build_stop(bigint), public.build_furnish(bigint, jsonb), public.build_ready(bigint, text), public.build_credit(bigint, text, int),
  public.design_job_post(int, jsonb, bigint, int), public.design_submit(bigint, jsonb, text), public.design_review(bigint, boolean, text),
  public.my_design_jobs(), public.ft_site(bigint, bigint, text), public.ft_idle(text, bigint, boolean);
drop table if exists public.design_jobs cascade;
drop table if exists public.builds cascade;
alter table public.ftasks drop column if exists build_id;

do $$ begin
  alter table public.gov_sites enable row level security; alter table public.pieces enable row level security; alter table public.build_inv enable row level security;
  alter table public.parts enable row level security; alter table public.site_drafts enable row level security; alter table public.name_reports enable row level security;
end $$;
drop policy if exists "gov sites readable" on public.gov_sites; create policy "gov sites readable" on public.gov_sites for select to authenticated using (true);
drop policy if exists "pieces readable" on public.pieces; create policy "pieces readable" on public.pieces for select to authenticated using (true);
drop policy if exists "parts readable" on public.parts; create policy "parts readable" on public.parts for select to authenticated using (true);
drop policy if exists "own inventory" on public.build_inv; create policy "own inventory" on public.build_inv for select to authenticated using (holder = auth.uid()::text or holder like 'gov:%');

-- what a site is: where, how big, who holds it
create or replace function public.site_meta(site_ text) returns table (x real, z real, name text, w int, d int, cell real, face int, floors int, cats text[], holder text, kind text, level text)
language sql stable security definer set search_path = public as $$
  select p.x, p.z, coalesce(p.name, 'Plot ' || p.code), p.w::int, p.d::int, 1::real, p.face,
         case p.kind when 'workshop' then 1 when 'mixed' then 3 when 'office' then 4 else 2 end,
         array['structure','finish','outdoor','rooms','interior'] || case p.kind when 'shop' then array['shop'] when 'office' then array['office'] when 'workshop' then array['workshop'] when 'mixed' then array['shop','office'] else array[]::text[] end,
         p.owner::text, 'plot', null::text
  from plots p where 'plot:' || p.id = site_
  union all
  select g.x, g.z, coalesce(g.name, g.official), g.w, g.d, 2, 1, 1, g.cats, 'gov:' || g.id, 'gov', g.level from gov_sites g where 'gov:' || g.id = site_;
$$;
-- who may open the explorer: the owner (plot owner, or the seat for government land), or someone hired on that site
create or replace function public.site_role(site_ text) returns text language plpgsql stable security definer set search_path = public as $$
declare m record; o text;
begin
  select * into m from site_meta(site_); if not found then return null; end if;
  if m.kind = 'plot' and m.holder = auth.uid()::text then return 'owner'; end if;
  if m.kind = 'gov' then
    select office into o from profiles where id = auth.uid();
    if m.level = any(case o when 'chairman' then array['local'] when 'senator' then array['district'] when 'vp' then array['city','bridge','aso'] when 'president' then array['city','bridge','aso'] else array[]::text[] end) then return 'owner'; end if;
    if m.cats && array['road','bridge'] then return null; end if;      -- citizens only work shifts on roads and bridges
  end if;
  if exists (select 1 from applications a join jobs j on j.id = a.job_id where a.user_id = auth.uid() and a.status = 'hired' and j.open and j.meta->>'site' = site_) then return 'invited'; end if;
  return null;
end $$;
-- prices follow the city: midday shock, and the market levy on pieces made from materials
create or replace function public.piece_price(pid text) returns bigint language sql stable security definer set search_path = public as $$
  select (round(p.price * (case when city_hour() >= 10 and city_hour() < 14 then 1.4 else 1 end) * (1 + case when p.mats <> '{}' then policy_value('market_levy') else 0 end) / 10) * 10)::bigint
  from pieces p where p.id = pid;
$$;
create or replace function public.piece_prices(site_ text) returns table (id text, price bigint, have int) language sql stable security definer set search_path = public as $$
  select p.id, piece_price(p.id), coalesce(v.qty, 0) from pieces p
  left join build_inv v on v.piece = p.id and v.holder = case when site_ like 'gov:%' then site_ else auth.uid()::text end;
$$;
-- buy pieces into your build inventory (government land: from the seat's budget)
create or replace function public.piece_buy(pid text, n int, site_ text) returns json language plpgsql security definer set search_path = public as $$
declare m record; pc pieces; cost bigint; hold text; q int; b bigint;
begin
  if site_role(site_) is distinct from 'owner' then raise exception 'Only the owner buys pieces for this site'; end if;
  select * into m from site_meta(site_); select * into pc from pieces where id = pid;
  if not found or not (pc.cat = any(m.cats)) then raise exception 'That piece is not sold for this site'; end if;
  if n < 1 or n > 500 then raise exception 'Buy between 1 and 500'; end if;
  cost := piece_price(pid) * n;
  if m.kind = 'gov' then
    hold := site_; perform budget_ensure(auth.uid());
    update office_budgets set balance = balance - cost where user_id = auth.uid() and balance >= cost returning balance into b;
    if not found then raise exception 'The office budget cannot cover ₦%', to_char(cost, 'FM999,999,999,999'); end if;
  else hold := auth.uid()::text; b := w_move(auth.uid(), -cost, 'bought ' || n || ' x ' || pc.name); end if;
  insert into build_inv values (hold, pid, n) on conflict (holder, piece) do update set qty = build_inv.qty + n returning qty into q;
  return json_build_object('balance', b, 'qty', q, 'cost', cost, 'public', m.kind = 'gov');
end $$;

-- the rules (src/catalog.js has the same): returns '' when every piece on the site can stand
create or replace function public.site_check(ps jsonb, w_ int, d_ int, floors_ int) returns text language plpgsql security definer set search_path = public as $$
declare m text;
begin
  create temp table if not exists sc_parts (n bigint, piece text, nm text, layer text, fl int, x int, z int, pw int, pd int, whole boolean, rooms text[], room text, on_ text, outside boolean) on commit drop;
  create temp table if not exists sc_cells (n bigint, nm text, layer text, grp text, fl int, x int, z int, rooms text[], room text, on_ text, outside boolean) on commit drop;
  truncate sc_parts; truncate sc_cells;
  insert into sc_parts select e.ord, p.id, p.name, p.layer, coalesce((e.v->>'fl')::int, 0), coalesce((e.v->>'x')::int, 0), coalesce((e.v->>'z')::int, 0),
      case when coalesce((e.v->>'rot')::int, 0) % 2 = 1 then p.d else p.w end, case when coalesce((e.v->>'rot')::int, 0) % 2 = 1 then p.w else p.d end, p.whole, p.rooms, p.room, p.on_, p.outside
    from jsonb_array_elements(ps) with ordinality e(v, ord) left join pieces p on p.id = e.v->>'piece';
  if exists (select 1 from sc_parts where piece is null) then return 'Unknown piece'; end if;
  insert into sc_cells select n, nm, layer, case when layer in ('wall','stairs','item','prefab','fence','road','deck') then 'solid' else layer end, fl, x + i, z + j, rooms, room, on_, outside
    from sc_parts, generate_series(0, greatest(pw, 1) - 1) i, generate_series(0, greatest(pd, 1) - 1) j where not whole;
  if exists (select 1 from sc_parts where fl < 0 or fl >= floors_) then return 'This site cannot go that high'; end if;
  if exists (select 1 from sc_cells where x < 0 or z < 0 or x >= w_ or z >= d_) then return 'Outside the site'; end if;
  m := (select string_agg(distinct nm, ' and ') from sc_cells c where (select count(*) from sc_cells o where o.fl = c.fl and o.x = c.x and o.z = c.z and o.grp = c.grp) > 1);
  if m is not null then return 'Two pieces on one cell: ' || m; end if;
  m := (select nm from sc_parts where whole group by nm, layer having count(*) > 1 limit 1); if m is not null then return 'Only one ' || m; end if;
  if exists (select 1 from sc_parts where layer <> 'pad') and not exists (select 1 from sc_parts where layer = 'pad') then return 'Clear and level the site first'; end if;
  m := (select nm from sc_parts p where fl > 0 and not exists (select 1 from sc_cells s where s.layer = 'stairs' and s.fl = p.fl - 1) limit 1);
  if m is not null then return m || ': add a staircase or lift on the floor below first'; end if;
  m := coalesce(
    (select nm || ': foundations go on the ground floor' from sc_cells where layer = 'foundation' and fl > 0 limit 1),
    (select nm || ': a floor slab needs a foundation under it' from sc_cells c where layer = 'slab' and fl = 0 and not exists (select 1 from sc_cells s where s.layer = 'foundation' and s.fl = 0 and s.x = c.x and s.z = c.z) limit 1),
    (select nm || ': an upper floor needs a slab under it' from sc_cells c where layer = 'slab' and fl > 0 and not exists (select 1 from sc_cells s where s.layer = 'slab' and s.fl = c.fl - 1 and s.x = c.x and s.z = c.z) limit 1),
    (select nm || ': a balcony is there' from sc_cells c where layer = 'slab' and exists (select 1 from sc_cells s where s.layer = 'balcony' and s.fl = c.fl and s.x = c.x and s.z = c.z) limit 1),
    (select nm || ': it needs a floor slab' from sc_cells c where layer in ('wall','stairs','tile','room','light') and not exists (select 1 from sc_cells s where s.layer = 'slab' and s.fl = c.fl and s.x = c.x and s.z = c.z) limit 1),
    (select nm || ': it needs a floor slab' from sc_cells c where layer = 'item' and not outside and not exists (select 1 from sc_cells s where s.layer = 'slab' and s.fl = c.fl and s.x = c.x and s.z = c.z) limit 1),
    (select nm || ': it needs a wall' from sc_cells c where layer in ('opening','paint','sign','decor') and not exists (select 1 from sc_cells s where s.layer = 'wall' and s.fl = c.fl and s.x = c.x and s.z = c.z) limit 1),
    (select nm || ': a roof needs the floor under it' from sc_cells c where layer = 'roof' and not exists (select 1 from sc_cells s where s.layer = 'slab' and s.fl = c.fl and s.x = c.x and s.z = c.z) limit 1),
    (select nm || ': there is a floor above' from sc_cells c where layer = 'roof' and exists (select 1 from sc_cells s where s.layer = 'slab' and s.fl = c.fl + 1 and s.x = c.x and s.z = c.z) limit 1),
    (select nm || ': close every outside edge of this floor with walls first' from sc_cells c where layer = 'roof' and exists (
       select 1 from sc_cells s where s.layer = 'slab' and s.fl = c.fl
         and exists (select 1 from (values (1,0),(-1,0),(0,1),(0,-1)) v(a,b) where not exists (select 1 from sc_cells t where t.layer = 'slab' and t.fl = s.fl and t.x = s.x + v.a and t.z = s.z + v.b))
         and not exists (select 1 from sc_cells t where t.layer = 'wall' and t.fl = s.fl and t.x = s.x and t.z = s.z)) limit 1),
    (select nm || ': put a roof on first' from sc_parts where layer = 'style' and not exists (select 1 from sc_cells where layer = 'roof') limit 1),
    (select nm || ': a ceiling needs a roof or a floor above' from sc_cells c where layer = 'ceiling' and not exists (select 1 from sc_cells s where s.fl in (c.fl, c.fl + 1) and s.x = c.x and s.z = c.z and ((s.layer = 'roof' and s.fl = c.fl) or (s.layer = 'slab' and s.fl = c.fl + 1))) limit 1),
    (select nm || ': it needs a floor slab' from sc_cells c where layer = 'ceiling' and not exists (select 1 from sc_cells s where s.layer = 'slab' and s.fl = c.fl and s.x = c.x and s.z = c.z) limit 1),
    (select nm || ': mark the room first' from sc_cells c where (layer = 'light' or (layer = 'item' and not outside)) and not exists (select 1 from sc_cells s where s.layer = 'room' and s.fl = c.fl and s.x = c.x and s.z = c.z) limit 1),
    (select nm || ': it does not belong in that room' from sc_cells c where layer = 'item' and not outside and rooms is not null and not exists (select 1 from sc_cells s where s.layer = 'room' and s.fl = c.fl and s.x = c.x and s.z = c.z and s.room = any(c.rooms)) limit 1),
    (select nm || ': this goes outside the building' from sc_cells c where layer = 'item' and outside and (fl > 0 or exists (select 1 from sc_cells s where s.layer = 'foundation' and s.x = c.x and s.z = c.z)) limit 1),
    (select nm || ': balconies go on upper floors and must touch the floor' from sc_cells c where layer = 'balcony' and (fl = 0
       or exists (select 1 from sc_cells s where s.layer = 'slab' and s.fl = c.fl and s.x = c.x and s.z = c.z)
       or not exists (select 1 from sc_cells s where s.layer = 'slab' and s.fl = c.fl and abs(s.x - c.x) + abs(s.z - c.z) = 1)) limit 1),
    (select nm || ': fences go on the ground, outside the building' from sc_cells c where layer = 'fence' and (fl > 0 or exists (select 1 from sc_cells s where s.layer = 'foundation' and s.x = c.x and s.z = c.z)) limit 1),
    (select nm || ': this goes on the ground' from sc_cells where layer in ('prefab','road','pier','deck') and fl > 0 limit 1),
    (select nm || ': it goes on a ' || on_ from sc_cells c where layer = 'fixture' and not exists (select 1 from sc_cells s where s.layer = c.on_ and s.fl = c.fl and s.x = c.x and s.z = c.z) limit 1),
    (select nm || ': a deck needs a pier within 2 cells' from sc_cells c where layer = 'deck' and not exists (select 1 from sc_cells s where s.layer = 'pier' and abs(s.x - c.x) <= 2 and abs(s.z - c.z) <= 2) limit 1));
  return coalesce(m, '');
end $$;

-- the order builders work in (src/catalog.js rankOf)
create or replace function public.part_rank(fl int, layer text) returns int language sql immutable as $$
  select fl * 10 + case layer when 'pad' then 0 when 'foundation' then 1 when 'slab' then 2 when 'fence' then 2 when 'prefab' then 2 when 'road' then 2 when 'pier' then 2
    when 'wall' then 3 when 'stairs' then 3 when 'deck' then 3 when 'opening' then 4 when 'balcony' then 4 when 'roof' then 5 when 'style' then 6
    when 'item' then 8 when 'light' then 8 when 'decor' then 8 when 'room' then 9 else 7 end;
$$;
-- where a part sits in the world (its centre)
create or replace function public.part_world(site_ text, p parts) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('x', m.x + (-m.w / 2.0 + cx) * m.cell * m.face, 'z', m.z + (-m.d / 2.0 + cz) * m.cell * m.face)
  from site_meta(site_) m, pieces pc,
    lateral (select case when pc.whole then m.w / 2.0 else p.x + (case when p.rot % 2 = 1 then pc.d else pc.w end) / 2.0 end cx,
                    case when pc.whole then m.d / 2.0 else p.z + (case when p.rot % 2 = 1 then pc.w else pc.d end) / 2.0 end cz) c
  where pc.id = p.piece;
$$;

-- apply a list of ops to a site: [{act:'place', piece, fl, x, z, rot}, {act:'remove', id}]
create or replace function public.site_apply(site_ text, ops jsonb, author uuid) returns json language plpgsql security definer set search_path = public as $$
declare m record; cur jsonb; fin jsonb; msg text; r record; hold text; got int; salv bigint := 0; nplace int; nrem int; cid bigint; out_ boolean; o text;
begin
  perform pg_advisory_xact_lock(hashtext(site_));
  select * into m from site_meta(site_);
  hold := case when m.kind = 'gov' then site_ else m.holder end;
  if exists (select 1 from jsonb_array_elements(ops) e where e->>'act' = 'remove' and not exists (select 1 from parts where id = (e->>'id')::bigint and site = site_)) then raise exception 'That piece is not on this site'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('piece', piece, 'fl', fl, 'x', x, 'z', z, 'rot', rot)), '[]') into cur from parts
    where site = site_ and id not in (select (e->>'id')::bigint from jsonb_array_elements(ops) e where e->>'act' = 'remove');
  fin := cur || coalesce((select jsonb_agg(e) from jsonb_array_elements(ops) e where e->>'act' = 'place'), '[]');
  msg := site_check(fin, m.w, m.d, m.floors);
  if msg <> '' then raise exception '%', msg; end if;
  select count(*) filter (where e->>'act' = 'place'), count(*) filter (where e->>'act' = 'remove') into nplace, nrem from jsonb_array_elements(ops) e;
  -- pieces must be in the build inventory (room labels are free)
  for r in select e->>'piece' pid, count(*)::int n from jsonb_array_elements(ops) e join pieces p on p.id = e->>'piece' where e->>'act' = 'place' and p.price > 0 group by 1 loop
    select qty into got from build_inv where holder = hold and piece = r.pid;
    if coalesce(got, 0) < r.n then raise exception 'Buy % more % first', r.n - coalesce(got, 0), (select name from pieces where id = r.pid); end if;
  end loop;
  -- city stock: the materials the new pieces use
  for r in select key, ceil(sum(v::numeric) - 0.000000001)::int n from jsonb_array_elements(ops) e join pieces p on p.id = e->>'piece', jsonb_each_text(p.mats) mt(key, v) where e->>'act' = 'place' group by key loop
    if r.n > 0 and st_qty('unity', r.key) < r.n then raise exception 'Short in the city: % (needs %, Unity Market has %). Wait for the depot to restock, then commit.', r.key, r.n, st_qty('unity', r.key); end if;
  end loop;
  out_ := mod(floor(extract(epoch from now()) / 60)::bigint * 7919 + abs(hashtext(site_))::bigint * 104729, 100) < 12;
  if out_ then
    o := (select p.name from jsonb_array_elements(ops) e join pieces p on p.id = e->>'piece' where e->>'act' = 'place' and p.power limit 1);
    if o is not null then raise exception 'NEPA took light at the site: the % cannot be fitted now. Commit again when power is back.', o; end if;
  end if;
  if exists (select 1 from jobs j where j.open and j.meta->>'site' = site_ and j.source <> 'city' and j.unit = 'hour' and j.escrow < shift_pay(j)) then
    raise exception 'Your crew''s held pay has run out. Close their job or post a new one before you commit.'; end if;
  -- write it
  for r in select e->>'piece' pid, count(*)::int n from jsonb_array_elements(ops) e join pieces p on p.id = e->>'piece' where e->>'act' = 'place' and p.price > 0 group by 1 loop
    update build_inv set qty = qty - r.n where holder = hold and piece = r.pid;
  end loop;
  for r in select key, ceil(sum(v::numeric) - 0.000000001)::int n from jsonb_array_elements(ops) e join pieces p on p.id = e->>'piece', jsonb_each_text(p.mats) mt(key, v) where e->>'act' = 'place' group by key loop
    if r.n > 0 then perform st_add('unity', r.key, -r.n); end if;
  end loop;
  -- taking pieces out: 40% back as salvage
  select coalesce(sum(piece_price(piece) * 4 / 10), 0) into salv from parts where id in (select (e->>'id')::bigint from jsonb_array_elements(ops) e where e->>'act' = 'remove');
  delete from parts where id in (select (e->>'id')::bigint from jsonb_array_elements(ops) e where e->>'act' = 'remove');
  if salv > 0 then
    if m.kind = 'gov' then update office_budgets set balance = balance + salv where user_id = auth.uid();
    else perform w_move(m.holder::uuid, salv, 'salvage from ' || m.name); end if;
  end if;
  select id into cid from contracts where site = site_ and kind = 'build' and status = 'open' order by id desc limit 1;
  insert into parts(site, piece, fl, x, z, rot, built, by_, contract_id)
    select site_, p.id, coalesce((e->>'fl')::int, 0), coalesce((e->>'x')::int, 0), coalesce((e->>'z')::int, 0), coalesce((e->>'rot')::int, 0) % 4, p.trade is null, author, cid
    from jsonb_array_elements(ops) e join pieces p on p.id = e->>'piece' where e->>'act' = 'place';
  if m.kind = 'gov' then
    if nplace = 0 and nrem > 0 then          -- pulling down public works with nothing to replace them
      perform w_moral(auth.uid(), -6);
      insert into site_state values ('protest:' || site_, '1', now() + interval '1 day') on conflict (key) do update set val = (coalesce(site_state.val, '0')::int + 1)::text, until = excluded.until;
      insert into news(text) values ('Residents protest at ' || m.name || ': public works pulled down with nothing planned in their place.');
    elsif nplace > 0 then
      insert into news(text) values ((select initcap(office) || ' ' || username from profiles where id = auth.uid()) || ' committed ' || nplace || ' pieces at ' || m.name || '.');
    end if;
  end if;
  return json_build_object('placed', nplace, 'removed', nrem, 'salvage', salv, 'balance', (select balance from wallets where user_id = auth.uid()));
end $$;
create or replace function public.site_commit(site_ text, ops jsonb) returns json language plpgsql security definer set search_path = public as $$
begin
  if site_role(site_) is distinct from 'owner' then raise exception 'Only the owner commits. Your changes stay a draft until they approve.'; end if;
  perform orders_tick();
  return site_apply(site_, ops, auth.uid());
end $$;
create or replace function public.site_rename(site_ text, nm text) returns void language plpgsql security definer set search_path = public as $$
begin
  if site_role(site_) is distinct from 'owner' then raise exception 'Only the owner names this place'; end if;
  nm := nullif(trim(regexp_replace(nm, '\s+', ' ', 'g')), '');
  if nm is not null and char_length(nm) not between 2 and 40 then raise exception 'Names are 2 to 40 letters'; end if;
  if site_ like 'plot:%' then update plots set name = nm where 'plot:' || id = site_; else update gov_sites set name = nm where 'gov:' || id = site_; end if;
  delete from name_reports where site = site_;
end $$;
-- three reports and the name comes down until the owner picks a new one
create or replace function public.name_report(site_ text, why text) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into name_reports(site, by_, why) values (site_, auth.uid(), left(why, 200)) on conflict do nothing;
  if (select count(*) from name_reports where site = site_) >= 3 then
    update plots set name = null where 'plot:' || id = site_; update gov_sites set name = null where 'gov:' || id = site_;
    delete from name_reports where site = site_;
  end if;
end $$;
-- invited builders and architects: their drops are a draft until the owner approves
create or replace function public.site_draft_save(site_ text, ops jsonb, note_ text, submit boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if site_role(site_) is distinct from 'invited' then raise exception 'You are not invited to draft on this site'; end if;
  if jsonb_array_length(ops) > 600 then raise exception 'That draft is too big'; end if;
  insert into site_drafts values (site_, auth.uid(), ops, left(coalesce(note_, ''), 200), case when submit then 'submitted' else 'draft' end, now())
    on conflict (site, author) do update set ops = excluded.ops, note = excluded.note, status = excluded.status, updated_at = now();
end $$;
create or replace function public.site_drafts_for(site_ text) returns table (author uuid, username text, ops jsonb, note text, status text, updated_at timestamptz, mine boolean)
language sql stable security definer set search_path = public as $$
  select d.author, p.username, d.ops, d.note, d.status, d.updated_at, d.author = auth.uid() from site_drafts d join profiles p on p.id = d.author
  where d.site = site_ and (d.author = auth.uid() or site_role(site_) = 'owner') order by d.updated_at desc;
$$;
-- the owner approves: missing pieces are bought at today's price, the draft is committed, an architect is paid
create or replace function public.site_approve(site_ text, author_ uuid, ok boolean) returns json language plpgsql security definer set search_path = public as $$
declare d site_drafts; r record; hold text; got int; res json; jb jobs;
begin
  if site_role(site_) is distinct from 'owner' then raise exception 'Only the owner approves'; end if;
  select * into d from site_drafts where site = site_ and author = author_ for update;
  if not found then raise exception 'That draft is gone'; end if;
  if not ok then update site_drafts set status = 'draft', note = 'Sent back by the owner' where site = site_ and author = author_; return json_build_object('sent_back', true); end if;
  hold := case when site_ like 'gov:%' then site_ else auth.uid()::text end;
  for r in select e->>'piece' pid, count(*)::int n from jsonb_array_elements(d.ops) e join pieces p on p.id = e->>'piece' where e->>'act' = 'place' and p.price > 0 group by 1 loop
    select qty into got from build_inv where holder = hold and piece = r.pid;
    if coalesce(got, 0) < r.n then perform piece_buy(r.pid, r.n - coalesce(got, 0), site_); end if;
  end loop;
  res := site_apply(site_, d.ops, author_);
  delete from site_drafts where site = site_ and author = author_;
  select j.* into jb from jobs j join applications a on a.job_id = j.id and a.user_id = author_ and a.status = 'hired' where j.open and j.meta->>'site' = site_ and j.skill = 'architect' limit 1;
  if found then
    perform w_move(author_, jb.escrow, 'architect fee: ' || jb.title); update jobs set escrow = 0 where id = jb.id; perform w_close_job(jb.id);
    perform w_skill(author_, 'architect', 3); update workers set rep = least(100, rep + 2) where user_id = author_;
  end if;
  return res;
end $$;

-- the sites I am hired on (builders and architects)
create or replace function public.my_sites() returns table (site text, skill text) language sql stable security definer set search_path = public as $$
  select distinct j.meta->>'site', j.skill from applications a join jobs j on j.id = a.job_id where a.user_id = auth.uid() and a.status = 'hired' and j.open and j.meta ? 'site';
$$;
-- building tasks: the next piece in order, done at its spot on the site
create or replace function public.ft_build(sid bigint, site_ text, trade_ text) returns bigint language plpgsql security definer set search_path = public as $$
declare m record; lo int; p parts; pc pieces; wp jsonb; gate jsonb; act text; ids bigint[]; tid bigint;
begin
  select * into m from site_meta(site_); if not found then return null; end if;
  select min(part_rank(pt.fl, pc2.layer)) into lo from parts pt join pieces pc2 on pc2.id = pt.piece where pt.site = site_ and not pt.built;
  if lo is null then return null; end if;
  select pt.* into p from parts pt join pieces pc2 on pc2.id = pt.piece
   where pt.site = site_ and not pt.built and part_rank(pt.fl, pc2.layer) = lo
     and (pc2.trade = 'labour' or pc2.trade = trade_ or (trade_ is null and my_level(auth.uid(), pc2.trade) >= 1))
     and not exists (select 1 from ftasks f where pt.id = any(coalesce(f.part_ids, array[f.part_id])) and f.done_at is null and f.issued_at > now() - interval '4 minutes')
   order by random() limit 1;
  if not found then return null; end if;
  select * into pc from pieces where id = p.piece;
  -- small pieces (one cell) go four at a time: the nearest ones of the same kind
  ids := array(select q.id from parts q where q.site = site_ and q.piece = p.piece and q.fl = p.fl and not q.built and pc.w = 1 and pc.d = 1
     and not exists (select 1 from ftasks f where q.id = any(coalesce(f.part_ids, array[f.part_id])) and f.done_at is null and f.issued_at > now() - interval '4 minutes')
     order by abs(q.x - p.x) + abs(q.z - p.z) limit 4);
  if cardinality(ids) = 0 then ids := array[p.id]; end if;
  wp := part_world(site_, p);
  gate := jsonb_build_object('x', m.x, 'z', m.z + (m.d / 2.0 - .5) * m.cell * m.face);
  act := case pc.trade when 'mason' then 'lay' when 'carpenter' then 'fix' when 'electrician' then 'wire' when 'plumber' then 'plumb' when 'tiler' then 'tile' when 'painter' then 'paint' when 'mechanic' then 'fit' else 'dig' end;
  tid := ft_make(sid, p.id, site_, 'build', jsonb_build_array(
      jsonb_build_object('code', 'GATE', 'x', gate->'x', 'z', gate->'z', 'w', true, 'site', site_, 'act', 'lift', 'hold', 1.2, 'power', false, 'label', 'Collect materials at the gate'),
      jsonb_build_object('code', upper(left(pc.name, 14)), 'x', wp->'x', 'z', wp->'z', 'w', true, 'site', site_, 'act', act, 'hold', 2.4, 'power', pc.power, 'label', initcap(act) || ': ' || lower(pc.name) || case when cardinality(ids) > 1 then ' ×' || cardinality(ids) else '' end || case when p.fl > 0 then ' (floor ' || p.fl || ')' else '' end)),
    null, null, coalesce(pc.trade, 'labour'), cardinality(ids), null, null, 1, m.name);
  update ftasks set part_ids = ids where id = tid;
  return tid;
end $$;
create or replace function public.site_idle(site_ text) returns text language plpgsql stable security definer set search_path = public as $$
declare lo int; t text; n text; free_ int;
begin
  select min(part_rank(pt.fl, pc.layer)) into lo from parts pt join pieces pc on pc.id = pt.piece where pt.site = site_ and not pt.built;
  if lo is null then return 'Nothing left to build here. New pieces come from the owner''s Building Explorer.'; end if;
  select pc.trade, lower(pc.name), count(*) filter (where not exists (select 1 from ftasks f where f.part_id = pt.id and f.done_at is null and f.issued_at > now() - interval '4 minutes'))
    into t, n, free_ from parts pt join pieces pc on pc.id = pt.piece where pt.site = site_ and not pt.built and part_rank(pt.fl, pc.layer) = lo group by 1, 2 order by 3 desc limit 1;
  if free_ = 0 then return 'Others are on the ' || n || ' right now. Your next task comes in a moment.'; end if;
  return 'Next up: the ' || n || '. It needs a ' || t || ' (Apprentice or better). Hire one, or learn the trade on a city job.';
end $$;
-- a government build contract is finished when every piece it placed is built
create or replace function public.site_progress(site_ text) returns void language plpgsql security definer set search_path = public as $$
declare c contracts;
begin
  select * into c from contracts where site = site_ and kind = 'build' and status = 'open' for update;
  if not found or exists (select 1 from parts where site = site_ and not built) or not exists (select 1 from parts where contract_id = c.id) then return; end if;
  update contracts set status = 'done' where id = c.id;
  if c.job_id is not null then perform w_close_job(c.job_id); end if;
  perform w_moral(c.poster, case when c.padded = 0 then 6 else -4 end);
  insert into news(text) values (c.title || ' is finished' || case when c.padded = 0 then '. Crew paid, work done.' else ', but the crew list had names nobody saw on site.' end);
end $$;
-- a politician awards the drag-and-drop session on government land to a hired crew
create or replace function public.contract_build(site_ text, crew_ int, ghosts int) returns bigint language plpgsql security definer set search_path = public as $$
declare me profiles; m record; cid bigint; jid bigint; skim_ bigint := 4000 * 4 * 2 * ghosts; ttl text;
begin
  if site_role(site_) is distinct from 'owner' or site_ not like 'gov:%' then raise exception 'Only the seat that holds this land awards its works'; end if;
  if crew_ < 1 or crew_ > 6 or ghosts < 0 or ghosts > 6 then raise exception 'Crew of 1 to 6'; end if;
  if exists (select 1 from contracts where site = site_ and kind = 'build' and status = 'open') then raise exception 'This site already has a crew'; end if;
  select * into me from profiles where id = auth.uid(); select * into m from site_meta(site_);
  ttl := 'Works at ' || m.name || ' (' || initcap(me.office) || ' ' || me.username || ')';
  insert into contracts(poster, seat, kind, title, targets, crew, padded, ends_at, site) values (auth.uid(), me.office, 'build', ttl, '{}', crew_, ghosts, now() + interval '2 days', site_) returning id into cid;
  jid := job_post(jsonb_build_object('source', 'seat', 'title', left(ttl, 50), 'skill', 'mason', 'min_level', 0, 'pay', 4000, 'unit', 'hour',
    'start_hour', (floor(city_hour())::int + 1) % 24, 'hours', 4, 'days', 2, 'slots', crew_, 'moral', 'government', 'meta', jsonb_build_object('site', site_)));
  update jobs set meta = meta || jsonb_build_object('contract', cid) where id = jid;
  if skim_ > 0 then
    perform budget_ensure(auth.uid());
    update office_budgets set balance = balance - skim_ where user_id = auth.uid() and balance >= skim_;
    if not found then raise exception 'The budget cannot cover that crew list'; end if;
    perform w_move(auth.uid(), skim_, 'crew allowances'); perform w_moral(auth.uid(), -least(20, 6 * ghosts));
  end if;
  update contracts set job_id = jid, skim = skim_ where id = cid;
  insert into news(text) values (ttl || ' awarded: crew of ' || (crew_ + ghosts) || '.');
  return cid;
end $$;
-- contracts that ran out of time: a padded budget with nothing placed is the worst kind
create or replace function public.contracts_lapse() returns void language plpgsql security definer set search_path = public as $$
declare c contracts;
begin
  for c in select * from contracts where status = 'open' and kind = 'build' and ends_at < now() loop
    update contracts set status = 'lapsed' where id = c.id;
    if c.job_id is not null then perform w_close_job(c.job_id); end if;
    if not exists (select 1 from parts where contract_id = c.id) then
      perform w_moral(c.poster, -10);
      insert into site_state values ('protest:' || c.site, '1', now() + interval '1 day') on conflict (key) do update set val = (coalesce(site_state.val, '0')::int + 1)::text, until = excluded.until;
      insert into news(text) values ('Protest: ' || c.title || ' was paid for, but nothing was built.');
    end if;
  end loop;
end $$;

do $$ declare f text; begin
  foreach f in array array['st_add(text,text,integer)','orders_tick()','order_deliver(bigint,boolean)','ft_make(bigint,bigint,text,text,jsonb,bigint,integer,text,integer,text,jsonb,numeric,text)',
    'ft_depot(bigint,text,boolean)','ft_shop(bigint,text,boolean,boolean)','ft_workshop(bigint,boolean)','ft_yard(bigint,bigint)','ft_build(bigint,text,text)','contract_progress(bigint,text)',
    'w_finish(bigint,real,real,boolean)','site_apply(text,jsonb,uuid)','site_check(jsonb,integer,integer,integer)','site_progress(text)','contracts_lapse()','part_world(text,parts)','site_meta(text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
  end loop;
  foreach f in array array['floor_task_next(bigint,text,text)','floor_task_done(bigint,real,real,text,text)','shift_clockout(bigint,real,real)','floor_gig(text)','order_delivery(text,integer,bigint)',
    'my_orders()','contract_post(text,integer,integer)','contracts_list()','city_fixes()','shelf_take(text,text)','site_role(text)','piece_prices(text)','piece_buy(text,integer,text)',
    'site_commit(text,jsonb)','site_rename(text,text)','name_report(text,text)','site_draft_save(text,jsonb,text,boolean)','site_drafts_for(text)','site_approve(text,uuid,boolean)','contract_build(text,integer,integer)','my_sites()'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
