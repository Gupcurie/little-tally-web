-- Cloud ledgers are scoped by Supabase's verified auth.uid(), never by a
-- user_id supplied by a browser. Direct write grants are intentionally absent.
create schema if not exists tally_private;
revoke all on schema tally_private from public, anon, authenticated;

create table if not exists public.tally_ledgers (
 user_id uuid primary key references auth.users(id) on delete cascade,
 payload jsonb not null,
 revision bigint not null check (revision > 0),
 last_mutation uuid not null,
 updated_at timestamptz not null default now()
);
alter table public.tally_ledgers enable row level security;
revoke all on public.tally_ledgers from public, anon, authenticated;
grant select(user_id,payload,revision,updated_at) on public.tally_ledgers to authenticated;
create policy tally_read_own on public.tally_ledgers for select to authenticated
 using ((select auth.uid()) is not null and user_id=(select auth.uid()));

create table if not exists tally_private.backups (
 user_id uuid not null references auth.users(id) on delete cascade,
 revision bigint not null,
 payload jsonb not null,
 saved_at timestamptz not null,
 primary key(user_id,revision)
);
revoke all on tally_private.backups from public, anon, authenticated;

create or replace function tally_private.validate_snapshot(s jsonb)
returns void language plpgsql set search_path='' as $$
declare k text; b jsonb; i jsonb; r jsonb; ids text[]; names text[];
 t jsonb; item_id text; record_ids text[]; n numeric; part_sum numeric; v jsonb;
begin
 if s is null or jsonb_typeof(s) is distinct from 'object' or s->>'format' is distinct from 'little-tally-pocket'
 or s->>'version' is distinct from '1' or octet_length(s::text)>6291456 then
  raise exception 'TALLY_INVALID: invalid snapshot or larger than 6 MB';
 end if;
 foreach k in array array['sales','stock'] loop
  b:=s->k;
  if b is null or b->>'book' is distinct from k or jsonb_typeof(b->'items') is distinct from 'array'
   or jsonb_typeof(b->'records') is distinct from 'array' then raise exception 'TALLY_INVALID: ledger shape'; end if;
  if jsonb_array_length(b->'items')>200 or jsonb_array_length(b->'records')>200000 then raise exception 'TALLY_INVALID: too many items or records'; end if;
  ids:='{}'; names:='{}'; t:='{}'::jsonb;
  if (select count(distinct(value->>'id')) from jsonb_array_elements(b->'records'))<>jsonb_array_length(b->'records') then raise exception 'TALLY_INVALID: duplicate record IDs'; end if;
  for i in select value from jsonb_array_elements(b->'items') loop
   item_id:=i->>'id';
   if item_id is null or item_id!~'^[a-zA-Z0-9_-]{1,80}$' or item_id=any(ids)
    or jsonb_typeof(i->'name') is distinct from 'string' or char_length(btrim(i->>'name'))=0
    or char_length(i->>'name')>40 or (i->>'name')=any(names)
    or coalesce(i->>'created','')!~'^[0-9]+$' or (i->>'created')::numeric>8640000000000000
    or coalesce(i->>'color','')!~'^-?[0-9]+$' or abs((i->>'color')::numeric)>9007199254740991
    or jsonb_typeof(i->'breakdown') is distinct from 'object' then raise exception 'TALLY_INVALID: item data'; end if;
   ids:=array_append(ids,item_id); names:=array_append(names,i->>'name');
   t:=jsonb_set(t,array[item_id],'0'::jsonb,true);
   if (select count(*) from jsonb_object_keys(i->'breakdown'))>30 then raise exception 'TALLY_INVALID: too many stock parts'; end if;
   if k='sales' and i->'breakdown'<>'{}'::jsonb then raise exception 'TALLY_INVALID: stock parts in sales'; end if;
   for item_id,v in select key,value from jsonb_each(i->'breakdown') loop
    if char_length(item_id)=0 or char_length(item_id)>20 or item_id='未分类'
     or v::text!~'^[0-9]+$' or v::text::numeric>999999999 then raise exception 'TALLY_INVALID: stock part'; end if;
   end loop;
  end loop;
  for r in select value from jsonb_array_elements(b->'records') loop
   item_id:=r->>'itemId';
   if coalesce(r->>'id','')!~'^[a-zA-Z0-9_-]{1,80}$'
    or item_id is null or not(item_id=any(ids)) or coalesce(r->>'delta','')!~'^-?[0-9]+$'
    or abs((r->>'delta')::numeric)>999999999 or coalesce(r->>'at','')!~'^[0-9]+$'
    or (r->>'at')::numeric>8640000000000000 or coalesce(r->>'kind','') not in ('count','set') then
    raise exception 'TALLY_INVALID: record data';
   end if;
   t:=jsonb_set(t,array[item_id],to_jsonb((t->>item_id)::numeric+(r->>'delta')::numeric));
  end loop;
  for i in select value from jsonb_array_elements(b->'items') loop
   n:=(t->>(i->>'id'))::numeric;
   select coalesce(sum(value::text::numeric),0) into part_sum from jsonb_each(i->'breakdown');
   if n<0 or n>999999999 or n<part_sum then raise exception 'TALLY_INVALID: negative total or stock floor'; end if;
  end loop;
  if b->'goal' is not null and b->'goal'<>'null'::jsonb then
   if coalesce(b->'goal'->>'mode','') not in ('parts','percent') or jsonb_typeof(b->'goal'->'values') is distinct from 'object'
    or b->'goal'->'values'='{}'::jsonb then raise exception 'TALLY_INVALID: goal shape'; end if;
   for item_id,v in select key,value from jsonb_each(b->'goal'->'values') loop
    if not(item_id=any(ids)) then raise exception 'TALLY_INVALID: goal item'; end if;
   end loop;
  end if;
 end loop;
