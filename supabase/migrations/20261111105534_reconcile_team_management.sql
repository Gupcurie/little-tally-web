-- Group membership management. Dissolution retains ledger/history for administrator review.
alter table tally_private.teams add column dissolved_at timestamptz;
create table tally_private.team_exclusions (
 team_id uuid references tally_private.teams(id),
 user_id uuid references auth.users(id),
 removed_at timestamptz not null default now(),
 primary key (team_id,user_id)
);
alter table tally_private.team_exclusions enable row level security;
revoke all on tally_private.team_exclusions from public,anon,authenticated;

create or replace function tally_private.team_allowed(t uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists (
  select 1 from tally_private.team_members m
  join tally_private.teams g on g.id=m.team_id
  where m.team_id=t and m.user_id=auth.uid() and g.dissolved_at is null
 );
$$;

create function public.tally_team_details(p_team_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not tally_private.team_allowed(p_team_id) then raise exception 'TALLY_TEAM_DENIED'; end if;
 return (
  select jsonb_build_object('id',t.id,'name',t.name,'owner_id',t.owner_id,
   'members',(select jsonb_agg(jsonb_build_object(
    'user_id',m.user_id,'name',coalesce(u.raw_app_meta_data->>'tally_username','成员'),
    'joined_at',m.joined_at) order by (m.user_id=t.owner_id) desc,m.joined_at)
    from tally_private.team_members m join auth.users u on u.id=m.user_id where m.team_id=t.id))
  from tally_private.teams t where t.id=p_team_id
 );
end;
$$;

create function public.tally_team_kick(p_team_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
 if u is null then raise exception 'TALLY_UNAUTHENTICATED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_team_id::text,0));
 if not exists(select 1 from tally_private.teams
  where id=p_team_id and owner_id=u and dissolved_at is null) then raise exception 'TALLY_TEAM_DENIED'; end if;
 if p_user_id is null or p_user_id=u then raise exception 'TALLY_INVALID'; end if;
 insert into tally_private.team_exclusions(team_id,user_id) values(p_team_id,p_user_id) on conflict do nothing;
 delete from tally_private.team_members where team_id=p_team_id and user_id=p_user_id;
 return jsonb_build_object('ok',true);
end;
$$;

create function public.tally_team_dissolve(p_team_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
 if u is null then raise exception 'TALLY_UNAUTHENTICATED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_team_id::text,0));
 if not exists(select 1 from tally_private.teams where id=p_team_id and owner_id=u)
 then raise exception 'TALLY_TEAM_DENIED'; end if;
 update tally_private.teams set dissolved_at=coalesce(dissolved_at,clock_timestamp()) where id=p_team_id;
 delete from tally_private.team_codes where team_id=p_team_id;
 delete from tally_private.team_members where team_id=p_team_id;
 return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.tally_team_details(uuid),public.tally_team_kick(uuid,uuid),
 public.tally_team_dissolve(uuid) from public,anon;
grant execute on function public.tally_team_details(uuid),public.tally_team_kick(uuid,uuid),
 public.tally_team_dissolve(uuid) to authenticated;

create or replace function public.tally_team_save(p_team_id uuid,p_expected_revision bigint,p_snapshot jsonb,p_mutation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare old tally_private.team_ledgers%rowtype; n bigint;stamp timestamptz:=clock_timestamp();begin
 if not tally_private.team_allowed(p_team_id) then raise exception 'TALLY_TEAM_DENIED';end if;
 if p_mutation is null then raise exception 'TALLY_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_team_id::text,0));
 if not tally_private.team_allowed(p_team_id) then raise exception 'TALLY_TEAM_DENIED';end if;
 select * into old from tally_private.team_ledgers where team_id=p_team_id for update;
 if old.last_mutation=p_mutation then return jsonb_build_object('revision',old.revision,'updated_at',old.updated_at,'replayed',true);end if;
 if p_expected_revision is distinct from old.revision then raise exception 'TALLY_CONFLICT';end if;
 perform tally_private.validate_snapshot(p_snapshot);n:=old.revision+1;
 insert into tally_private.team_backups values(p_team_id,old.revision,old.payload,old.updated_at) on conflict do nothing;
 update tally_private.team_ledgers set payload=jsonb_set(p_snapshot,'{revision}',to_jsonb(n)),revision=n,last_mutation=p_mutation,updated_at=stamp where team_id=p_team_id;
 delete from tally_private.team_backups where team_id=p_team_id and revision not in(select revision from tally_private.team_backups where team_id=p_team_id order by revision desc limit 5);
 return jsonb_build_object('revision',n,'updated_at',stamp,'replayed',false);end$$;
create or replace function public.tally_team_join(p_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();t uuid;v_ip text:=btrim(split_part(coalesce(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-forwarded-for','unknown'),',',1));begin
 if u is null then raise exception 'TALLY_UNAUTHENTICATED';end if;
 perform pg_advisory_xact_lock(hashtextextended('join-ip-'||v_ip,0));
 if (select count(*) from tally_private.join_attempts where at>now()-interval '10 minutes' and (user_id=u or join_attempts.ip=v_ip))>=10 then return jsonb_build_object('error','TALLY_TEAM_RATE');end if;
 insert into tally_private.join_attempts values(u,left(v_ip,80),now());
 delete from tally_private.join_attempts where at<now()-interval '1 day';
 select team_id into t from tally_private.team_codes where code_day=(clock_timestamp() at time zone 'Asia/Shanghai')::date and code_hash=sha256(convert_to((clock_timestamp() at time zone 'Asia/Shanghai')::date::text||coalesce(p_code,''),'UTF8')) and expires_at>clock_timestamp() and p_code~'^[0-9]{4}$';
 if t is null then insert into tally_private.security_events(ip,kind,detail) values(left(v_ip,80),'team_code_failed','入群码无效或过期');return jsonb_build_object('error','TALLY_TEAM_CODE_INVALID');end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text,0));
 if not exists(select 1 from tally_private.teams where id=t and dissolved_at is null)
 or exists(select 1 from tally_private.team_exclusions where team_id=t and user_id=u) then
  return jsonb_build_object('error','TALLY_TEAM_CODE_INVALID');
 end if;
 insert into tally_private.team_members values(t,u,now()) on conflict do nothing;
 return (select jsonb_build_object('id',id,'name',name) from tally_private.teams where id=t);end$$;
notify pgrst,'reload schema';
