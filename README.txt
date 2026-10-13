DEPLOYMENT: see DEPLOYMENT.md (MongoDB Atlas + Render API + Vercel frontend). The Python server below is the old local prototype.

Juki — Admin website, customer landmarks and live sales receiver

START
1. Extract the ZIP.
2. Open a terminal inside JuFlow-UI.
3. Run: python server.py (Windows alternative: py server.py)
4. Open http://localhost:8000/signup.html for first-run admin signup, then sign in.
Python 3.10+; no pip dependencies. Internet is required for map imagery.
Use server.py, not python -m http.server: authentication and sales receiving require it.

REMOVED
Team / Employees / Schedule / Attendance / Payroll, including dashboard team cards.

CUSTOMER LOCATION
Customers > Edit details & location (or New customer).
- Click/drag the pin, or use Use my GPS here when physically at the customer's address.
- GPS uses the current viewing device, not another person's phone. Accuracy is shown;
  manually adjust the doorstep if needed. Permission and HTTPS/localhost are required.
- Check/Open pin in Google Maps opens the exact saved coordinates in Google Maps.
- Save customer & location commits the draft. Closing discards the draft.
- Existing orders retain their original address snapshots.

GOOGLE MAPS EMBEDDED EDITOR
Google Maps links need no API key and work immediately.
To use Google Maps itself inside the customer editor:
1. Set up a Google Cloud project, Maps JavaScript API, and billing as required.
2. Create an API key restricted to Maps JavaScript API and your HTTP referrers.
3. Put that browser-restricted key in map-config.js > googleMapsApiKey.
4. Refresh the Customers page. The editor now loads Google Maps with draggable pins.
The example uses DEMO_MAP_ID for development; use your own map ID when deploying.
Without a key, the editor shows OpenStreetMap and retains GPS + Google Maps links.
The admin active-delivery overview still uses OpenStreetMap. No geocoding, address
search, traffic ETA, or live remote rider tracking is connected.
Google Maps configuration and physical-device GPS have not been tested here.
Docs: https://developers.google.com/maps/documentation/javascript/get-api-key
https://developers.google.com/maps/documentation/urls/get-started

LANDMARK PHOTOS
Upload JPG/PNG/WebP in customer details. Photos are resized and compressed in the
browser. Save the customer, then click View landmark photo to open it.
The same button is present in active delivery details for that saved customer.
No photo is automatically taken or sourced from Google Street View.
Photos and customers persist only in this browser/localStorage, with limited
capacity. They are not uploaded to a server or synced to future rider devices.

SALES AND ANALYTICS
Sales & reports lists submitted food items and updates every 3 seconds.
The Dashboard uses cashier totals instead of invented sample revenue.
Cashier sales persist in the local .juflow-sales.sqlite3 database.
See CASHIER_INTEGRATION.md for the endpoint, payload, idempotency and test command.
The cashier app is not built; a sample sender verifies the integration contract.
Test sales are clearly labeled and separate from real totals.

ACTIVE DELIVERIES
Destination pins are view-only and remain after rider-reported delivery until
cashier completion is received. Existing sample scenarios remain labeled.
Cashier delivery completion and rider tracking feeds are not connected.
Shop coordinates 14.763649, 120.956218 remain provisional.

TESTING / SCOPE
Run python test_backend.py for transaction, timezone and handler checks.
Checks passed for duplicate/concurrent retries, conflicting transaction IDs,
Philippine midnight, test-data isolation, invalid sales, and cashier authorization.
JavaScript syntax and HTML links/structure checked.
Actual browser rendering, real GPS, Google-key integration and live HTTP server
execution remain unverified in the restricted build environment.
AUTHENTICATION
First-run signup creates the admin; passwords require at least 8 characters.
Further signup is disabled by default. Set JUFLOW_ALLOW_SIGNUP=1 before starting
server.py to allow more accounts. These accounts are admins: enable only when needed.
Set JUFLOW_HTTPS=1 when serving behind HTTPS to mark session cookies Secure.
Do not use that setting over plain HTTP; deploy remotely only with HTTPS.
Authentication uses an HttpOnly, SameSite=Lax cookie and server-side SQLite sessions.
Sessions last 12 hours; five failed password attempts lock the account for 5 minutes.
Use Logout to invalidate the session. Browser localStorage is not authentication.
The local .juflow-auth.sqlite3 contains users/session hashes: keep it private, back it
up securely, and never commit it. JUFLOW_AUTH_DB can set a different database path.
Create the first admin before exposing the service to others.
Run python test_auth.py and python test_backend.py for backend checks.
The cashier endpoint retains its separate authorization; no admin cookie is required.
Legacy admin.html/dashboard-mongo.html product/rider APIs are not implemented by the
Python server. Auth works there; unrelated legacy data features remain unavailable.
This remains a local admin prototype, not a fully hardened production deployment.
