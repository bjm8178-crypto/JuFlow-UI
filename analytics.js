(()=>{
const el=id=>document.getElementById(id),money=JuStore.money,E=JuStore.escape;
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
if(el('sales-date'))el('sales-date').value=today();
let controller,sequence=0,hadData=false,inFlight=false;
function chart(values){const max=Math.max(...values,1);el('sales-chart').innerHTML='<div class="hour-bars" aria-label="Hourly sales">'+values.map((v,h)=>`<div class="hour-column"><div title="${h}:00 · ${money(v)}" class="hour-bar" style="height:${Math.max(2,v/max*140)}px"><span class="sr-only">${h}:00 ${money(v)}</span></div><small>${h%4===0?h:''}</small></div>`).join('')+'</div><p class="map-help">Peak hourly sales: '+money(Math.max(...values))+'</p>';}
async function refresh(){
 inFlight=true;const request=++sequence;if(controller)controller.abort();controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),7000);
 const date=el('sales-date')?.value||today(),demo=el('sales-source')?.value==='demo';
 try{const r=await fetch('/api/sales/summary?'+new URLSearchParams({date,demo:demo?'1':'0'}),{cache:'no-store',signal:controller.signal});if(!r.ok)throw Error('Sales service unavailable');const d=await r.json();if(request!==sequence)return;
 document.querySelectorAll('[data-stat]').forEach(node=>{const k=node.dataset.stat;node.textContent=k.endsWith('centavos')?money(d[k]):d[k].toLocaleString();});
 chart(d.hourly_centavos);el('top-products').innerHTML=d.products.slice(0,6).map((p,i)=>`<div class="product-row"><span>${i+1}</span><div><strong>${E(p.name)}</strong><small>${p.quantity} sold</small></div><strong>${money(p.revenue_centavos)}</strong></div>`).join('')||'<p class="empty">No food sales recorded for this day.</p>';
 if(el('sales-feed'))el('sales-feed').innerHTML=d.transactions.map(t=>`<tr><td>${E(new Date(t.sold_at).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit'}))}</td><td><strong>${E(t.transaction_id)}</strong><small>${E(t.device_id)}</small></td><td>${t.items.map(i=>E(i.name)+' × '+i.quantity).join('<br>')}</td><td>${E(t.payment_method.toUpperCase())}</td><td>${money(t.total_centavos)}</td></tr>`).join('')||'<tr><td colspan="5">No submitted sales yet.</td></tr>';
 if(el('cash-sales')){el('cash-sales').textContent=money(d.payments_centavos.cash);el('gcash-sales').textContent=money(d.payments_centavos.gcash);}
 el('sales-connection').textContent='Connected · refreshes every 3s';el('sales-connection').className='badge blue';
 el('sales-message').textContent=demo?'TEST DATA ONLY · Sent by the integration test script. These amounts are excluded from cashier sales.':'Cashier sales receiver ready. Only submitted completed sales are counted. The separate cashier app is not built yet.';
 el('sales-updated').textContent='Last received '+new Date(d.generated_at).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila'})+' · Philippine time';hadData=true;
 }catch(e){if(request!==sequence)return;el('sales-connection').textContent='Disconnected';el('sales-connection').className='badge amber';el('sales-message').textContent=(hadData?'Showing the last received values. ':'')+'Start python server.py and open http://localhost:8000 to receive sales updates.';
 }finally{clearTimeout(timeout);if(request===sequence)inFlight=false;}
}
function changed(){hadData=false;document.querySelectorAll('[data-stat]').forEach(n=>n.textContent='—');el('sales-chart').innerHTML='';el('top-products').innerHTML='';if(el('sales-feed'))el('sales-feed').innerHTML='';if(el('cash-sales')){el('cash-sales').textContent='—';el('gcash-sales').textContent='—';}refresh();}
if(el('sales-date'))el('sales-date').onchange=changed;if(el('sales-source'))el('sales-source').onchange=changed;if(el('refresh-sales'))el('refresh-sales').onclick=refresh;
refresh();const timer=setInterval(()=>{if(!document.hidden&&!inFlight)refresh();},3000);window.addEventListener('focus',refresh);window.addEventListener('pagehide',()=>{clearInterval(timer);controller?.abort();});
})();
