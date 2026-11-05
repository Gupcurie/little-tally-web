#!/usr/bin/env python3
"""Local bounded nginx audit collector and administrator-requested IP deny updater.
No network listener, no automatic IP bans, no request bodies/cookies/query strings.
"""
import pathlib,json,os,time,ipaddress,subprocess,hashlib,re
ROOT=pathlib.Path('/opt/little-tally');DATA=ROOT/'admin/data';NET=DATA/'network';SEC=ROOT/'security'
def write(path,value):
 tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8');os.chmod(tmp,0o640);os.chown(tmp,0,10001);os.replace(tmp,path)
def run(args):return subprocess.run(args,capture_output=True,text=True,timeout=20)
def event(entry):
 path=NET/'events.jsonl'
 if path.exists() and path.stat().st_size>20*1024*1024:
  for k in range(6,0,-1):
   old=NET/('events.'+str(k)+'.jsonl')
   if old.exists():os.replace(old,NET/('events.'+str(k+1)+'.jsonl'))
  os.replace(path,NET/'events.1.jsonl')
 with path.open('a',encoding='utf-8') as fh:fh.write(json.dumps(entry,ensure_ascii=False)+'\n')
 os.chown(path,0,10001);path.chmod(0o640)
REQUEST_KINDS={400:'请求格式错误',401:'未登录或登录未通过',403:'访问被拒绝',404:'资源不存在',405:'请求方式不允许',408:'请求超时',413:'请求体过大',429:'请求限速'}
def classify_request(x):
 status=int(x.get('status',0));uri=str(x.get('path',''))[:300];method=str(x.get('method',''))
 scan=bool(re.search(r'/(\.env|\.git|wp-admin|wp-login|phpmyadmin|etc/passwd|vendor/phpunit)',uri,re.I))
 if status==404 and method in ('GET','HEAD') and uri in ('/favicon.ico','/robots.txt'):return None
 kind='敏感路径探测' if scan else '服务器响应异常' if status>=500 else REQUEST_KINDS.get(status)
 if not kind:return None
 return {'at':float(x['at']),'ip':str(x['ip'])[:80],'kind':kind,'detail':method+' '+uri+' · HTTP '+str(status),'method':method,'path':uri,'status':status}

def main():
 NET.mkdir(exist_ok=True);SEC.mkdir(exist_ok=True)
 for p in [NET]:os.chown(p,0,10001);p.chmod(0o750)
 try:cursor=json.loads((SEC/'cursor.json').read_text())
 except (OSError,ValueError):cursor={'offset':0,'inode':0}
 last=None
 while True:
  try:
   raw=(DATA/'ip-blocks.json').read_text() if (DATA/'ip-blocks.json').exists() else '[]'
   if len(raw)>1024*1024:raise ValueError('IP list too large')
   addresses=sorted(set(str(ipaddress.ip_address(s)) for s in json.loads(raw)))
   if len(addresses)>10000:raise ValueError('IP list too large')
   digest=hashlib.sha256(json.dumps(addresses).encode()).hexdigest()
   if digest!=last:
    conf=SEC/'blocked.conf';before=conf.read_text() if conf.exists() else '';text=''.join('deny '+s+';\n' for s in addresses)
    tmp=SEC/'blocked.tmp';tmp.write_text(text);tmp.chmod(0o644);os.replace(tmp,conf)
    checked=run(['docker','exec','little-tally-web','nginx','-t'])
    if checked.returncode:
     conf.write_text(before);raise RuntimeError('nginx configuration check failed')
    reloaded=run(['docker','exec','little-tally-web','nginx','-s','reload'])
    if reloaded.returncode:conf.write_text(before);raise RuntimeError('nginx reload failed')
    last=digest;write(DATA/'security-status.json',{'status':'运行正常，手动封禁已应用','at':time.time(),'blocked':len(addresses)})
   path=NET/'access.jsonl'
   if path.exists():
    stat=path.stat()
    if stat.st_ino!=cursor['inode'] or stat.st_size<cursor['offset']:cursor={'offset':0,'inode':stat.st_ino}
    with path.open('rb') as fh:
     fh.seek(cursor['offset']);chunk=fh.read(2*1024*1024);end=chunk.rfind(b'\n')
    if end>=0:
     cursor['offset']+=end+1
     for line in chunk[:end+1].splitlines():
      try:
       entry=classify_request(json.loads(line))
       if entry is not None:event(entry)
      except (ValueError,TypeError,KeyError):pass
     write(SEC/'cursor.json',cursor)
    if stat.st_size>20*1024*1024 and cursor['offset']>=stat.st_size:
     # copy-truncate only this fixed audit file; keep its root-open nginx FD valid.
     with path.open('r+b') as fh:fh.truncate(0)
     cursor['offset']=0;write(SEC/'cursor.json',cursor)
   write(DATA/'security-status.json',{'status':'运行正常，手动封禁已应用','at':time.time(),'blocked':len(addresses)})
  except Exception as exc:
   write(DATA/'security-status.json',{'status':'安全服务需检查：'+str(exc)[:150],'at':time.time()})
  time.sleep(3)

if __name__=='__main__':main()
