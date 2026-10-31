#!/usr/bin/env python3
import json
from pathlib import Path

root=Path('/opt/little-tally')
stack=root/'stack'
p=stack/'.env'
lines=p.read_text().splitlines()
env=dict(line.split('=',1) for line in lines if line and not line.startswith('#') and '=' in line)
origin='https://43.142.19.116'
updates={'SITE_URL':origin,'SUPABASE_PUBLIC_URL':origin,'API_EXTERNAL_URL':origin+'/auth/v1',
 'TALLY_ALLOWED_ORIGINS':','.join([origin,'https://gupcurie.github.io','https://little-tally-pocket-455b.sharp-wave-4678.chatgpt.site','http://127.0.0.1:8080','http://localhost:8080']),
 'COMPOSE_FILE':'docker-compose.yml:docker-compose.override.yml:docker-compose.web.yml:docker-compose.ip-test.yml'}
lines=[line for line in lines if not any(line.startswith(k+'=') for k in updates)]
lines.extend(k+'='+v for k,v in updates.items())
p.write_text('\n'.join(lines)+'\n');p.chmod(0o600)
config={'authEnabled':True,'url':origin,'publishableKey':env['ANON_KEY'],
 'registrationKey':env['ANON_KEY'],'redirectUrl':origin+'/'}
out=root/'app/dist/cloud-config.js'
out.write_text('// Public configuration. No administrator credentials.\nexport const cloudConfig=Object.freeze('+json.dumps(config,separators=(',',':'))+');\n')
out.chmod(0o644)
source=(stack/'private-web.conf').read_text()
tls=source.replace('listen 80;','listen 443 ssl;\n    ssl_certificate /etc/letsencrypt/live/little-tally-ip-test/fullchain.pem;\n    ssl_certificate_key /etc/letsencrypt/live/little-tally-ip-test/privkey.pem;\n    ssl_protocols TLSv1.2 TLSv1.3;',1)
tls=tls.replace('server_name _;','server_name 43.142.19.116;',1)
plain='''server {
    listen 80;
    server_name 43.142.19.116;
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type text/plain;
        try_files $uri =404;
    }
    location / { return 301 https://43.142.19.116$request_uri; }
}
server {
    listen 81;
    server_name localhost;
    allow 127.0.0.1;
    deny all;
    root /usr/share/nginx/html;
    location = /health.json { try_files $uri =404; }
    location / { return 404; }
}
'''
(stack/'ip-test-web.conf').write_text(plain+tls)
(stack/'ip-test-web.conf').chmod(0o644)
assert env['SERVICE_ROLE_KEY'] not in out.read_text() and env['JWT_SECRET'] not in out.read_text()
print('IP test frontend prepared; HTTP redirects to HTTPS and management endpoints remain private.')
