(()=>{
let editor,pin,accuracyRing,generation=0;
const el=id=>document.getElementById(id);
function links(lat,lng){const url=window.JuMapConfig.googleSearch(lat,lng);el('customer-google-map').hidden=!url;if(url)el('customer-google-map').href=url;else el('customer-google-map').removeAttribute('href');}
function choose(lat,lng){
 if(!window.JuMapConfig.coordinates(lat,lng))return;
 el('lat').value=lat.toFixed(6);el('lng').value=lng.toFixed(6);links(lat,lng);
 el('customer-pin-status').textContent=`Selected pin: ${lat.toFixed(6)}, ${lng.toFixed(6)} · Save customer & location to apply`;
 if(editor){
   if(pin)pin.setLatLng([lat,lng]);
   else pin=L.marker([lat,lng],{draggable:true,title:'Customer destination — drag to adjust',icon:L.divIcon({className:'pin-icon',html:'<span class="pin-dot"></span>',iconSize:[30,38],iconAnchor:[15,36]})}).addTo(editor).on('dragend',()=>{const p=pin.getLatLng();choose(p.lat,p.lng);});
 }
}
async function init(center){
 if(editor)return;
 if(location.protocol==='file:'||!window.L)throw Error('Open through localhost with internet to load the map.');
 editor=L.map('customer-location-map');
 if(center)editor.setView([center.lat,center.lng],16);
 else editor.setView([14.7566, 120.9472],13); // Default Marilao, Bulacan
 L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(editor).on('tileerror',()=>{el('customer-pin-status').textContent='Some map imagery failed to load. Check your internet connection.';});
 editor.on('click',e=>choose(e.latlng.lat,e.latlng.lng));
 el('map-provider').textContent='100% Free OpenStreetMap · Click map or drag pin to position';
}
window.openCustomerPin=async c=>{
 const current=++generation;el('customer-google-map').hidden=true;el('customer-google-map').removeAttribute('href');el('lat').value='';el('lng').value='';el('customer-pin-status').textContent='Loading location editor…';el('gps-result').textContent='';
 const saved=window.JuMapConfig.coordinates(c?.lat,c?.lng);let shop=null,shopError=false;
 try{shop=await window.JuMapConfig.loadShop();}catch{shopError=true;}
 if(current!==generation||!el('customer-dialog').open)return;
 try{
   await init(saved||shop);
   if(current!==generation||!el('customer-dialog').open)return;
   if(pin){editor.removeLayer(pin);pin=null;}
   if(accuracyRing){editor.removeLayer(accuracyRing);accuracyRing=null;}
   if(saved){choose(saved.lat,saved.lng);}
   else{el('customer-pin-status').textContent='No destination pin saved. Search an address, click the doorstep on the map, or use GPS.'+(shop?'':' Shop location is not configured; showing area overview.');}
   requestAnimationFrame(()=>{
     if(current!==generation||!el('customer-dialog').open)return;
     editor.invalidateSize();
     const pos=saved||shop;
     if(pos)editor.setView([pos.lat,pos.lng],17);
   });
 }catch(e){el('customer-pin-status').textContent=e.message;}
};
el('capture-gps').onclick=()=>{
 if(!navigator.geolocation||!window.isSecureContext){el('gps-result').textContent='GPS needs HTTPS or localhost and browser location permission.';return;}
 const current=generation;el('capture-gps').disabled=true;el('gps-result').textContent='Getting this device’s location…';
 navigator.geolocation.getCurrentPosition(async p=>{
   el('capture-gps').disabled=false;if(current!==generation||!el('customer-dialog').open)return;
   try{
     const pos=window.JuMapConfig.coordinates(p.coords.latitude,p.coords.longitude);
     if(!pos)throw Error('GPS returned invalid coordinates.');
     await init(pos);
     if(current!==generation||!el('customer-dialog').open)return;
     choose(pos.lat,pos.lng);
     if(accuracyRing){editor.removeLayer(accuracyRing);}
     editor.setView([pos.lat,pos.lng],18);
     accuracyRing=L.circle([pos.lat,pos.lng],{radius:p.coords.accuracy,color:'#427aab',weight:1,fillOpacity:.12}).addTo(editor);
     el('gps-result').textContent=`GPS accuracy: approximately ${Math.round(p.coords.accuracy)} metres. Check the doorstep and adjust the pin before saving.`;
   }catch(e){el('gps-result').textContent=e.message;}
 },e=>{el('capture-gps').disabled=false;if(current!==generation)return;el('gps-result').textContent=e.code===1?'Location permission denied. You can still select a pin manually.':'GPS could not determine your location. Try outdoors or place the pin manually.';},{enableHighAccuracy:true,timeout:20000,maximumAge:0});
};

// Free Nominatim OpenStreetMap Search
async function searchAddress() {
  const query = el('map-search-input')?.value.trim();
  if (!query) return;
  const statusEl = el('customer-pin-status');
  statusEl.textContent = 'Searching location…';
  try {
    const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
      q: query + ', Philippines',
      format: 'json',
      limit: '1'
    });
    const res = await fetch(url, { headers: { 'Accept-Language': 'en-PH,en' } });
    const results = await res.json();
    if (results && results.length > 0) {
      const lat = parseFloat(results[0].lat), lng = parseFloat(results[0].lon);
      await init({ lat, lng });
      choose(lat, lng);
      editor.setView([lat, lng], 17);
      statusEl.textContent = `Found: ${results[0].display_name.slice(0, 80)}… (drag pin to exact doorstep)`;
    } else {
      statusEl.textContent = 'Location not found. Try searching a nearby landmark, street or barangay.';
    }
  } catch (err) {
    statusEl.textContent = 'Could not search location. Check your internet connection.';
  }
}
if (el('map-search-btn')) el('map-search-btn').onclick = searchAddress;
if (el('map-search-input')) el('map-search-input').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); searchAddress(); } };

el('customer-dialog').addEventListener('close',()=>{generation++;el('capture-gps').disabled=false;});
})();
