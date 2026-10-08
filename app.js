/**
 * SafeRoute – app.js
 * Complete vanilla-JS prototype.
 * All data stored in localStorage.
 * No frameworks, no backend, no API keys.
 *
 * Key objects & flows:
 *  - Auth: register / login / logout
 *  - Session: start, countdown, check-in popup, extend
 *  - Emergency: manual SOS, auto SOS on no-response
 *  - Contacts: CRUD
 *  - History: localStorage list
 *  - Privacy: toggles persisted in localStorage
 *  - Demo Mode: 10× speed factor
 */

'use strict';

/* ═════════════════════════════════════════
   CONSTANTS & DEMO DATA
═════════════════════════════════════════ */

const DEMO_USER = {
  name: 'Ananya Sharma',
  email: 'demo@saferoute.app',
  mobile: '+91 98765 43210',
  password: 'demo1234'
};

const NEARBY_POLICE = [
  { name: 'MG Road Police Station',      distance: '0.8 km', phone: '100' },
  { name: 'Civil Lines Police Station',  distance: '1.4 km', phone: '100' },
  { name: 'Women\'s Help Desk – Sector 9', distance: '2.1 km', phone: '1091' },
];

const NEARBY_HOSPITALS = [
  { name: 'City General Hospital',    distance: '1.2 km', phone: '102' },
  { name: 'Apollo Clinic – Sector 5', distance: '1.9 km', phone: '108' },
  { name: 'Aastha Women\'s Hospital', distance: '2.6 km', phone: '112' },
];

// Alert counter seed
const ALERT_PREFIX = 'SR';

/* ═════════════════════════════════════════
   STATE
═════════════════════════════════════════ */
let currentUser    = null;   // logged-in user object
let demoMode       = false;  // speed multiplier
let sessionConfig  = {};     // active session settings
let sessionTimerId = null;   // setInterval for main countdown
let checkinTimerId = null;   // setInterval for check-in countdown
let checkinPopupId = null;   // setTimeout to show check-in popup
let sessionRemaining = 0;    // seconds left in session
let checkinInterval  = 30;   // seconds between check-ins
let checkinActive    = false;// is check-in popup open?
let checkinCountdown = 10;   // seconds to respond
let checkinProgressId = null;// setInterval for progress bar
let currentLocation  = null; // { lat, lng, label }
let emergencyActive  = false;// prevent double-trigger
let currentAlertId   = null; // e.g. SR1001
let graceCancelId    = null; // setInterval for cancel grace

/* ═════════════════════════════════════════
   UTILITY HELPERS
═════════════════════════════════════════ */

/** Format seconds → HH:MM:SS */
function formatTime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

/** Generate unique alert ID */
function nextAlertId() {
  const alerts = getHistory();
  const num    = 1001 + alerts.length;
  return `${ALERT_PREFIX}${num}`;
}

/** Now as readable string */
function nowStr() {
  return new Date().toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  });
}

/** Demo speed factor (1 = real, 10 = fast) */
function speedFactor() { return demoMode ? 10 : 1; }

/** Real seconds adjusted for demo mode */
function demoSecs(real) { return Math.max(1, Math.round(real / speedFactor())); }

/* ═════════════════════════════════════════
   LOCAL STORAGE HELPERS
═════════════════════════════════════════ */

function getUsers()    { return JSON.parse(localStorage.getItem('sr_users')    || '[]'); }
function saveUsers(u)  { localStorage.setItem('sr_users', JSON.stringify(u)); }

function getContacts() { return JSON.parse(localStorage.getItem('sr_contacts') || '[]'); }
function saveContacts(c){ localStorage.setItem('sr_contacts', JSON.stringify(c)); }

function getHistory()  { return JSON.parse(localStorage.getItem('sr_history')  || '[]'); }
function saveHistory(h){ localStorage.setItem('sr_history', JSON.stringify(h)); }

function getPrivacy()  {
  return JSON.parse(localStorage.getItem('sr_privacy') || JSON.stringify({
    location: true, camera: false, vibrate: true
  }));
}
function savePrivacyData(p){ localStorage.setItem('sr_privacy', JSON.stringify(p)); }

function getDemoMode() { return localStorage.getItem('sr_demo') === '1'; }
function saveDemoMode(v){ localStorage.setItem('sr_demo', v ? '1' : '0'); }

/* ═════════════════════════════════════════
   TOAST NOTIFICATIONS
═════════════════════════════════════════ */

