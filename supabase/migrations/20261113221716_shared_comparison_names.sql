-- Shared comparison labels are distinct from each member's private card labels.
create table tally_private.comparison_names(team_id uuid primary key references tally_private.teams(id) on delete cascade,labels jsonb not null default '{}');
alter table tally_private.comparison_names enable row level security;
revoke all on tally_private.comparison_names from public,anon,authenticated;
-- Recover an existing unique non-synonym alias without guessing between conflicting historical names.
insert into tally_private.comparison_names(team_id,labels)
select team_id,jsonb_object_agg(id,name) from (
 select dm.team_id,i->>'id' id,min(n.value) name
 from tally_private.daily_memberships dm
 join tally_private.team_ledgers l on l.team_id=dm.team_id
 cross join lateral jsonb_array_elements(l.payload#>'{egg,items}') i
 join lateral jsonb_each_text(dm.egg_labels) n on n.key=i->>'id'
 where n.value !~ '（群[0-9]+）$' and tally_private.prize_key(n.value)<>tally_private.prize_key(i->>'name')
 group by dm.team_id,i->>'id' having count(distinct n.value)=1
) recovered group by team_id;
create or replace function public.tally_team_save(p_team_id uuid,p_expected_revision bigint,p_snapshot jsonb,p_mutation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare old jsonb;clean jsonb:=p_snapshot;ack jsonb;shown_names jsonb;shared_names jsonb:='{}';labels jsonb;v_stock_labels jsonb;items jsonb;i jsonb;canonical jsonb;m tally_private.daily_memberships%rowtype;begin
 if not tally_private.team_allowed(p_team_id) then raise exception 'TALLY_TEAM_DENIED';end if;
 if not exists(select 1 from tally_private.daily_rooms where team_id=p_team_id) then return tally_private.role_save_v1(p_team_id,p_expected_revision,p_snapshot,p_mutation);end if;
 perform pg_advisory_xact_lock(hashtextextended(p_team_id::text,0));
 select * into m from tally_private.daily_memberships where team_id=p_team_id and user_id=auth.uid();
 if m.user_id is null then raise exception 'TALLY_TEAM_DENIED';end if;
 if m.job<>'place' then return tally_private.role_save_v1(p_team_id,p_expected_revision,p_snapshot,p_mutation);end if;
 perform tally_private.validate_snapshot(p_snapshot);select payload into old from tally_private.team_ledgers where team_id=p_team_id;
 select coalesce(jsonb_object_agg(item->>'id',item->>'name'),'{}') into shown_names from jsonb_array_elements(tally_private.named_book(old->'egg',m.egg_labels)->'items')item;
 labels:=m.egg_labels;v_stock_labels:=m.stock_labels;
 items:='[]';for i in select value from jsonb_array_elements(p_snapshot#>'{egg,items}') loop
  labels:=labels||jsonb_build_object(i->>'id',i->>'name');select item into canonical from jsonb_array_elements(old#>'{egg,items}')item where item->>'id'=i->>'id';
  if canonical is not null and i->>'name' is distinct from shown_names->>(i->>'id') then shared_names:=shared_names||jsonb_build_object(i->>'id',i->>'name');end if;
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
 if shared_names<>'{}'::jsonb and not coalesce((ack->>'replayed')::boolean,false) then
  insert into tally_private.comparison_names(team_id,labels) values(p_team_id,shared_names) on conflict(team_id) do update set labels=comparison_names.labels||excluded.labels;
 end if;
 select payload into old from tally_private.team_ledgers where team_id=p_team_id;
 return jsonb_set(ack,'{payload}',tally_private.daily_projection(p_team_id,old));
end$$;

create or replace function public.tally_daily_comparison(p_team_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare out jsonb;names jsonb;begin
 out:=tally_private.comparison_v1(p_team_id);
 select labels into names from tally_private.comparison_names where team_id=p_team_id;
 return jsonb_set(out,'{egg}',tally_private.named_book(out->'egg',coalesce(names,'{}')));
end$$;
revoke all on function public.tally_team_save(uuid,bigint,jsonb,uuid),public.tally_daily_comparison(uuid) from public,anon;
grant execute on function public.tally_team_save(uuid,bigint,jsonb,uuid),public.tally_daily_comparison(uuid) to authenticated;
notify pgrst,'reload schema';
