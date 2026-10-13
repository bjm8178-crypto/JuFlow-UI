"""Juki local admin prototype + cashier sales receiver. Python stdlib only."""
import argparse, calendar, hashlib, hmac, json, mimetypes, os, secrets, sqlite3
import auth
from contextlib import closing
from datetime import datetime, timedelta, timezone, date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote
ROOT=Path(__file__).resolve().parent
TZ=timezone(timedelta(hours=8))
DB=ROOT/'.juflow-sales.sqlite3'
TOKEN=''

def connect():
 c=sqlite3.connect(DB,timeout=10);c.row_factory=sqlite3.Row
 c.execute('CREATE TABLE IF NOT EXISTS sales (id TEXT PRIMARY KEY, digest TEXT NOT NULL, sold_at TEXT NOT NULL, received_at TEXT NOT NULL, demo INTEGER NOT NULL, total INTEGER NOT NULL, payload TEXT NOT NULL)')
 return c

def clean_sale(d):
 if not isinstance(d,dict):raise ValueError('JSON object required')
 def text(key,maxlen=120):
  x=d.get(key)
  if not isinstance(x,str) or not x.strip() or len(x)>maxlen:raise ValueError('Invalid '+key)
  return x.strip()
 sale={'transaction_id':text('transaction_id'),'device_id':text('device_id'),'payment_method':text('payment_method')}
 if sale['payment_method'] not in ('cash','gcash'):raise ValueError('Payment must be cash or gcash')
 raw=text('sold_at',50)
 try:dt=datetime.fromisoformat(raw.replace('Z','+00:00'))
 except ValueError:raise ValueError('sold_at must be an ISO timestamp')
 if dt.tzinfo is None:raise ValueError('sold_at must include timezone')
 if dt>datetime.now(timezone.utc)+timedelta(minutes=5):raise ValueError('sold_at cannot be in the future')
 sale['sold_at']=dt.astimezone(TZ).isoformat()
 demo=d.get('demo',False)
 if type(demo) is not bool:raise ValueError('demo must be boolean')
 sale['demo']=demo
 items=d.get('items')
 if not isinstance(items,list) or not 1<=len(items)<=100:raise ValueError('Provide 1 to 100 items')
 sale['items']=[]
 for i in items:
  if not isinstance(i,dict):raise ValueError('Invalid item')
  name=i.get('name');sku=i.get('product_id');qty=i.get('quantity');price=i.get('unit_price_centavos')
  if not isinstance(name,str) or not name.strip() or len(name)>120 or not isinstance(sku,str) or not sku.strip() or len(sku)>120:raise ValueError('Item needs name and product_id')
  if type(qty) is not int or not 1<=qty<=999 or type(price) is not int or not 1<=price<=10000000:raise ValueError('Invalid quantity or unit price')
  sale['items'].append({'product_id':sku.strip(),'name':name.strip(),'quantity':qty,'unit_price_centavos':price})
 # A completed paid sale is the sole supported event. Orders/preparation never add revenue.
 if d.get('status')!='completed':raise ValueError('Only completed paid sales are accepted')
 sale['status']='completed'
 return sale

def record(d):
 sale=clean_sale(d);body=json.dumps(sale,sort_keys=True,separators=(',',':'));digest=hashlib.sha256(body.encode()).hexdigest()
 total=sum(i['quantity']*i['unit_price_centavos'] for i in sale['items'])
 with closing(connect()) as c, c:
  c.execute('BEGIN IMMEDIATE')
  old=c.execute('SELECT digest FROM sales WHERE id=?',(sale['transaction_id'],)).fetchone()
  if old:
   if old['digest']!=digest:raise FileExistsError('Transaction ID already exists with different content')
   return {'accepted':True,'duplicate':True,'transaction_id':sale['transaction_id']}
  c.execute('INSERT INTO sales VALUES (?,?,?,?,?,?,?)',(sale['transaction_id'],digest,sale['sold_at'],datetime.now(TZ).isoformat(),int(sale['demo']),total,body))
 return {'accepted':True,'duplicate':False,'transaction_id':sale['transaction_id']}

