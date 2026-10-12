(()=>{
let editor,pin,accuracyRing,provider='leaflet',generation=0,googleReady;
const el=id=>document.getElementById(id),center={lat:14.763649,lng:120.956218};
function links(lat,lng){el('customer-google-map').href='https://www.google.com/maps/search/?'+new URLSearchParams({api:'1',query:lat+','+lng});el('customer-google-map').hidden=false;}
function choose(lat,lng){
 el('lat').value=lat.toFixed(6);el('lng').value=lng.toFixed(6);links(lat,lng);
 el('customer-pin-status').textContent=`Selected pin: ${lat.toFixed(6)}, ${lng.toFixed(6)} · Save customer & location to apply`;
 if(provider==='google'){
  if(pin)pin.position={lat,lng};else{pin=new google.maps.marker.AdvancedMarkerElement({map:editor,position:{lat,lng},gmpDraggable:true,title:'Customer delivery pin'});pin.addEventListener('gmp-dragend',()=>{const p=pin.position;choose(typeof p.lat==='function'?p.lat():p.lat,typeof p.lng==='function'?p.lng():p.lng);});}
 }else if(editor){if(pin)pin.setLatLng([lat,lng]);else pin=L.marker([lat,lng],{draggable:true,title:'Customer destination — drag to adjust',icon:L.divIcon({className:'pin-icon',html:'<span class="pin-dot"></span>',iconSize:[30,38],iconAnchor:[15,36]})}).addTo(editor).on('dragend',()=>{const p=pin.getLatLng();choose(p.lat,p.lng);});}
}
async function init(){
 if(editor)return;
 const key=window.JuMapConfig?.googleMapsApiKey?.trim();
 if(key){
  if(!googleReady)googleReady=new Promise((resolve,reject)=>{window.juflowGoogleReady=resolve;const script=document.createElement('script');script.src='https://maps.googleapis.com/maps/api/js?'+new URLSearchParams({key,callback:'juflowGoogleReady',loading:'async',v:'weekly',libraries:'marker'});script.onerror=()=>reject(Error('Google Maps could not load. Check the key and connection.'));document.head.append(script);setTimeout(()=>reject(Error('Google Maps timed out. Check the API key and billing configuration.')),15000);});
  await googleReady;await Promise.all([google.maps.importLibrary('maps'),google.maps.importLibrary('marker')]);provider='google';editor=new google.maps.Map(el('customer-location-map'),{center,zoom:16,mapId:'DEMO_MAP_ID',streetViewControl:false,mapTypeControl:true});editor.addListener('click',e=>choose(e.latLng.lat(),e.latLng.lng()));el('map-provider').textContent='Google Maps';
 }else{
  if(location.protocol==='file:'||!window.L)throw Error('Open through localhost with internet to load the map.');
  provider='leaflet';editor=L.map('customer-location-map').setView([center.lat,center.lng],16);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(editor).on('tileerror',()=>{el('customer-pin-status').textContent='Some map imagery failed to load. Check your internet connection.';});editor.on('click',e=>choose(e.latlng.lat,e.latlng.lng));el('map-provider').textContent='OpenStreetMap · Google Maps link available';
 }
}
window.openCustomerPin=async c=>{
 const current=++generation;el('customer-google-map').hidden=true;el('customer-pin-status').textContent='Loading location editor…';el('gps-result').textContent='';
 try{await init();if(current!==generation||!el('customer-dialog').open)return;
 if(pin){if(provider==='google')pin.map=null;else editor.removeLayer(pin);pin=null;}
 if(accuracyRing){if(provider==='google')accuracyRing.setMap(null);else editor.removeLayer(accuracyRing);accuracyRing=null;}
 if(c){choose(c.lat,c.lng);}else{el('lat').value='';el('lng').value='';el('customer-pin-status').textContent='Click the doorstep on the map, or use GPS while at the customer’s address.';}
 requestAnimationFrame(()=>{const pos=c?{lat:c.lat,lng:c.lng}:center;if(provider==='google'){editor.setCenter(pos);editor.setZoom(17);}else{editor.invalidateSize();editor.setView([pos.lat,pos.lng],17);}});
 }catch(e){el('customer-pin-status').textContent=e.message;}
};
el('capture-gps').onclick=()=>{
 if(!navigator.geolocation||!window.isSecureContext){el('gps-result').textContent='GPS needs HTTPS or localhost and browser location permission.';return;}
 const current=generation;el('capture-gps').disabled=true;el('gps-result').textContent='Getting this device’s location…';
 navigator.geolocation.getCurrentPosition(async p=>{
 el('capture-gps').disabled=false;if(current!==generation||!el('customer-dialog').open)return;
 try{await init();if(current!==generation||!el('customer-dialog').open)return;choose(p.coords.latitude,p.coords.longitude);const pos={lat:p.coords.latitude,lng:p.coords.longitude};
 if(accuracyRing){if(provider==='google')accuracyRing.setMap(null);else editor.removeLayer(accuracyRing);}
 if(provider==='google'){editor.setCenter(pos);editor.setZoom(18);accuracyRing=new google.maps.Circle({map:editor,center:pos,radius:p.coords.accuracy,strokeColor:'#427aab',fillColor:'#427aab',fillOpacity:.12,strokeWeight:1});}else{editor.setView([pos.lat,pos.lng],18);accuracyRing=L.circle([pos.lat,pos.lng],{radius:p.coords.accuracy,color:'#427aab',weight:1,fillOpacity:.12}).addTo(editor);}
 el('gps-result').textContent=`GPS accuracy: approximately ${Math.round(p.coords.accuracy)} metres. Check the doorstep and adjust the pin before saving.`;
 }catch(e){el('gps-result').textContent=e.message;}
 },e=>{el('capture-gps').disabled=false;if(current!==generation)return;el('gps-result').textContent=e.code===1?'Location permission denied. You can still select a pin manually.':'GPS could not determine your location. Try outdoors or place the pin manually.';},{enableHighAccuracy:true,timeout:20000,maximumAge:0});
};
el('customer-dialog').addEventListener('close',()=>{generation++;el('capture-gps').disabled=false;});
})();
