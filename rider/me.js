// JuKi Rider App - Me/Profile Module
// User profile, availability toggle, and app settings

(function() {
  'use strict';

  const { state, api, auth, outbox, location, router, updateConnectivityStatus } = window.JuFlowRider;

  // Render profile screen
  async function renderMe() {
    const main = document.getElementById('app-main');
    main.innerHTML = '';
    main.className = 'app-main';

    document.getElementById('header-title').textContent = 'Profile';
    document.getElementById('header-subtitle').textContent = 'Settings & info';

    // User info section
    const userSection = document.createElement('div');
    userSection.className = 'app-card';
    
    const userName = state.user?.full_name || state.user?.username || 'Rider';
    const userRole = state.user?.role_name || 'rider';
    
    userSection.innerHTML = `
      <div style="text-align:center;padding:16px 0;">
        <div class="profile-avatar rider-avatar">${userName.charAt(0).toUpperCase()}</div>
        <h2 style="margin:12px 0 4px;">${userName}</h2>
        <p style="color:var(--text-muted);font-size:14px;">${userRole.charAt(0).toUpperCase() + userRole.slice(1)}</p>
      </div>
    `;
    main.appendChild(userSection);

    // Location sharing status
    const locationSection = document.createElement('div');
    locationSection.className = 'app-card';
    locationSection.innerHTML = `
      <h3>Location sharing</h3>
      <p style="margin:8px 0;color:var(--text-muted);font-size:14px;">
        ${state.locationSharing 
          ? 'Your location is being shared with the kitchen during active deliveries.' 
          : 'Enable location sharing to help track deliveries in real-time.'}
      </p>
      <button class="app-btn ${state.locationSharing ? 'success' : 'secondary'} full" id="location-toggle-me">
        ${state.locationSharing ? '✓ Location sharing active' : 'Enable location sharing'}
      </button>
    `;
    main.appendChild(locationSection);

    setTimeout(() => {
      document.getElementById('location-toggle-me').onclick = () => {
        if (state.locationSharing) {
          location.stopSharing();
        } else {
          location.startSharing();
        }
        renderMe(); // Refresh
      };
    }, 0);

    // Queue status
    const queueCount = await outbox.getCount();
    
    if (queueCount > 0) {
      const queueSection = document.createElement('div');
      queueSection.className = 'app-card';
      queueSection.innerHTML = `
        <h3>⚠️ Unsent events</h3>
        <p style="margin:8px 0;">You have <strong>${queueCount}</strong> delivery event${queueCount === 1 ? '' : 's'} waiting to sync.</p>
        <button class="app-btn primary" id="retry-sync-btn">Retry sync now</button>
      `;
      main.appendChild(queueSection);
      
      setTimeout(() => {
        document.getElementById('retry-sync-btn').onclick = async () => {
          const btn = document.getElementById('retry-sync-btn');
          btn.disabled = true;
          btn.textContent = 'Syncing...';
          
          const result = await outbox.flush();
          
          if (result.synced > 0) {
            alert(`✓ Synced ${result.synced} event${result.synced === 1 ? '' : 's'}`);
            renderMe();
          } else if (result.failed > 0) {
            alert(`⚠️ Still ${result.failed} unsent. Check your connection.`);
            btn.disabled = false;
            btn.textContent = 'Retry sync now';
          }
          
          if (result.blocked.length > 0) {
            alert(`⚠️ ${result.blocked.length} event${result.blocked.length === 1 ? '' : 's'} blocked\n\nThese events have conflicts and need review.`);
          }
        };
      }, 0);
    }

    // App info
    const infoSection = document.createElement('div');
    infoSection.className = 'app-card';
    infoSection.innerHTML = `
      <h3>App information</h3>
      <div class="info-list">
        <div class="info-row">
          <span>Version</span>
          <span>1.0.0</span>
        </div>
        <div class="info-row">
          <span>Platform</span>
          <span>Progressive Web App</span>
        </div>
        <div class="info-row">
          <span>Connection</span>
          <span id="connection-status">${navigator.onLine ? '✓ Online' : '⚠️ Offline'}</span>
        </div>
        <div class="info-row">
          <span>GPS</span>
          <span>${state.lastLocation ? `✓ Active (±${Math.round(state.lastLocation.accuracy)}m)` : 'Not active'}</span>
        </div>
      </div>
    `;
    main.appendChild(infoSection);

    // Install app button (if applicable)
    if (state.installPromptEvent || !window.matchMedia('(display-mode: standalone)').matches) {
      const installSection = document.createElement('div');
      installSection.className = 'app-card';
      installSection.innerHTML = `
        <h3>📱 Install app</h3>
        <p style="margin:8px 0;color:var(--text-muted);font-size:14px;">
          Install JuKi Rider on your device for faster access and offline support.
        </p>
        <button class="app-btn primary" id="install-app-btn">Install app</button>
      `;
      main.appendChild(installSection);
      
      setTimeout(() => {
        document.getElementById('install-app-btn').onclick = async () => {
          if (state.installPromptEvent) {
            state.installPromptEvent.prompt();
            const result = await state.installPromptEvent.userChoice;
            if (result.outcome === 'accepted') {
              alert('App installed! Look for the JuKi Rider icon on your home screen.');
              renderMe();
            }
          } else {
            alert('To install:\n1. Open this page in Chrome\n2. Tap the menu (⋮)\n3. Select "Install app" or "Add to Home screen"');
          }
        };
      }, 0);
    } else {
      const installedSection = document.createElement('div');
      installedSection.className = 'app-card';
      installedSection.innerHTML = `
        <h3>✓ App installed</h3>
        <p style="color:var(--text-muted);font-size:14px;">
          You're using the installed version of JuKi Rider.
        </p>
      `;
      main.appendChild(installedSection);
    }

    // Help section
    const helpSection = document.createElement('div');
    helpSection.className = 'app-card';
    helpSection.innerHTML = `
      <h3>Help & support</h3>
      <p style="margin:8px 0;color:var(--text-muted);font-size:14px;">
        For assistance, contact your administrator or refer to the rider guide.
      </p>
      <div style="margin-top:12px;">
        <a href="#/jobs" class="link-btn">View active jobs</a>
        <a href="#/history" class="link-btn" style="margin-left:16px;">Check history</a>
      </div>
    `;
    main.appendChild(helpSection);

    // Sign out button
    const signOutSection = document.createElement('div');
    signOutSection.className = 'app-card';
    signOutSection.innerHTML = `
      <button class="app-btn danger full" id="signout-btn">Sign out</button>
      <p style="text-align:center;margin-top:8px;color:var(--text-muted);font-size:12px;">
        JuKi Rider v1.0.0
      </p>
    `;
    main.appendChild(signOutSection);

    // Sign out handler
    setTimeout(() => {
      document.getElementById('signout-btn').onclick = async () => {
        const queueSize = await outbox.getCount();
        const jobsSize = state.deliveries?.length || 0;
        
        let message = 'Sign out of JuKi Rider?';
        if (queueSize > 0 || jobsSize > 0) {
          message = `You have:\n`;
          if (queueSize > 0) message += `• ${queueSize} unsent event${queueSize === 1 ? '' : 's'}\n`;
          if (jobsSize > 0) message += `• ${jobsSize} cached job${jobsSize === 1 ? '' : 's'}\n`;
          message += `\nThese will be cleared. Sign out anyway?`;
        }
        
        const confirmed = confirm(message);
        
        if (confirmed) {
          // Stop location sharing before logout
          if (state.locationSharing) {
            location.stopSharing();
          }
          
          await auth.logout();
        }
      };
    }, 0);
  }

  // Register route
  router.register('/me', renderMe);

})();
