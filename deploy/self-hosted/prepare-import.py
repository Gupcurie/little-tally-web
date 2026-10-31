#!/usr/bin/env python3
"""Create a private SQL import for a fresh staging database; never prints data."""
import argparse
import json
import os
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--input',default='/opt/little-tally/migration/preliminary.json')
parser.add_argument('--output',default='/opt/little-tally/migration/import.sql')
parser.add_argument('--commit',action='store_true')
args=parser.parse_args()
os.umask(0o077)
data=json.loads(Path(args.input).read_text())
assert data['format']=='little-tally-migration-v1'
assert data['source_project']=='pinztkcvnaswsiorhaun'
for key in ['users','identities','ledgers','backups']:
 assert isinstance(data[key],list)
assert data['users']
payload=json.dumps(data,ensure_ascii=True,separators=(',',':'))
assert '$migration_payload$' not in payload
sql="""BEGIN;
SET LOCAL statement_timeout='60s';
DO $migration$
DECLARE
 j jsonb := $migration_payload$PAYLOAD$migration_payload$::jsonb;
 item record;
 columns_sql text;
 unsupported text;
 target_count bigint;
 inserted_count bigint;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('users','auth.users'),('identities','auth.identities'),
  ('ledgers','public.tally_ledgers'),('backups','tally_private.backups')
 ) AS tables(key,table_name)
 LOOP
  EXECUTE format('SELECT count(*) FROM %s',item.table_name) INTO target_count;
  IF target_count<>0 THEN RAISE EXCEPTION 'Fresh target required: %',item.table_name; END IF;
  IF jsonb_array_length(j->item.key)=0 THEN CONTINUE; END IF;
  SELECT string_agg(k,', ' ORDER BY k) INTO unsupported
   FROM jsonb_object_keys(j->item.key->0) AS source(k)
   WHERE NOT EXISTS(SELECT 1 FROM pg_attribute a
    WHERE a.attrelid=item.table_name::regclass AND a.attname=k
     AND a.attnum>0 AND NOT a.attisdropped);
  IF unsupported IS NOT NULL THEN
   RAISE EXCEPTION 'Review unsupported source columns in %: %',item.table_name,unsupported;
  END IF;
  SELECT string_agg(format('%I',a.attname),',' ORDER BY a.attnum) INTO columns_sql
   FROM pg_attribute a WHERE a.attrelid=item.table_name::regclass
    AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated=''
    AND (j->item.key->0) ? a.attname;
  EXECUTE format('INSERT INTO %s (%s) SELECT %s FROM jsonb_populate_recordset(NULL::%s,$1)',
   item.table_name,columns_sql,columns_sql,item.table_name) USING j->item.key;
  GET DIAGNOSTICS inserted_count=ROW_COUNT;
  IF inserted_count<>jsonb_array_length(j->item.key) THEN
   RAISE EXCEPTION 'Row count mismatch in %',item.table_name;
  END IF;
  RAISE NOTICE 'Imported % rows into %',inserted_count,item.table_name;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(j->'users') x
  JOIN auth.users u ON u.id=(x->>'id')::uuid
  WHERE u.encrypted_password IS DISTINCT FROM x->>'encrypted_password') THEN
  RAISE EXCEPTION 'Password hash verification failed';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(j->'ledgers') x
  JOIN public.tally_ledgers l ON l.user_id=(x->>'user_id')::uuid
  WHERE l.payload IS DISTINCT FROM x->'payload'
   OR l.revision IS DISTINCT FROM (x->>'revision')::bigint) THEN
  RAISE EXCEPTION 'Ledger verification failed';
 END IF;
END $migration$;
""".replace('PAYLOAD',payload)
sql+='COMMIT;\n' if args.commit else 'ROLLBACK;\n'
out=Path(args.output)
out.write_text(sql)
out.chmod(0o600)
print('Prepared private', 'commit' if args.commit else 'rollback validation', 'SQL; counts:',
 {k:len(data[k]) for k in ['users','identities','ledgers','backups']})