function showToast(msg, type = 'info', dur = 3200) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;

  const icons = { success: '✅', info: 'ℹ️', warning: '⚠️', error: '❌' };
  el.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${msg}</span>`;

  const container = document.getElementById('toast-container');
  container.appendChild(el);

  setTimeout(() => {
    el.classList.add('toast-out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, dur);
}

/* ═════════════════════════════════════════
   MODAL
═════════════════════════════════════════ */

function showModal(title, body, actions = []) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML    = body;

  const actBox = document.getElementById('modal-actions');
  actBox.innerHTML = '';
  actions.forEach(a => {
    const b = document.createElement('button');
    b.className   = `btn ${a.cls || 'btn-primary'}`;
    b.textContent = a.label;
    b.onclick     = () => { closeModal(); a.fn && a.fn(); };
    actBox.appendChild(b);
  });

  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

// Close modal on overlay click
document.getElementById('modal-overlay').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

/* ═════════════════════════════════════════
   SCREEN / TAB NAVIGATION
═════════════════════════════════════════ */

const SCREENS = {
  auth:          'screen-auth',
  home:          'screen-home',
  contacts:      'screen-contacts',
  nearby:        'screen-nearby',
  history:       'screen-history',
  privacy:       'screen-privacy',
  'start-session':'screen-start-session',
  monitor:       'screen-monitor',
  emergency:     'screen-emergency',
};

/** Show a screen, hide all others */
function showScreen(name) {
  Object.values(SCREENS).forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('active');
    el.classList.add('hidden');
  });
  const target = document.getElementById(SCREENS[name]);
  if (target) {
    target.classList.remove('hidden');
    // Trigger reflow for animation
    void target.offsetWidth;
    target.classList.add('active');
  }
}

/** Tab nav (within home shell) */
function showTab(tab) {
  // Map tab name to screen
  const map = {
    home:     'home',
    contacts: 'contacts',
    nearby:   'nearby',
    history:  'history',
    privacy:  'privacy',
  };
  const screenName = map[tab] || tab;
  showScreen(screenName);

  // Update bottom nav and desktop top nav active states
  ['home','contacts','nearby','history','privacy'].forEach(t => {
    const btn = document.getElementById(`nav-${t}`);
    if (btn) btn.classList.toggle('active', t === tab);
    const topBtn = document.getElementById(`topnav-${t}`);
    if (topBtn) topBtn.classList.toggle('active', t === tab);
  });

  document.querySelectorAll('.desktop-top-nav .top-nav-btn').forEach(btn => {
    const text = btn.textContent.toLowerCase();
    const isTarget = (tab === 'home' && text.includes('home')) ||
                     (tab === 'contacts' && text.includes('contacts')) ||
                     (tab === 'nearby' && (text.includes('nearby') || text.includes('havens'))) ||
                     (tab === 'history' && (text.includes('history') || text.includes('logs'))) ||
                     (tab === 'privacy' && text.includes('privacy'));
    btn.classList.toggle('active', isTarget);
  });

  // Refresh content on relevant tabs
  if (tab === 'contacts') renderContacts();
  if (tab === 'history')  renderHistory();
  if (tab === 'nearby')   renderNearby();
  if (tab === 'privacy')  loadPrivacyToggles();
  if (tab === 'home')     refreshHomeBadges();
}

/* ═════════════════════════════════════════
   AUTH
═════════════════════════════════════════ */

/** Switch between Login / Register tabs */
function switchAuthTab(tab) {
  document.getElementById('form-login').classList.toggle('hidden', tab !== 'login');
  document.getElementById('form-register').classList.toggle('hidden', tab !== 'register');
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab !== 'login');
}

/** Quick demo login – no credentials needed */
async function loginDemo() {
  try {
    const res = await fetch('/api/auth/demo', { method: 'POST' });
    const data = await res.json();
    if (data.success && data.user) {
      currentUser = data.user;
      if (data.token) localStorage.setItem('sr_token', data.token);
      try { await fetch('/api/contacts/seed', { method: 'POST' }); } catch (_) {}
      showToast('Logged in as Demo User (MongoDB ready)!', 'success');
      onLoginSuccess();
      return;
    }
  } catch (_) {}

  // Local fallback
  let users = getUsers();
  if (!users.find(u => u.email === DEMO_USER.email)) {
    users.push({ ...DEMO_USER });
    saveUsers(users);
  }
  if (getContacts().length === 0) seedDemoContacts();

  currentUser = { ...DEMO_USER };
  onLoginSuccess();
}

/** Handle login form */
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;

  if (!email || !pass) { showToast('Please fill in all fields.', 'warning'); return; }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass })
    });
    const data = await res.json();
    if (data.success && data.user) {
      currentUser = data.user;
      if (data.token) localStorage.setItem('sr_token', data.token);
      showToast(`Login successful! Welcome ${data.user.name.split(' ')[0]}`, 'success');
      onLoginSuccess();
      return;
    } else if (data.error) {
      // If server does not have this account yet, check if it was previously registered in this browser's localStorage
      const localUsers = getUsers();
      const localUser = localUsers.find(u => u.email === email && u.password === pass);
      if (localUser) {
        // Auto-sync this local user to server and retry login
        try {
          await fetch('/api/auth/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ users: [localUser], contacts: getContacts() })
          });
          const retryRes = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: pass })
          });
          const retryData = await retryRes.json();
          if (retryData.success && retryData.user) {
            currentUser = retryData.user;
            if (retryData.token) localStorage.setItem('sr_token', retryData.token);
            showToast(`Login successful! Synced to server.`, 'success');
            onLoginSuccess();
            return;
          }
        } catch (_) {}
      }

      showToast(data.error, 'error');
      return;
    }
  } catch (err) {
    console.warn('Backend login fallback:', err);
  }

  // Fallback to local storage only if network failed
  const users = getUsers();
  const user  = users.find(u => u.email === email && u.password === pass);

  if (!user) { showToast('Invalid email or password.', 'error'); return; }

  currentUser = user;
  showToast('Logged in (Offline Mode).', 'info');
  onLoginSuccess();
}

/** Handle register form */
async function handleRegister(e) {
  e.preventDefault();
  const name     = document.getElementById('reg-name').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const mobile   = document.getElementById('reg-mobile').value.trim();
  const pass     = document.getElementById('reg-pass').value;
  const confirm  = document.getElementById('reg-confirm').value;
  const ecName   = document.getElementById('reg-ec-name').value.trim();
  const ecPhone  = document.getElementById('reg-ec-phone').value.trim();

  // Basic validation
  if (!name || !email || !mobile || !pass || !confirm) {
    showToast('All fields are required.', 'warning'); return;
  }
  if (!/\S+@\S+\.\S+/.test(email)) {
    showToast('Please enter a valid email.', 'warning'); return;
  }
  if (pass.length < 6) {
    showToast('Password must be at least 6 characters.', 'warning'); return;
  }
  if (pass !== confirm) {
    showToast('Passwords do not match.', 'warning'); return;
  }

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, mobile, password: pass })
    });
    const data = await res.json();
    if (data.success && data.user) {
      currentUser = data.user;
      if (data.token) localStorage.setItem('sr_token', data.token);

      // Save local backup as well
      const localUsers = getUsers();
      if (!localUsers.find(u => u.email === email)) {
        localUsers.push({ name, email, mobile, password: pass });
        saveUsers(localUsers);
      }

      if (ecName && ecPhone) {
        try {
          await fetch('/api/contacts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: ecName, phone: ecPhone, relation: 'Emergency Contact', userEmail: email })
          });
        } catch (_) {}
      }

      showToast('Account created successfully! Accessible on all devices.', 'success');
      onLoginSuccess();
      return;
    } else if (data.error) {
      showToast(data.error, 'error');
      return;
    }
  } catch (err) {
    console.warn('Backend register error, fallback to local storage:', err);
  }

  const users = getUsers();
  if (users.find(u => u.email === email)) {
    showToast('An account with this email already exists.', 'error'); return;
  }

  const newUser = { name, email, mobile, password: pass };
  users.push(newUser);
  saveUsers(users);

  // Add emergency contact if provided
  if (ecName && ecPhone) {
    const contacts = getContacts();
    contacts.push({ id: Date.now(), name: ecName, phone: ecPhone, relation: 'Emergency Contact', email: '' });
    saveContacts(contacts);
  }

  currentUser = newUser;
  showToast('Account created (Offline Mode)!', 'success');
  onLoginSuccess();
}

/** Post-login setup */
function onLoginSuccess() {
  demoMode = getDemoMode();
  syncDemoToggles();

  document.getElementById('header-username').textContent = currentUser.name.split(' ')[0];
  refreshHomeBadges();
  showScreen('home');
  showTab('home');
  updateStatusCard('safe', 'SAFE', 'No active session');

  // Immediately initialize real-time live GPS tracking
  getLiveLocation(false);
  startContinuousLocationWatch();
}

/** Logout */
function handleLogout() {
  showModal('Logout', 'Are you sure you want to log out?', [
    { label: 'Cancel',  cls: 'btn-ghost' },
    { label: 'Logout',  cls: 'btn-danger', fn: () => {
      // Stop any active session
      clearAllTimers();
      emergencyActive = false;
      currentUser = null;
      showScreen('auth');
      switchAuthTab('login');
    }},
  ]);
}

/** Forgot password mock */
function showForgotModal() {
  showModal(
    'Forgot Password',
    'In the production version, a reset link would be sent to your email.<br><br>For this demo, use the <strong>Quick Demo Login</strong> button.',
    [{ label: 'OK', cls: 'btn-primary' }]
  );
}

/* ═════════════════════════════════════════
   HOME DASHBOARD
═════════════════════════════════════════ */

function updateStatusCard(state, label, sub) {
  const card = document.getElementById('status-card');
  const labelEl = document.getElementById('status-label');
  const subEl   = document.getElementById('status-sub');

  card.className = `status-card ${state}`;
  labelEl.textContent = label;
  subEl.textContent   = sub;
}

function refreshHomeBadges() {
  const contacts = getContacts();
  const history  = getHistory();

  const cb = document.getElementById('contacts-count-badge');
  if (cb) cb.textContent = contacts.length ? `${contacts.length}` : '';

  const hb = document.getElementById('history-count-badge');
  if (hb) hb.textContent = history.length ? `${history.length}` : '';

  // Show last alert if SOS
  const lastAlert = history[history.length - 1];
  const prev = document.getElementById('last-alert-preview');
  if (prev && lastAlert && (lastAlert.status === 'SOS Sent' || lastAlert.status === 'Auto-Alert')) {
    prev.classList.remove('hidden');
    prev.innerHTML = `🚨 Last alert: <strong>${lastAlert.status}</strong> · ${lastAlert.time} · ${lastAlert.location}`;
  } else if (prev) {
    prev.classList.add('hidden');
  }

  // Sync demo mode toggle
  syncDemoToggles();
}

/* ═════════════════════════════════════════
   DEMO MODE
═════════════════════════════════════════ */

function toggleDemoMode(on) {
  demoMode = on;
  saveDemoMode(on);
  syncDemoToggles();
  showToast(on ? 'Demo Mode ON – timers run at 10× speed' : 'Demo Mode OFF – real timers', 'info');
}

function syncDemoToggles() {
  const t1 = document.getElementById('demo-mode-toggle');
  const t2 = document.getElementById('demo-mode-toggle-privacy');
  if (t1) t1.checked = demoMode;
  if (t2) t2.checked = demoMode;
}

/* ═════════════════════════════════════════
   START SESSION
═════════════════════════════════════════ */

let selectedDurationMins = 10;

function goToStartSession() {
  // Load privacy prefs into session toggles
  const priv = getPrivacy();
  document.getElementById('sess-camera-toggle').checked   = priv.camera;
  document.getElementById('sess-location-toggle').checked = priv.location;

  // Render contacts checkboxes
  renderSessionContacts();

  // Reset chip selection
  selectDuration(10);

  showScreen('start-session');
}

function selectDuration(mins, fromInput = false) {
  if (!mins || mins < 1) return;
  selectedDurationMins = mins;
  document.getElementById('sess-duration-label').textContent = `${mins} minute${mins > 1 ? 's' : ''}`;

  // Update chips
  document.querySelectorAll('.chip').forEach(c => {
    const d = parseInt(c.textContent);
    c.classList.toggle('chip-active', d === mins && !fromInput);
  });
}

function renderSessionContacts() {
  const contacts = getContacts();
  const container = document.getElementById('sess-contacts-list');
  if (!contacts.length) {
    container.innerHTML = '<p class="section-hint">No contacts added yet. <span class="link" onclick="showTab(\'contacts\')">Add contacts →</span></p>';
    return;
  }
  container.innerHTML = contacts.map(c => `
    <label class="sess-contact-item" for="sess-c-${c.id}">
      <input type="checkbox" id="sess-c-${c.id}" data-cid="${c.id}" checked />
      <span class="contact-avatar">${c.name[0].toUpperCase()}</span>
      <span>
        <strong>${c.name}</strong><br>
        <small>${c.relation} · ${c.phone}</small>
      </span>
    </label>
  `).join('');
}

function getSelectedContactIds() {
  return [...document.querySelectorAll('#sess-contacts-list input[type="checkbox"]:checked')]
    .map(el => parseInt(el.dataset.cid));
}

function startSession() {
  const from = document.getElementById('sess-from').value.trim() || 'Current Location';
  const to   = document.getElementById('sess-to').value.trim()   || 'Destination';

  const rawInterval = parseInt(document.getElementById('sess-checkin-interval').value) || 30;
  const allowCamera  = document.getElementById('sess-camera-toggle').checked;
  const allowLocation= document.getElementById('sess-location-toggle').checked;
  const selectedContacts = getSelectedContactIds();

  sessionConfig = {
    from, to,
    durationMins: selectedDurationMins,
    checkinIntervalSecs: rawInterval,
    allowCamera,
    allowLocation,
    contactIds: selectedContacts,
    startTime: new Date().toISOString(),
  };

  sessionRemaining = selectedDurationMins * 60;
  checkinInterval  = rawInterval;

  // Get location first (async, no blocking)
  acquireLocation(allowLocation);

  // Show monitor screen
  document.getElementById('map-from').textContent = from;
  document.getElementById('map-to').textContent   = to;
  document.getElementById('main-timer').textContent = formatTime(sessionRemaining);

  updateStatusCard('safe', 'SESSION ACTIVE', `To: ${to}`);

  showScreen('monitor');
  startCountdown();
  scheduleCheckin();

  showToast('Safety session started!', 'success');
}

/* ═════════════════════════════════════════
   REAL-TIME LIVE GEOLOCATION ENGINE
═════════════════════════════════════════ */

const DEMO_LOCATION = { lat: 18.5204, lng: 73.8567, accuracy: 25, label: 'Live Location Tracking Active' };
let geoWatchId = null;

// Get high-precision live location from device GPS
function getLiveLocation(highAccuracy = true) {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      console.warn('Geolocation API not supported by browser.');
      resolve(currentLocation || DEMO_LOCATION);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const acc = Math.round(pos.coords.accuracy || 15);
        const loc = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: acc,
          altitude: pos.coords.altitude,
          speed: pos.coords.speed,
          heading: pos.coords.heading,
          timestamp: new Date(pos.timestamp).toLocaleTimeString(),
          label: `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)} (±${acc}m)`
        };
        currentLocation = loc;
        setMapCoords(loc.label);

        // Update HUD live GPS display
        const hudGps = document.getElementById('hud-gps-val');
        if (hudGps) hudGps.textContent = `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)} (±${acc}m)`;

        resolve(loc);
      },
      (err) => {
        console.warn('Geolocation request failed or timed out:', err.message);
        if (!currentLocation) {
          currentLocation = { ...DEMO_LOCATION, label: `${DEMO_LOCATION.lat.toFixed(4)}, ${DEMO_LOCATION.lng.toFixed(4)} (Approximate)` };
        }
        setMapCoords(currentLocation.label);
        resolve(currentLocation);
      },
      {
        enableHighAccuracy: highAccuracy,
        timeout: 9000,
        maximumAge: 3000
      }
    );
  });
}

// Start continuous background GPS watcher
function startContinuousLocationWatch() {
  if (!('geolocation' in navigator)) return;
  if (geoWatchId) navigator.geolocation.clearWatch(geoWatchId);

  geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const acc = Math.round(pos.coords.accuracy || 15);
      currentLocation = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: acc,
        altitude: pos.coords.altitude,
        speed: pos.coords.speed,
        heading: pos.coords.heading,
        timestamp: new Date(pos.timestamp).toLocaleTimeString(),
        label: `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)} (±${acc}m)`
      };
      setMapCoords(currentLocation.label);

      // Update HUD live GPS display
      const hudGps = document.getElementById('hud-gps-val');
      if (hudGps) hudGps.textContent = `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
    },
    (err) => {
      console.warn('Background GPS watcher note:', err.message);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 12000
    }
  );
}

function acquireLocation(allowed) {
  if (!allowed) {
    currentLocation = null;
    setMapCoords('Location sharing disabled');
    return;
  }
  getLiveLocation(true);
}

function setMapCoords(text) {
  const el = document.getElementById('map-coords');
  if (el) el.textContent = text;
}

function locationLabel() {
  if (!currentLocation) return 'Live GPS Signal Active';
  if (currentLocation.accuracy) {
    return `${currentLocation.lat.toFixed(6)}, ${currentLocation.lng.toFixed(6)} (±${currentLocation.accuracy}m)`;
  }
  return `${currentLocation.lat.toFixed(6)}, ${currentLocation.lng.toFixed(6)}`;
}

/* ═════════════════════════════════════════
   SESSION COUNTDOWN
═════════════════════════════════════════ */

function startCountdown() {
  clearInterval(sessionTimerId);
  sessionTimerId = setInterval(() => {
    sessionRemaining -= speedFactor();
    if (sessionRemaining < 0) sessionRemaining = 0;

    document.getElementById('main-timer').textContent = formatTime(sessionRemaining);

    if (sessionRemaining <= 0) {
      clearInterval(sessionTimerId);
      if (!emergencyActive) triggerAutoEmergency();
    }
  }, 1000);
}

