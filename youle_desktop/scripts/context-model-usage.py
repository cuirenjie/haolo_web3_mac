"""Read-only gateway billing evidence for one isolated live-model audit."""
import json, re, subprocess, sys
from pathlib import Path

directory=Path(sys.argv[1]).resolve()
request=json.loads((directory/'requests.json').read_text(encoding='utf-8'))
prefix=request['prefix']
assert re.fullmatch(r'ctx-(?:ab|long)-[0-9]{8}-[0-9a-f]{8}', prefix)
key_ids=[int(request['billingKeyId']),int(request['routeKeyId'])]
source=r'''
import datetime,json,subprocess
from pathlib import Path
def query(sql):
 p=subprocess.run(['docker','exec','-e','PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=15000','sub2api-postgres','psql','-X','-At','-v','ON_ERROR_STOP=1','-U','sub2api','-d','sub2api','-c',sql],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=25)
 if p.returncode:raise RuntimeError(p.stderr.decode()[-500:])
 return json.loads(p.stdout)
layout=json.loads(Path('/opt/sub2api-deploy/bluegreen-layout.json').read_text())
rows=query("""SELECT coalesce(json_agg(t),'[]'::json) FROM (SELECT id,created_at,request_id,interaction_id,conversation_id,api_key_id,model,requested_model,upstream_model,reasoning_effort,input_tokens,cache_read_tokens,output_tokens,input_cost,cache_read_cost,output_cost,actual_cost,rate_multiplier,source_type,inbound_endpoint,duration_ms,first_token_ms FROM usage_logs WHERE api_key_id IN (__KEYS__) AND interaction_id LIKE '__PREFIX__:%' ORDER BY id)t""")
wallet=query("""SELECT coalesce(json_agg(t),'[]'::json) FROM (SELECT u.id, to_jsonb(u)->'balance' balance,to_jsonb(u)->'subscription_balance' subscription_balance FROM users u WHERE u.id IN (SELECT user_id FROM api_keys WHERE id IN (__KEYS__)))t""")
print(json.dumps({'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'layout':{k:layout.get(k) for k in ['active','commit','last_release']},'rows':rows,'wallet':wallet}))
'''.replace('__KEYS__',','.join(map(str,key_ids))).replace('__PREFIX__',prefix)
args=['ssh','-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','IdentitiesOnly=yes','-o','ConnectTimeout=15','-i',str(Path.home()/'.ssh/codex_haolo_deploy_ed25519'),'-J','8.217.125.71','root@8.216.43.79','python3 -']
p=subprocess.run(args,input=source.encode('utf-8'),capture_output=True,timeout=55)
if p.returncode:raise RuntimeError(p.stderr.decode('utf-8','replace')[-800:])
data=json.loads(p.stdout)
(directory/'billing.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'observedAt':data['observedAt'],'rows':len(data['rows']),'ledgerCost':sum(r['actual_cost'] for r in data['rows']),'layout':data['layout'],'wallet':data['wallet']}))
