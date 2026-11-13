-- Append after matching-database.sql inside BEGIN/ROLLBACK, synthetic groups only.
select set_config('request.jwt.claim.sub',current_setting('qa.userD'),true);
set local role authenticated;
do $$declare v jsonb;s jsonb;begin
 v:=public.tally_team_read(current_setting('qa.team')::uuid);s:=v->'payload';
 s:=jsonb_set(s,'{stock,items,0,breakdown}','{"分类":2}');
 s:=jsonb_set(s,'{stock,records}',jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'itemId',s#>>'{stock,items,0,id}','delta',5,'kind','count','at',floor(extract(epoch from now())*1000))));
 perform public.tally_team_save(current_setting('qa.team')::uuid,(v->>'revision')::bigint,s,gen_random_uuid());
 perform set_config('qa.oldD',(public.tally_team_read(current_setting('qa.team')::uuid)->'payload')::text,true);
end$$;
select set_config('request.jwt.claim.sub',current_setting('qa.userA'),true);
select set_config('qa.oldP',(public.tally_team_read(current_setting('qa.team')::uuid)->'payload')::text,true);
reset role;
select set_config('qa.before',(select payload::text from tally_private.team_ledgers where team_id=current_setting('qa.team')::uuid),true);
select set_config('qa.rev',(select revision::text from tally_private.team_ledgers where team_id=current_setting('qa.team')::uuid),true);
select set_config('qa.reset',gen_random_uuid()::text,true);
set local role service_role;
select public.tally_admin_reset_angel(current_setting('qa.team')::uuid,current_setting('qa.rev')::bigint,current_setting('qa.reset')::uuid,'primary');
do $$begin
 begin perform public.tally_admin_reset_angel(current_setting('qa.newteam')::uuid,1,gen_random_uuid(),'primary');raise exception 'devil reset accepted';exception when others then if sqlerrm<>'TALLY_RESET_TARGET' then raise;end if;end;
 begin perform public.tally_admin_reset_angel(current_setting('qa.team')::uuid,current_setting('qa.rev')::bigint,gen_random_uuid(),'secondary');raise exception 'stale reset accepted';exception when others then if sqlerrm<>'TALLY_CONFLICT' then raise;end if;end;
end$$;
reset role;
do $$declare s jsonb;old jsonb:=current_setting('qa.before')::jsonb;k text;begin
 select payload into s from tally_private.team_ledgers where team_id=current_setting('qa.team')::uuid;
 foreach k in array array['sales','stock','egg','placementStock'] loop
  if jsonb_array_length(s#>array[k,'records'])<>0 then raise exception 'book not empty: %',k;end if;
  if jsonb_array_length(s#>array[k,'items'])<>jsonb_array_length(old#>array[k,'items']) then raise exception 'items removed';end if;
 end loop;
 if s#>>'{stock,items,0,breakdown,分类}'<>'0' then raise exception 'inventory subcounts not zero';end if;
 if s#>'{egg,recommendation}' is not null then raise exception 'old plan survived';end if;
 if (select count(*) from tally_private.team_members where team_id=current_setting('qa.team')::uuid)<>3 then raise exception 'members changed';end if;
 if (select payload from tally_private.admin_team_resets where team_id=current_setting('qa.team')::uuid and mutation=current_setting('qa.reset')::uuid) is distinct from old then raise exception 'backup incomplete';end if;
 if has_function_privilege('authenticated','public.tally_admin_reset_angel(uuid,bigint,uuid,text)','EXECUTE') or has_function_privilege('anon','public.tally_admin_reset_angel(uuid,bigint,uuid,text)','EXECUTE') then raise exception 'reset exposed to client';end if;
 if has_table_privilege('authenticated','tally_private.admin_team_resets','SELECT') then raise exception 'backup exposed';end if;
end$$;
select set_config('request.jwt.claim.sub',current_setting('qa.userA'),true);
set local role authenticated;
do $$declare t uuid:=current_setting('qa.team')::uuid;d jsonb;begin
 begin perform public.tally_team_save(t,current_setting('qa.rev')::bigint,current_setting('qa.oldP')::jsonb,gen_random_uuid());raise exception 'stale P restored old data';exception when others then if sqlerrm<>'TALLY_CONFLICT' then raise;end if;end;
 d:=public.tally_matching_read(t);
 if jsonb_array_length(d#>'{egg_books,0,records}')<>0 or jsonb_array_length(d#>'{sales_books,0,records}')<>0 then raise exception 'comparison not zero';end if;
end$$;
select set_config('request.jwt.claim.sub',current_setting('qa.userD'),true);
do $$declare t uuid:=current_setting('qa.team')::uuid;v jsonb;s jsonb;begin
 begin perform public.tally_team_save(t,current_setting('qa.rev')::bigint,current_setting('qa.oldD')::jsonb,gen_random_uuid());raise exception 'stale D restored old data';exception when others then if sqlerrm<>'TALLY_CONFLICT' then raise;end if;end;
 v:=public.tally_team_read(t);s:=v->'payload';s:=jsonb_set(s,'{sales,records}',jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'itemId',s#>>'{sales,items,0,id}','delta',1,'kind','count','at',floor(extract(epoch from now())*1000))));
 perform public.tally_team_save(t,(v->>'revision')::bigint,s,gen_random_uuid());
end$$;
set local role service_role;
do $$declare ack jsonb;begin
 ack:=public.tally_admin_reset_angel(current_setting('qa.team')::uuid,current_setting('qa.rev')::bigint,current_setting('qa.reset')::uuid,'primary');
 if not (ack->>'replayed')::boolean then raise exception 'reset not idempotent';end if;
end$$;
reset role;
do $$begin
 if jsonb_array_length((select payload#>'{sales,records}' from tally_private.team_ledgers where team_id=current_setting('qa.team')::uuid))<>1 then raise exception 'retry wiped later sales';end if;
end$$;