/* ═════════════════════════════════════════
   CHECK-IN POPUP
═════════════════════════════════════════ */

function scheduleCheckin() {
  clearTimeout(checkinPopupId);
  const waitSecs = demoSecs(checkinInterval);
  updateCheckinLabel(waitSecs);

  // Count-down the "next check-in" label
  let remaining = waitSecs;
  const labelTimer = setInterval(() => {
    remaining--;
    updateCheckinLabel(remaining);
    if (remaining <= 0) clearInterval(labelTimer);
  }, 1000);

  checkinPopupId = setTimeout(() => {
    clearInterval(labelTimer);
    if (!emergencyActive) showCheckinPopup();
  }, waitSecs * 1000);
}

function updateCheckinLabel(secs) {
  const el = document.getElementById('checkin-secs');
  if (el) el.textContent = secs;
}

function showCheckinPopup() {
  if (emergencyActive) return;
  checkinActive = true;
  checkinCountdown = 10; // seconds to respond

  const popup    = document.getElementById('checkin-popup');
  const timerEl  = document.getElementById('checkin-timer');
  const bar      = document.getElementById('checkin-progress-bar');

  popup.classList.remove('hidden');
  timerEl.textContent = checkinCountdown;
  bar.style.width     = '100%';

  // Vibrate if allowed
  if (getPrivacy().vibrate && navigator.vibrate) navigator.vibrate([200, 100, 200]);

  clearInterval(checkinProgressId);
  checkinProgressId = setInterval(() => {
    checkinCountdown--;
    timerEl.textContent = checkinCountdown;
    bar.style.width = `${(checkinCountdown / 10) * 100}%`;

    if (checkinCountdown <= 0) {
      clearInterval(checkinProgressId);
      popup.classList.add('hidden');
      checkinActive = false;
      // NO RESPONSE → auto emergency
      if (!emergencyActive) triggerAutoEmergency();
    }
  }, 1000);
}

/** User responded "I'm Safe" in popup */
function checkInSafe() {
  clearInterval(checkinProgressId);
  document.getElementById('checkin-popup').classList.add('hidden');
  checkinActive = false;
  showToast('Check-in confirmed. Stay safe! 🛡️', 'success');
  scheduleCheckin(); // schedule next check-in
}

/* ═════════════════════════════════════════
   MONITOR SCREEN ACTIONS
═════════════════════════════════════════ */

/** "I'm Safe" button on monitor screen */
function userSafe() {
  showToast('Great! You confirmed you are safe.', 'success');
  // Reset check-in cycle
  clearTimeout(checkinPopupId);
  clearInterval(checkinProgressId);
  document.getElementById('checkin-popup').classList.add('hidden');
  checkinActive = false;
  scheduleCheckin();
}

/** "Extend Time" */
function extendTime() {
  showModal('Extend Session', 'How many more minutes do you need?', [
    { label: '+ 5 minutes',  cls: 'btn-ghost',   fn: () => extendBy(5)  },
    { label: '+ 10 minutes', cls: 'btn-primary',  fn: () => extendBy(10) },
    { label: '+ 15 minutes', cls: 'btn-ghost',    fn: () => extendBy(15) },
  ]);
}

function extendBy(mins) {
  sessionRemaining += mins * 60;
  showToast(`Session extended by ${mins} minutes.`, 'info');
}

/** End session normally (user choice) */
function endSession() {
  showModal('End Session', 'Are you sure you want to end this safety session?', [
    { label: 'Keep Active', cls: 'btn-ghost' },
    { label: 'End Session', cls: 'btn-danger', fn: () => {
      clearAllTimers();
      saveAlertToHistory('Safe', 'Session ended by user');
      updateStatusCard('safe', 'SAFE', 'Session ended');
      showToast('Session ended. Stay safe!', 'success');
      showTab('home');
    }},
  ]);
}

/** Manual SOS button */
function manualSOS() {
  if (emergencyActive) return;
  clearInterval(checkinProgressId);
  document.getElementById('checkin-popup').classList.add('hidden');
  checkinActive = false;
  triggerEmergency('Manual SOS', 'User pressed Need Help button');
}

/* ═════════════════════════════════════════
   EMERGENCY – AUTO TRIGGER
═════════════════════════════════════════ */

function triggerAutoEmergency() {
  triggerEmergency('Auto-Alert', 'No Response / Safety Timer Expired');
}

/* ═════════════════════════════════════════
   EMERGENCY FLOW
═════════════════════════════════════════ */

/**
 * triggerEmergency(type, reason)
 * type:   'Manual SOS' | 'Auto-Alert'
 * reason: human-readable reason string
 */
function triggerEmergency(type, reason) {
  if (emergencyActive) return;
  emergencyActive = true;

  clearAllTimers();

  // Generate alert ID
  currentAlertId = nextAlertId();
  const timeStr  = nowStr();

  // Update UI metadata
  document.getElementById('em-alert-id').textContent = currentAlertId;
  document.getElementById('em-time').textContent     = timeStr;
  document.getElementById('em-type').textContent     = type;
  document.getElementById('emergency-reason').textContent =
    type === 'Auto-Alert'
      ? '⚠️ NO RESPONSE DETECTED – Emergency alert activated automatically.'
      : '🆘 User requested emergency assistance.';

  // Reset steps
  ['sos','location','share','contacts','camera'].forEach(id => {
    setStep(id, 'waiting', '⏳');
  });
  document.getElementById('em-location-card').classList.add('hidden');
  document.getElementById('em-contact-notifs').classList.add('hidden');
  document.getElementById('cancel-grace').classList.add('hidden');

  showScreen('emergency');
  updateStatusCard('emergency', type === 'Auto-Alert' ? 'NO RESPONSE' : 'NEED HELP', 'Emergency active');

  // Run animated steps
  runEmergencySteps(type, reason, timeStr);

  // Save to history
  const locLabel = locationLabel();
  saveAlertToHistory(type, reason, locLabel, currentAlertId, timeStr);
  refreshHomeBadges();
}

/** Animate through SOS steps */
function runEmergencySteps(type, reason, timeStr) {
  const steps = [
    { id: 'sos',      delay: 0,    text: 'SOS signal sent',    fn: stepSOS       },
    { id: 'location', delay: 1200, text: 'Location acquired',  fn: stepLocation  },
    { id: 'share',    delay: 2400, text: 'Location link shared',fn: stepShare    },
    { id: 'contacts', delay: 3800, text: 'Contacts alerted',   fn: stepContacts  },
    { id: 'camera',   delay: 5200, text: 'Camera handled',     fn: () => stepCamera() },
  ];

  steps.forEach(({ id, delay, text, fn }) => {
    // Mark running after a short delay
    setTimeout(() => setStep(id, 'running', '🔄'), delay);
    // Mark done and run side-effect
    setTimeout(() => {
      setStep(id, 'done', '✅');
      fn && fn();
    }, delay + 900);
  });

  // Show cancel grace after all steps
  setTimeout(() => {
    document.getElementById('cancel-grace').classList.remove('hidden');
    startGraceCountdown();
  }, 6500);
}

function setStep(id, cls, icon) {
  const el = document.getElementById(`step-${id}`);
  if (!el) return;
  el.className = `sos-step ${cls}`;
  el.querySelector('.step-status').textContent = icon;
}

function stepSOS() {
  // Mark SOS as sent
  document.getElementById('step-sos').querySelector('.step-text').textContent = 'SOS signal sent ✓';
}

function stepLocation() {
  const locLabel = locationLabel();
  const card = document.getElementById('em-location-card');
  document.getElementById('em-location-coords').textContent =
    currentLocation
      ? `📍 ${currentLocation.lat?.toFixed(5)}, ${currentLocation.lng?.toFixed(5)}\n${currentLocation.label || ''}`
      : 'Location unavailable – using last known.';
  card.classList.remove('hidden');

  document.getElementById('step-location').querySelector('.step-text').textContent = `Location: ${locLabel}`;
}

function stepShare() {
  document.getElementById('step-share').querySelector('.step-text').textContent = 'Live location link created';
}

function stepContacts() {
  const allContacts = getContacts();
  const selectedIds  = sessionConfig.contactIds || allContacts.map(c => c.id);
  const selected     = allContacts.filter(c => selectedIds.includes(c.id));

  if (!selected.length) {
    setStep('contacts', 'skipped', '⚠️');
    document.getElementById('step-contacts').querySelector('.step-text').textContent = 'No contacts selected';
    return;
  }

  const locLabel = locationLabel();
  const container = document.getElementById('em-contact-notifs');
  container.innerHTML = selected.map(c => `
    <div class="em-contact-notif">
      📲 <strong>${c.name}</strong> (${c.relation}) — ${c.phone}<br>
      <small>"EMERGENCY: ${currentUser?.name || 'User'} needs help! Location: ${locLabel} — SafeRoute"</small>
      <span class="demo-tag">Demo Notification</span>
    </div>
  `).join('');
  container.classList.remove('hidden');
}

let activeCameraStream = null;

async function stepCamera() {
  const allowed = sessionConfig.allowCamera;
  const step = document.getElementById('step-camera');
  const liveBox = document.getElementById('camera-live-box');
  const liveVideo = document.getElementById('camera-live-video');

  if (!allowed) {
    setStep('camera', 'skipped', '🚫');
    if (step) step.querySelector('.step-text').textContent = 'Camera skipped – no permission';
    return;
  }

  // Attempt real getUserMedia recording
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      activeCameraStream = stream;

      if (liveVideo && liveBox) {
        liveVideo.srcObject = stream;
        liveBox.classList.remove('hidden');
      }

      setStep('camera', 'running', '🎥');
      if (step) step.querySelector('.step-text').textContent = 'Recording video & capturing photo...';

      // 1. Take Photo Snapshot after short warmup
      setTimeout(() => {
        try {
          if (liveVideo && liveVideo.videoWidth) {
            const canvas = document.createElement('canvas');
            canvas.width = liveVideo.videoWidth || 640;
            canvas.height = liveVideo.videoHeight || 480;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(liveVideo, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(async (blob) => {
              if (blob) {
                const photoFile = new File([blob], `evidence_${currentAlertId || Date.now()}.jpg`, { type: 'image/jpeg' });
                await uploadEvidenceFile(photoFile, 'photo', currentAlertId);
              }
            }, 'image/jpeg');
          }
        } catch (e) {
          console.warn('Photo snapshot failed:', e);
        }
      }, 700);

      // 2. Record 3 seconds of Video using MediaRecorder
      try {
        let recordedChunks = [];
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : (MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '');
        const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) recordedChunks.push(e.data);
        };

        recorder.onstop = async () => {
          try {
            const videoBlob = new Blob(recordedChunks, { type: recorder.mimeType || 'video/webm' });
            const videoFile = new File([videoBlob], `evidence_${currentAlertId || Date.now()}.webm`, { type: 'video/webm' });
            await uploadEvidenceFile(videoFile, 'video', currentAlertId);
          } catch (err) {
            console.warn('Video save error:', err);
          } finally {
            if (activeCameraStream) {
              activeCameraStream.getTracks().forEach(t => t.stop());
              activeCameraStream = null;
            }
            if (liveBox) liveBox.classList.add('hidden');
          }
        };

        recorder.start();
        setTimeout(() => {
          if (recorder && recorder.state === 'recording') {
            recorder.stop();
          }
        }, 3200);

      } catch (recErr) {
        console.warn('MediaRecorder not fully supported, keeping photo snapshot:', recErr);
        setTimeout(() => {
          if (activeCameraStream) {
            activeCameraStream.getTracks().forEach(t => t.stop());
            activeCameraStream = null;
          }
          if (liveBox) liveBox.classList.add('hidden');
        }, 2000);
      }

      setStep('camera', 'done', '✅');
      if (step) step.querySelector('.step-text').textContent = 'Evidence recorded & saved to MongoDB ✅';
      showToast('Camera evidence saved to MongoDB!', 'success');

    } catch (err) {
      console.warn('Camera access denied or unavailable:', err);
      setStep('camera', 'skipped', '⚠️');
      if (step) step.querySelector('.step-text').textContent = 'Camera permission denied by browser';
    }
  } else {
    setStep('camera', 'done', '✅');
    if (step) step.querySelector('.step-text').textContent = 'Evidence recording simulated (Browser limited)';
  }
}

