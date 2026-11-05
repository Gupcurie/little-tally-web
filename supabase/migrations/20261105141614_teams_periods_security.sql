-- Private shared ledgers: all browser access passes authenticated membership RPCs.
create table tally_private.teams(id uuid primary key default gen_random_uuid(),name text not null check(length(name) between 1 and 40),owner_id uuid not null references auth.users(id),created_at timestamptz not null default now());
create table tally_private.team_members(team_id uuid references tally_private.teams(id),user_id uuid references auth.users(id),joined_at timestamptz not null default now(),primary key(team_id,user_id));
create index on tally_private.team_members(user_id);
create table tally_private.team_codes(team_id uuid references tally_private.teams(id),code_day date not null,code_hash bytea not null,expires_at timestamptz not null,unique(code_day,code_hash));
create table tally_private.team_ledgers(team_id uuid primary key references tally_private.teams(id),payload jsonb not null,revision bigint not null,last_mutation uuid not null,updated_at timestamptz not null default now());
create table tally_private.team_backups(team_id uuid references tally_private.teams(id),revision bigint,payload jsonb,saved_at timestamptz,primary key(team_id,revision));
create table tally_private.join_attempts(user_id uuid,ip text,at timestamptz not null default now());
create index on tally_private.join_attempts(at);
create table tally_private.security_events(id bigint generated always as identity primary key,at timestamptz not null default now(),ip text not null,kind text not null,detail text not null default '');
create table tally_private.periods(id uuid primary key,owner_id uuid not null references auth.users(id),team_id uuid references tally_private.teams(id),started_at timestamptz not null,ended_at timestamptz not null default now(),payload jsonb not null,summary jsonb not null);
create index on tally_private.periods(owner_id,ended_at);create index on tally_private.periods(team_id,ended_at);
do $$declare t text;begin foreach t in array array['teams','team_members','team_codes','team_ledgers','team_backups','join_attempts','security_events','periods'] loop execute format('alter table tally_private.%I enable row level security',t);execute format('revoke all on tally_private.%I from public,anon,authenticated',t);end loop;end$$;

create function tally_private.team_allowed(t uuid) returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null and exists(select 1 from tally_private.team_members where team_id=t and user_id=auth.uid())$$;
revoke all on function tally_private.team_allowed(uuid) from public,anon,authenticated;
create function public.tally_teams() returns jsonb language sql stable security definer set search_path='' as $$select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by m.joined_at desc),'[]'::jsonb) from tally_private.teams t join tally_private.team_members m on m.team_id=t.id where m.user_id=auth.uid()$$;
create function public.tally_team_create(p_name text,p_code text,p_snapshot jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); t uuid; d date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date; exp timestamptz;begin
 if u is null then raise exception 'TALLY_UNAUTHENTICATED';end if;
 if p_name is null or length(btrim(p_name)) not between 1 and 40 or p_code is null or p_code!~'^[0-9]{4}$' then raise exception 'TALLY_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('team-create-'||u::text,0));
 if (select count(*) from tally_private.teams where owner_id=u and created_at>=now()-interval '1 day')>=10 then raise exception 'TALLY_TEAM_RATE';end if;
 exp:=((d::timestamp+interval '23 hours 59 minutes') at time zone 'Asia/Shanghai');if clock_timestamp()>=exp then raise exception 'TALLY_TEAM_CODE_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('code-'||d||p_code,0));
 if exists(select 1 from tally_private.team_codes where code_day=d and code_hash=sha256(convert_to(d::text||p_code,'UTF8'))) then raise exception 'TALLY_TEAM_CODE_TAKEN';end if;
 perform tally_private.validate_snapshot(p_snapshot);
 insert into tally_private.teams(name,owner_id) values(btrim(p_name),u) returning id into t;
 insert into tally_private.team_members values(t,u,now());
 insert into tally_private.team_codes values(t,d,sha256(convert_to(d::text||p_code,'UTF8')),exp);
 insert into tally_private.team_ledgers values(t,jsonb_set(p_snapshot,'{revision}','1'),1,gen_random_uuid(),now());
 return jsonb_build_object('id',t,'name',btrim(p_name));end$$;
