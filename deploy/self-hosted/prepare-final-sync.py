#!/usr/bin/env python3
"""Build a transactional final sync while the application write RPC is locked."""
import argparse,json,os
from pathlib import Path

p=argparse.ArgumentParser()
p.add_argument('--input',default='/opt/little-tally/migration/final.json')
p.add_argument('--output',default='/opt/little-tally/migration/final-sync.sql')
p.add_argument('--commit',action='store_true')
a=p.parse_args()
os.umask(0o077)
d=json.loads(Path(a.input).read_text())
assert d['format']=='little-tally-migration-v1' and d['source_project']=='pinztkcvnaswsiorhaun'
assert d['users'] and all(isinstance(d[k],list) for k in ('users','identities','ledgers','backups'))
payload=json.dumps(d,ensure_ascii=True,separators=(',',':'))
assert '$final_payload$' not in payload
sql="""BEGIN;
SET LOCAL statement_timeout='60s';
DO $final$
DECLARE j jsonb := $final_payload$PAYLOAD$final_payload$::jsonb;
 item record; cols text; updates text; unknown_cols text;
BEGIN
 IF has_function_privilege('authenticated','public.tally_save(bigint,jsonb,uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'Target write lock required';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(j->'ledgers') s
  JOIN public.tally_ledgers l ON l.user_id=(s->>'user_id')::uuid
  WHERE l.revision>(s->>'revision')::bigint
   OR (l.revision=(s->>'revision')::bigint AND l.payload IS DISTINCT FROM s->'payload')) THEN
  RAISE EXCEPTION 'Target ledger diverged; manual reconciliation required';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(j->'backups') s
  JOIN tally_private.backups b ON b.user_id=(s->>'user_id')::uuid AND b.revision=(s->>'revision')::bigint
  WHERE b.payload IS DISTINCT FROM s->'payload') THEN
  RAISE EXCEPTION 'Backup revision diverged; manual reconciliation required';
 END IF;
 FOR item IN SELECT * FROM (VALUES
  ('users','auth.users','id'),('identities','auth.identities','id'),
  ('ledgers','public.tally_ledgers','user_id'),('backups','tally_private.backups','user_id,revision')
 ) t(key,table_name,conflict_cols)
 LOOP
  IF jsonb_array_length(j->item.key)=0 THEN CONTINUE; END IF;
  SELECT string_agg(k,', ' ORDER BY k) INTO unknown_cols
   FROM jsonb_object_keys(j->item.key->0) s(k)
   WHERE NOT EXISTS(SELECT 1 FROM pg_attribute x WHERE x.attrelid=item.table_name::regclass
    AND x.attname=k AND x.attnum>0 AND NOT x.attisdropped);
  IF unknown_cols IS NOT NULL THEN RAISE EXCEPTION 'Unknown source columns in %: %',item.table_name,unknown_cols; END IF;
  SELECT string_agg(format('%I',x.attname),',' ORDER BY x.attnum),
   string_agg(format('%I=EXCLUDED.%I',x.attname,x.attname),',' ORDER BY x.attnum)
   FILTER(WHERE NOT x.attname=ANY(string_to_array(item.conflict_cols,','))) INTO cols,updates
   FROM pg_attribute x WHERE x.attrelid=item.table_name::regclass
    AND x.attnum>0 AND NOT x.attisdropped AND x.attgenerated='' AND (j->item.key->0) ? x.attname;
  EXECUTE format('INSERT INTO %s (%s) SELECT %s FROM jsonb_populate_recordset(NULL::%s,$1) ON CONFLICT (%s) DO UPDATE SET %s',
   item.table_name,cols,cols,item.table_name,item.conflict_cols,updates) USING j->item.key;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(j->'users') s LEFT JOIN auth.users u ON u.id=(s->>'id')::uuid
  WHERE u.id IS NULL OR u.encrypted_password IS DISTINCT FROM s->>'encrypted_password') THEN
  RAISE EXCEPTION 'Final account verification failed';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(j->'ledgers') s LEFT JOIN public.tally_ledgers l ON l.user_id=(s->>'user_id')::uuid
  WHERE l.user_id IS NULL OR l.payload IS DISTINCT FROM s->'payload' OR l.revision IS DISTINCT FROM (s->>'revision')::bigint) THEN
  RAISE EXCEPTION 'Final ledger verification failed';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(j->'backups') s LEFT JOIN tally_private.backups b
  ON b.user_id=(s->>'user_id')::uuid AND b.revision=(s->>'revision')::bigint
  WHERE b.user_id IS NULL OR b.payload IS DISTINCT FROM s->'payload') THEN
  RAISE EXCEPTION 'Final backup verification failed';
 END IF;
 RAISE NOTICE 'Final accounts, password hashes, ledgers, and backups verified.';
END $final$;
""".replace('PAYLOAD',payload)
sql+='COMMIT;\n' if a.commit else 'ROLLBACK;\n'
out=Path(a.output);out.write_text(sql);out.chmod(0o600)
print('Prepared final sync', 'commit' if a.commit else 'rollback validation',
 {k:len(d[k]) for k in ('users','identities','ledgers','backups')})
