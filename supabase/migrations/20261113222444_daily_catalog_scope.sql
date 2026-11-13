-- Track only categories introduced automatically by daily-role joins.
create table tally_private.daily_catalog_imports(team_id uuid references tally_private.teams(id) on delete cascade,book text check(book in ('egg','placementStock')),item_id text,owners uuid[] not null,primary key(team_id,book,item_id));
alter table tally_private.daily_catalog_imports enable row level security;
revoke all on tally_private.daily_catalog_imports from public,anon,authenticated;
create function tally_private.prune_daily_catalog(t uuid) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb;old jsonb;rev bigint;k text;bad jsonb;begin
 perform pg_advisory_xact_lock(hashtextextended(t::text,0));
 select payload,revision into s,rev from tally_private.team_ledgers where team_id=t for update;old:=s;
 foreach k in array array['egg','placementStock'] loop
  select coalesce(jsonb_agg(c.item_id),'[]') into bad from tally_private.daily_catalog_imports c
  where c.team_id=t and c.book=k
   and not exists(select 1 from tally_private.daily_memberships m where m.team_id=t and m.job='place' and m.user_id=any(c.owners))
   and not exists(select 1 from jsonb_array_elements(coalesce(s#>array[k,'records'],'[]'))r where r->>'itemId'=c.item_id);
  if jsonb_array_length(bad)=0 then continue;end if;
  s:=jsonb_set(s,array[k,'items'],(select coalesce(jsonb_agg(i),'[]') from jsonb_array_elements(s#>array[k,'items'])i where not bad?(i->>'id')));
  if k='egg' then
   s:=jsonb_set(s,'{egg}',(s->'egg')-'recommendation');
   if s#>'{egg,order}' is not null then s:=jsonb_set(s,'{egg,order}',(select coalesce(jsonb_agg(i),'[]') from jsonb_array_elements(s#>'{egg,order}')i where not bad?(i#>>'{}')));end if;
  end if;
  delete from tally_private.daily_catalog_imports c where c.team_id=t and c.book=k and bad?c.item_id;
 end loop;
 if s is distinct from old then
  s:=jsonb_set(s,'{_dailyRevisions,place}',to_jsonb(coalesce((s#>>'{_dailyRevisions,place}')::bigint,0)+1));s:=jsonb_set(s,'{revision}',to_jsonb(rev+1));
  perform tally_private.validate_snapshot(s);update tally_private.team_ledgers set payload=s,revision=rev+1,updated_at=clock_timestamp() where team_id=t;
 end if;
end$$;
revoke all on function tally_private.prune_daily_catalog(uuid) from public,anon,authenticated;
alter function public.tally_daily_join(text,text,jsonb) set schema tally_private;
alter function tally_private.tally_daily_join(text,text,jsonb) rename to member_labels_join_v1;
revoke all on function tally_private.member_labels_join_v1(text,text,jsonb) from public,anon,authenticated,service_role;
create function public.tally_daily_join(p_kind text,p_job text,p_snapshot jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;before jsonb;after jsonb;result jsonb;k text;m tally_private.daily_memberships%rowtype;begin
 if auth.uid() is null then raise exception 'TALLY_UNAUTHENTICATED';end if;
 perform pg_advisory_xact_lock(hashtextextended('daily-room-'||(clock_timestamp() at time zone 'Asia/Shanghai')::date::text||p_kind,0));
 select team_id into t from tally_private.daily_rooms where room_day=(clock_timestamp() at time zone 'Asia/Shanghai')::date and kind=p_kind;
 if t is not null then perform pg_advisory_xact_lock(hashtextextended(t::text,0));select payload into before from tally_private.team_ledgers where team_id=t;end if;
 result:=tally_private.member_labels_join_v1(p_kind,p_job,p_snapshot);t:=(result->>'id')::uuid;
 select payload into after from tally_private.team_ledgers where team_id=t;
 select * into m from tally_private.daily_memberships where team_id=t and user_id=auth.uid();
 if p_job='place' then
  foreach k in array array['egg','placementStock'] loop
   if before is not null then
    insert into tally_private.daily_catalog_imports(team_id,book,item_id,owners)
    select t,k,i->>'id',array[auth.uid()] from jsonb_array_elements(after#>array[k,'items'])i
    where not exists(select 1 from jsonb_array_elements(coalesce(before#>array[k,'items'],'[]'))b where b->>'id'=i->>'id') on conflict do nothing;
   end if;
   update tally_private.daily_catalog_imports c set owners=array_append(c.owners,auth.uid()) where c.team_id=t and c.book=k and not auth.uid()=any(c.owners) and (case when k='egg' then m.egg_labels else m.stock_labels end)?c.item_id;
  end loop;
 end if;
 perform tally_private.prune_daily_catalog(t);return result;
end$$;
alter function public.tally_team_save(uuid,bigint,jsonb,uuid) set schema tally_private;
alter function tally_private.tally_team_save(uuid,bigint,jsonb,uuid) rename to shared_names_save_v1;
revoke all on function tally_private.shared_names_save_v1(uuid,bigint,jsonb,uuid) from public,anon,authenticated,service_role;
create function public.tally_team_save(p_team_id uuid,p_expected_revision bigint,p_snapshot jsonb,p_mutation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior jsonb;ack jsonb;k text;projected text;begin
 if not tally_private.team_allowed(p_team_id) then raise exception 'TALLY_TEAM_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_team_id::text,0));
 if exists(select 1 from tally_private.daily_memberships where team_id=p_team_id and user_id=auth.uid() and job='place') then
  select tally_private.daily_projection(p_team_id,payload) into prior from tally_private.team_ledgers where team_id=p_team_id;
 end if;
 ack:=tally_private.shared_names_save_v1(p_team_id,p_expected_revision,p_snapshot,p_mutation);
 if prior is not null and not coalesce((ack->>'replayed')::boolean,false) then
  foreach k in array array['egg','placementStock'] loop
   projected:=case when k='egg' then 'egg' else 'stock' end;
   delete from tally_private.daily_catalog_imports c where c.team_id=p_team_id and c.book=k and (
    exists(select 1 from jsonb_array_elements(coalesce(p_snapshot#>array[projected,'records'],'[]'))r where r->>'itemId'=c.item_id)
    or exists(select 1 from jsonb_array_elements(coalesce(p_snapshot#>array[projected,'items'],'[]'))i join jsonb_array_elements(coalesce(prior#>array[projected,'items'],'[]'))b on b->>'id'=i->>'id' where i->>'id'=c.item_id and (i->'name' is distinct from b->'name' or i->'ratio' is distinct from b->'ratio' or i->'photo' is distinct from b->'photo'))
   );
  end loop;
 end if;
 return ack;
end$$;
-- Repair test account 123's orphan imports only: no records, no active placement member using them.
-- Existing categories with records or active users cannot satisfy these predicates.
do $$declare t uuid;begin for t in select dm.team_id from tally_private.daily_memberships dm join auth.users u on u.id=dm.user_id join tally_private.daily_rooms r on r.team_id=dm.team_id where u.raw_app_meta_data->>'tally_username'='123' and r.room_day=(clock_timestamp() at time zone 'Asia/Shanghai')::date order by dm.team_id loop perform pg_advisory_xact_lock(hashtextextended(t::text,0));end loop;end$$;
insert into tally_private.daily_catalog_imports(team_id,book,item_id,owners)
select dm.team_id,'egg',i->>'id',array[dm.user_id]
from tally_private.daily_memberships dm join auth.users u on u.id=dm.user_id
join tally_private.daily_rooms r on r.team_id=dm.team_id join tally_private.team_ledgers l on l.team_id=dm.team_id
cross join lateral jsonb_array_elements(l.payload#>'{egg,items}')i
where u.raw_app_meta_data->>'tally_username'='123' and dm.job='dismantle' and r.room_day=(clock_timestamp() at time zone 'Asia/Shanghai')::date
 and dm.egg_labels?(i->>'id')
 and not exists(select 1 from jsonb_array_elements(l.payload#>'{egg,records}')e where e->>'itemId'=i->>'id')
 and not exists(select 1 from tally_private.daily_memberships active where active.team_id=dm.team_id and active.job='place' and active.egg_labels?(i->>'id'))
 and i->>'name' not in ('鼠标垫','盆栽','便利贴','冰箱贴','拼图','扑克','掼蛋','娃衣','磁吸支架','T恤') on conflict do nothing;
do $$declare t uuid;begin for t in select distinct team_id from tally_private.daily_catalog_imports loop perform tally_private.prune_daily_catalog(t);end loop;end$$;
revoke all on function public.tally_daily_join(text,text,jsonb),public.tally_team_save(uuid,bigint,jsonb,uuid) from public,anon;
grant execute on function public.tally_daily_join(text,text,jsonb),public.tally_team_save(uuid,bigint,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
