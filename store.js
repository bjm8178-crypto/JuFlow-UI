// Browser-only demonstration storage; never use this as production authentication/storage.
window.JuStore=(()=>{
 const key='juflow-demo-v1';
 const seed={customers:[{id:'sample-maria',name:'Maria Santos (sample)',messenger:'Maria Santos',phone:'09000000000',address:'Sample address, Saog, Marilao',landmark:'Sample only — confirm the actual gate and map pin',lat:14.7571,lng:120.9512}],orders:[]};
 function read(){const raw=localStorage.getItem(key);if(!raw)return structuredClone(seed);const d=JSON.parse(raw);if(!Array.isArray(d.customers)||!Array.isArray(d.orders))throw Error('Stored demo data could not be read.');return d;}
 function save(d){localStorage.setItem(key,JSON.stringify(d));}
 function id(){return crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);}
 function money(cents){return '₱'+(cents/100).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});}
 function payment(o){if(o.method==='gcash')return 'GCash · '+money(o.total)+' · '+(o.paymentVerified?'Verified':'Pending verification');if(o.method==='exact')return 'Cash Exact · '+money(o.total);return 'Cash '+(o.total/100)+'/'+(o.tendered/100)+' · Change '+money(o.tendered-o.total);}
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return {read,save,id,money,payment,escape};
})();
