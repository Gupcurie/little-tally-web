#!/usr/bin/env python3
"""Connect the staged frontend to its loopback-only backend."""
import json
import subprocess
from pathlib import Path

stack=Path('/opt/little-tally/stack')
p=stack/'.env'
lines=p.read_text().splitlines()
env=dict(line.split('=',1) for line in lines if line and not line.startswith('#') and '=' in line)
image=subprocess.check_output(['docker','image','inspect','nginx:stable-alpine','--format','{{index .RepoDigests 0}}'],text=True).strip()
assert image.startswith('nginx@sha256:') and len(image.split(':')[-1])==64
updates={'TALLY_NGINX_IMAGE':image,
 'COMPOSE_FILE':'docker-compose.yml:docker-compose.override.yml:docker-compose.web.yml'}
lines=[line for line in lines if not any(line.startswith(k+'=') for k in updates)]
lines.extend(k+'='+v for k,v in updates.items())
p.write_text('\n'.join(lines)+'\n');p.chmod(0o600)
config={'authEnabled':True,'url':'http://127.0.0.1:8080',
 'publishableKey':env['ANON_KEY'],'registrationKey':env['ANON_KEY'],
 'redirectUrl':'http://127.0.0.1:8080/'}
out=Path('/opt/little-tally/app/dist/cloud-config.js')
out.write_text('// Public client configuration. No administrator credentials.\nexport const cloudConfig=Object.freeze('+json.dumps(config,separators=(',',':'))+');\n')
out.chmod(0o644)
assert env['SERVICE_ROLE_KEY'] not in out.read_text()
assert env['JWT_SECRET'] not in out.read_text()
print('Private frontend configured for same-origin API access; only public client keys included.')
