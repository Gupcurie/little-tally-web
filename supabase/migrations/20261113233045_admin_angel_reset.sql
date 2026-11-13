create table tally_private.admin_team_resets(
 team_id uuid references tally_private.teams(id) on delete cascade,
 mutation uuid not null,at timestamptz not null default clock_timestamp(),admin_slot text not null,
 previous_revision bigint not null,payload jsonb not null,primary key(team_id,mutation)
);
alter table tally_private.admin_team_resets enable row level security;
revoke all on tally_private.admin_team_resets from public,anon,authenticated;
create function public.tally_admin_reset_angel(p_team_id uuid,p_expected_revision bigint,p_mutation uuid,p_admin_slot text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb;old jsonb;rev bigint;k text;stamp bigint:=floor(extract(epoch from clock_timestamp())*1000);begin
 if p_team_id is null or p_mutation is null or p_admin_slot is null or p_admin_slot not in ('primary','secondary') then raise exception 'TALLY_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_team_id::text,0));
 if not exists(select 1 from tally_private.daily_rooms where team_id=p_team_id and kind='angel' and room_day=(clock_timestamp() at time zone 'Asia/Shanghai')::date) then raise exception 'TALLY_RESET_TARGET';end if;
 select payload,revision into old,rev from tally_private.team_ledgers where team_id=p_team_id for update;
 if exists(select 1 from tally_private.admin_team_resets where team_id=p_team_id and mutation=p_mutation) then return jsonb_build_object('ok',true,'revision',rev,'replayed',true);end if;
 if rev is distinct from p_expected_revision then raise exception 'TALLY_CONFLICT';end if;
 s:=old;
 foreach k in array array['sales','stock','egg','placementStock'] loop
  if not s?k then continue;end if;
  s:=jsonb_set(s,array[k,'records'],'[]');
  if k in ('stock','placementStock') then
   s:=jsonb_set(s,array[k,'items'],(select coalesce(jsonb_agg(jsonb_set(i,'{breakdown}',(select coalesce(jsonb_object_agg(key,0),'{}') from jsonb_each(coalesce(i->'breakdown','{}'))))),'[]') from jsonb_array_elements(s#>array[k,'items'])i));
  end if;
 end loop;
 s:=jsonb_set(s,'{egg}',(s->'egg')-'recommendation');
 s:=jsonb_set(s,'{egg,items}',(select coalesce(jsonb_agg(i-'lastAt'),'[]') from jsonb_array_elements(s#>'{egg,items}')i));
 if s?'reconciliation' then
  s:=jsonb_set(s,'{reconciliation}',(s->'reconciliation')||jsonb_build_object('at',stamp,'egg','{"lastId":null,"excluded":[],"quantities":{}}'::jsonb,'sales','{"lastId":null,"excluded":[],"quantities":{}}'::jsonb));
 end if;
 s:=s||jsonb_build_object('revision',rev+1,'periodStartedAt',stamp,'_dailyRevisions',jsonb_build_object('place',coalesce((old#>>'{_dailyRevisions,place}')::bigint,0)+1,'dismantle',coalesce((old#>>'{_dailyRevisions,dismantle}')::bigint,0)+1));
 perform tally_private.validate_snapshot(s);
 insert into tally_private.admin_team_resets(team_id,mutation,admin_slot,previous_revision,payload) values(p_team_id,p_mutation,p_admin_slot,rev,old);
 update tally_private.team_ledgers set payload=s,revision=rev+1,last_mutation=p_mutation,updated_at=clock_timestamp() where team_id=p_team_id;
 return jsonb_build_object('ok',true,'revision',rev+1,'replayed',false);
end$$;
revoke all on function public.tally_admin_reset_angel(uuid,bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.tally_admin_reset_angel(uuid,bigint,uuid,text) to service_role;
create or replace function public.tally_admin_teams() returns jsonb language sql stable security definer set search_path='' as $$
select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'created_at',t.created_at,'payload',l.payload,'revision',l.revision,'updated_at',l.updated_at,'daily_kind',r.kind,'day',r.room_day,'members',(select count(*) from tally_private.team_members m where m.team_id=t.id))),'[]') from tally_private.teams t join tally_private.team_ledgers l on l.team_id=t.id left join tally_private.daily_rooms r on r.team_id=t.id
$$;
revoke all on function public.tally_admin_teams() from public,anon,authenticated;
grant execute on function public.tally_admin_teams() to service_role;
notify pgrst,'reload schema';