end;
$$;
revoke all on function tally_private.validate_snapshot(jsonb) from public,anon,authenticated;

create or replace function public.tally_save(p_expected_revision bigint,p_snapshot jsonb,p_mutation uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); old public.tally_ledgers%rowtype; next_revision bigint; saved timestamptz:=clock_timestamp();
begin
 if u is null then raise exception 'TALLY_UNAUTHENTICATED' using errcode='28000'; end if;
 if p_expected_revision is null or p_expected_revision<0 or p_mutation is null then raise exception 'TALLY_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select * into old from public.tally_ledgers where user_id=u for update;
 if found then
  if old.last_mutation=p_mutation then return jsonb_build_object('revision',old.revision,'updated_at',old.updated_at,'replayed',true); end if;
  if old.revision<>p_expected_revision then raise exception 'TALLY_CONFLICT'; end if;
  next_revision:=old.revision+1;
 else
  if p_expected_revision<>0 then raise exception 'TALLY_CONFLICT'; end if;
  next_revision:=1;
 end if;
 perform tally_private.validate_snapshot(p_snapshot);
 p_snapshot:=jsonb_set(p_snapshot,'{revision}',to_jsonb(next_revision),true);
 if old.user_id is not null then
  insert into tally_private.backups(user_id,revision,payload,saved_at) values(u,old.revision,old.payload,old.updated_at) on conflict do nothing;
 end if;
 insert into public.tally_ledgers(user_id,payload,revision,last_mutation,updated_at) values(u,p_snapshot,next_revision,p_mutation,saved)
 on conflict(user_id) do update set payload=excluded.payload,revision=excluded.revision,last_mutation=excluded.last_mutation,updated_at=excluded.updated_at;
 delete from tally_private.backups where user_id=u and revision not in
  (select revision from tally_private.backups where user_id=u order by revision desc limit 5);
 return jsonb_build_object('revision',next_revision,'updated_at',saved,'replayed',false);
end;
$$;
revoke all on function public.tally_save(bigint,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.tally_save(bigint,jsonb,uuid) to authenticated;

create or replace function public.tally_backup_list()
returns table(revision bigint,saved_at timestamptz) language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'TALLY_UNAUTHENTICATED' using errcode='28000'; end if;
 return query select b.revision,b.saved_at from tally_private.backups b where b.user_id=auth.uid() order by b.revision desc;
end;
$$;
revoke all on function public.tally_backup_list() from public,anon,authenticated;
grant execute on function public.tally_backup_list() to authenticated;

create or replace function public.tally_backup_get(p_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p jsonb;
begin
 if auth.uid() is null then raise exception 'TALLY_UNAUTHENTICATED' using errcode='28000'; end if;
 select payload into p from tally_private.backups where user_id=auth.uid() and revision=p_revision;
 return p;
end;
$$;
revoke all on function public.tally_backup_get(bigint) from public,anon,authenticated;
grant execute on function public.tally_backup_get(bigint) to authenticated;