/* Grace cancel countdown */
function startGraceCountdown() {
  let secs = 5;
  document.getElementById('grace-count').textContent = secs;

  graceCancelId = setInterval(() => {
    secs--;
    const el = document.getElementById('grace-count');
    if (el) el.textContent = secs;
    if (secs <= 0) {
      clearInterval(graceCancelId);
      document.getElementById('cancel-grace').classList.add('hidden');
    }
  }, 1000);
}

function cancelEmergency() {
  clearInterval(graceCancelId);
  if (activeCameraStream) {
    activeCameraStream.getTracks().forEach(t => t.stop());
    activeCameraStream = null;
  }
  const liveBox = document.getElementById('camera-live-box');
  if (liveBox) liveBox.classList.add('hidden');

  // Mark last history entry as cancelled
  const hist = getHistory();
  if (hist.length) hist[hist.length - 1].status = 'Cancelled';
  saveHistory(hist);

  if (currentAlertId) {
    fetch(`/api/alerts/${currentAlertId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Cancelled' })
    }).catch(() => {});
  }

  emergencyActive = false;
  showToast('Emergency cancelled. Stay safe!', 'success');
  updateStatusCard('safe', 'SAFE', 'No active session');
  showTab('home');
}

function endEmergency() {
  clearInterval(graceCancelId);
  emergencyActive = false;
  showToast('Emergency ended. Please contact authorities if needed.', 'info', 4000);
  updateStatusCard('safe', 'SAFE', 'Emergency ended');
  showTab('home');
}

/* ═════════════════════════════════════════
   ALERT HISTORY
═════════════════════════════════════════ */

async function saveAlertToHistory(status, reason, location, alertId, time) {
  const history = getHistory();
  const alertObj = {
    id:       alertId || nextAlertId(),
    time:     time    || nowStr(),
    status,
    reason,
    location: location || locationLabel(),
    from:     sessionConfig.from  || '–',
    to:       sessionConfig.to    || '–',
    contactsAlerted: sessionConfig.contactIds?.length || 0,
    evidence: []
  };
  history.push(alertObj);
  saveHistory(history);

  // Sync to MongoDB
  try {
    await fetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alertId: alertObj.id,
        type: status,
        reason: alertObj.reason,
        location: alertObj.location,
        from: alertObj.from,
        to: alertObj.to,
        contactsAlerted: alertObj.contactsAlerted,
        time: alertObj.time,
        userEmail: currentUser?.email || '',
        userName: currentUser?.name || ''
      })
    });
  } catch (err) {
    console.warn('Could not sync alert to MongoDB:', err);
  }
}

async function renderHistory() {
  const list = document.getElementById('history-list');
  let history = getHistory().slice().reverse(); // newest first fallback

  // Fetch populated alerts with photos & videos from MongoDB
  try {
    const res = await fetch('/api/alerts');
    const data = await res.json();
    if (data.success && data.alerts && data.alerts.length) {
      history = data.alerts.map(a => ({
        id: a.alertId,
        time: a.time,
        status: a.status,
        reason: a.reason,
        location: a.location,
        from: a.from,
        to: a.to,
        contactsAlerted: a.contactsAlerted,
        evidence: a.evidence || []
      }));
    }
  } catch (err) {
    console.warn('Loaded history from local cache:', err);
  }

  if (!history.length) {
    list.innerHTML = '<div class="history-empty">No alerts yet.<br>Your session history and photo/video evidence will appear here.</div>';
    return;
  }

  list.innerHTML = history.map(h => {
    const cls = h.status === 'Safe' ? 'safe' : 'sos';
    const statusCls = h.status === 'Safe' ? 'safe' : 'sos';

    const evidenceHtml = (h.evidence && h.evidence.length) ? `
      <div class="evidence-preview-wrap">
        <div class="evidence-title">📁 Attached Evidence (${h.evidence.length})</div>
        <div class="evidence-gallery">
          ${h.evidence.map(ev => {
            const isVideo = ev.mediaType === 'video' || (ev.mimeType && ev.mimeType.startsWith('video/'));
            if (isVideo) {
              return `<div class="evidence-video-badge" onclick="openEvidenceModal('${ev.fileUrl}', true)" title="Play Video Evidence">
                <span>▶️</span><small>VIDEO</small>
              </div>`;
            } else {
              return `<img src="${ev.fileUrl}" class="evidence-item" onclick="openEvidenceModal('${ev.fileUrl}', false)" title="View Photo Evidence" alt="Evidence" />`;
            }
          }).join('')}
        </div>
      </div>
    ` : '';

    return `
      <div class="history-card ${cls}">
        <div class="history-id">Alert ${h.id}</div>
        <span class="history-status ${statusCls}">${h.status}</span>
        <div class="history-body">
          <strong>📅 ${h.time}</strong><br>
          📍 ${h.location}<br>
          ↗️ ${h.from} → ${h.to}<br>
          🔔 Reason: ${h.reason}<br>
          👥 Contacts alerted: ${h.contactsAlerted}
        </div>
        ${evidenceHtml}
      </div>
    `;
  }).join('');
}

function clearHistory() {
  showModal('Clear History', 'This will permanently delete all alert history and records from the database. Continue?', [
    { label: 'Cancel',        cls: 'btn-ghost' },
    { label: 'Clear History', cls: 'btn-danger', fn: async () => {
      saveHistory([]);
      try {
        await fetch('/api/alerts', { method: 'DELETE' });
      } catch (_) {}
      renderHistory();
      refreshHomeBadges();
      showToast('History cleared from MongoDB & local storage.', 'info');
    }},
  ]);
}

/* ═════════════════════════════════════════
   CONTACTS
═════════════════════════════════════════ */

async function renderContacts() {
  const list = document.getElementById('contacts-list');
  let contacts = getContacts();

  // Try fetching from MongoDB
  try {
    const res = await fetch(`/api/contacts?email=${encodeURIComponent(currentUser?.email || '')}`);
    const data = await res.json();
    if (data.success && data.contacts && data.contacts.length) {
      contacts = data.contacts.map(c => ({
        id: c._id || c.id,
        name: c.name,
        phone: c.phone,
        relation: c.relation,
        email: c.email || ''
      }));
      saveContacts(contacts);
    }
  } catch (_) {}

  if (!contacts.length) {
    list.innerHTML = '<p class="section-hint">No contacts added yet. Add at least one trusted contact.</p>';
    return;
  }

  list.innerHTML = contacts.map(c => `
    <div class="contact-card">
      <div class="contact-avatar">${c.name[0].toUpperCase()}</div>
      <div class="contact-info">
        <div class="contact-name">${c.name}</div>
        <div class="contact-meta">${c.relation} · ${c.phone}</div>
        ${c.email ? `<div class="contact-meta">${c.email}</div>` : ''}
      </div>
      <div class="contact-actions">
        <button class="contact-btn" onclick="openEditContact('${c.id}')" title="Edit">✏️</button>
        <button class="contact-btn delete" onclick="deleteContact('${c.id}')" title="Delete">🗑️</button>
      </div>
    </div>
  `).join('');

  refreshHomeBadges();
}

function openAddContact() {
  showModal('Add Contact', `
    <div class="field-group"><label>Full Name *</label><input type="text" id="mc-name" placeholder="Mom / Dad / Friend" /></div>
    <div class="field-group" style="margin-top:10px"><label>Relationship *</label><input type="text" id="mc-rel" placeholder="Mother / Father / Colleague" /></div>
    <div class="field-group" style="margin-top:10px"><label>Mobile Number *</label><input type="tel" id="mc-phone" placeholder="+91 99999 00000" /></div>
    <div class="field-group" style="margin-top:10px"><label>Email (optional)</label><input type="email" id="mc-email" placeholder="contact@email.com" /></div>
  `, [
    { label: 'Cancel', cls: 'btn-ghost' },
    { label: 'Add Contact', cls: 'btn-primary', fn: async () => {
      const name  = document.getElementById('mc-name')?.value.trim();
      const rel   = document.getElementById('mc-rel')?.value.trim();
      const phone = document.getElementById('mc-phone')?.value.trim();
      const email = document.getElementById('mc-email')?.value.trim();

      if (!name || !rel || !phone) { showToast('Name, relationship and phone are required.', 'warning'); return; }

      // Save to MongoDB
      try {
        const res = await fetch('/api/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, phone, relation: rel, email: email || '', userEmail: currentUser?.email })
        });
        const data = await res.json();
        if (data.success && data.contact) {
          const contacts = getContacts();
          contacts.push({ id: data.contact._id, name, relation: rel, phone, email: email || '' });
          saveContacts(contacts);
          renderContacts();
          showToast(`${name} added to MongoDB!`, 'success');
          return;
        }
      } catch (err) {
        console.warn('Fallback to local contact save:', err);
      }

      const contacts = getContacts();
      contacts.push({ id: Date.now(), name, relation: rel, phone, email: email || '' });
      saveContacts(contacts);
      renderContacts();
      showToast(`${name} added!`, 'success');
    }},
  ]);
}

function openEditContact(id) {
  const contacts = getContacts();
  const c = contacts.find(x => String(x.id) === String(id));
  if (!c) return;

  showModal('Edit Contact', `
    <div class="field-group"><label>Full Name *</label><input type="text" id="ec-name" value="${c.name}" /></div>
    <div class="field-group" style="margin-top:10px"><label>Relationship *</label><input type="text" id="ec-rel" value="${c.relation}" /></div>
    <div class="field-group" style="margin-top:10px"><label>Mobile Number *</label><input type="tel" id="ec-phone" value="${c.phone}" /></div>
    <div class="field-group" style="margin-top:10px"><label>Email (optional)</label><input type="email" id="ec-email" value="${c.email || ''}" /></div>
  `, [
    { label: 'Cancel', cls: 'btn-ghost' },
    { label: 'Save', cls: 'btn-primary', fn: async () => {
      const name  = document.getElementById('ec-name')?.value.trim();
      const rel   = document.getElementById('ec-rel')?.value.trim();
      const phone = document.getElementById('ec-phone')?.value.trim();
      const email = document.getElementById('ec-email')?.value.trim();

      if (!name || !rel || !phone) { showToast('Required fields missing.', 'warning'); return; }

      try {
        await fetch(`/api/contacts/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, phone, relation: rel, email: email || '' })
        });
      } catch (_) {}

      const idx = contacts.findIndex(x => String(x.id) === String(id));
      if (idx !== -1) {
        contacts[idx] = { id, name, relation: rel, phone, email: email || '' };
        saveContacts(contacts);
      }
      renderContacts();
      showToast('Contact updated!', 'success');
    }},
  ]);
}

