create function public.tally_team_leave(p_team_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();daily boolean;next_owner uuid;
 v_ip text:=btrim(split_part(coalesce(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-forwarded-for','server'),',',1));begin
 if u is null then raise exception 'TALLY_UNAUTHENTICATED';end if;
 if p_team_id is null then raise exception 'TALLY_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_team_id::text,0));
 -- Idempotent: repeating a leave cannot remove anyone else or duplicate the audit.
 if not tally_private.team_allowed(p_team_id) then return jsonb_build_object('ok',true,'already_left',true);end if;
 select exists(select 1 from tally_private.daily_rooms where team_id=p_team_id) into daily;
 delete from tally_private.team_members where team_id=p_team_id and user_id=u;
 if daily then
  if exists(select 1 from tally_private.daily_rooms where team_id=p_team_id and room_day=(clock_timestamp() at time zone 'Asia/Shanghai')::date) then perform tally_private.prune_daily_catalog(p_team_id);end if;
 elsif exists(select 1 from tally_private.teams where id=p_team_id and owner_id=u) then
  select user_id into next_owner from tally_private.team_members where team_id=p_team_id order by joined_at,user_id limit 1;
  if next_owner is not null then update tally_private.teams set owner_id=next_owner where id=p_team_id;end if;
 end if;
 insert into tally_private.security_events(ip,kind,detail) values(left(v_ip,80),'主动退出群','账号 '||u::text||' 退出群 '||p_team_id::text);
 return jsonb_build_object('ok',true);
end$$;
-- If an ordinary group became empty, the next valid member becomes its owner.
alter function public.tally_team_join(text) set schema tally_private;
alter function tally_private.tally_team_join(text) rename to pre_leave_join_v1;
revoke all on function tally_private.pre_leave_join_v1(text) from public,anon,authenticated,service_role;
create function public.tally_team_join(p_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;t uuid;begin
 result:=tally_private.pre_leave_join_v1(p_code);
 if result?'error' then return result;end if;
 t:=(result->>'id')::uuid;
 if not tally_private.team_allowed(t) then raise exception 'TALLY_TEAM_DENIED';end if;
 if not exists(select 1 from tally_private.daily_rooms where team_id=t) then
  update tally_private.teams g set owner_id=auth.uid() where g.id=t
  and not exists(select 1 from tally_private.team_members m where m.team_id=t and m.user_id=g.owner_id);
 end if;
 return result;
end$$;
revoke all on function public.tally_team_leave(uuid),public.tally_team_join(text) from public,anon;
grant execute on function public.tally_team_leave(uuid),public.tally_team_join(text) to authenticated;
notify pgrst,'reload schema';
