-- Synthetic accounts only. This body is always wrapped in BEGIN/migration/ROLLBACK.
-- Temporarily detach real rooms in this transaction so joining never targets user data.
delete from tally_private.daily_rooms;
insert into auth.users(id) values('931a0000-0000-4000-8000-000000000001'),('931a0000-0000-4000-8000-000000000002'),('931a0000-0000-4000-8000-000000000003'),('931a0000-0000-4000-8000-000000000004');
select set_config('qa.userA','931a0000-0000-4000-8000-000000000001',true),set_config('qa.userB','931a0000-0000-4000-8000-000000000002',true),set_config('qa.userD','931a0000-0000-4000-8000-000000000003',true);
select set_config('qa.template',jsonb_build_object('format','little-tally-pocket','version',1,'revision',0,'sales',tally_private.preset_book('sales',array['旧销售']),'stock',tally_private.preset_book('stock',array['旧库存']),'egg',tally_private.preset_book('egg',array['支架','扑克牌','娃衣']))::text,true);
select set_config('request.jwt.claim.sub',current_setting('qa.userA'),true);
set local role authenticated;
select set_config('qa.team',(public.tally_daily_join('angel','place',current_setting('qa.template')::jsonb)->>'id'),true);
do $$declare t uuid:=current_setting('qa.team')::uuid;v jsonb;s jsonb;id text;ack jsonb;begin
 v:=public.tally_team_read(t);s:=v->'payload';
 if s#>>'{egg,items,0,name}'<>'支架' or s#>>'{egg,items,1,name}'<>'扑克牌' then raise exception 'A names lost';end if;
 if jsonb_array_length(s#>'{sales,items}')<>0 or jsonb_array_length(s#>'{stock,items}')<>0 then raise exception 'P permissions';end if;
 id:=s#>>'{egg,items,0,id}';perform set_config('qa.item',id,true);
 s:=jsonb_set(s,'{egg,records}',jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'itemId',id,'delta',1,'kind','count','at',floor(extract(epoch from now())*1000))));
 ack:=public.tally_team_save(t,(v->>'revision')::bigint,s,gen_random_uuid());
 if ack#>>'{payload,egg,records,0,delta}'<>'1' then raise exception 'A quantity';end if;
 perform set_config('qa.Aview',(ack->'payload')::text,true);perform set_config('qa.global',ack->>'revision',true);