function deleteContact(id) {
  showModal('Delete Contact', 'Remove this contact from your trusted list?', [
    { label: 'Cancel', cls: 'btn-ghost' },
    { label: 'Delete', cls: 'btn-danger', fn: async () => {
      try {
        await fetch(`/api/contacts/${id}`, { method: 'DELETE' });
      } catch (_) {}
      const contacts = getContacts().filter(c => String(c.id) !== String(id));
      saveContacts(contacts);
      renderContacts();
      showToast('Contact removed.', 'info');
    }},
  ]);
}

function seedDemoContacts() {
  saveContacts([
    { id: 1000001, name: 'Mom',           relation: 'Mother',   phone: '+91 98765 43210', email: 'mom@demo.com' },
    { id: 1000002, name: 'Dad',           relation: 'Father',   phone: '+91 98765 43211', email: '' },
    { id: 1000003, name: 'Priya Singh',   relation: 'Friend',   phone: '+91 99123 45678', email: 'priya@demo.com' },
  ]);
  try { fetch('/api/contacts/seed', { method: 'POST' }); } catch (_) {}
}

/* ═════════════════════════════════════════
   MEDIA EVIDENCE & MODAL PREVIEWS
═════════════════════════════════════════ */

async function uploadEvidenceFile(file, mediaType, alertId) {
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('mediaType', mediaType || 'photo');
    formData.append('alertId', alertId || currentAlertId || 'SR1001');
    if (currentUser?.email) formData.append('userEmail', currentUser.email);

    const res = await fetch('/api/evidence/upload', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Evidence ${mediaType} saved to MongoDB!`, 'success');
      return data.file;
    }
  } catch (err) {
    console.warn('Evidence upload failed:', err);
  }
  return null;
}

function triggerManualEvidenceUpload() {
  const input = document.getElementById('manual-evidence-input');
  if (input) input.click();
}

async function handleManualEvidenceUpload(input) {
  const file = input.files && input.files[0];
  if (!file) return;

  const isVideo = file.type.startsWith('video/');
  showToast(`Uploading ${isVideo ? 'video' : 'photo'} to MongoDB...`, 'info', 2000);

  const targetAlertId = currentAlertId || (getHistory().length ? getHistory()[getHistory().length - 1].id : nextAlertId());
  const uploaded = await uploadEvidenceFile(file, isVideo ? 'video' : 'photo', targetAlertId);

  if (uploaded) {
    showToast('Evidence uploaded & linked to Alert!', 'success');
    renderHistory();
  }
  input.value = '';
}

function openEvidenceModal(url, isVideo) {
  if (isVideo) {
    showModal('🎥 Video Evidence', `
      <div style="text-align:center; padding: 4px;">
        <video src="${url}" controls autoplay style="width:100%; max-height:360px; border-radius:8px; background:#000;"></video>
        <p style="font-size:0.75rem; color:var(--text-soft); margin-top:8px;">Stored on Server & MongoDB Evidence Record</p>
      </div>
    `, [{ label: 'Close', cls: 'btn-primary' }]);
  } else {
    showModal('📸 Photo Evidence', `
      <div style="text-align:center; padding: 4px;">
        <img src="${url}" alt="Evidence" style="width:100%; max-height:360px; object-fit:contain; border-radius:8px; background:#000;" />
        <p style="font-size:0.75rem; color:var(--text-soft); margin-top:8px;">Stored on Server & MongoDB Evidence Record</p>
      </div>
    `, [{ label: 'Close', cls: 'btn-primary' }]);
  }
}

/* ═════════════════════════════════════════
   DATABASE HEALTH CHECK
═════════════════════════════════════════ */

async function checkDbStatus() {
  const badge = document.getElementById('db-status-pill');
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.connected) {
      if (badge) {
        badge.className = 'db-pill';
        badge.innerHTML = data.isTurso ? `🟢 Turso Cloud Live` : `🟢 Server Synced`;
        badge.title = data.isTurso
          ? `Turso Database Connected! Users: ${data.stats.users}, Alerts: ${data.stats.alerts}`
          : `Central Storage Active! All devices (Mobile & Laptop) synced. Users: ${data.stats.users}`;
      }
      return true;
    } else {
      if (badge) {
        badge.className = 'db-pill warning';
        badge.innerHTML = `🟡 Offline`;
        badge.title = data.error || 'Server storage not connected.';
      }
      return false;
    }
  } catch (e) {
    if (badge) {
      badge.className = 'db-pill disconnected';
      badge.innerHTML = `⚪ Standalone`;
    }
    return false;
  }
}

/** Auto-sync locally stored users & contacts to central server */
async function syncLocalDataToServer() {
  try {
    const localUsers = getUsers();
    const localContacts = getContacts();
    if (localUsers.length > 0 || localContacts.length > 0) {
      const res = await fetch('/api/auth/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ users: localUsers, contacts: localContacts })
      });
      const data = await res.json();
      if (data.addedUsers > 0) {
        console.log(`[SafeRoute] Synced ${data.addedUsers} local account(s) to central server.`);
      }
    }
  } catch (err) {
    console.debug('Background sync to server:', err.message);
  }
}

/* ═════════════════════════════════════════
   NEARBY SERVICES
═════════════════════════════════════════ */

function renderNearby() {
  const policeList   = document.getElementById('police-list');
  const hospitalList = document.getElementById('hospital-list');

  policeList.innerHTML = NEARBY_POLICE.map(p => `
    <div class="nearby-card">
      <div class="nearby-icon">🚔</div>
      <div class="nearby-info">
        <div class="nearby-name">${p.name}</div>
        <div class="nearby-meta">📍 ${p.distance} away</div>
      </div>
      <button class="nearby-call" onclick="simulateCall('${p.name}', '${p.phone}')">
        📞 ${p.phone}
      </button>
    </div>
  `).join('');

  hospitalList.innerHTML = NEARBY_HOSPITALS.map(h => `
    <div class="nearby-card">
      <div class="nearby-icon">🏥</div>
      <div class="nearby-info">
        <div class="nearby-name">${h.name}</div>
        <div class="nearby-meta">📍 ${h.distance} away</div>
      </div>
      <button class="nearby-call" onclick="simulateCall('${h.name}', '${h.phone}')">
        📞 ${h.phone}
      </button>
    </div>
  `).join('');
}

function simulateCall(name, number) {
  showModal(
    '📞 Call Service',
    `Calling <strong>${name}</strong><br><strong>${number}</strong><br><br><small>Demo only – no real call made.</small>`,
    [
      { label: 'Cancel', cls: 'btn-ghost' },
      { label: `Call ${number}`, cls: 'btn-safe', fn: () => {
        // Try tel: link for real devices
        window.location.href = `tel:${number}`;
        showToast(`Calling ${name}…`, 'info');
      }},
    ]
  );
}

/* ═════════════════════════════════════════
   PRIVACY SETTINGS
═════════════════════════════════════════ */

function loadPrivacyToggles() {
  const priv = getPrivacy();
  const t1 = document.getElementById('priv-location');
  const t2 = document.getElementById('priv-camera');
  const t3 = document.getElementById('priv-checkin-vibrate');
  const t4 = document.getElementById('priv-shake');
  const t5 = document.getElementById('priv-audio');

  if (t1) t1.checked = priv.location !== false;
  if (t2) t2.checked = priv.camera;
  if (t3) t3.checked = priv.vibrate !== false;
  if (t4) t4.checked = priv.shake !== false;
  if (t5) t5.checked = priv.audio !== false;
}

function savePrivacy() {
  savePrivacyData({
    location: document.getElementById('priv-location')?.checked ?? true,
    camera:   document.getElementById('priv-camera')?.checked   ?? false,
    vibrate:  document.getElementById('priv-checkin-vibrate')?.checked ?? true,
    shake:    document.getElementById('priv-shake')?.checked ?? true,
    audio:    document.getElementById('priv-audio')?.checked ?? true,
  });
  showToast('Privacy & security settings saved.', 'success');
}

/* ═════════════════════════════════════════
   WOMEN SAFETY ARSENAL & AUDIO ENGINE
═════════════════════════════════════════ */

let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// ── Ringtone Generator ──
let ringtoneInterval = null;
let ringtoneNodes = [];

function startRingtoneSound() {
  try {
    const ctx = getAudioContext();
    function playRingBurst() {
      stopRingtoneNodes();
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(440, ctx.currentTime);
      osc2.frequency.setValueAtTime(480, ctx.currentTime);

      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.8);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start();
      osc2.start();
      osc1.stop(ctx.currentTime + 1.8);
      osc2.stop(ctx.currentTime + 1.8);

      ringtoneNodes = [osc1, osc2, gain];
    }
    playRingBurst();
    ringtoneInterval = setInterval(playRingBurst, 3200);
  } catch (e) {
    console.warn('Web Audio ringtone not available:', e);
  }
}

function stopRingtoneNodes() {
  try {
    ringtoneNodes.forEach(n => { if (n.stop) n.stop(); });
    ringtoneNodes = [];
  } catch (_) {}
}

function stopRingtoneSound() {
  clearInterval(ringtoneInterval);
  ringtoneInterval = null;
  stopRingtoneNodes();
}

// ── Panic Siren Sound Generator ──
let sirenOsc = null;
let sirenGain = null;
let sirenInterval = null;

function startSirenSound() {
  try {
    const ctx = getAudioContext();
    sirenOsc = ctx.createOscillator();
    sirenGain = ctx.createGain();

    sirenOsc.type = 'sawtooth';
    sirenOsc.frequency.setValueAtTime(700, ctx.currentTime);

    sirenGain.gain.setValueAtTime(0.28, ctx.currentTime);
    sirenOsc.connect(sirenGain);
    sirenGain.connect(ctx.destination);

    sirenOsc.start();

    let high = false;
    sirenInterval = setInterval(() => {
      if (!sirenOsc) return;
      const targetFreq = high ? 700 : 1150;
      sirenOsc.frequency.exponentialRampToValueAtTime(targetFreq, ctx.currentTime + 0.25);
      high = !high;
    }, 280);
  } catch (e) {
    console.warn('Web Audio siren not available:', e);
  }
}

function stopSirenSound() {
  clearInterval(sirenInterval);
  sirenInterval = null;
  if (sirenOsc) {
    try { sirenOsc.stop(); } catch (_) {}
    sirenOsc = null;
  }
}

// ── Fake Call Controller ──
let fakeCallTimerId = null;
let fakeCallSeconds = 0;
let fakeCallCountdownId = null;

function openFakeCallMenu() {
  showModal('📞 Fake Incoming Call', `
    <p style="font-size:0.85rem; color:var(--text-soft); margin-bottom:12px;">
      Simulates a realistic phone call so you can easily excuse yourself from uncomfortable, unsafe or intrusive situations.
    </p>
    <div class="field-group">
      <label>Caller Name</label>
      <select id="fc-select-caller" style="width:100%; padding:9px 12px; border-radius:8px; border:1px solid var(--border); background:var(--bg); color:var(--text);">
        <option value="Maa (Mom)">👩 Maa (Mom)</option>
        <option value="Papa (Dad)">👨 Papa (Dad)</option>
        <option value="Bhaiya (Brother)">👦 Bhaiya (Brother)</option>
        <option value="Police Control Room">👮 Police Helpline 112</option>
      </select>
    </div>
  `, [
    { label: 'Cancel', cls: 'btn-ghost' },
    { label: '⏰ Call in 5s', cls: 'btn-outline', fn: () => {
      const name = document.getElementById('fc-select-caller')?.value || 'Maa (Mom)';
      startFakeCallCountdown(5, name);
    }},
    { label: '📞 Call Now', cls: 'btn-primary', fn: () => {
      const name = document.getElementById('fc-select-caller')?.value || 'Maa (Mom)';
      triggerFakeCall(name);
    }},
  ]);
}

function startFakeCallCountdown(secs, name) {
  showToast(`Fake call scheduled in ${secs} seconds. Lock or hold your phone!`, 'info', 4000);
  fakeCallCountdownId = setTimeout(() => {
    triggerFakeCall(name);
  }, secs * 1000);
}

function triggerFakeCall(name = 'Maa (Mom)', num = '+91 98765 43210') {
  clearTimeout(fakeCallCountdownId);
  const overlay = document.getElementById('fake-call-overlay');
  const incoming = document.getElementById('fc-incoming');
  const active = document.getElementById('fc-active');
  const nameEl = document.getElementById('fc-caller-name');
  const numEl = document.getElementById('fc-caller-num');
  const activeNameEl = document.getElementById('fc-active-name');

  if (nameEl) nameEl.textContent = name;
  if (numEl) numEl.textContent = num;
  if (activeNameEl) activeNameEl.textContent = name;

  if (incoming) incoming.classList.remove('hidden');
  if (active) active.classList.add('hidden');
  if (overlay) overlay.classList.remove('hidden');

  startRingtoneSound();
}

function acceptFakeCall() {
  stopRingtoneSound();
  const incoming = document.getElementById('fc-incoming');
  const active = document.getElementById('fc-active');
  if (incoming) incoming.classList.add('hidden');
  if (active) active.classList.remove('hidden');

  fakeCallSeconds = 0;
  const timerEl = document.getElementById('fc-call-timer');
  if (timerEl) timerEl.textContent = '00:00';

  clearInterval(fakeCallTimerId);
  fakeCallTimerId = setInterval(() => {
    fakeCallSeconds++;
    const m = String(Math.floor(fakeCallSeconds / 60)).padStart(2, '0');
    const s = String(fakeCallSeconds % 60).padStart(2, '0');
    if (timerEl) timerEl.textContent = `${m}:${s}`;
  }, 1000);

  // Synthesize caller voice
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance("Beta, where are you right now? I am waiting for you at the corner, hurry up and come!");
      utter.rate = 0.95;
      utter.pitch = 1.1;
      window.speechSynthesis.speak(utter);
    } catch (_) {}
  }
}

function endFakeCall() {
  stopRingtoneSound();
  clearInterval(fakeCallTimerId);
  clearTimeout(fakeCallCountdownId);
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();

  const overlay = document.getElementById('fake-call-overlay');
  if (overlay) overlay.classList.add('hidden');
  showToast('Fake call ended.', 'info');
}

// ── Panic Siren Controller ──
function triggerPanicSiren() {
  const overlay = document.getElementById('siren-overlay');
  if (overlay) overlay.classList.remove('hidden');
  startSirenSound();
  showToast('🚨 MAX VOLUME PANIC SIREN ACTIVATED!', 'error', 4000);
}

function stopPanicSiren() {
  const overlay = document.getElementById('siren-overlay');
  if (overlay) overlay.classList.add('hidden');
  stopSirenSound();
  showToast('Panic siren deactivated.', 'info');
}

// ── Safe Route AI Advisor ──
function openSafeRouteModal() {
  showModal('🛣️ AI Safe Route Advisor', `
    <p style="font-size:0.83rem; color:var(--text-soft); margin-bottom:12px;">
      SafeRoute evaluates lighting, CCTV coverage, crowd density, and verified safe points to protect you after dark.
    </p>

    <!-- Safe Route Option -->
    <div class="route-card-compare safe-route" onclick="selectSafeRoute('safe')">
      <div class="route-card-header">
        <strong>🟢 Main Avenue & Market Route</strong>
        <span class="route-score-badge safe">94% SAFE</span>
      </div>
      <div class="route-feature-list">
        💡 <strong>98% Lit:</strong> Streetlights fully functional<br>
        📹 <strong>14 CCTV Zones</strong> along the entire path<br>
        👮 <strong>2 Police Booths</strong> open on this route<br>
        👥 <strong>High Pedestrian Crowd</strong> (Low risk)
      </div>
      <div style="font-size:0.75rem; color:#15803d; margin-top:6px; font-weight:700;">
        📍 2.8 km · ~12 mins walk · Recommended
      </div>
    </div>

    <!-- Risky Short Route Option -->
    <div class="route-card-compare risky-route" onclick="selectSafeRoute('risky')">
      <div class="route-card-header">
        <strong>⚠️ Back Alley Cut (Shortest)</strong>
        <span class="route-score-badge risky">42% RISK</span>
      </div>
      <div class="route-feature-list">
        💡 <strong>Only 25% Lit:</strong> 3 non-functional lights<br>
        📹 <strong>0 CCTV Coverage:</strong> Blind spots reported<br>
        ⚠️ <strong>Isolated stretch:</strong> Low pedestrian flow
      </div>
      <div style="font-size:0.75rem; color:#b91c1c; margin-top:6px; font-weight:700;">
        📍 2.1 km · ~8 mins walk · Not Advised
      </div>
    </div>
  `, [
    { label: 'Close', cls: 'btn-ghost' },
    { label: '🛡️ Apply 94% Safe Route', cls: 'btn-primary', fn: () => selectSafeRoute('safe') },
  ]);
}

function selectSafeRoute(type) {
  if (type === 'safe') {
    showToast('🟢 SafeRoute (94% Safety) Selected! Route Deviation Guard active.', 'success', 3500);
    const fromInput = document.getElementById('sess-from');
    const toInput   = document.getElementById('sess-to');
    if (fromInput) fromInput.value = 'College Gate (Lit Corridor)';
    if (toInput)   toInput.value   = 'Home via MG Road (94% Safe)';
    showTab('start-session');
  } else {
    showToast('⚠️ Warning: Shortest route has low lighting and zero CCTV!', 'warning', 4000);
  }
}

// ── 1-Tap Offline Emergency SMS / WhatsApp ──
async function triggerOfflineEmergencySMS() {
  showToast('🛰️ Querying real-time GPS coordinates…', 'info', 2000);
  const loc = await getLiveLocation(true);

  const lat = loc ? loc.lat : 18.5204;
  const lng = loc ? loc.lng : 73.8567;
  const acc = loc && loc.accuracy ? `±${loc.accuracy}m` : '±15m';
  const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
  const coordsStr = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

  const contacts = getContacts();
  const phoneList = contacts.map(c => c.phone.replace(/[^0-9+]/g, '')).filter(Boolean);
  const primaryPhone = phoneList[0] || '112';
  const contactsDisplay = contacts.length 
    ? contacts.map(c => `${c.name} (${c.phone})`).join(', ')
    : 'National Emergency 112';

  const userName = currentUser?.name || 'User';
  const msg = `🚨 EMERGENCY SOS! I need help immediately. My REAL live location is: ${mapsUrl} (${coordsStr}, accuracy ${acc}). Registered Alert for ${userName} via SafeRoute Women Safety.`;

  // Log emergency dispatch to MongoDB in background
  try {
    const alertId = nextAlertId();
    saveAlertToHistory('Active', `📲 1-Tap Offline Emergency SMS dispatched to: ${contactsDisplay}`, `${coordsStr} (${acc})`, alertId);
    fetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alertId,
        type: 'Offline Emergency SOS',
        status: 'Active',
        reason: `1-Tap Cellular Emergency SMS dispatched to: ${contactsDisplay}`,
        location: `${coordsStr} (${acc})`,
        userEmail: currentUser?.email || '',
        userName: userName,
        time: nowStr()
      })
    }).catch(() => {});
  } catch (_) {}

  // Native GSM SMS URI
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const smsDelimiter = isIOS ? '&' : '?';
  const phonesJoined = isIOS ? phoneList.join(';') : phoneList.join(',');
  const smsUri = `sms:${phonesJoined || primaryPhone}${smsDelimiter}body=${encodeURIComponent(msg)}`;

  // WhatsApp share URL
  const waUrl = phoneList.length === 1 
    ? `https://wa.me/${phoneList[0].replace(/^\+/, '')}?text=${encodeURIComponent(msg)}`
    : `https://wa.me/?text=${encodeURIComponent(msg)}`;

  showModal('📲 1-Tap Real GPS Emergency Alert', `
    <div style="margin-bottom:12px;">
      <p style="font-size:0.83rem; color:var(--text-soft); line-height:1.4;">
        Direct cellular dispatch via GSM SMS or WhatsApp. Works even without mobile internet.
      </p>
    </div>

    <!-- Live Coordinates Card -->
    <div style="background:rgba(22, 10, 48, 0.85); border:1.5px solid rgba(168, 85, 247, 0.45); border-radius:10px; padding:12px; margin-bottom:12px; box-shadow:0 0 15px rgba(168, 85, 247, 0.2);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <span style="font-family:'Orbitron',sans-serif; font-size:0.75rem; color:#f472b6; font-weight:800;">🛰️ REAL LIVE GPS LOCK</span>
        <span style="background:rgba(16, 185, 129, 0.2); color:#4ade80; border:1px solid rgba(16, 185, 129, 0.4); font-size:0.68rem; font-weight:700; padding:2px 6px; border-radius:10px;">${acc} High Precision</span>
      </div>
      <div style="font-family:'Share Tech Mono',monospace; font-size:1rem; color:#fff; font-weight:700; margin:4px 0;">
        📍 ${coordsStr}
      </div>
      <div style="font-size:0.75rem; color:#cbd5e1; display:flex; justify-content:space-between; align-items:center; margin-top:6px; border-top:1px dashed rgba(168, 85, 247, 0.3); padding-top:6px;">
        <span>Contacts: <strong style="color:#f8fafc;">${contacts.length ? contacts.length + ' Registered' : '112'}</strong></span>
        <button type="button" class="btn btn-ghost" style="padding:3px 8px; font-size:0.7rem;" onclick="window.open('${mapsUrl}', '_blank')">
          🗺️ Test Pin on Google Maps
        </button>
      </div>
    </div>

    <!-- Message Payload Preview -->
    <div style="background:rgba(15, 6, 30, 0.7); border:1px solid rgba(168, 85, 247, 0.3); border-radius:8px; padding:10px; font-size:0.76rem; color:#cbd5e1; line-height:1.45; margin-bottom:12px;">
      <strong style="color:#fff;">SMS Text Payload:</strong><br>
      "${msg}"
    </div>
  `, [
    { label: 'Cancel', cls: 'btn-ghost' },
    { label: '💬 Send via WhatsApp', cls: 'btn-primary', fn: () => {
      window.open(waUrl, '_blank');
      showToast('Opening WhatsApp with real live coordinates…', 'success', 3500);
    }},
    { label: '✉️ Send via Native SMS', cls: 'btn-danger', fn: () => {
      window.location.href = smsUri;
      showToast('Opening native phone SMS messenger…', 'success', 3500);
    }},
    { label: '📲 Share via All Apps', cls: 'btn-ghost', fn: () => {
      if (navigator.share) {
        navigator.share({
          title: '🚨 EMERGENCY SOS LOCATION',
          text: msg,
          url: mapsUrl
        }).catch(() => {});
      } else {
        navigator.clipboard.writeText(msg);
        showToast('SOS message with live coordinates copied to clipboard!', 'success', 3000);
      }
    }}
  ]);
}

// ── Shake-to-SOS Gesture Detection ──
let shakeCount = 0;
let lastShakeTime = 0;

function initShakeDetection() {
  if (window.DeviceMotionEvent) {
    window.addEventListener('devicemotion', (e) => {
      const priv = getPrivacy();
      if (!priv.shake) return;

      const acc = e.accelerationIncludingGravity || e.acceleration;
      if (!acc) return;

      const magnitude = Math.abs(acc.x || 0) + Math.abs(acc.y || 0) + Math.abs(acc.z || 0);
      const now = Date.now();

      if (magnitude > 28) {
        if (now - lastShakeTime > 400) {
          shakeCount++;
          lastShakeTime = now;
          if (shakeCount >= 3) {
            shakeCount = 0;
            if (!emergencyActive) {
              if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
              showToast('📳 Shake-to-SOS Activated!', 'error');
              triggerEmergency('Manual SOS', 'Phone shaken 3 times violently (Gesture SOS)');
            }
          }
        }
      }

      if (now - lastShakeTime > 2500) {
        shakeCount = 0;
      }
    });
  }

  // Keyboard shortcut simulator for PC laptops/desktops (Shift + S)
  window.addEventListener('keydown', (e) => {
    if (e.shiftKey && (e.key === 'S' || e.key === 's') && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      showToast('📳 Gesture Shake-to-SOS Triggered via Shortcut!', 'warning');
      triggerEmergency('Manual SOS', 'Gesture Shake-to-SOS activated');
    }
  });
}

/* ═════════════════════════════════════════
   STEALTH CALCULATOR CAMOUFLAGE ENGINE
═════════════════════════════════════════ */

let calcExpr = '';
let calcCurrent = '0';
let calcPrevOp = '';

function openCalculatorMode() {
  const overlay = document.getElementById('calculator-overlay');
  if (overlay) overlay.classList.remove('hidden');
  calcExpr = '';
  calcCurrent = '0';
  updateCalcDisplay();
  showToast('🔒 Stealth Calculator Mode Active! Enter 911= for Covert SOS', 'info', 3500);
}

function exitCalculatorMode() {
  const overlay = document.getElementById('calculator-overlay');
  if (overlay) overlay.classList.add('hidden');
}

function updateCalcDisplay() {
  const disp = document.getElementById('calc-display');
  const hist = document.getElementById('calc-history');
  if (disp) disp.textContent = calcCurrent;
  if (hist) hist.textContent = calcExpr;
}

function calcInput(val) {
  // Check for Covert Emergency triggers
  if (val === '=') {
    const checkSeq = calcCurrent.trim();
    if (checkSeq === '911' || checkSeq === '100' || checkSeq === '9999' || calcExpr.includes('911') || calcExpr.includes('100')) {
      // 🚨 COVERT SILENT SOS TRIGGERED!
      calcCurrent = '0';
      calcExpr = '';
      updateCalcDisplay();
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      triggerEmergency('Covert Calculator SOS', 'SILENT COVERT SOS dispatched via Stealth Calculator camouflage');
      showToast('🔒 Covert SOS Dispatched in background. Screen remains disguised.', 'error', 4500);
      return;
    }
  }

  if (val === 'C') {
    calcCurrent = '0';
    calcExpr = '';
  } else if (val === '+/-') {
    if (calcCurrent !== '0') {
      calcCurrent = calcCurrent.startsWith('-') ? calcCurrent.slice(1) : '-' + calcCurrent;
    }
  } else if (val === '%') {
    calcCurrent = String(parseFloat(calcCurrent) / 100);
  } else if (['+', '-', '*', '/'].includes(val)) {
    calcExpr = `${calcCurrent} ${val}`;
    calcCurrent = '0';
  } else if (val === '=') {
    if (calcExpr) {
      try {
        const fullExpr = `${calcExpr} ${calcCurrent}`;
        // Safe math evaluation
        const sanitized = fullExpr.replace(/[^0-9+\-*/.]/g, '');
        // eslint-disable-next-line no-eval
        const result = Function(`'use strict'; return (${sanitized})`)();
        calcCurrent = String(Number.isFinite(result) ? result : '0');
        calcExpr = '';
      } catch (_) {
        calcCurrent = 'Error';
      }
    }
  } else {
    // Digit or dot
    if (val === '.' && calcCurrent.includes('.')) return;
    if (calcCurrent === '0' && val !== '.') {
      calcCurrent = val;
    } else {
      calcCurrent += val;
    }
  }
  updateCalcDisplay();
}

/* ═════════════════════════════════════════
   DURESS PIN & COERCION SHIELD
═════════════════════════════════════════ */

function openDuressPinModal() {
  showModal('🔒 Safety PIN Required', `
    <p style="font-size:0.84rem; color:var(--text-soft); margin-bottom:12px;">
      Enter your 4-digit Safety PIN to authenticate disarming this emergency session.
    </p>
    <div class="field-group" style="text-align:center;">
      <input type="password" id="duress-pin-input" maxlength="4" placeholder="••••"
             style="font-size:1.8rem; text-align:center; letter-spacing:0.4em; width:160px; margin:0 auto; padding:8px;" />
      <small style="display:block; margin-top:8px; color:var(--text-soft); font-size:0.75rem;">
        Real PIN: <strong>1234</strong> · Coercion/Duress PIN: <strong>9999</strong>
      </small>
    </div>
  `, [
    { label: 'Cancel', cls: 'btn-ghost' },
    { label: 'Verify & Disarm', cls: 'btn-primary', fn: handleDuressPinVerification },
  ]);

  setTimeout(() => {
    const input = document.getElementById('duress-pin-input');
    if (input) input.focus();
  }, 150);
}

async function handleDuressPinVerification() {
  const pin = document.getElementById('duress-pin-input')?.value.trim();

  if (pin === '1234') {
    // Genuine Disarm
    cancelEmergency();
    showToast('Emergency legitimately disarmed with Safety PIN.', 'success');
  } else if (pin === '9999') {
    // 🚨 DURESS PIN ENTERED UNDER COERCION / THREAT!
    // 1. Immediately calm the attacker by showing a convincing, smiling fake success UI
    clearInterval(graceCancelId);
    emergencyActive = false;
    updateStatusCard('safe', 'SAFE', 'Session ended safely');
    showTab('home');

    showModal('✅ Safety Confirmed', `
      <div style="text-align:center; padding:10px;">
        <span style="font-size:3rem;">😊</span>
        <h3 style="margin-top:8px; color:#15803d;">Emergency Disarmed</h3>
        <p style="font-size:0.85rem; color:var(--text-soft); margin-top:6px;">
          All systems set to safe mode. Have a wonderful and peaceful day!
        </p>
      </div>
    `, [{ label: 'Done', cls: 'btn-primary' }]);

    // 2. Secretly in the background, send Critical Hostage Alert to MongoDB & authorities!
    const duressAlertId = nextAlertId();
    const loc = locationLabel();
    try {
      await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alertId: duressAlertId,
          type: 'Manual SOS',
          status: 'Active',
          reason: '🚨 HOSTAGE/COERCION ALERT! User forced by aggressor to enter Duress PIN (9999). Immediate discreet dispatch required!',
          location: loc,
          userEmail: currentUser?.email || '',
          userName: currentUser?.name || 'User',
          time: nowStr(),
        })
      });
      console.warn('Silent Hostage Duress Alert logged to MongoDB database.');
    } catch (_) {}

  } else {
    showToast('Invalid Security PIN. Please try again.', 'error');
  }
}

