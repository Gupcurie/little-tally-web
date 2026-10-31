-- Only the trusted registration function can consume these durable quotas.
create table tally_private.registration_limits (
 bucket text primary key,
 window_start timestamptz not null,
 attempts integer not null check(attempts>0)
);
alter table tally_private.registration_limits enable row level security;
revoke all on tally_private.registration_limits from public,anon,authenticated;
create function public.tally_registration_allow(p_username_hash text,p_ip_hash text)
returns boolean language plpgsql security definer set search_path='' as $$
declare w timestamptz:=date_trunc('hour',clock_timestamp()); b text; n integer; cap integer;
begin
 if p_username_hash!~'^[a-f0-9]{64}$' or p_ip_hash!~'^[a-f0-9]{64}$' then return false; end if;
 perform pg_advisory_xact_lock(782683499310);
 delete from tally_private.registration_limits where window_start<w-interval '2 hours';
 foreach b in array array['global','ip:'||p_ip_hash,'name:'||p_username_hash] loop
  cap:=case when b='global' then 30 when b like 'ip:%' then 8 else 3 end;
  insert into tally_private.registration_limits(bucket,window_start,attempts) values(b,w,1)
  on conflict(bucket) do update set attempts=case when registration_limits.window_start=w then registration_limits.attempts+1 else 1 end,window_start=w
  returning attempts into n;
  if n>cap then return false; end if;
 end loop;
 return true;
end;
$$;
revoke all on function public.tally_registration_allow(text,text) from public,anon,authenticated;
grant execute on function public.tally_registration_allow(text,text) to service_role;
