// Optional: insert a browser-restricted Google Maps JavaScript API key.
// Restrict the key to the Maps JavaScript API and your localhost/HTTPS referrers.
(() => {
  function coordinates(lat, lng) {
    return typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90 &&
      typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= 180 ? { lat, lng } : null;
  }
  function shopFromSettings(rows) {
    if (!Array.isArray(rows)) return null;
    const lat = rows.filter(row => row?.key === 'shop_lat');
    const lng = rows.filter(row => row?.key === 'shop_lng');
    // Legacy seeded coordinates are provisional, not a confirmed shop origin.
    if (lat.length !== 1 || lng.length !== 1) return null;
    return coordinates(lat[0].value, lng[0].value);
  }
  async function loadShop() {
    const response = await fetch('/api/settings', { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw Error('Shop location could not be loaded.');
    return shopFromSettings(await response.json());
  }
  function googleSearch(lat, lng) {
    const point = coordinates(lat, lng);
    return point ? 'https://www.google.com/maps/search/?' + new URLSearchParams({ api: '1', query: `${point.lat},${point.lng}` }) : null;
  }
  function googleDirections(origin, destination) {
    const from = coordinates(origin?.lat, origin?.lng), to = coordinates(destination?.lat, destination?.lng);
    return from && to ? 'https://www.google.com/maps/dir/?' + new URLSearchParams({ api: '1', origin: `${from.lat},${from.lng}`, destination: `${to.lat},${to.lng}`, travelmode: 'driving' }) : null;
  }
  window.JuMapConfig = { googleMapsApiKey: '', coordinates, shopFromSettings, loadShop, googleSearch, googleDirections };
})();