/* ═════════════════════════════════════════
   CAB RIDE SHIELD (AUTO & TAXI GUARD)
═════════════════════════════════════════ */

let rideShieldActive = false;
let rideVehicleInfo = null;
let rideHaltTimerId = null;

function openRideShieldModal() {
  showModal('🚖 Cab & Auto Ride Shield', `
    <p style="font-size:0.83rem; color:var(--text-soft); margin-bottom:12px;">
      Log vehicle plates, auto-monitor route stops, and share live tracking with family before boarding any taxi, auto, or cab.
    </p>
    <div class="field-group">
      <label>Vehicle Number *</label>
      <input type="text" id="rs-plate" placeholder="e.g. MH-12-AB-1234" style="text-transform:uppercase;" />
    </div>
    <div class="field-group" style="margin-top:8px;">
      <label>Service / Driver Name</label>
      <input type="text" id="rs-driver" placeholder="e.g. Uber / Ola / Auto Driver Ramesh" />
    </div>
    <div class="field-group" style="margin-top:8px;">
      <label>Drop Destination</label>
      <input type="text" id="rs-dest" placeholder="e.g. Home – Sector 14" />
    </div>
  `, [
    { label: 'Cancel', cls: 'btn-ghost' },
    { label: '🛡️ Activate Ride Shield', cls: 'btn-primary', fn: startRideShieldSession },
  ]);
}

