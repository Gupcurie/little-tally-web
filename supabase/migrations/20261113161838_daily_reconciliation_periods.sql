-- Admin-only read of today's closed segments. Private period tables remain private.
-- No auth user, anonymous client, or group member can invoke this service endpoint.
create function public.tally_admin_comparison_periods(p_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare out jsonb; start_ms numeric:=extract(epoch from (date_trunc('day',now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'))*1000;
begin
 if p_ids is null or cardinality(p_ids)<1 or cardinality(p_ids)>2 then raise exception 'TALLY_INVALID';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'source_id',coalesce(p.team_id,p.owner_id),'startedAt',floor(extract(epoch from p.started_at)*1000),'endedAt',floor(extract(epoch from p.ended_at)*1000),
  'payload',jsonb_build_object(
   'egg',jsonb_build_object('items',coalesce(p.payload#>'{egg,items}','[]'), 'records',(select coalesce(jsonb_agg(r),'[]') from jsonb_array_elements(coalesce(p.payload#>'{egg,records}','[]'))r where (r->>'at')::numeric>=start_ms)),
   'sales',jsonb_build_object('items',coalesce(p.payload#>'{sales,items}','[]'), 'records',(select coalesce(jsonb_agg(r),'[]') from jsonb_array_elements(coalesce(p.payload#>'{sales,records}','[]'))r where (r->>'at')::numeric>=start_ms))
  )) order by p.ended_at),'[]') into out
 from tally_private.periods p where p.ended_at>=to_timestamp(start_ms/1000) and coalesce(p.team_id,p.owner_id)=any(p_ids);
 return out;
end$$;
revoke all on function public.tally_admin_comparison_periods(uuid[]) from public,anon,authenticated;
grant execute on function public.tally_admin_comparison_periods(uuid[]) to service_role;
notify pgrst,'reload schema';