create function public.tally_team_join(p_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();t uuid;v_ip text:=btrim(split_part(coalesce(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-forwarded-for','unknown'),',',1));begin
 if u is null then raise exception 'TALLY_UNAUTHENTICATED';end if;
 perform pg_advisory_xact_lock(hashtextextended('join-ip-'||v_ip,0));
 if (select count(*) from tally_private.join_attempts where at>now()-interval '10 minutes' and (user_id=u or join_attempts.ip=v_ip))>=10 then return jsonb_build_object('error','TALLY_TEAM_RATE');end if;
 insert into tally_private.join_attempts values(u,left(v_ip,80),now());
 delete from tally_private.join_attempts where at<now()-interval '1 day';
 select team_id into t from tally_private.team_codes where code_day=(clock_timestamp() at time zone 'Asia/Shanghai')::date and code_hash=sha256(convert_to((clock_timestamp() at time zone 'Asia/Shanghai')::date::text||coalesce(p_code,''),'UTF8')) and expires_at>clock_timestamp() and p_code~'^[0-9]{4}$';
 if t is null then insert into tally_private.security_events(ip,kind,detail) values(left(v_ip,80),'team_code_failed','入群码无效或过期');return jsonb_build_object('error','TALLY_TEAM_CODE_INVALID');end if;
 insert into tally_private.team_members values(t,u,now()) on conflict do nothing;
 return (select jsonb_build_object('id',id,'name',name) from tally_private.teams where id=t);end$$;
create function public.tally_team_read(p_team_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if not tally_private.team_allowed(p_team_id) then raise exception 'TALLY_TEAM_DENIED';end if;
 return (select jsonb_build_object('payload',payload,'revision',revision,'updated_at',updated_at) from tally_private.team_ledgers where team_id=p_team_id);end$$;
create function public.tally_team_save(p_team_id uuid,p_expected_revision bigint,p_snapshot jsonb,p_mutation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare old tally_private.team_ledgers%rowtype; n bigint;stamp timestamptz:=clock_timestamp();begin
 if not tally_private.team_allowed(p_team_id) then raise exception 'TALLY_TEAM_DENIED';end if;
 if p_mutation is null then raise exception 'TALLY_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_team_id::text,0));select * into old from tally_private.team_ledgers where team_id=p_team_id for update;
 if old.last_mutation=p_mutation then return jsonb_build_object('revision',old.revision,'updated_at',old.updated_at,'replayed',true);end if;
 if p_expected_revision is distinct from old.revision then raise exception 'TALLY_CONFLICT';end if;
 perform tally_private.validate_snapshot(p_snapshot);n:=old.revision+1;
 insert into tally_private.team_backups values(p_team_id,old.revision,old.payload,old.updated_at) on conflict do nothing;
 update tally_private.team_ledgers set payload=jsonb_set(p_snapshot,'{revision}',to_jsonb(n)),revision=n,last_mutation=p_mutation,updated_at=stamp where team_id=p_team_id;
 delete from tally_private.team_backups where team_id=p_team_id and revision not in(select revision from tally_private.team_backups where team_id=p_team_id order by revision desc limit 5);
 return jsonb_build_object('revision',n,'updated_at',stamp,'replayed',false);end$$;
create function tally_private.period_summary(s jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare k text;b jsonb;i jsonb;items jsonb;n numeric;total numeric;out jsonb:='{}';begin
 foreach k in array array['sales','stock','egg'] loop b:=s->k;items:='[]';total:=0;
 for i in select value from jsonb_array_elements(coalesce(b->'items','[]')) loop
 select coalesce(sum((value->>'delta')::numeric),0) into n from jsonb_array_elements(coalesce(b->'records','[]')) where value->>'itemId'=i->>'id';
 items:=items||jsonb_build_array(jsonb_build_object('name',i->>'name','ratio',i->'ratio','quantity',n,'breakdown',case when k='stock' then i->'breakdown' else '{}'::jsonb end));total:=total+n;
 end loop;out:=out||jsonb_build_object(k,jsonb_build_object('items',items,'total',total));end loop;return out;end$$;
revoke all on function tally_private.period_summary(jsonb) from public,anon,authenticated;
create function public.tally_periods(p_team_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null then raise exception 'TALLY_UNAUTHENTICATED';end if;
 if p_team_id is not null and not tally_private.team_allowed(p_team_id) then raise exception 'TALLY_TEAM_DENIED';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'startedAt',floor(extract(epoch from started_at)*1000),'endedAt',floor(extract(epoch from ended_at)*1000),'summary',summary) order by ended_at desc),'[]') from tally_private.periods where case when p_team_id is null then team_id is null and owner_id=auth.uid() else team_id=p_team_id end);end$$;
create function public.tally_period_close(p_team_id uuid,p_expected_revision bigint,p_snapshot jsonb,p_mutation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare old jsonb;rev bigint;start timestamptz;ack jsonb;begin
 if auth.uid() is null then raise exception 'TALLY_UNAUTHENTICATED';end if;
 if p_mutation is null then raise exception 'TALLY_INVALID';end if;
 if p_team_id is not null and not tally_private.team_allowed(p_team_id) then raise exception 'TALLY_TEAM_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended('close-'||coalesce(p_team_id,auth.uid())::text,0));
 if exists(select 1 from tally_private.periods where id=p_mutation) then
  if not exists(select 1 from tally_private.periods where id=p_mutation and owner_id=auth.uid() and team_id is not distinct from p_team_id) then raise exception 'TALLY_CONFLICT';end if;
  if p_team_id is null then return (select jsonb_build_object('revision',revision,'updated_at',updated_at,'replayed',true) from public.tally_ledgers where user_id=auth.uid());
  else return (select jsonb_build_object('revision',revision,'updated_at',updated_at,'replayed',true) from tally_private.team_ledgers where team_id=p_team_id);end if;
 end if;
 if p_team_id is null then select payload,revision into old,rev from public.tally_ledgers where user_id=auth.uid() for update;
 else select payload,revision into old,rev from tally_private.team_ledgers where team_id=p_team_id for update;end if;
 if coalesce(rev,0) is distinct from p_expected_revision then raise exception 'TALLY_CONFLICT';end if;
 if old is not null then
 start:=coalesce(to_timestamp((old->>'periodStartedAt')::numeric/1000), (select min(to_timestamp((r->>'at')::numeric/1000)) from (select value r from jsonb_array_elements(coalesce(old#>'{sales,records}','[]')) union all select value from jsonb_array_elements(coalesce(old#>'{stock,records}','[]')) union all select value from jsonb_array_elements(coalesce(old#>'{egg,records}','[]')))x),now());
 insert into tally_private.periods values(p_mutation,auth.uid(),p_team_id,start,clock_timestamp(),old,tally_private.period_summary(old));end if;
 if p_team_id is null then ack:=public.tally_save(p_expected_revision,p_snapshot,p_mutation);else ack:=public.tally_team_save(p_team_id,p_expected_revision,p_snapshot,p_mutation);end if;return ack;end$$;
-- No table reads or writes are granted to clients, only explicit checked RPCs.
do $$declare f regprocedure;begin for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.proname in ('tally_teams','tally_team_create','tally_team_join','tally_team_read','tally_team_save','tally_periods','tally_period_close') loop execute format('revoke all on function %s from public,anon',f);execute format('grant execute on function %s to authenticated',f);end loop;end$$;
notify pgrst,'reload schema';

create function public.tally_admin_teams() returns jsonb language sql stable security definer set search_path='' as $$select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'created_at',t.created_at,'payload',l.payload,'revision',l.revision,'updated_at',l.updated_at,'members',(select count(*) from tally_private.team_members m where m.team_id=t.id))),'[]') from tally_private.teams t join tally_private.team_ledgers l on l.team_id=t.id$$;
create function public.tally_admin_security() returns jsonb language sql stable security definer set search_path='' as $$select coalesce(jsonb_agg(to_jsonb(e)),'[]') from (select at,ip,kind,detail from tally_private.security_events order by at desc limit 200)e$$;
revoke all on function public.tally_admin_teams() from public,anon,authenticated;
revoke all on function public.tally_admin_security() from public,anon,authenticated;
grant execute on function public.tally_admin_teams() to service_role;
grant execute on function public.tally_admin_security() to service_role;
notify pgrst,'reload schema';

create function public.tally_team_previous(p_team_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if not tally_private.team_allowed(p_team_id) then raise exception 'TALLY_TEAM_DENIED';end if;
 return (select jsonb_build_object('payload',payload,'revision',revision,'saved_at',saved_at) from tally_private.team_backups where team_id=p_team_id order by revision desc limit 1);end$$;
revoke all on function public.tally_team_previous(uuid) from public,anon;
grant execute on function public.tally_team_previous(uuid) to authenticated;
notify pgrst,'reload schema';

create function public.tally_period_read(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$declare r tally_private.periods%rowtype;begin
 select * into r from tally_private.periods where id=p_id;
 if auth.uid() is null or r.id is null or not(case when r.team_id is null then r.owner_id=auth.uid() else tally_private.team_allowed(r.team_id) end) then raise exception 'TALLY_TEAM_DENIED';end if;
 return r.payload;end$$;
revoke all on function public.tally_period_read(uuid) from public,anon;
grant execute on function public.tally_period_read(uuid) to authenticated;
notify pgrst,'reload schema';

-- Sensitive successful edits are logged too, not just failed HTTP requests.
create or replace function tally_private.audit_ledger_reduction() returns trigger language plpgsql security definer set search_path='' as $$
declare bk text;removed boolean:=false;ip text:=btrim(split_part(coalesce(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-forwarded-for','server'),',',1));begin
 foreach bk in array array['sales','stock','egg'] loop
  if jsonb_array_length(coalesce(new.payload->bk->'records','[]'))<jsonb_array_length(coalesce(old.payload->bk->'records','[]')) or jsonb_array_length(coalesce(new.payload->bk->'items','[]'))<jsonb_array_length(coalesce(old.payload->bk->'items','[]')) then removed:=true;end if;
 end loop;
 if removed then insert into tally_private.security_events(ip,kind,detail) values(left(ip,80),'敏感数据变更','账本条目减少（可能为正常删除、恢复或结算）；操作账号 '||coalesce(auth.uid()::text,'服务器')||'；'||tg_table_name);end if;
 return new;end$$;
revoke all on function tally_private.audit_ledger_reduction() from public,anon,authenticated;
drop trigger if exists tally_sensitive_audit on public.tally_ledgers;
create trigger tally_sensitive_audit after update on public.tally_ledgers for each row execute function tally_private.audit_ledger_reduction();
drop trigger if exists tally_sensitive_audit on tally_private.team_ledgers;
create trigger tally_sensitive_audit after update on tally_private.team_ledgers for each row execute function tally_private.audit_ledger_reduction();