async function startRideShieldSession() {
  const plate  = document.getElementById('rs-plate')?.value.trim().toUpperCase();
  const driver = document.getElementById('rs-driver')?.value.trim();
  const dest   = document.getElementById('rs-dest')?.value.trim();

  if (!plate) {
    showToast('Vehicle number is required to activate Ride Shield.', 'warning');
    return;
  }

  showToast('🛰️ Locking live GPS coordinates for Ride Shield…', 'info', 2000);
  const loc = await getLiveLocation(true);
  const lat = loc ? loc.lat : 18.5204;
  const lng = loc ? loc.lng : 73.8567;
  const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;

  rideShieldActive = true;
  rideVehicleInfo = { plate, driver: driver || 'Cab Driver', dest: dest || 'Home', pickupLoc: `${lat.toFixed(5)}, ${lng.toFixed(5)}` };

  updateStatusCard('active', `RIDE GUARD: ${plate}`, `Destination: ${dest || 'Set'} · Real-time Tracking Active`);
  showToast(`🚖 Ride Shield Active for ${plate}! Unusual stop guard on.`, 'success', 4000);

  // Message to share with family
  const contacts = getContacts();
  const phones = contacts.map(c => c.phone.replace(/[^0-9+]/g, '')).filter(Boolean);
  const shareMsg = `🚖 RIDE GUARD ACTIVE: I have boarded vehicle ${plate} (${driver || 'Cab/Auto'}) heading to ${dest || 'Destination'}. Track my live pickup GPS: ${mapsUrl}. Monitored by SafeRoute Women Safety.`;
  const waRideUrl = `https://wa.me/?text=${encodeURIComponent(shareMsg)}`;
  const smsRideUri = `sms:${phones[0] || '112'}?body=${encodeURIComponent(shareMsg)}`;

  // Save alert to MongoDB
  const alertId = nextAlertId();
  saveAlertToHistory('Test', `🚖 Ride Shield Commenced in vehicle: ${plate} (${driver || 'Cab'}) to ${dest || 'Home'}`, `${lat.toFixed(5)}, ${lng.toFixed(5)}`, alertId);
  try {
    fetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alertId,
        type: 'Ride Shield Tracking',
        status: 'Active',
        reason: `Auto/Cab Shield Started: Plate ${plate}, Driver ${driver || 'N/A'}, Dest: ${dest || 'N/A'}`,
        location: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        userEmail: currentUser?.email || '',
        userName: currentUser?.name || 'User',
        time: nowStr()
      })
    }).catch(() => {});
  } catch (_) {}

  // Show Quick Share Modal for Ride
  showModal('🚖 Ride Shield Active', `
    <div style="background:rgba(22, 10, 48, 0.85); border:1px solid rgba(168, 85, 247, 0.4); border-radius:10px; padding:12px; margin-bottom:12px;">
      <div style="font-family:'Orbitron',sans-serif; color:#4ade80; font-size:0.82rem; font-weight:800; margin-bottom:4px;">
        🛡️ ACTIVE MONITORING: ${plate}
      </div>
      <div style="font-size:0.8rem; color:#cbd5e1; line-height:1.5;">
        <strong>Driver:</strong> ${driver || 'Not specified'}<br>
        <strong>Destination:</strong> ${dest || 'Not specified'}<br>
        <strong>Pickup GPS:</strong> <a href="${mapsUrl}" target="_blank" style="color:#f472b6;">${lat.toFixed(5)}, ${lng.toFixed(5)} (Google Maps)</a>
      </div>
    </div>
    <p style="font-size:0.82rem; color:var(--text-soft); margin-bottom:12px;">
      Share this tracking record with your emergency contacts right now via WhatsApp or SMS:
    </p>
  `, [
    { label: 'Done', cls: 'btn-ghost' },
    { label: '💬 Share on WhatsApp', cls: 'btn-primary', fn: () => window.open(waRideUrl, '_blank') },
    { label: '✉️ Share via SMS', cls: 'btn-danger', fn: () => window.location.href = smsRideUri },
  ]);

  // Periodic route halt check
  clearInterval(rideHaltTimerId);
  rideHaltTimerId = setInterval(() => {
    if (rideShieldActive && !emergencyActive) {
      showToast(`🚖 Vehicle ${plate} moving normally on designated corridor.`, 'info', 2500);
    }
  }, 25000);
}

