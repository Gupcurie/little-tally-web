-- Run after matching-database.sql inside the same rollback transaction.
reset role;
select set_config('qa.code',(select lpad(i::text,4,'0') from generate_series(8000,8999)i where not exists(select 1 from tally_private.team_codes where code_day=(clock_timestamp() at time zone 'Asia/Shanghai')::date and code_hash=sha256(convert_to(code_day::text||lpad(i::text,4,'0'),'UTF8'))) limit 1),true);
select set_config('request.jwt.claim.sub',current_setting('qa.userA'),true);
set local role authenticated;
select set_config('qa.normal',(public.tally_team_create('leave transaction only',current_setting('qa.code'),current_setting('qa.template')::jsonb)->>'id'),true);
select set_config('request.jwt.claim.sub',current_setting('qa.userB'),true);
select public.tally_team_join(current_setting('qa.code'));
select set_config('request.jwt.claim.sub',current_setting('qa.userA'),true);
select public.tally_team_leave(current_setting('qa.normal')::uuid);
do $$declare t uuid:=current_setting('qa.normal')::uuid;begin
 if not (public.tally_team_leave(t)->>'already_left')::boolean then raise exception 'leave retry not idempotent';end if;
 begin perform public.tally_team_read(t);raise exception 'left member could read group';exception when others then if sqlerrm<>'TALLY_TEAM_DENIED' then raise;end if;end;
 begin perform public.tally_matching_read(t);raise exception 'left member could compare';exception when others then if sqlerrm<>'TALLY_TEAM_DENIED' then raise;end if;end;
end$$;
select set_config('request.jwt.claim.sub',current_setting('qa.userB'),true);
do $$begin
 if public.tally_team_details(current_setting('qa.normal')::uuid)->>'owner_id'<>current_setting('qa.userB') then raise exception 'remaining member did not inherit owner';end if;
end$$;
select public.tally_team_leave(current_setting('qa.normal')::uuid);
select set_config('request.jwt.claim.sub',current_setting('qa.userA'),true);
select public.tally_team_join(current_setting('qa.code'));
do $$begin
 if public.tally_team_details(current_setting('qa.normal')::uuid)->>'owner_id'<>current_setting('qa.userA') then raise exception 'empty group first rejoin owner';end if;
end$$;
-- Daily-room voluntary leave is distinct from kicking and permits a later explicit rejoin.
select public.tally_team_leave(current_setting('qa.team')::uuid);
do $$begin
 begin perform public.tally_daily_comparison(current_setting('qa.team')::uuid);raise exception 'left daily member could compare';exception when others then if sqlerrm<>'TALLY_TEAM_DENIED' then raise;end if;end;
end$$;
select public.tally_daily_join('angel','dismantle',current_setting('qa.template')::jsonb);
select set_config('request.jwt.claim.sub','931a0000-0000-4000-8000-000000000004',true);
select public.tally_team_leave(current_setting('qa.normal')::uuid);
reset role;
do $$begin
 if not exists(select 1 from tally_private.team_members where team_id=current_setting('qa.normal')::uuid and user_id=current_setting('qa.userA')::uuid) then raise exception 'outsider leave removed another member';end if;
 if not exists(select 1 from tally_private.daily_memberships where team_id=current_setting('qa.team')::uuid and user_id=current_setting('qa.userA')::uuid) then raise exception 'daily explicit rejoin not allowed';end if;
 if jsonb_array_length((select payload#>'{egg,records}' from tally_private.team_ledgers where team_id=current_setting('qa.team')::uuid))<>1 then raise exception 'daily records removed';end if;
 if has_function_privilege('anon','public.tally_team_leave(uuid)','EXECUTE') then raise exception 'anonymous leave';end if;
 if has_function_privilege('authenticated','tally_private.pre_leave_join_v1(text)','EXECUTE') then raise exception 'join helper bypass exposed';end if;
end$$;
