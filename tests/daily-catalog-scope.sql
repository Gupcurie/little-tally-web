-- Append after matching-database.sql + shared-comparison-names.sql, in BEGIN/ROLLBACK.
reset role;
select set_config('qa.importTemplate',jsonb_set(current_setting('qa.template')::jsonb,'{egg}',tally_private.preset_book('egg',array['临时甲','临时乙','正式丙']))::text,true);
select set_config('request.jwt.claim.sub',current_setting('qa.userA'),true);
set local role authenticated;
select public.tally_daily_join('angel','place',current_setting('qa.importTemplate')::jsonb);
do $$declare v jsonb;s jsonb;id text;t uuid:=current_setting('qa.team')::uuid;begin
 v:=public.tally_team_read(t);s:=v->'payload';
 if not exists(select 1 from jsonb_array_elements(s#>'{egg,items}')i where i->>'name'='临时甲') then raise exception 'personal catalog not preserved on placement entry';end if;
 select i->>'id' into id from jsonb_array_elements(s#>'{egg,items}')i where i->>'name'='正式丙';
 s:=jsonb_set(s,'{egg,records}',s#>'{egg,records}'||jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'itemId',id,'delta',1,'kind','count','at',floor(extract(epoch from now())*1000))));
 perform public.tally_team_save(t,(v->>'revision')::bigint,s,gen_random_uuid());
end$$;
select public.tally_daily_join('angel','dismantle',current_setting('qa.template')::jsonb);
do $$declare d jsonb;t uuid:=current_setting('qa.team')::uuid;begin
 d:=public.tally_daily_comparison(t);
 if exists(select 1 from jsonb_array_elements(d#>'{egg,items}')i where i->>'name' in ('临时甲','临时乙')) then raise exception 'temporary imports persisted after leaving placement';end if;
 if not exists(select 1 from jsonb_array_elements(d#>'{egg,items}')i where i->>'name'='正式丙') then raise exception 'used group category removed';end if;
end$$;
reset role;
select set_config('qa.sharedTemplate',jsonb_set(current_setting('qa.template')::jsonb,'{egg}',tally_private.preset_book('egg',array['共同临时']))::text,true);
set local role authenticated;
select public.tally_daily_join('angel','place',current_setting('qa.sharedTemplate')::jsonb);
select set_config('request.jwt.claim.sub',current_setting('qa.userB'),true);
select public.tally_daily_join('angel','place',current_setting('qa.sharedTemplate')::jsonb);
select set_config('request.jwt.claim.sub',current_setting('qa.userA'),true);
select public.tally_daily_join('angel','dismantle',current_setting('qa.template')::jsonb);
do $$begin
 if not exists(select 1 from jsonb_array_elements(public.tally_daily_comparison(current_setting('qa.team')::uuid)#>'{egg,items}')i where i->>'name'='共同临时') then raise exception 'another placement member still uses imported category';end if;
end$$;
select set_config('request.jwt.claim.sub',current_setting('qa.userB'),true);
-- A manually added zero-count category is a formal shared category, not an automatic import.
do $$declare v jsonb;s jsonb;begin
 v:=public.tally_team_read(current_setting('qa.team')::uuid);s:=v->'payload';
 s:=jsonb_set(s,'{egg,items}',s#>'{egg,items}'||jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'name','手动新增','ratio',1,'created',floor(extract(epoch from now())*1000),'color',99)));
 perform public.tally_team_save(current_setting('qa.team')::uuid,(v->>'revision')::bigint,s,gen_random_uuid());
end$$;
select public.tally_daily_join('angel','dismantle',current_setting('qa.template')::jsonb);
do $$declare d jsonb;begin
 d:=public.tally_daily_comparison(current_setting('qa.team')::uuid);
 if exists(select 1 from jsonb_array_elements(d#>'{egg,items}')i where i->>'name'='共同临时') then raise exception 'last imported owner left but category remained';end if;
 if not exists(select 1 from jsonb_array_elements(d#>'{egg,items}')i where i->>'name'='手动新增') then raise exception 'manually added group category removed';end if;
end$$;
reset role;
do $$begin
 if has_function_privilege('authenticated','tally_private.shared_names_save_v1(uuid,bigint,jsonb,uuid)','EXECUTE') then raise exception 'old save bypass exposed';end if;
 if has_table_privilege('authenticated','tally_private.daily_catalog_imports','SELECT') then raise exception 'catalog origin table exposed';end if;
end$$;
