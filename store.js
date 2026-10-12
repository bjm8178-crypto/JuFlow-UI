// Shared display helpers. Business records are stored on the server (MongoDB), never in the browser.
window.JuStore=(()=>{
 function money(cents){return '₱'+(cents/100).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});}
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return {money,escape};
})();