end$$;
select set_config('request.jwt.claim.sub',current_setting('qa.userB'),true);
select public.tally_daily_join('angel','place',jsonb_set(current_setting('qa.template')::jsonb,'{egg,items}',jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'name','磁吸支架','ratio',1,'color',0,'created',floor(extract(epoch from now())*1000)),jsonb_build_object('id',gen_random_uuid()::text,'name','扑克','ratio',1,'color',1,'created',floor(extract(epoch from now())*1000)))));
do $$declare t uuid:=current_setting('qa.team')::uuid;v jsonb;s jsonb;begin
 v:=public.tally_team_read(t);s:=v->'payload';
 if s#>>'{egg,items,0,name}'<>'磁吸支架' or s#>>'{egg,items,1,name}'<>'扑克' then raise exception 'B names lost';end if;
 if s#>>'{egg,items,0,id}'<>current_setting('qa.item') or s#>>'{egg,records,0,delta}'<>'1' then raise exception 'quantity not shared';end if;
 s:=jsonb_set(s,'{egg,items,0,name}','"我自己的支架"');
 perform public.tally_team_save(t,(v->>'revision')::bigint,s,gen_random_uuid());
 v:=public.tally_team_read(t);if v#>>'{payload,egg,items,0,name}'<>'我自己的支架' then raise exception 'private rename not kept';end if;
 perform public.tally_daily_stock_enabled(t,true);v:=public.tally_team_read(t);s:=v->'payload';
 s:=jsonb_set(s,'{stock,records}',jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'itemId',s#>>'{stock,items,0,id}','delta',7,'at',floor(extract(epoch from now())*1000),'kind','count')));
 perform public.tally_team_save(t,(v->>'revision')::bigint,s,gen_random_uuid());
end$$;
select set_config('request.jwt.claim.sub',current_setting('qa.userA'),true);
do $$declare v jsonb;begin
 v:=public.tally_team_read(current_setting('qa.team')::uuid);
 if v#>>'{payload,egg,items,0,name}'<>'支架' or jsonb_array_length(v#>'{payload,egg,records}')<>1 then raise exception 'B changed A name/count';end if;
 begin perform public.tally_team_save(current_setting('qa.team')::uuid,current_setting('qa.global')::bigint,current_setting('qa.Aview')::jsonb,gen_random_uuid());raise exception 'same-job stale accepted';exception when others then if sqlerrm<>'TALLY_CONFLICT' then raise;end if;end;
end$$;
select set_config('request.jwt.claim.sub',current_setting('qa.userD'),true);
select public.tally_daily_join('angel','dismantle',current_setting('qa.template')::jsonb);
do $$declare v jsonb;s jsonb;names text[];begin
 v:=public.tally_team_read(current_setting('qa.team')::uuid);s:=v->'payload';
 select array_agg(i->>'name' order by ord) into names from jsonb_array_elements(s#>'{sales,items}') with ordinality as x(i,ord);
 if names<>array['T恤','红娃衣','黑娃衣','扑克','拼图','磁吸支架','掼蛋','便利贴','冰箱贴','盆栽','鼠标垫'] then raise exception 'D defaults';end if;
 if jsonb_array_length(s#>'{egg,items}')<>0 or (s::text like '%recommendation%') then raise exception 'D leaked future';end if;
 perform set_config('qa.Dview',s::text,true);perform set_config('qa.Drev',v->>'revision',true);
 s:=jsonb_set(s,'{egg}',current_setting('qa.template')::jsonb->'egg');
 begin perform public.tally_team_save(current_setting('qa.team')::uuid,(v->>'revision')::bigint,s,gen_random_uuid());raise exception 'D egg write accepted';exception when others then if sqlerrm<>'TALLY_DAILY_FORBIDDEN' then raise;end if;end;
end$$;
select set_config('request.jwt.claim.sub',current_setting('qa.userA'),true);
do $$declare v jsonb;s jsonb;begin
 v:=public.tally_team_read(current_setting('qa.team')::uuid);s:=v->'payload';perform public.tally_team_save(current_setting('qa.team')::uuid,(v->>'revision')::bigint,s,gen_random_uuid());
 s:=jsonb_set(s,'{sales}',current_setting('qa.template')::jsonb->'sales');
 begin perform public.tally_team_save(current_setting('qa.team')::uuid,(v->>'revision')::bigint,s,gen_random_uuid());raise exception 'P sale write accepted';exception when others then if sqlerrm not in ('TALLY_DAILY_FORBIDDEN','TALLY_CONFLICT') then raise;end if;end;
end$$;
select set_config('request.jwt.claim.sub',current_setting('qa.userD'),true);
do $$declare s jsonb:=current_setting('qa.Dview')::jsonb;ack jsonb;m uuid:=gen_random_uuid();t uuid:=current_setting('qa.team')::uuid;begin
 s:=jsonb_set(s,'{sales,records}',jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'itemId',s#>>'{sales,items,5,id}','delta',1,'kind','count','at',floor(extract(epoch from now())*1000))));
 ack:=public.tally_team_save(t,current_setting('qa.Drev')::bigint,s,m);
 if jsonb_array_length(ack#>'{payload,sales,records}')<>1 then raise exception 'opposite role interleaving';end if;
 ack:=public.tally_team_save(t,current_setting('qa.Drev')::bigint,s,m);if not (ack->>'replayed')::boolean then raise exception 'replay not recognized';end if;
end$$;
-- Mapping uses canonical IDs, works across private names, changes neither quantities nor ledger revision.
do $$declare d jsonb;config jsonb;out jsonb;rev bigint;t uuid:=current_setting('qa.team')::uuid;begin
 d:=public.tally_matching_read(t);rev:=(d->>'revision')::bigint;
 if d::text like '%recommendation%' or d::text like '%placementStock%' or d::text like '%randomSeed%' then raise exception 'matching leaked restricted data';end if;
 config:=jsonb_build_object('version',1,'groups',jsonb_build_array(jsonb_build_object('sales',jsonb_build_array(d#>>'{ids,sales,0}',d#>>'{ids,sales,1}'),'egg',jsonb_build_array(d#>>'{ids,egg,0}'))),'singles',jsonb_build_object('sales',(d#>'{ids,sales}')-0-0,'egg',(d#>'{ids,egg}')-0));
 out:=public.tally_matching_save(t,config,d->>'signature',d->>'hash');
 if out->>'revision'<>rev::text or out->>'hash'='' then raise exception 'mapping changed quantity revision';end if;
 begin perform public.tally_matching_save(t,config,d->>'signature',d->>'hash');raise exception 'mapping stale accepted';exception when others then if sqlerrm<>'TALLY_MATCHING_CONFLICT' then raise;end if;end;
 begin perform public.tally_matching_save(t,config,'old-signature',out->>'hash');raise exception 'changed types accepted';exception when others then if sqlerrm<>'TALLY_MATCHING_CHANGED' then raise;end if;end;
 config:=jsonb_set(config,'{singles,egg}','[]');
 begin perform public.tally_matching_save(t,config,out->>'signature',out->>'hash');raise exception 'incomplete accepted';exception when others then if sqlerrm<>'TALLY_MATCHING_INCOMPLETE' then raise;end if;end;
 config:=jsonb_set(out->'config','{groups,0,sales}',jsonb_build_array(d#>>'{ids,sales,0}',d#>>'{ids,sales,0}'));
 begin perform public.tally_matching_save(t,config,out->>'signature',out->>'hash');raise exception 'duplicate accepted';exception when others then if sqlerrm<>'TALLY_MATCHING_INCOMPLETE' then raise;end if;end;
end$$;
select set_config('request.jwt.claim.sub','931a0000-0000-4000-8000-000000000004',true);
do $$begin
 begin perform public.tally_matching_read(current_setting('qa.team')::uuid);raise exception 'outsider read';exception when others then if sqlerrm<>'TALLY_TEAM_DENIED' then raise;end if;end;
 begin perform public.tally_matching_save(current_setting('qa.team')::uuid,'{}','','');raise exception 'outsider write';exception when others then if sqlerrm<>'TALLY_TEAM_DENIED' then raise;end if;end;
end$$;
-- Empty/new account gets exactly the ten placement presets.
select set_config('qa.newteam',(public.tally_daily_join('devil','place',jsonb_set(current_setting('qa.template')::jsonb,'{egg,items}','[]'))->>'id'),true);
do $$declare v jsonb;names text[];begin
 v:=public.tally_team_read(current_setting('qa.newteam')::uuid);
 select array_agg(i->>'name' order by ord) into names from jsonb_array_elements(v#>'{payload,egg,items}') with ordinality as x(i,ord);
 if names<>array['鼠标垫','盆栽','便利贴','冰箱贴','拼图','扑克','掼蛋','娃衣','磁吸支架','T恤'] then raise exception 'new P presets';end if;
 if jsonb_array_length(v#>'{payload,egg,records}')<>0 then raise exception 'imported quantities';end if;
end$$;
-- Personal configurations are separate from the shared team and keep ledger revision unchanged.
select public.tally_save(0,current_setting('qa.template')::jsonb,gen_random_uuid());
do $$declare d jsonb;config jsonb;out jsonb;begin
 d:=public.tally_matching_read(null);
 if d->>'hash'<>'' then raise exception 'team mapping leaked to personal';end if;
 config:=jsonb_build_object('version',1,'groups','[]'::jsonb,'singles',d->'ids');
 out:=public.tally_matching_save(null,config,d->>'signature',d->>'hash');
 if out->>'revision'<>d->>'revision' then raise exception 'personal revision changed';end if;
 begin perform public.tally_matching_save(null,config-'version',out->>'signature',out->>'hash');raise exception 'missing version accepted';exception when others then if sqlerrm<>'TALLY_INVALID' then raise;end if;end;
end$$;
reset role;
do $$begin
 if has_function_privilege('authenticated','tally_private.role_save_v1(uuid,bigint,jsonb,uuid)','EXECUTE') then raise exception 'private save bypass';end if;
 if has_function_privilege('anon','public.tally_matching_read(uuid)','EXECUTE') then raise exception 'anonymous matching';end if;
 if has_table_privilege('authenticated','tally_private.matching_configs','SELECT') then raise exception 'mapping table exposed';end if;
 if (select payload#>>'{placementStock,records,0,delta}' from tally_private.team_ledgers where team_id=current_setting('qa.team')::uuid)<>'7' then raise exception 'independent stock lost';end if;
end$$;
do $$declare b jsonb;pref jsonb;r jsonb;begin
 b:=tally_private.preset_book('egg',array['支架']);pref:=tally_private.preset_book('egg',array['磁吸支架','支架'])->'items';
 r:=tally_private.prepare_labels(b,pref,true);
 if jsonb_array_length(r#>'{book,items}')<>2 or (select count(*) from jsonb_each(r->'labels'))<>2 then raise exception 'two distinct original categories collapsed';end if;
end$$;
