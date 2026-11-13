-- Daily public work rooms. Membership and role are database state, never client claims.
create table tally_private.daily_rooms(
 room_day date not null,kind text not null check(kind in ('angel','devil')),
 team_id uuid not null unique references tally_private.teams(id),primary key(room_day,kind)
);
create table tally_private.daily_memberships(
 team_id uuid not null,user_id uuid not null,job text not null check(job in ('dismantle','place')),
 stock_enabled boolean not null default false,
 primary key(team_id,user_id),foreign key(team_id,user_id) references tally_private.team_members(team_id,user_id) on delete cascade
);
alter table tally_private.daily_rooms enable row level security;
alter table tally_private.daily_memberships enable row level security;
revoke all on tally_private.daily_rooms,tally_private.daily_memberships from public,anon,authenticated;
create table tally_private.daily_mutations(team_id uuid references tally_private.teams(id),mutation uuid,user_id uuid references auth.users(id),job text,at timestamptz not null default now(),primary key(team_id,mutation));
alter table tally_private.daily_mutations enable row level security;
revoke all on tally_private.daily_mutations from public,anon,authenticated;

create function tally_private.daily_projection(t uuid,s jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare m tally_private.daily_memberships%rowtype;r tally_private.daily_rooms%rowtype;out jsonb;
 empty_sales jsonb:='{"book":"sales","items":[],"records":[],"goal":null}';
 empty_stock jsonb:='{"book":"stock","items":[],"records":[],"goal":null}';
 empty_egg jsonb:='{"book":"egg","items":[],"records":[],"goal":null}';
begin
 select * into r from tally_private.daily_rooms where team_id=t;
 if r.team_id is null then return s-'_dailyRoom';end if;
 if not tally_private.team_allowed(t) then raise exception 'TALLY_TEAM_DENIED';end if;
 select * into m from tally_private.daily_memberships where team_id=t and user_id=auth.uid();
 if m.user_id is null then raise exception 'TALLY_TEAM_DENIED';end if;
 out:=jsonb_build_object('format','little-tally-pocket','version',1,'revision',s->'revision',
 'periodStartedAt',s->'periodStartedAt',
 'sales',case when m.job='dismantle' then s->'sales' else empty_sales end,
 'stock',case when m.job='dismantle' then s->'stock' when m.stock_enabled then coalesce(s->'placementStock',empty_stock) else empty_stock end,
 'egg',case when m.job='place' then s->'egg' else empty_egg end,
 '_dailyRoom',jsonb_build_object('kind',r.kind,'day',r.room_day,'role',m.job,'stockEnabled',m.stock_enabled,'editRevision',coalesce(s#>array['_dailyRevisions',m.job],'0'),
 'aliasHash',encode(sha256(convert_to(coalesce(s#>'{reconciliation,aliases}','[]')::text,'UTF8')),'hex')));
 if m.job='dismantle' and s?'salesStockBinding' then out:=out||jsonb_build_object('salesStockBinding',s->'salesStockBinding');end if;
 if s?'reconciliation' then out:=out||jsonb_build_object('reconciliation',s->'reconciliation');end if;
 return out;
end$$;
revoke all on function tally_private.daily_projection(uuid,jsonb) from public,anon,authenticated;

create function tally_private.daily_empty(s jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare out jsonb;k text;begin
 out:=jsonb_build_object('format','little-tally-pocket','version',1,'revision',1,
 'sales',s->'sales','stock',s->'stock','egg',coalesce(s->'egg','{"book":"egg","items":[],"records":[],"goal":null}'));
 if s?'placementStock' then out:=out||jsonb_build_object('placementStock',s->'placementStock');end if;
 foreach k in array array['sales','stock','egg','placementStock'] loop
  if out?k then out:=jsonb_set(out,array[k,'records'],'[]');out:=jsonb_set(out,array[k,'goal'],'null');end if;
 end loop;
 out:=out-'reconciliation'-'salesStockBinding'-'_dailyRoom';
 out:=jsonb_set(out,'{egg}',(out->'egg')-'recommendation');
 -- All inventory subcategory quantities are zero in a new daily room.
 foreach k in array array['stock','placementStock'] loop
  if out?k then out:=jsonb_set(out,array[k,'items'],(select coalesce(jsonb_agg(jsonb_set(i,'{breakdown}','{}')),'[]') from jsonb_array_elements(out->k->'items')i));end if;
 end loop;
 return out;
end$$;
revoke all on function tally_private.daily_empty(jsonb) from public,anon,authenticated;

create function public.tally_daily_join(p_kind text,p_job text,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();d date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;t uuid;s jsonb;old_job text;
 v_ip text:=btrim(split_part(coalesce(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-forwarded-for','server'),',',1));begin
 if u is null then raise exception 'TALLY_UNAUTHENTICATED';end if;
 if p_kind not in ('angel','devil') or p_job not in ('dismantle','place') or p_kind is null or p_job is null then raise exception 'TALLY_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('daily-room-'||d::text||p_kind,0));
 select team_id into t from tally_private.daily_rooms where room_day=d and kind=p_kind;
 if t is null then
  select l.payload into s from tally_private.daily_rooms r join tally_private.team_ledgers l on l.team_id=r.team_id where r.kind=p_kind order by r.room_day desc limit 1;
  if s is null then s:=p_snapshot;end if;
  perform tally_private.validate_snapshot(s);
  s:=tally_private.daily_empty(s);
  if not s?'placementStock' then s:=s||jsonb_build_object('placementStock',s->'stock');end if;
  s:=jsonb_set(s,'{revision}','1');s:=jsonb_set(s,'{periodStartedAt}',to_jsonb(floor(extract(epoch from clock_timestamp())*1000)));
  insert into tally_private.teams(name,owner_id) values(d::text||' '||case when p_kind='angel' then '天使大群' else '恶魔大群' end,u) returning id into t;
  insert into tally_private.team_ledgers values(t,s,1,gen_random_uuid(),clock_timestamp());
  insert into tally_private.daily_rooms values(d,p_kind,t);
 end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text,0));
 if exists(select 1 from tally_private.team_exclusions where team_id=t and user_id=u) then raise exception 'TALLY_DAILY_REMOVED';end if;
 insert into tally_private.team_members values(t,u,now()) on conflict do nothing;
 select job into old_job from tally_private.daily_memberships where team_id=t and user_id=u;
 insert into tally_private.daily_memberships(team_id,user_id,job) values(t,u,p_job) on conflict(team_id,user_id) do update set job=excluded.job,stock_enabled=case when daily_memberships.job=excluded.job then daily_memberships.stock_enabled else false end;
 if old_job is distinct from p_job then insert into tally_private.security_events(ip,kind,detail) values(left(v_ip,80),'岗位切换','账号 '||u::text||' 加入/切换 '||p_kind||' '||p_job);end if;
 return (select jsonb_build_object('id',g.id,'name',g.name,'daily_kind',p_kind,'day',d,'role',p_job) from tally_private.teams g where g.id=t);
end$$;

create or replace function public.tally_teams() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'daily_kind',r.kind,'day',r.room_day,'role',j.job) order by m.joined_at desc),'[]')
 from tally_private.teams t join tally_private.team_members m on m.team_id=t.id
 left join tally_private.daily_rooms r on r.team_id=t.id left join tally_private.daily_memberships j on j.team_id=t.id and j.user_id=m.user_id
 where m.user_id=auth.uid() and t.dissolved_at is null
$$;

-- Move old implementations out of the exposed API before adding guarded wrappers.
alter function public.tally_team_read(uuid) set schema tally_private;
alter function tally_private.tally_team_read(uuid) rename to legacy_team_read;
alter function public.tally_team_save(uuid,bigint,jsonb,uuid) set schema tally_private;
alter function tally_private.tally_team_save(uuid,bigint,jsonb,uuid) rename to legacy_team_save;
alter function public.tally_team_previous(uuid) set schema tally_private;
alter function tally_private.tally_team_previous(uuid) rename to legacy_team_previous;
alter function public.tally_period_close(uuid,bigint,jsonb,uuid) set schema tally_private;
alter function tally_private.tally_period_close(uuid,bigint,jsonb,uuid) rename to legacy_period_close;
alter function public.tally_period_read(uuid) set schema tally_private;
alter function tally_private.tally_period_read(uuid) rename to legacy_period_read;
alter function public.tally_team_dissolve(uuid) set schema tally_private;
alter function tally_private.tally_team_dissolve(uuid) rename to legacy_team_dissolve;
revoke all on function tally_private.legacy_team_read(uuid),tally_private.legacy_team_save(uuid,bigint,jsonb,uuid),tally_private.legacy_team_previous(uuid),tally_private.legacy_period_close(uuid,bigint,jsonb,uuid),tally_private.legacy_period_read(uuid),tally_private.legacy_team_dissolve(uuid) from public,anon,authenticated,service_role;

create function public.tally_team_read(p_team_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare row jsonb;begin row:=tally_private.legacy_team_read(p_team_id);return jsonb_set(row,'{payload}',tally_private.daily_projection(p_team_id,row->'payload'));end$$;
create function public.tally_team_save(p_team_id uuid,p_expected_revision bigint,p_snapshot jsonb,p_mutation uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r tally_private.daily_rooms%rowtype;m tally_private.daily_memberships%rowtype;old jsonb;out jsonb;view jsonb;ack jsonb;rev bigint;own_rev bigint;new_alias jsonb;alias_hash text;begin
 select * into r from tally_private.daily_rooms where team_id=p_team_id;
 if r.team_id is null then return tally_private.legacy_team_save(p_team_id,p_expected_revision,p_snapshot,p_mutation);end if;
 if not tally_private.team_allowed(p_team_id) then raise exception 'TALLY_TEAM_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_team_id::text,0));
 if not tally_private.team_allowed(p_team_id) then raise exception 'TALLY_TEAM_DENIED';end if;
 select * into m from tally_private.daily_memberships where team_id=p_team_id and user_id=auth.uid();
 if m.user_id is null or r.room_day<>(clock_timestamp() at time zone 'Asia/Shanghai')::date then raise exception 'TALLY_DAILY_READONLY';end if;
 if p_snapshot#>>'{_dailyRoom,role}' is distinct from m.job then raise exception 'TALLY_DAILY_ROLE_CHANGED';end if;
 if p_mutation is null then raise exception 'TALLY_INVALID';end if;
 select payload,revision into old,rev from tally_private.team_ledgers where team_id=p_team_id for update;
 if exists(select 1 from tally_private.daily_mutations where team_id=p_team_id and mutation=p_mutation and user_id=auth.uid() and job=m.job) then
  return jsonb_build_object('revision',rev,'updated_at',clock_timestamp(),'replayed',true,'payload',tally_private.daily_projection(p_team_id,old));
 end if;
 own_rev:=coalesce((old#>>array['_dailyRevisions',m.job])::bigint,0);
 if (p_snapshot#>>'{_dailyRoom,editRevision}')::bigint is distinct from own_rev then raise exception 'TALLY_CONFLICT';end if;
 view:=tally_private.daily_projection(p_team_id,old);
 perform tally_private.validate_snapshot(p_snapshot);
 if p_snapshot->'periodStartedAt' is distinct from view->'periodStartedAt' then raise exception 'TALLY_DAILY_FORBIDDEN';end if;
 if m.job='dismantle' then
  if p_snapshot->'egg' is distinct from view->'egg' then raise exception 'TALLY_DAILY_FORBIDDEN';end if;
  out:=old||jsonb_build_object('sales',p_snapshot->'sales','stock',p_snapshot->'stock');
  if p_snapshot?'salesStockBinding' then out:=out||jsonb_build_object('salesStockBinding',p_snapshot->'salesStockBinding');else out:=out-'salesStockBinding';end if;
 else
  if p_snapshot->'sales' is distinct from view->'sales' or p_snapshot?'salesStockBinding' then raise exception 'TALLY_DAILY_FORBIDDEN';end if;
  if not m.stock_enabled and p_snapshot->'stock' is distinct from view->'stock' then raise exception 'TALLY_DAILY_FORBIDDEN';end if;
  out:=old||jsonb_build_object('egg',p_snapshot->'egg');
  if m.stock_enabled then out:=out||jsonb_build_object('placementStock',p_snapshot->'stock');end if;
 end if;
 new_alias:=coalesce(p_snapshot#>'{reconciliation,aliases}','[]');
 alias_hash:=encode(sha256(convert_to(new_alias::text,'UTF8')),'hex');
 if alias_hash is distinct from p_snapshot#>>'{_dailyRoom,aliasHash}' then
  if p_snapshot#>>'{_dailyRoom,aliasHash}' is distinct from view#>>'{_dailyRoom,aliasHash}' then raise exception 'TALLY_CONFLICT';end if;
  if jsonb_typeof(new_alias)<>'array' then raise exception 'TALLY_INVALID';end if;
  if not out?'reconciliation' then out:=out||jsonb_build_object('reconciliation',p_snapshot->'reconciliation');end if;
  out:=jsonb_set(out,'{reconciliation,aliases}',new_alias);
 end if;
 if not out?'_dailyRevisions' then out:=out||'{"_dailyRevisions":{}}'::jsonb;end if;
 out:=jsonb_set(out,array['_dailyRevisions',m.job],to_jsonb(own_rev+1));
 ack:=tally_private.legacy_team_save(p_team_id,rev,out,p_mutation);
 insert into tally_private.daily_mutations(team_id,mutation,user_id,job) values(p_team_id,p_mutation,auth.uid(),m.job);
 delete from tally_private.daily_mutations where team_id=p_team_id and mutation not in(select mutation from tally_private.daily_mutations where team_id=p_team_id order by at desc limit 500);
 select payload into out from tally_private.team_ledgers where team_id=p_team_id;
 return ack||jsonb_build_object('payload',tally_private.daily_projection(p_team_id,out));
end$$;
create function public.tally_team_previous(p_team_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare row jsonb;begin row:=tally_private.legacy_team_previous(p_team_id);if row is null then return null;end if;return jsonb_set(row,'{payload}',tally_private.daily_projection(p_team_id,row->'payload'));end$$;
create function public.tally_period_close(p_team_id uuid,p_expected_revision bigint,p_snapshot jsonb,p_mutation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin if exists(select 1 from tally_private.daily_rooms where team_id=p_team_id) then raise exception 'TALLY_DAILY_FORBIDDEN';end if;return tally_private.legacy_period_close(p_team_id,p_expected_revision,p_snapshot,p_mutation);end$$;
create function public.tally_period_read(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s jsonb;t uuid;begin s:=tally_private.legacy_period_read(p_id);select team_id into t from tally_private.periods where id=p_id;return tally_private.daily_projection(t,s);end$$;
create function public.tally_team_dissolve(p_team_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin if exists(select 1 from tally_private.daily_rooms where team_id=p_team_id) then raise exception 'TALLY_DAILY_FORBIDDEN';end if;return tally_private.legacy_team_dissolve(p_team_id);end$$;

create function public.tally_daily_stock_enabled(p_team_id uuid,p_enabled boolean) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not tally_private.team_allowed(p_team_id) then raise exception 'TALLY_TEAM_DENIED';end if;
 if p_enabled is null then raise exception 'TALLY_INVALID';end if;
 update tally_private.daily_memberships set stock_enabled=p_enabled where team_id=p_team_id and user_id=auth.uid() and job='place';
 if not found then raise exception 'TALLY_DAILY_FORBIDDEN';end if;
 return jsonb_build_object('ok',true);
end$$;

create function public.tally_daily_comparison(p_team_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s jsonb;start_ms numeric:=extract(epoch from (date_trunc('day',now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'))*1000;end_ms numeric:=extract(epoch from now())*1000;begin
 if not tally_private.team_allowed(p_team_id) or not exists(select 1 from tally_private.daily_memberships where team_id=p_team_id and user_id=auth.uid()) then raise exception 'TALLY_TEAM_DENIED';end if;
 select payload into s from tally_private.team_ledgers where team_id=p_team_id;
 return jsonb_build_object('revision',s->'revision','aliases',coalesce(s#>'{reconciliation,aliases}','[]'),
  'egg',jsonb_build_object('items',s#>'{egg,items}','records',(select coalesce(jsonb_agg(r),'[]') from jsonb_array_elements(coalesce(s#>'{egg,records}','[]'))r where (r->>'at')::numeric between start_ms and end_ms)),
  'sales',jsonb_build_object('items',s#>'{sales,items}','records',(select coalesce(jsonb_agg(r),'[]') from jsonb_array_elements(coalesce(s#>'{sales,records}','[]'))r where (r->>'at')::numeric between start_ms and end_ms)));
end$$;

create or replace function public.tally_team_details(p_team_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not tally_private.team_allowed(p_team_id) then raise exception 'TALLY_TEAM_DENIED';end if;
 return (select jsonb_build_object('id',t.id,'name',t.name,'owner_id',t.owner_id,'daily_kind',r.kind,'day',r.room_day,
 'can_kick',r.team_id is not null or t.owner_id=auth.uid(),
 'members',(select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'name',coalesce(u.raw_app_meta_data->>'tally_username','成员'),'role',j.job,'joined_at',m.joined_at) order by m.joined_at),'[]') from tally_private.team_members m join auth.users u on u.id=m.user_id left join tally_private.daily_memberships j on j.team_id=m.team_id and j.user_id=m.user_id where m.team_id=t.id))
 from tally_private.teams t left join tally_private.daily_rooms r on r.team_id=t.id where t.id=p_team_id);
end$$;
create or replace function public.tally_team_kick(p_team_id uuid,p_user_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();daily boolean;v_ip text:=btrim(split_part(coalesce(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-forwarded-for','server'),',',1));begin
 if u is null then raise exception 'TALLY_UNAUTHENTICATED';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_team_id::text,0));
 select exists(select 1 from tally_private.daily_rooms where team_id=p_team_id) into daily;
 if not tally_private.team_allowed(p_team_id) or (not daily and not exists(select 1 from tally_private.teams where id=p_team_id and owner_id=u)) then raise exception 'TALLY_TEAM_DENIED';end if;
 if p_user_id is null or p_user_id=u then raise exception 'TALLY_INVALID';end if;
 if not exists(select 1 from tally_private.team_members where team_id=p_team_id and user_id=p_user_id) then raise exception 'TALLY_INVALID';end if;
 if not daily then insert into tally_private.team_exclusions(team_id,user_id) values(p_team_id,p_user_id) on conflict do nothing;end if;
 delete from tally_private.team_members where team_id=p_team_id and user_id=p_user_id;
 insert into tally_private.security_events(ip,kind,detail) values(left(v_ip,80),'移出群成员','账号 '||u::text||' 从群 '||p_team_id::text||' 移出 '||p_user_id::text);
 return jsonb_build_object('ok',true);
end$$;

do $$declare f regprocedure;begin for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('tally_daily_join','tally_daily_stock_enabled','tally_daily_comparison','tally_team_read','tally_team_save','tally_team_previous','tally_period_close','tally_period_read','tally_team_dissolve','tally_team_details','tally_team_kick','tally_teams') loop
 execute format('revoke all on function %s from public,anon',f);execute format('grant execute on function %s to authenticated',f);
end loop;end$$;
notify pgrst,'reload schema';
