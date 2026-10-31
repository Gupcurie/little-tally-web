#!/usr/bin/env python3
"""Exercise the private API without printing passwords, tokens, or user data."""
import hashlib
import json
import secrets
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request,urlopen

env=dict(line.split('=',1) for line in Path('/opt/little-tally/stack/.env').read_text().splitlines()
 if line and not line.startswith('#') and '=' in line)
base='http://127.0.0.1:8000'
origin='http://127.0.0.1:8080'
anon=env['ANON_KEY']
admin=env['SERVICE_ROLE_KEY']
created=[]

def request(path,method='GET',body=None,token=None,key=None,source_origin=origin):
 headers={'apikey':key or anon,'Authorization':'Bearer '+(token or anon),
  'Origin':source_origin,'Content-Type':'application/json'}
 req=Request(base+path,method=method,headers=headers,
  data=None if body is None else json.dumps(body).encode())
 try:
  with urlopen(req,timeout=20) as r: status=r.status;raw=r.read()
 except HTTPError as e: status=e.code;raw=e.read()
 try: data=json.loads(raw) if raw else None
 except ValueError: data=None
 return status,data

def expect(status,allowed,step):
 if status not in allowed: raise RuntimeError(f'{step}: unexpected HTTP {status}')

def login(username,password):
 email='u'+hashlib.sha256(username.encode()).hexdigest()+'@users.little-tally.invalid'
 status,data=request('/auth/v1/token?grant_type=password','POST',{'email':email,'password':password})
 expect(status,[200],'password login')
 assert data and data.get('access_token') and data.get('user',{}).get('id')
 return data

try:
 for index,password in enumerate([str(secrets.randbelow(900000)+100000),
  ''.join(secrets.choice('abcdefghijklmnopqrstuvwxyz') for _ in range(12))]):
  username=f'qa_migrate_{int(time.time())}_{index}'
  status,data=request('/functions/v1/tally-accounts','POST',{'username':username,'password':password})
  expect(status,[200],'username registration')
  assert data=={'created':True}
  session=login(username,password)
  created.append({'username':username,'password':password,'id':session['user']['id'],'token':session['access_token']})
 print('PASS: numeric-only and alphabetic-only passwords register and log in.')
 a,b=created
 stamp=int(time.time()*1000)
 item_id=str(uuid.uuid4())
 snapshot={'format':'little-tally-pocket','version':1,'revision':0,
  'sales':{'book':'sales','items':[{'id':item_id,'name':'Migration check','color':0,'created':stamp,'breakdown':{}}],
   'records':[{'id':str(uuid.uuid4()),'itemId':item_id,'delta':1,'at':stamp,'kind':'count'}],'goal':None},
  'stock':{'book':'stock','items':[],'records':[],'goal':None}}
 mutation=str(uuid.uuid4())
 body={'p_expected_revision':0,'p_snapshot':snapshot,'p_mutation':mutation}
 status,saved=request('/rest/v1/rpc/tally_save','POST',body,token=a['token'])
 expect(status,[200],'save ledger');assert saved['revision']==1
 status,replayed=request('/rest/v1/rpc/tally_save','POST',body,token=a['token'])
 expect(status,[200],'idempotent save');assert replayed['revision']==1 and replayed['replayed']
 status,_=request('/rest/v1/rpc/tally_save','POST',{**body,'p_mutation':str(uuid.uuid4())},token=a['token'])
 expect(status,[400,409],'revision conflict protection')
 print('PASS: saving, retry protection, and revision conflict protection.')
 query='/rest/v1/tally_ledgers?select=user_id,payload,revision'
 status,own=request(query,token=a['token']);expect(status,[200],'read own ledger')
 assert len(own)==1 and own[0]['user_id']==a['id'] and own[0]['revision']==1
 status,other=request(query+'&user_id=eq.'+a['id'],token=b['token'])
 expect(status,[200],'cross-account isolation');assert other==[]
 status,_=request(query);expect(status,[401,403],'anonymous access denial')
 status,_=request('/rest/v1/tally_ledgers','POST',{'user_id':b['id'],'payload':snapshot,'revision':1,'last_mutation':str(uuid.uuid4())},token=b['token'])
 expect(status,[401,403],'direct table write denial')
 status,_=request('/functions/v1/tally-accounts','POST',{'username':'blocked_origin','password':'123456'},source_origin='https://untrusted.example.invalid')
 expect(status,[403],'registration origin restriction')
 print('PASS: account isolation, anonymous denial, direct-write denial, and origin restriction.')
 status,_=request('/auth/v1/logout?scope=local','POST',token=a['token'])
 expect(status,[200,204],'logout')
 again=login(a['username'],a['password'])
 status,restored=request(query,token=again['access_token'])
 expect(status,[200],'read after relogin')
 assert len(restored)==1 and restored[0]['payload']==own[0]['payload']
 print('PASS: the saved ledger remains identical after logout and login.')
finally:
 for user in created:
  status,_=request('/auth/v1/admin/users/'+user['id'],'PUT',{'ban_duration':'876000h'},token=admin,key=admin)
  expect(status,[200],'disable temporary QA account')
 if created: print('Temporary QA accounts disabled; original user accounts were not changed.')