def summary(day,demo=False):
 selected=date.fromisoformat(day);seven=(selected-timedelta(days=6)).isoformat();month=selected.replace(day=1).isoformat();earliest=min(seven,month)
 with closing(connect()) as c, c:rows=c.execute('SELECT * FROM sales WHERE demo=? AND substr(sold_at,1,10)>=? AND substr(sold_at,1,10)<=? ORDER BY sold_at DESC,id',(int(demo),earliest,day)).fetchall()
 todays=[r for r in rows if r['sold_at'][:10]==day];products={};hours=[0]*24;feed=[];units=0;payments={'cash':0,'gcash':0}
 for r in todays:
  sale=json.loads(r['payload']);payments[sale['payment_method']]+=r['total'];hours[datetime.fromisoformat(r['sold_at']).hour]+=r['total']
  for i in sale['items']:
   units+=i['quantity'];p=products.setdefault(i['product_id'],{'name':i['name'],'quantity':0,'revenue_centavos':0});p['quantity']+=i['quantity'];p['revenue_centavos']+=i['quantity']*i['unit_price_centavos']
  if len(feed)<50:feed.append({**sale,'total_centavos':r['total'],'received_at':r['received_at']})
 return {'date':day,'timezone':'Asia/Manila (UTC+08:00)','demo':demo,'total_centavos':sum(r['total'] for r in todays),'transaction_count':len(todays),'units_sold':units,'last_7_days_centavos':sum(r['total'] for r in rows if r['sold_at'][:10]>=seven),'month_to_date_centavos':sum(r['total'] for r in rows if r['sold_at'][:10]>=month),'products':sorted(products.values(),key=lambda p:p['quantity'],reverse=True),'hourly_centavos':hours,'payments_centavos':payments,'transactions':feed,'generated_at':datetime.now(TZ).isoformat()}

class Handler(BaseHTTPRequestHandler):
 def json_response(self,code,payload):
  b=json.dumps(payload).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(b)));self.send_header('Cache-Control','no-store');self.end_headers()
  if getattr(self,'command',None)!='HEAD':self.wfile.write(b)
 def do_GET(self):
  if auth.handle(self,'GET',self.path):return
  if auth.gate(self,'GET',self.path):return
  self.serve_get()
 def do_HEAD(self):
  if auth.handle(self,'HEAD',self.path):return
  if auth.gate(self,'HEAD',self.path):return
  self.serve_get()
 def serve_get(self):
  u=urlparse(self.path)
  if u.path=='/api/sales/summary':
   q=parse_qs(u.query)
   try:self.json_response(200,summary(q.get('date',[datetime.now(TZ).date().isoformat()])[0],q.get('demo',['0'])[0]=='1'))
   except ValueError:self.json_response(400,{'error':'Invalid date: use YYYY-MM-DD'})
   return
  if u.path=='/api/health':self.json_response(200,{'status':'ok','mode':'local-admin-prototype'});return
  name=unquote(u.path).lstrip('/') or 'index.html'
  # Never serve the SQLite database, private token, Python source, or arbitrary paths.
  f=ROOT/name
  if '/' in name or '\\' in name or ':' in name or name.startswith('.') or f.suffix not in ('.html','.css','.js','.png','.svg','.jpg','.ico') or f.is_symlink() or not f.is_file():self.send_error(404);return
  b=f.read_bytes();self.send_response(200);self.send_header('Content-Type',mimetypes.guess_type(name)[0] or 'application/octet-stream');self.send_header('Content-Length',str(len(b)));self.send_header('X-Content-Type-Options','nosniff');self.end_headers()
  if getattr(self,'command',None)!='HEAD':self.wfile.write(b)
 def do_POST(self):
  if auth.handle(self,'POST',self.path):return
  if auth.gate(self,'POST',self.path):return
  if urlparse(self.path).path!='/api/cashier/sales':self.json_response(404,{'error':'Not found'});return
  if not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+TOKEN):self.json_response(401,{'error':'Cashier API token required'});return
  try:
   size=int(self.headers.get('Content-Length','0'))
   if not 0<size<=65536:raise ValueError('Body must be between 1 and 65536 bytes')
   payload=json.loads(self.rfile.read(size));result=record(payload);self.json_response(200 if result['duplicate'] else 201,result)
  except FileExistsError as e:self.json_response(409,{'error':str(e)})
  except (ValueError,UnicodeError) as e:self.json_response(400,{'error':str(e)})
  except sqlite3.Error:self.json_response(503,{'error':'Storage temporarily unavailable; retry with the same transaction ID'})
 def log_message(self,fmt,*args):pass

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8000);args=parser.parse_args()
 tokenfile=ROOT/'.cashier-token'
 if not tokenfile.exists():tokenfile.write_text(secrets.token_urlsafe(32));os.chmod(tokenfile,0o600)
 TOKEN=tokenfile.read_text().strip()
 with closing(connect()) as c, c:pass
 auth.init_auth()
 print(f'Juki admin: http://localhost:{args.port}',flush=True)
 print('Local prototype only. Cashier token is in .cashier-token. Do not expose publicly without admin login and HTTPS.',flush=True)
 ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
