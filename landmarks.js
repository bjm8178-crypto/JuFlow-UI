// Compressed local prototype photos; no uploads leave the browser.
(()=>{
let draft='',revision=0,busy=false;const el=id=>document.getElementById(id);
const safe=src=>/^data:image\/(jpeg|png|webp);base64,/.test(src||'');
function preview(){const image=el('landmark-preview');image.hidden=!draft;if(draft)image.src=draft;else image.removeAttribute('src');el('remove-landmark').hidden=!draft;}
window.Landmarks={begin(c){revision++;busy=false;draft=safe(c?.landmarkPhoto)?c.landmarkPhoto:'';el('landmark-file').value='';el('landmark-upload-status').textContent=draft?'Saved photo. Choose another image to replace it.':'Add a photo of the gate, building or nearby landmark.';preview();},value(){if(busy)throw Error('Wait for the landmark photo to finish processing.');return draft;},view(src){if(!safe(src)){showDemoNotice('No landmark photo has been saved yet.');return;}el('landmark-full').src=src;el('landmark-viewer').showModal();}};
el('landmark-file').onchange=async e=>{
 const f=e.target.files[0];if(!f)return;const version=++revision;busy=true;
 try{if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>12*1024*1024)throw Error('Choose a JPG, PNG or WebP image up to 12 MB.');const bitmap=await createImageBitmap(f);if(version!==revision){bitmap.close();return;}const scale=Math.min(1,1000/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const result=canvas.toDataURL('image/jpeg',.75);if(result.length>600000)throw Error('Photo is too detailed. Choose a smaller image.');draft=result;preview();el('landmark-upload-status').textContent='Photo ready. Save customer & location to keep it.';
 }catch(err){if(version===revision)el('landmark-upload-status').textContent=err.message;}finally{if(version===revision)busy=false;}
};
el('remove-landmark').onclick=()=>{revision++;busy=false;draft='';preview();el('landmark-file').value='';el('landmark-upload-status').textContent='Photo removed from this draft. Save to apply.';};
el('landmark-view-close').onclick=()=>el('landmark-viewer').close();
})();
