-- Append after matching-database.sql, inside the same synthetic BEGIN/ROLLBACK.
select set_config('request.jwt.claim.sub',current_setting('qa.userA'),true);
set local role authenticated;
do $$declare v jsonb;s jsonb;m uuid:=gen_random_uuid();t uuid:=current_setting('qa.team')::uuid;begin
 v:=public.tally_team_read(t);s:=jsonb_set(v->'payload','{egg,items,0,name}','"娃衣q"');
 perform set_config('qa.renameSnapshot',s::text,true);perform set_config('qa.renameRevision',v->>'revision',true);perform set_config('qa.renameMutation',m::text,true);
 perform public.tally_team_save(t,(v->>'revision')::bigint,s,m);
end$$;
select set_config('request.jwt.claim.sub',current_setting('qa.userD'),true);
do $$declare d jsonb;t uuid:=current_setting('qa.team')::uuid;begin
 d:=public.tally_daily_comparison(t);
 if d#>>'{egg,items,0,name}'<>'娃衣q' then raise exception 'D did not receive P rename';end if;
 d:=public.tally_matching_read(t);
 if d#>>'{egg_books,0,items,0,name}'<>'娃衣q' then raise exception 'matching RPC kept canonical name';end if;
 if d::text like '%recommendation%' or d::text like '%placementStock%' then raise exception 'restricted data leak';end if;
 if jsonb_array_length(public.tally_team_read(t)#>'{payload,egg,items}')<>0 then raise exception 'D egg permission relaxed';end if;
end$$;
-- Another placement user's regular count/plan save must not restore their private name in comparison.
select set_config('request.jwt.claim.sub',current_setting('qa.userB'),true);
do $$declare v jsonb;s jsonb;t uuid:=current_setting('qa.team')::uuid;begin
 v:=public.tally_team_read(t);s:=v->'payload';
 if s#>>'{egg,items,0,name}'<>'我自己的支架' then raise exception 'private cards unexpectedly renamed';end if;
 perform public.tally_team_save(t,(v->>'revision')::bigint,s,gen_random_uuid());
 if public.tally_daily_comparison(t)#>>'{egg,items,0,name}'<>'娃衣q' then raise exception 'ordinary save reverted shared name';end if;
 s:=public.tally_team_read(t)->'payload';s:=jsonb_set(s,'{egg,items,0,name}','"娃衣r"');
 perform public.tally_team_save(t,(v->>'revision')::bigint,s,gen_random_uuid());
 if public.tally_daily_comparison(t)#>>'{egg,items,0,name}'<>'娃衣r' then raise exception 'second explicit rename not shared';end if;
end$$;
select set_config('request.jwt.claim.sub',current_setting('qa.userA'),true);
do $$declare t uuid:=current_setting('qa.team')::uuid;ack jsonb;begin
 ack:=public.tally_team_save(t,current_setting('qa.renameRevision')::bigint,current_setting('qa.renameSnapshot')::jsonb,current_setting('qa.renameMutation')::uuid);
 if not (ack->>'replayed')::boolean then raise exception 'replay protection lost';end if;
 if public.tally_daily_comparison(t)#>>'{egg,items,0,name}'<>'娃衣r' then raise exception 'replayed rename reverted newest name';end if;
 if public.tally_team_read(t)#>>'{payload,egg,items,0,name}'<>'娃衣q' then raise exception 'A personal card name lost';end if;
end$$;
reset role;
do $$begin
 if has_table_privilege('authenticated','tally_private.comparison_names','SELECT') then raise exception 'name table exposed';end if;
 if has_function_privilege('anon','public.tally_daily_comparison(uuid)','EXECUTE') then raise exception 'anonymous comparison';end if;
end$$;
