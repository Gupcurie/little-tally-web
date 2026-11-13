alter table tally_private.daily_memberships add column egg_labels jsonb not null default '{}',add column stock_labels jsonb not null default '{}',add column preferred_egg jsonb not null default '[]';
create table tally_private.matching_configs(scope_kind text not null check(scope_kind in ('personal','team')),scope_id uuid not null,config jsonb not null,updated_at timestamptz not null default now(),updated_by uuid references auth.users(id) on delete set null,owner_id uuid references auth.users(id) on delete cascade,team_id uuid references tally_private.teams(id) on delete cascade,primary key(scope_kind,scope_id));
alter table tally_private.matching_configs enable row level security;
revoke all on tally_private.matching_configs from public,anon,authenticated;

create function tally_private.prize_key(n text) returns text language sql immutable set search_path='' as $$
 select case lower(btrim(n)) when '扑克牌' then '扑克' when '掼蛋纸牌' then '掼蛋' when '支架' then '磁吸支架' else lower(btrim(n)) end
$$;
revoke all on function tally_private.prize_key(text) from public,anon,authenticated;
create function tally_private.preset_book(k text,names text[],old jsonb default '{}') returns jsonb language plpgsql volatile set search_path='' as $$
declare out jsonb:='[]';n text;i jsonb;idx integer:=0;begin
 foreach n in array names loop
  select item into i from jsonb_array_elements(coalesce(old->'items','[]'))item where item->>'name'=n limit 1;
  if i is null then i:=jsonb_build_object('id',gen_random_uuid()::text,'name',n,'color',idx,'created',floor(extract(epoch from now())*1000),'breakdown','{}'::jsonb);end if;
  if k='egg' then i:=i||jsonb_build_object('ratio',coalesce(i->'ratio','1'::jsonb));else i:=i||'{"breakdown":{}}'::jsonb;end if;
  out:=out||jsonb_build_array(i);idx:=idx+1;
 end loop;
 return jsonb_build_object('book',k,'items',out,'records','[]'::jsonb,'goal',null);