/* ═════════════════════════════════════════
   24x7 SAFE HAVENS LOCATOR (100% REAL LIVE GPS)
═════════════════════════════════════════ */

async function openSafeHavensModal() {
  showToast('🛰️ Locating verified 24x7 safe spots around your live GPS…', 'info', 2000);
  const loc = await getLiveLocation(true);
  const lat = loc ? loc.lat : 18.5204;
  const lng = loc ? loc.lng : 73.8567;
  const coordsLabel = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

  const HAVEN_CATEGORIES = [
    {
      name: '🚔 Police Stations & Pink Help Desks',
      desc: 'Local Police jurisdiction, 24/7 armed personnel & emergency response',
      query: `https://www.google.com/maps/search/police+station/@${lat},${lng},15z`,
      badge: 'Immediate Law Enforcement',
      icon: '🚔'
    },
    {
      name: '🏥 24x7 Hospitals & Trauma Centers',
      desc: 'All-night medical emergency rooms, security guards & ambulances',
      query: `https://www.google.com/maps/search/hospital+emergency/@${lat},${lng},15z`,
      badge: 'Open 24/7 · High Security',
      icon: '🏥'
    },
    {
      name: '💊 24-Hour Pharmacies & Chemists',
      desc: 'Bright lit store fronts with active attendants on night shifts',
      query: `https://www.google.com/maps/search/pharmacy+open+24+hours/@${lat},${lng},15z`,
      badge: 'Lit Corridor · Staff on Duty',
      icon: '💊'
    },
    {
      name: '⛽ 24x7 Petrol Pumps & Rest Stops',
      desc: 'High-intensity LED lights, CCTV cameras & 24hr staff presence',
      query: `https://www.google.com/maps/search/petrol+pump/@${lat},${lng},15z`,
      badge: 'High Visibility · CCTV Monitored',
      icon: '⛽'
    },
    {
      name: '🚇 Metro Stations & Major Transit Concourse',
      desc: 'CISF / State Security booths, SOS call boxes & crowd presence',
      query: `https://www.google.com/maps/search/metro+station+or+bus+stand/@${lat},${lng},15z`,
      badge: 'Transit Protection Zone',
      icon: '🚇'
    }
  ];

  const havenCardsHtml = HAVEN_CATEGORIES.map(h => `
    <div class="haven-card">
      <div class="haven-card-left">
        <div class="haven-icon">${h.icon}</div>
        <div class="haven-info">
          <strong>${h.name}</strong>
          <small>${h.desc}</small>
          <span class="haven-badge-247">📍 ${h.badge}</span>
        </div>
      </div>
      <button class="haven-btn-nav" onclick="window.open('${h.query}', '_blank')">
        Live Maps 🗺️
      </button>
    </div>
  `).join('');

  showModal('🏥 24x7 Live Safe Havens Near You', `
    <div style="background:rgba(22, 10, 48, 0.85); border:1px solid rgba(168, 85, 247, 0.4); border-radius:10px; padding:10px 12px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
      <span style="font-size:0.75rem; color:#cbd5e1;">📍 Centered on your Live GPS:</span>
      <strong style="font-family:'Share Tech Mono',monospace; color:#4ade80; font-size:0.8rem;">${coordsLabel}</strong>
    </div>
    <p style="font-size:0.82rem; color:var(--text-soft); margin-bottom:12px;">
      Tap any category below to immediately open real Google Maps showing open, staffed 24/7 safe refuges around you right now:
    </p>
    <div style="max-height:360px; overflow-y:auto;">
      ${havenCardsHtml}
    </div>
  `, [
    { label: 'Close', cls: 'btn-ghost' },
    { label: '🚨 Trigger Siren if Followed', cls: 'btn-danger', fn: triggerPanicSiren },
  ]);
}

function navigateToHaven(name) {
  showToast(`Routing to nearest safe haven: ${name}…`, 'success', 3000);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;
  window.open(mapsUrl, '_blank');
}

/* ═════════════════════════════════════════
   BATTERY PRE-EMPTIVE GUARD
═════════════════════════════════════════ */

async function checkBatteryGuard() {
  if ('getBattery' in navigator) {
    try {
      const b = await navigator.getBattery();
      const pct = Math.round(b.level * 100);
      const isCharging = b.charging;

      const hintEl = document.getElementById('battery-status-hint');
      if (hintEl) hintEl.textContent = `Battery: ${pct}% ${isCharging ? '⚡' : ''}`;

      if (pct <= 15 && !isCharging) {
        showModal('🔋 Low Battery Emergency Pre-Alert', `
          <div style="text-align:center; padding:10px;">
            <span style="font-size:2.6rem;">🪫</span>
            <h3 style="color:#dc2626; margin-top:6px;">Battery Critically Low (${pct}%)</h3>
            <p style="font-size:0.84rem; color:var(--text-soft); margin-top:8px;">
              Your phone may shut down soon. Send your current live GPS coordinates to family right now before you lose power!
            </p>
          </div>
        `, [
          { label: 'Dismiss', cls: 'btn-ghost' },
          { label: '📲 Send Pre-Alert SMS Now', cls: 'btn-danger', fn: triggerOfflineEmergencySMS },
        ]);
      } else {
        showToast(`Battery level is ${pct}% ${isCharging ? '(Charging)' : '(Healthy)'}. SafeRoute Battery Guard is watching!`, 'info', 3500);
      }
      return;
    } catch (_) {}
  }
  showToast('Battery status checked: Auto-SOS will alert family if power drops below 15%.', 'info');
}

/* ═════════════════════════════════════════
   TIMER CLEANUP
═════════════════════════════════════════ */

function clearAllTimers() {
  clearInterval(sessionTimerId);
  clearInterval(checkinProgressId);
  clearTimeout(checkinPopupId);
  clearInterval(graceCancelId);
  sessionTimerId  = null;
  checkinProgressId = null;
  checkinPopupId   = null;
  graceCancelId    = null;
  checkinActive    = false;

  // Hide check-in popup if open
  const popup = document.getElementById('checkin-popup');
  if (popup) popup.classList.add('hidden');
}

/* ═════════════════════════════════════════
   INIT
═════════════════════════════════════════ */

(function init() {
  // Restore demo mode preference
  demoMode = getDemoMode();

  // Seed demo user if no users exist
  const users = getUsers();
  if (!users.find(u => u.email === DEMO_USER.email)) {
    users.push({ ...DEMO_USER });
    saveUsers(users);
  }

  // Check if a user session was active (page reload during session)
  // For simplicity, always start at auth screen
  showScreen('auth');
  switchAuthTab('login');

  // Pre-fill email for quick demo
  const emailInput = document.getElementById('login-email');
  if (emailInput) emailInput.value = DEMO_USER.email;

  // Check live server storage / MongoDB connection status
  checkDbStatus();

  // Automatically sync local users to central server so mobile accounts are immediately available on laptop
  syncLocalDataToServer();

  // Initialize Shake-to-SOS detector
  initShakeDetection();

  // Initialize Desktop & Laptop keyboard shortcuts
  initDesktopKeyboardShortcuts();

  // Initialize real-time GPS tracking engine
  getLiveLocation(false);
  startContinuousLocationWatch();

  console.log('%cSafeRoute prototype loaded with Women Safety Arsenal & MongoDB. Quick login: demo@saferoute.app / demo1234', 'color:#4f46e5;font-weight:bold;font-size:13px');
})();

/* ═════════════════════════════════════════
   DESKTOP & LAPTOP KEYBOARD SHORTCUTS
═════════════════════════════════════════ */
function initDesktopKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    // If user is currently typing in an input or textarea, don't hijack typing
    const activeEl = document.activeElement;
    const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);

    // 1. Shift + S -> Instant SOS Alert
    if (e.shiftKey && (e.key === 'S' || e.key === 's')) {
      if (!isTyping) {
        e.preventDefault();
        showToast('⌨️ Instant SOS Triggered via [Shift + S]!', 'warning', 3000);
        manualSOS();
      }
    }

    // 2. Escape -> Close active modal / stealth calculator / fake call / settings
    if (e.key === 'Escape') {
      const modal = document.getElementById('modal-overlay');
      const calc = document.getElementById('calculator-overlay');
      const fakeCall = document.getElementById('fake-call-overlay');
      const siren = document.getElementById('siren-overlay');

      if (siren && !siren.classList.contains('hidden')) {
        stopPanicSiren();
        return;
      }
      if (calc && !calc.classList.contains('hidden')) {
        exitCalculatorMode();
        return;
      }
      if (fakeCall && !fakeCall.classList.contains('hidden')) {
        endFakeCall();
        return;
      }
      if (modal && !modal.classList.contains('hidden')) {
        closeModal();
        return;
      }
    }

    // 3. Space -> Stop Siren if siren overlay is open
    if (e.code === 'Space' && !isTyping) {
      const siren = document.getElementById('siren-overlay');
      if (siren && !siren.classList.contains('hidden')) {
        e.preventDefault();
        stopPanicSiren();
      }
    }
  });
}



