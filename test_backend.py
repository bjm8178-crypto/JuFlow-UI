import copy, importlib.util, json, tempfile, threading, unittest, urllib.request, urllib.error
from pathlib import Path
from contextlib import closing
spec=importlib.util.spec_from_file_location('juflow_server',Path(__file__).with_name('server.py'));server=importlib.util.module_from_spec(spec);spec.loader.exec_module(server)
class SalesTest(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();server.DB=Path(self.tmp.name)/'test.sqlite3'
  self.sale={'transaction_id':'t-1','device_id':'cashier-1','sold_at':'2026-09-28T16:01:00Z','status':'completed','payment_method':'cash','items':[{'product_id':'pork','name':'Pork Paksiw','quantity':2,'unit_price_centavos':7500}]}
 def tearDown(self):self.tmp.cleanup()
 def test_idempotency_and_conflict(self):
  self.assertFalse(server.record(self.sale)['duplicate']);self.assertTrue(server.record(self.sale)['duplicate']);changed=copy.deepcopy(self.sale);changed['items'][0]['quantity']=3
  with self.assertRaises(FileExistsError):server.record(changed)
  d=server.summary('2026-09-29');self.assertEqual(d['total_centavos'],15000);self.assertEqual(d['transaction_count'],1)
 def test_philippine_midnight_and_demo_separation(self):
  server.record(self.sale);before=copy.deepcopy(self.sale);before.update(transaction_id='yesterday',sold_at='2026-09-28T15:59:00Z');server.record(before);demo=copy.deepcopy(self.sale);demo.update(transaction_id='demo',demo=True);server.record(demo)
  d=server.summary('2026-09-29');self.assertEqual(d['total_centavos'],15000);self.assertEqual(d['last_7_days_centavos'],30000);self.assertEqual(d['month_to_date_centavos'],30000);self.assertEqual(d['hourly_centavos'][0],15000);self.assertEqual(d['products'][0]['quantity'],2);self.assertEqual(server.summary('2026-09-28')['total_centavos'],15000);self.assertEqual(server.summary('2026-09-29',True)['transaction_count'],1)
 def test_invalid_events(self):
  for key,value in [('status','preparing'),('sold_at','2026-09-29T01:00:00'),('payment_method','unknown')]:
   bad=copy.deepcopy(self.sale);bad[key]=value
   with self.assertRaises(ValueError):server.record(bad)
  for value in [-1,1.5,True]:
   bad=copy.deepcopy(self.sale);bad['items'][0]['quantity']=value
   with self.assertRaises(ValueError):server.record(bad)
 def test_concurrent_retry(self):
  with closing(server.connect()) as c, c:pass
  from concurrent.futures import ThreadPoolExecutor
  with ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(lambda _:server.record(self.sale),range(8)))
  self.assertEqual(sum(not r['duplicate'] for r in results),1)
 def test_request_handlers_and_private_files(self):
  # Exercise real request-handler logic without binding a network socket.
  import io
  def request(method,path,body=None,auth=''):
   h=object.__new__(server.Handler);h.path=path;payload=json.dumps(body).encode() if body else b'';h.headers={'Authorization':auth,'Content-Length':str(len(payload))};h.rfile=io.BytesIO(payload);h.wfile=io.BytesIO();h.send_response=lambda code:setattr(h,'code',code);h.send_header=lambda *args:None;h.end_headers=lambda:None;h.send_error=lambda code:h.json_response(code,{'error':'not found'});getattr(h,'do_'+method)();return h.code,json.loads(h.wfile.getvalue())
  server.TOKEN='test-token'
  self.assertEqual(request('POST','/api/cashier/sales',self.sale)[0],401)
  self.assertEqual(request('POST','/api/cashier/sales',self.sale,'Bearer test-token')[0],201)
  self.assertEqual(request('POST','/api/cashier/sales',self.sale,'Bearer test-token')[0],200)
  self.assertEqual(request('GET','/api/sales/summary?date=2026-09-29')[0],401)
  self.assertEqual(request('GET','/server.py')[0],404)
  self.assertEqual(request('GET','/.cashier-token')[0],404)
if __name__=='__main__':unittest.main()