end$$;
revoke all on function tally_private.preset_book(text,text[],jsonb) from public,anon,authenticated;
create function tally_private.named_book(b jsonb,labels jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare items jsonb:='[]';i jsonb;n text;used text[]:='{}';reserved text[];attempt integer;begin
 select coalesce(array_agg(value),'{}') into reserved from jsonb_each_text(labels);
 for i in select value from jsonb_array_elements(coalesce(b->'items','[]')) loop
  n:=coalesce(labels->>(i->>'id'),i->>'name');attempt:=0;
  while n=any(used) or (not labels?(i->>'id') and n=any(reserved)) loop attempt:=attempt+1;n:=left(i->>'name',30)||'（群'||attempt::text||'）';end loop;
  used:=array_append(used,n);items:=items||jsonb_build_array(jsonb_set(i,'{name}',to_jsonb(n)));
 end loop;
 return jsonb_set(b,'{items}',items);
end$$;
revoke all on function tally_private.named_book(jsonb,jsonb) from public,anon,authenticated;
create function tally_private.prepare_labels(b jsonb,preferred jsonb,can_add boolean) returns jsonb language plpgsql volatile set search_path='' as $$
declare items jsonb:=coalesce(b->'items','[]');labels jsonb:='{}';i jsonb;found jsonb;matches integer;label text;n integer;begin
 for i in select value from jsonb_array_elements(preferred) loop
  label:=i->>'name';if label is null or length(label) not between 1 and 40 then raise exception 'TALLY_INVALID';end if;
  found:=null;select item into found from jsonb_array_elements(items)item where item->>'id'=i->>'id' and not labels?(item->>'id') limit 1;
  if found is null then select item into found from jsonb_array_elements(items)item where item->>'name'=label and not labels?(item->>'id') limit 1;end if;
  if found is null then
   select count(*) into matches from jsonb_array_elements(items)item where tally_private.prize_key(item->>'name')=tally_private.prize_key(label) and not labels?(item->>'id') and not exists(select 1 from jsonb_array_elements(preferred)p where p->>'name'=item->>'name' and p->>'name'<>label);
   if matches=1 then select item into found from jsonb_array_elements(items)item where tally_private.prize_key(item->>'name')=tally_private.prize_key(label) and not labels?(item->>'id') and not exists(select 1 from jsonb_array_elements(preferred)p where p->>'name'=item->>'name' and p->>'name'<>label);end if;
  end if;
  if found is null and can_add then
   n:=jsonb_array_length(items);if n>=200 then raise exception 'TALLY_INVALID';end if;
   found:=jsonb_build_object('id',gen_random_uuid()::text,'name',label,'color',n,'created',floor(extract(epoch from now())*1000),'breakdown','{}'::jsonb);
   if b->>'book'='egg' then found:=found||jsonb_build_object('ratio',coalesce(i->'ratio','1'::jsonb));end if;
   items:=items||jsonb_build_array(found);
  end if;
  if found is not null then labels:=labels||jsonb_build_object(found->>'id',label);end if;
 end loop;
 return jsonb_build_object('book',jsonb_set(b,'{items}',items),'labels',labels);
end$$;
revoke all on function tally_private.prepare_labels(jsonb,jsonb,boolean) from public,anon,authenticated;

alter function public.tally_daily_join(text,text,jsonb) set schema tally_private;
alter function tally_private.tally_daily_join(text,text,jsonb) rename to role_join_v1;
revoke all on function tally_private.role_join_v1(text,text,jsonb) from public,anon,authenticated,service_role;
create function public.tally_daily_join(p_kind text,p_job text,p_snapshot jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare team jsonb;t uuid;old jsonb;s jsonb;m tally_private.daily_memberships%rowtype;preferred jsonb;result jsonb;rev bigint;names text[]:=array['T恤','红娃衣','黑娃衣','扑克','拼图','磁吸支架','掼蛋','便利贴','冰箱贴','盆栽','鼠标垫'];place_names text[]:=array['鼠标垫','盆栽','便利贴','冰箱贴','拼图','扑克','掼蛋','娃衣','磁吸支架','T恤'];begin
 team:=tally_private.role_join_v1(p_kind,p_job,p_snapshot);t:=(team->>'id')::uuid;
 select payload,revision into old,rev from tally_private.team_ledgers where team_id=t for update;s:=old;
 select * into m from tally_private.daily_memberships where team_id=t and user_id=auth.uid();
 if not s?'_presetVersion' then
  if jsonb_array_length(s#>'{sales,records}')=0 then s:=jsonb_set(s,'{sales}',tally_private.preset_book('sales',names,s->'sales'));end if;
  if jsonb_array_length(s#>'{stock,records}')=0 then s:=jsonb_set(s,'{stock}',tally_private.preset_book('stock',names,s->'stock'));end if;
  if jsonb_array_length(s#>'{placementStock,records}')=0 then s:=jsonb_set(s,'{placementStock}',tally_private.preset_book('stock',place_names,s->'placementStock'));end if;
  if jsonb_array_length(coalesce(s#>'{egg,items}','[]'))=0 then s:=jsonb_set(s,'{egg}',tally_private.preset_book('egg',place_names));end if;
  s:=s||'{"_presetVersion":1}'::jsonb;
 end if;
 preferred:=coalesce(p_snapshot#>'{egg,items}','[]');
 if jsonb_array_length(preferred)=0 then preferred:=m.preferred_egg;end if;
 if jsonb_array_length(preferred)=0 then select coalesce(payload#>'{egg,items}','[]') into preferred from public.tally_ledgers where user_id=auth.uid();end if;
 if coalesce(jsonb_array_length(preferred),0)=0 then select dm.preferred_egg into preferred from tally_private.daily_memberships dm join tally_private.daily_rooms r on r.team_id=dm.team_id where dm.user_id=auth.uid() and jsonb_array_length(dm.preferred_egg)>0 order by r.room_day desc limit 1;end if;
 if coalesce(jsonb_array_length(preferred),0)=0 then preferred:=tally_private.preset_book('egg',place_names)->'items';end if;
 result:=tally_private.prepare_labels(s->'egg',preferred,p_job='place');s:=jsonb_set(s,'{egg}',result->'book');
 update tally_private.daily_memberships set preferred_egg=preferred,egg_labels=result->'labels' where team_id=t and user_id=auth.uid();
 result:=tally_private.prepare_labels(s->'placementStock',preferred,p_job='place');s:=jsonb_set(s,'{placementStock}',result->'book');
 update tally_private.daily_memberships set stock_labels=result->'labels' where team_id=t and user_id=auth.uid();
 if s is distinct from old then
  perform tally_private.validate_snapshot(s);
  if not s?'_dailyRevisions' then s:=s||'{"_dailyRevisions":{}}'::jsonb;end if;
  if s->'egg' is distinct from old->'egg' or s->'placementStock' is distinct from old->'placementStock' then s:=jsonb_set(s,array['_dailyRevisions','place'],to_jsonb(coalesce((old#>>'{_dailyRevisions,place}')::bigint,0)+1));s:=jsonb_set(s,'{egg}',(s->'egg')-'recommendation');end if;
  if s->'sales' is distinct from old->'sales' or s->'stock' is distinct from old->'stock' then s:=jsonb_set(s,array['_dailyRevisions','dismantle'],to_jsonb(coalesce((old#>>'{_dailyRevisions,dismantle}')::bigint,0)+1));s:=s-'salesStockBinding';end if;
  s:=jsonb_set(s,'{revision}',to_jsonb(rev+1));
  update tally_private.team_ledgers set payload=s,revision=rev+1,updated_at=clock_timestamp() where team_id=t;
 end if;
 return team;
end$$;

alter function public.tally_team_save(uuid,bigint,jsonb,uuid) set schema tally_private;
alter function tally_private.tally_team_save(uuid,bigint,jsonb,uuid) rename to role_save_v1;
revoke all on function tally_private.role_save_v1(uuid,bigint,jsonb,uuid) from public,anon,authenticated,service_role;
create function public.tally_team_save(p_team_id uuid,p_expected_revision bigint,p_snapshot jsonb,p_mutation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare old jsonb;clean jsonb:=p_snapshot;ack jsonb;labels jsonb;v_stock_labels jsonb;items jsonb;i jsonb;canonical jsonb;m tally_private.daily_memberships%rowtype;begin
 if not tally_private.team_allowed(p_team_id) then raise exception 'TALLY_TEAM_DENIED';end if;
 if not exists(select 1 from tally_private.daily_rooms where team_id=p_team_id) then return tally_private.role_save_v1(p_team_id,p_expected_revision,p_snapshot,p_mutation);end if;
 perform pg_advisory_xact_lock(hashtextextended(p_team_id::text,0));
 select * into m from tally_private.daily_memberships where team_id=p_team_id and user_id=auth.uid();
 if m.user_id is null then raise exception 'TALLY_TEAM_DENIED';end if;
 if m.job<>'place' then return tally_private.role_save_v1(p_team_id,p_expected_revision,p_snapshot,p_mutation);end if;
 perform tally_private.validate_snapshot(p_snapshot);select payload into old from tally_private.team_ledgers where team_id=p_team_id;
 labels:=m.egg_labels;v_stock_labels:=m.stock_labels;
 items:='[]';for i in select value from jsonb_array_elements(p_snapshot#>'{egg,items}') loop
  labels:=labels||jsonb_build_object(i->>'id',i->>'name');select item into canonical from jsonb_array_elements(old#>'{egg,items}')item where item->>'id'=i->>'id';
  items:=items||jsonb_build_array(case when canonical is null then i else jsonb_set(i,'{name}',canonical->'name') end);
 end loop;clean:=jsonb_set(clean,'{egg,items}',items);
 if m.stock_enabled then
  items:='[]';for i in select value from jsonb_array_elements(p_snapshot#>'{stock,items}') loop
   v_stock_labels:=v_stock_labels||jsonb_build_object(i->>'id',i->>'name');select item into canonical from jsonb_array_elements(old#>'{placementStock,items}')item where item->>'id'=i->>'id';
   items:=items||jsonb_build_array(case when canonical is null then i else jsonb_set(i,'{name}',canonical->'name') end);
  end loop;clean:=jsonb_set(clean,'{stock,items}',items);
 end if;
 ack:=tally_private.role_save_v1(p_team_id,p_expected_revision,clean,p_mutation);
 if not coalesce((ack->>'replayed')::boolean,false) then update tally_private.daily_memberships set egg_labels=labels,stock_labels=v_stock_labels,preferred_egg=p_snapshot#>'{egg,items}' where team_id=p_team_id and user_id=auth.uid();end if;
 select payload into old from tally_private.team_ledgers where team_id=p_team_id;
 return jsonb_set(ack,'{payload}',tally_private.daily_projection(p_team_id,old));
end$$;

create or replace function tally_private.daily_projection(t uuid,s jsonb) returns jsonb
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
 'stock',case when m.job='dismantle' then s->'stock' when m.stock_enabled then tally_private.named_book(coalesce(s->'placementStock',empty_stock),m.stock_labels) else empty_stock end,
 'egg',case when m.job='place' then tally_private.named_book(s->'egg',m.egg_labels) else empty_egg end,
 '_dailyRoom',jsonb_build_object('kind',r.kind,'day',r.room_day,'role',m.job,'stockEnabled',m.stock_enabled,'labelsReady',jsonb_array_length(m.preferred_egg)>0,'editRevision',coalesce(s#>array['_dailyRevisions',m.job],'0'),
 'aliasHash',encode(sha256(convert_to(coalesce(s#>'{reconciliation,aliases}','[]')::text,'UTF8')),'hex')));
 if m.job='dismantle' and s?'salesStockBinding' then out:=out||jsonb_build_object('salesStockBinding',s->'salesStockBinding');end if;
 if s?'reconciliation' then out:=out||jsonb_build_object('reconciliation',s->'reconciliation');end if;
 return out;
end$$;
revoke all on function tally_private.daily_projection(uuid,jsonb) from public,anon,authenticated;


alter function public.tally_daily_comparison(uuid) set schema tally_private;
alter function tally_private.tally_daily_comparison(uuid) rename to comparison_v1;
revoke all on function tally_private.comparison_v1(uuid) from public,anon,authenticated,service_role;
create function public.tally_daily_comparison(p_team_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare out jsonb;m tally_private.daily_memberships%rowtype;begin
 out:=tally_private.comparison_v1(p_team_id);select * into m from tally_private.daily_memberships where team_id=p_team_id and user_id=auth.uid();
 if m.job='place' then out:=jsonb_set(out,'{egg}',tally_private.named_book(out->'egg',m.egg_labels));end if;
 return out;
end$$;

create function tally_private.match_book(b jsonb,start_ms numeric,end_ms numeric,archived boolean default false) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('items',(select coalesce(jsonb_agg(i),'[]') from jsonb_array_elements(coalesce(b->'items','[]'))i where not archived or exists(select 1 from jsonb_array_elements(coalesce(b->'records','[]'))r where r->>'itemId'=i->>'id' and (r->>'at')::numeric between start_ms and end_ms)),
 'records',(select coalesce(jsonb_agg(r),'[]') from jsonb_array_elements(coalesce(b->'records','[]'))r where (r->>'at')::numeric between start_ms and end_ms))
$$;
revoke all on function tally_private.match_book(jsonb,numeric,numeric,boolean) from public,anon,authenticated;

create function public.tally_matching_read(p_team_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid();s jsonb;eggs jsonb:='[]';sales jsonb:='[]';p record;cmp jsonb;config jsonb;sig text;ids jsonb;rev bigint:=0;k text:=case when p_team_id is null then 'personal' else 'team' end;v_scope_id uuid:=coalesce(p_team_id,auth.uid());
 start_ms numeric:=extract(epoch from (date_trunc('day',now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'))*1000;end_ms numeric:=extract(epoch from clock_timestamp())*1000;begin
 if u is null then raise exception 'TALLY_UNAUTHENTICATED';end if;
 if p_team_id is null then select payload,revision into s,rev from public.tally_ledgers where user_id=u;
 else
  if not tally_private.team_allowed(p_team_id) then raise exception 'TALLY_TEAM_DENIED';end if;
  select payload,revision into s,rev from tally_private.team_ledgers where team_id=p_team_id;
 end if;
 for p in select payload from tally_private.periods where ended_at>=to_timestamp(start_ms/1000) and case when p_team_id is null then team_id is null and owner_id=u else team_id=p_team_id end order by ended_at loop
  eggs:=eggs||jsonb_build_array(tally_private.match_book(p.payload->'egg',start_ms,end_ms,true));sales:=sales||jsonb_build_array(tally_private.match_book(p.payload->'sales',start_ms,end_ms,true));
 end loop;
 if exists(select 1 from tally_private.daily_rooms where team_id=p_team_id) then
  cmp:=public.tally_daily_comparison(p_team_id);eggs:=eggs||jsonb_build_array(cmp->'egg');sales:=sales||jsonb_build_array(cmp->'sales');
 else eggs:=eggs||jsonb_build_array(tally_private.match_book(s->'egg',start_ms,end_ms));sales:=sales||jsonb_build_array(tally_private.match_book(s->'sales',start_ms,end_ms));end if;
 ids:=jsonb_build_object('egg',(select coalesce(jsonb_agg(id order by id),'[]') from (select distinct i->>'id' id from jsonb_array_elements(eggs)b cross join lateral jsonb_array_elements(b->'items')i)x),
 'sales',(select coalesce(jsonb_agg(id order by id),'[]') from (select distinct i->>'id' id from jsonb_array_elements(sales)b cross join lateral jsonb_array_elements(b->'items')i)x));
 sig:=encode(sha256(convert_to(ids::text,'UTF8')),'hex');
 select mc.config into config from tally_private.matching_configs mc where mc.scope_kind=k and mc.scope_id=v_scope_id;
 return jsonb_build_object('egg_books',eggs,'sales_books',sales,'revision',coalesce(rev,0),'generated_at',end_ms,'ids',ids,'signature',sig,'config',config,'hash',case when config is null then '' else encode(sha256(convert_to(config::text,'UTF8')),'hex') end,'aliases',coalesce(s#>'{reconciliation,aliases}','[]'));
end$$;

create function public.tally_matching_save(p_team_id uuid,p_config jsonb,p_signature text,p_expected_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();data jsonb;side text;g jsonb;all_ids jsonb;distinct_ids jsonb;count_ids integer;kind text:=case when p_team_id is null then 'personal' else 'team' end;scope uuid:=coalesce(p_team_id,auth.uid());begin
 if u is null then raise exception 'TALLY_UNAUTHENTICATED';end if;
 if p_team_id is not null then
  perform pg_advisory_xact_lock(hashtextextended(p_team_id::text,0));
  if not tally_private.team_allowed(p_team_id) then raise exception 'TALLY_TEAM_DENIED';end if;
  if exists(select 1 from tally_private.daily_rooms where team_id=p_team_id and room_day<>(clock_timestamp() at time zone 'Asia/Shanghai')::date) then raise exception 'TALLY_DAILY_READONLY';end if;
 else perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 end if;
 perform pg_advisory_xact_lock(hashtextextended('matching-'||kind||scope::text,0));
 data:=public.tally_matching_read(p_team_id);
 if data->>'hash' is distinct from p_expected_hash then raise exception 'TALLY_MATCHING_CONFLICT';end if;
 if data->>'signature' is distinct from p_signature then raise exception 'TALLY_MATCHING_CHANGED';end if;
 if p_config->>'version' is distinct from '1' or jsonb_typeof(p_config->'groups') is distinct from 'array' or jsonb_array_length(p_config->'groups')>2000 then raise exception 'TALLY_INVALID';end if;
 for g in select value from jsonb_array_elements(p_config->'groups') loop
  if jsonb_typeof(g->'sales') is distinct from 'array' or jsonb_typeof(g->'egg') is distinct from 'array' or jsonb_array_length(g->'sales')=0 or jsonb_array_length(g->'egg')=0 then raise exception 'TALLY_INVALID';end if;
 end loop;
 foreach side in array array['sales','egg'] loop
  if jsonb_typeof(p_config->'singles'->side) is distinct from 'array' then raise exception 'TALLY_INVALID';end if;
  select coalesce(jsonb_agg(id),'[]'),count(*) into all_ids,count_ids from (select value id from jsonb_array_elements(p_config->'singles'->side) union all select elem from jsonb_array_elements(p_config->'groups') as groups(grp) cross join lateral jsonb_array_elements(grp->side) as entries(elem))x;
  if count_ids>2000 then raise exception 'TALLY_INVALID';end if;
  select coalesce(jsonb_agg(id order by id),'[]') into distinct_ids from (select distinct value id from jsonb_array_elements(all_ids))x;
  if jsonb_array_length(distinct_ids)<>count_ids or distinct_ids is distinct from data->'ids'->side then raise exception 'TALLY_MATCHING_INCOMPLETE';end if;
 end loop;
 insert into tally_private.matching_configs(scope_kind,scope_id,config,updated_by,owner_id,team_id) values(kind,scope,jsonb_build_object('version',1,'groups',p_config->'groups','singles',p_config->'singles','signature',p_signature),u,case when p_team_id is null then u else null end,p_team_id)
 on conflict(scope_kind,scope_id) do update set config=excluded.config,updated_at=clock_timestamp(),updated_by=excluded.updated_by;
 return public.tally_matching_read(p_team_id);
end$$;

revoke all on function public.tally_daily_join(text,text,jsonb),public.tally_team_save(uuid,bigint,jsonb,uuid),public.tally_daily_comparison(uuid),public.tally_matching_read(uuid),public.tally_matching_save(uuid,jsonb,text,text) from public,anon;
grant execute on function public.tally_daily_join(text,text,jsonb),public.tally_team_save(uuid,bigint,jsonb,uuid),public.tally_daily_comparison(uuid),public.tally_matching_read(uuid),public.tally_matching_save(uuid,jsonb,text,text) to authenticated;
notify pgrst,'reload schema';
