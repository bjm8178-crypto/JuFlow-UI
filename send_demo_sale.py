"""Send one labeled sample transaction, without building a cashier app."""
import argparse,json,uuid,urllib.request
from datetime import datetime,timezone
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8000);args=p.parse_args()
sale={'transaction_id':'demo-'+str(uuid.uuid4()),'device_id':'integration-test','sold_at':datetime.now(timezone.utc).isoformat(),'status':'completed','payment_method':'cash','demo':True,'items':[{'product_id':'pork-paksiw','name':'Pork Paksiw','quantity':1,'unit_price_centavos':7500}]}
token=(Path(__file__).parent/'.cashier-token').read_text().strip()
req=urllib.request.Request(f'http://localhost:{args.port}/api/cashier/sales',data=json.dumps(sale).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method='POST')
with urllib.request.urlopen(req) as r:print(r.read().decode())
print('Open Sales & reports and select Test transactions. The new sale will appear within 3 seconds.')
