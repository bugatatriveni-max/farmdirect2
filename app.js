// RythuSeva Master Application Controller
// Orchestrates i18n, Market Intelligence, Slot Booking, Queue Management, Voice AI, Biometrics, and Custom Security Password

import { CROP_DATA, TRANSPORT_RATES, STATES_DISTRICTS_DATA, TOLL_FREE_HELPLINES, BEST_SELLING_DESTINATIONS } from './data.js';
import { currentLanguage, setLanguage, getLanguage, t } from './i18n.js';
import { SecurityManager } from './biometrics.js';
import { ProfitCalculator } from './calculator.js';
import { VoiceAssistant } from './voice.js';
import { QueueManager } from './queue.js';

class RythuSevaApp {
  constructor() {
    this.currentTab = 'home';
    this.audioCtx = null;
    this.activeCropFilter = 'chilli';
  }

  init() {
    // Global Zero-Crash Interceptors
    if (typeof window !== 'undefined') {
      window.addEventListener('error', (event) => {
        console.warn('[RythuSeva Error Interceptor] Safely caught error:', event.message || event);
      });
      window.addEventListener('unhandledrejection', (event) => {
        console.warn('[RythuSeva Error Interceptor] Safely caught rejection:', event.reason);
      });
    }

    getLanguage();
    QueueManager.init().then(() => {
      this.renderLiveQueueBoard();
    }).catch(err => {
      console.warn('[App] QueueManager init background error:', err);
    });

    if (typeof window !== 'undefined') {
      window.app = this;
    }

    QueueManager.playChime = (type) => this.playChime(type === 'ping' ? 'notify' : type);
    QueueManager.subscribe('onNotification', (data) => {
      this.updateNotificationBadge(data.unreadCount);
      this.renderNotificationDrawer(data.notifications);
      if (data.notification) {
        this.showRealtimePopupToast(data.notification, data.booking, data.status);
        this.showBrowserNotification(data.notification.title, data.notification.message);
      }
    });

    QueueManager.subscribe('onStatusUpdate', (data) => {
      const activeToken = QueueManager.activeFarmerToken;
      const trackInput = document.getElementById('trackTokenInput');
      const currentTrackQuery = trackInput ? trackInput.value.trim().toUpperCase() : null;

      if (data.token && (data.token === activeToken || data.token === currentTrackQuery)) {
        this.renderTrackerResult(data.booking || QueueManager.findBooking(data.token));
      }
      this.renderLiveQueueBoard();
      this.renderFarmerLiveQueueCard();
      if (this.currentTab === 'admin') {
        this.renderAdminBookings();
        this.renderAdminLiveQueueConsole();
      }
    });

    QueueManager.subscribe('onQueueMovement', (data) => {
      this.renderFarmerLiveQueueCard();
      this.renderLiveQueueBoard();
      if (this.currentTab === 'admin') {
        this.renderAdminBookings();
        this.renderAdminLiveQueueConsole();
      }
    });

    // Initialize WebSocket for current session/farmer
    const savedFarmer = (typeof localStorage !== 'undefined' && localStorage.getItem('rythu_last_farmer')) || 'guest';
    QueueManager.initWebSocket(savedFarmer);

    SecurityManager.checkAvailability();
    VoiceAssistant.init();
    this.checkBackendHealth();

    this.setupNavigation();
    this.setupNotificationDrawer();
    this.setupLanguageSwitcher();
    this.setupSecurityAndBiometrics();
    this.setupDropdowns();
    this.setupSlotBooking();
    this.setupQueueUI();
    this.setupBestSellingDestinations();
    this.setupMarketCalculator();
    this.setupTracker();
    this.setupAdminDashboard();
    this.setupVoiceUI();
    this.renderActiveUser();
    this.updateNotificationBadge(QueueManager.unreadNotificationCount);

    this.applyTranslations();
    this.updateMarketListings();
    this.runProfitCalculation();
    this.renderLiveQueueBoard();
    this.renderFarmerLiveQueueCard();
    this.renderFarmerBookingsHistory();
    document.getElementById('btnRefreshFarmerHistory')?.addEventListener('click', () => {
      this.renderFarmerBookingsHistory();
      this.showToast('Bookings history refreshed.');
    });

    setInterval(() => {
      this.refreshQueueSilently();
    }, 15000);
  }

  async checkBackendHealth() {
    const pill = document.getElementById('backendStatusPill');
    const label = document.getElementById('backendStatusLabel');
    if (!pill || !label) return;

    const apiBase = (typeof window !== 'undefined' && window.FARMDIRECT_API_BASE) 
      ? window.FARMDIRECT_API_BASE.replace(/\/+$/, '') 
      : '';

    try {
      const res = await fetch(`${apiBase}/api/health`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        pill.className = 'backend-status-pill';
        const dot = pill.querySelector('.status-pulse-dot');
        if (dot) dot.className = 'status-pulse-dot online';
        label.innerText = '🟢 Backend: Online (v2.0)';
        return true;
      }
    } catch (e) {}

    pill.className = 'backend-status-pill offline';
    const dot = pill.querySelector('.status-pulse-dot');
    if (dot) dot.className = 'status-pulse-dot offline';
    label.innerText = '🟠 Offline Mode (Active)';
    return false;
  }

  playChime(type = 'success') {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      const now = this.audioCtx.currentTime;
      if (type === 'success') {
        osc.frequency.setValueAtTime(587.33, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.4);
      } else if (type === 'notify') {
        osc.frequency.setValueAtTime(659.25, now);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      }
    } catch (e) {}
  }

  showToast(message, type = 'success') {
    const toast = document.getElementById('appToast');
    if (!toast) return;
    toast.innerText = message;
    toast.className = `app-toast show ${type}`;
    this.playChime(type === 'success' ? 'success' : 'notify');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3500);
  }

  setupNavigation() {
    const navButtons = document.querySelectorAll('[data-nav-tab]');
    navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-nav-tab');
        this.switchTab(targetTab);
        window.location.hash = targetTab;
      });
    });

    // Support direct URL hash links (e.g. #voice, #tab-voice, #talk)
    const handleHash = () => {
      const hash = window.location.hash.replace('#', '').toLowerCase();
      if (hash === 'voice' || hash === 'tab-voice') {
        this.switchTab('voice');
      } else if (hash === 'talk' || hash === 'homevoiceherocard') {
        this.switchTab('home');
        const hero = document.getElementById('homeVoiceHeroCard');
        if (hero) hero.scrollIntoView({ behavior: 'smooth' });
      } else if (hash && ['home', 'book', 'queue', 'markets', 'track'].includes(hash)) {
        this.switchTab(hash);
      }
    };

    window.addEventListener('hashchange', handleHash);
    handleHash();
  }

  switchTab(tabId) {
    this.currentTab = tabId;
    document.querySelectorAll('[data-nav-tab]').forEach(btn => {
      if (btn.getAttribute('data-nav-tab') === tabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    document.querySelectorAll('.tab-section').forEach(sec => {
      if (sec.id === `tab-${tabId}`) {
        sec.classList.add('active');
      } else {
        sec.classList.remove('active');
      }
    });

    if (tabId === 'book') {
      this.renderSlotAvailabilityCards();
      this.renderFarmerBookingsHistory();
    } else if (tabId === 'queue') {
      this.renderLiveQueueBoard();
      this.renderFarmerLiveQueueCard();
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  setupLanguageSwitcher() {
    const selector = document.getElementById('langSelect');
    if (selector) {
      selector.value = currentLanguage;
      selector.addEventListener('change', (e) => {
        const lang = e.target.value;
        this.changeLanguage(lang);
        this.showToast(`Language switched to ${e.target.selectedOptions[0].text}`);
      });
    }
  }

  changeLanguage(lang) {
    setLanguage(lang);
    VoiceAssistant.setVoiceLanguage(lang);
    this.applyTranslations();
    this.setupDropdowns();
    this.updateMarketListings();
    this.runProfitCalculation();
  }

  applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      el.innerText = t(key);
    });

    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
      const key = el.getAttribute('data-i18n-ph');
      el.setAttribute('placeholder', t(key));
    });

    this.renderActiveUser();

    if (typeof this.renderBestSellingDestinations === 'function') {
      this.renderBestSellingDestinations(this.activeCropFilter || 'chilli');
    }
  }

  setupSecurityAndBiometrics() {
    // 1. Biometric Trigger
    document.querySelectorAll('.btn-biometric-trigger').forEach(btn => {
      btn.addEventListener('click', () => {
        SecurityManager.authenticateBiometric((user) => {
          this.renderActiveUser(user);
          this.showToast(`${t('biometricSuccess')} (${user.name})`);
          this.autoFillFarmerDetails(user);
        });
      });
    });

    // Close Biometric Modal
    document.getElementById('biometricModalClose')?.addEventListener('click', () => {
      document.getElementById('biometricModal')?.classList.remove('active');
    });

    // 2. Security Password Login Trigger & Modal
    const passLoginModal = document.getElementById('passwordLoginModal');
    document.querySelectorAll('.btn-password-login-trigger').forEach(btn => {
      btn.addEventListener('click', () => {
        if (passLoginModal) passLoginModal.classList.add('active');
        document.getElementById('enteredSecurityPin')?.focus();
      });
    });

    document.getElementById('closePasswordLoginModal')?.addEventListener('click', () => {
      passLoginModal?.classList.remove('active');
    });

    document.getElementById('btnSubmitPasswordLogin')?.addEventListener('click', () => {
      const pin = document.getElementById('enteredSecurityPin')?.value;
      const res = SecurityManager.verifySecurityPassword(pin);
      if (res.success) {
        passLoginModal?.classList.remove('active');
        this.renderActiveUser(res.user);
        this.showToast(`${t('passwordSuccess')} (${res.user.name})`);
        this.autoFillFarmerDetails(res.user);
      } else {
        this.showToast(res.message, 'notify');
      }
    });

    // 3. Fix / Set Security Password Trigger & Modal
    const fixModal = document.getElementById('fixPasswordModal');
    document.querySelectorAll('.btn-fix-password-trigger').forEach(btn => {
      btn.addEventListener('click', () => {
        if (fixModal) fixModal.classList.add('active');
        document.getElementById('newSecurityPin')?.focus();
      });
    });

    document.getElementById('closeFixPasswordModal')?.addEventListener('click', () => {
      fixModal?.classList.remove('active');
    });

    document.getElementById('btnSaveFixedPassword')?.addEventListener('click', () => {
      const newPin = document.getElementById('newSecurityPin')?.value;
      const confirmPin = document.getElementById('confirmSecurityPin')?.value;

      if (!newPin || newPin.trim().length < 4) {
        this.showToast('Password / PIN must be at least 4 digits.', 'notify');
        return;
      }
      if (newPin !== confirmPin) {
        this.showToast('Passwords do not match. Please re-enter.', 'notify');
        return;
      }

      const res = SecurityManager.fixSecurityPassword(newPin);
      if (res.success) {
        fixModal?.classList.remove('active');
        this.showToast(res.message, 'success');
        document.getElementById('currentPasswordDisplay').innerText = `Active PIN: •••• (${newPin})`;
      }
    });

    // Global and Admin logout triggers
    document.getElementById('btnGlobalLogout')?.addEventListener('click', () => {
      this.handleLogout();
    });
    document.getElementById('btnAdminLogout')?.addEventListener('click', () => {
      this.handleLogout();
    });

    // Load existing stored profile
    const storedUser = SecurityManager.loadStoredUser();
    if (storedUser) {
      this.renderActiveUser(storedUser);
    }
  }

  async handleLogout() {
    SecurityManager.logout();
    try {
      await fetch(`${window.FARMDIRECT_API_BASE || ''}/api/auth/logout`, { method: 'POST' });
    } catch (e) {}
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('rythu_farmer_profile');
    }
    this.renderActiveUser(null);
    this.showToast(t('logoutSuccess') || 'మీరు విజయవంతంగా లాగ్ అవుట్ అయ్యారు.', 'success');
    this.switchTab('home');
  }

  async handleCancelBooking(token) {
    const cleanToken = (token || '').trim().toUpperCase();
    if (!cleanToken) return;

    const promptMsg = t('confirmCancelPrompt') || 'మీరు మీ స్లాట్ బుకింగ్‌ను రద్దు చేయాలనుకుంటున్నారా?';
    if (!confirm(promptMsg)) return;

    this.showToast('Cancelling slot booking...', 'notify');
    const res = await QueueManager.cancelBooking(cleanToken);
    if (res) {
      this.showToast(t('cancelSuccess') || 'మీ స్లాట్ విజయవంతంగా రద్దు చేయబడింది.', 'success');
      document.getElementById('tokenSlipModal')?.classList.remove('active');
      const bar = document.getElementById('slotConfirmedNotificationBar');
      if (bar) bar.style.display = 'none';
      this.renderLiveQueueBoard();
      this.renderFarmerLiveQueueCard();
      this.renderSlotAvailabilityCards();
      this.renderFarmerBookingsHistory();
      const trackInput = document.getElementById('trackTokenInput');
      if (trackInput && trackInput.value.trim().toUpperCase() === cleanToken) {
        this.viewBookingDetails(cleanToken);
      }
    } else {
      this.showToast('Cancellation failed. Please try again.', 'notify');
    }
  }

  renderActiveUser(user = null) {
    const banner = document.getElementById('userProfileBanner');
    const u = user || SecurityManager.currentUser;
    const currentPin = SecurityManager.getSecurityPassword();

    if (banner) {
      if (u) {
        banner.innerHTML = `
          <div class="user-pill">
            <span class="pulse-dot"></span>
            <span class="user-name">👤 ${u.name}</span>
            <span class="user-badge">${t('kisanId')}: ${u.kisanId}</span>
            <span class="bio-verified-tag">✓ Auth: ${u.authMethod || 'Secured'}</span>
            <button class="btn-text-action btn-fix-password-trigger" title="Fix / Change Security Password">
              ⚙️ ${t('fixPasswordBtn')}
            </button>
            <button type="button" class="btn-logout-trigger btn-user-logout" title="Logout">
              🚪 ${t('logoutBtn')}
            </button>
          </div>
        `;
      } else {
        banner.innerHTML = `
          <div class="auth-buttons-group">
            <button class="btn-fast-bio btn-biometric-trigger">
              <span class="fingerprint-icon">👆</span>
              <span>${t('biometricLoginBtn')}</span>
            </button>
            <button class="btn-fast-pass btn-password-login-trigger">
              <span>🔑</span>
              <span>${t('passwordLoginBtn')}</span>
            </button>
            <button class="btn-fix-pill btn-fix-password-trigger">
              <span>⚙️</span>
              <span>${t('fixPasswordBtn')}</span>
            </button>
          </div>
        `;
      }

      // Re-bind triggers
      banner.querySelector('.btn-biometric-trigger')?.addEventListener('click', () => {
        SecurityManager.authenticateBiometric((verified) => {
          this.renderActiveUser(verified);
          this.showToast(`${t('biometricSuccess')} (${verified.name})`);
          this.autoFillFarmerDetails(verified);
        });
      });

      banner.querySelector('.btn-password-login-trigger')?.addEventListener('click', () => {
        document.getElementById('passwordLoginModal')?.classList.add('active');
        document.getElementById('enteredSecurityPin')?.focus();
      });

      banner.querySelector('.btn-fix-password-trigger')?.addEventListener('click', () => {
        document.getElementById('fixPasswordModal')?.classList.add('active');
        document.getElementById('newSecurityPin')?.focus();
      });

      banner.querySelector('.btn-user-logout')?.addEventListener('click', () => {
        this.handleLogout();
      });

      const globalLogout = document.getElementById('btnGlobalLogout');
      if (globalLogout) {
        globalLogout.style.display = u ? 'inline-flex' : 'none';
      }
    }
  }

  autoFillFarmerDetails(user) {
    const nameEl = document.getElementById('bookFarmerName');
    const mobileEl = document.getElementById('bookMobile');
    const aadhaarEl = document.getElementById('bookAadhaar');
    const stateEl = document.getElementById('bookState');
    const districtEl = document.getElementById('bookDistrict');
    const mandalEl = document.getElementById('bookMandal');

    if (nameEl && !nameEl.value) nameEl.value = user.name;
    if (mobileEl && !mobileEl.value) mobileEl.value = user.mobile;
    if (aadhaarEl && !aadhaarEl.value) aadhaarEl.value = user.aadhaarLast4;
    if (stateEl) {
      stateEl.value = user.state;
      this.populateDistricts('bookState', 'bookDistrict');
    }
    if (districtEl) {
      districtEl.value = user.district;
      this.populateMarketYards('bookDistrict', 'bookMarket');
    }
    if (mandalEl) mandalEl.value = user.mandal || '';
  }

  setupDropdowns() {
    const stateSelects = ['bookState', 'calcState'];
    stateSelects.forEach(selId => {
      const sel = document.getElementById(selId);
      if (!sel) return;
      const prevVal = sel.value;
      sel.innerHTML = `<option value="">-- ${t('fieldState')} --</option>`;
      Object.values(STATES_DISTRICTS_DATA).forEach(st => {
        const opt = document.createElement('option');
        opt.value = st.id;
        opt.innerText = st.name[currentLanguage] || st.name.en;
        sel.appendChild(opt);
      });
      sel.value = prevVal || 'andhra_pradesh';
    });

    const setupDistrictBinding = (stateId, distId, marketId = null) => {
      const stateEl = document.getElementById(stateId);
      const distEl = document.getElementById(distId);
      if (!stateEl || !distEl) return;

      const update = () => {
        this.populateDistricts(stateId, distId);
        if (marketId) {
          this.populateMarketYards(distId, marketId);
        }
      };

      stateEl.addEventListener('change', update);
      distEl.addEventListener('change', () => {
        if (marketId) {
          this.populateMarketYards(distId, marketId);
        }
        if (stateId === 'calcState') {
          this.updateMarketListings();
          this.runProfitCalculation();
        }
      });
    };

    setupDistrictBinding('bookState', 'bookDistrict', 'bookMarket');
    setupDistrictBinding('calcState', 'calcDistrict');

    this.populateDistricts('bookState', 'bookDistrict');
    this.populateMarketYards('bookDistrict', 'bookMarket');
    this.populateDistricts('calcState', 'calcDistrict');

    const cropSelects = ['bookCrop', 'calcCrop'];
    cropSelects.forEach(selId => {
      const sel = document.getElementById(selId);
      if (!sel) return;
      const prev = sel.value;
      sel.innerHTML = '';
      Object.values(CROP_DATA).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        const cropName = c.name[currentLanguage] || c.name.en;
        opt.innerText = `${c.icon} ${cropName} (MSP: ₹${c.msp})`;
        sel.appendChild(opt);
      });
      sel.value = prev || 'chilli';
    });

    const vehicleSelects = ['bookVehicle', 'calcVehicle'];
    vehicleSelects.forEach(selId => {
      const sel = document.getElementById(selId);
      if (!sel) return;
      const prev = sel.value;
      sel.innerHTML = '';
      Object.entries(TRANSPORT_RATES).forEach(([key, val]) => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.innerText = `${val.name} • ₹${val.ratePerKm}/km`;
        sel.appendChild(opt);
      });
      sel.value = prev || 'minitruck';
    });
  }

  populateDistricts(stateSelectId, districtSelectId) {
    const stateEl = document.getElementById(stateSelectId);
    const distEl = document.getElementById(districtSelectId);
    if (!stateEl || !distEl) return;

    const stateId = stateEl.value || 'andhra_pradesh';
    const stateData = STATES_DISTRICTS_DATA[stateId];
    distEl.innerHTML = '';

    if (stateData && stateData.districts) {
      Object.values(stateData.districts).forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.innerText = d.name[currentLanguage] || d.name.en;
        distEl.appendChild(opt);
      });
    }
  }

  populateMarketYards(districtSelectId, marketSelectId) {
    const distEl = document.getElementById(districtSelectId);
    const mktEl = document.getElementById(marketSelectId);
    if (!distEl || !mktEl) return;

    const distId = distEl.value;
    mktEl.innerHTML = '';

    const stateSelectId = districtSelectId === 'bookDistrict' ? 'bookState' : 'calcState';
    const stateId = document.getElementById(stateSelectId)?.value || 'andhra_pradesh';
    const districtData = STATES_DISTRICTS_DATA[stateId]?.districts[distId];

    if (districtData && districtData.markets) {
      districtData.markets.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        const name = currentLanguage === 'te' && m.nameTe ? m.nameTe : m.name;
        opt.innerText = `${name} (${m.type})`;
        mktEl.appendChild(opt);
      });
    }
  }


  requestBrowserNotificationPermission() {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
          console.log('[Browser Notifications] Permission:', permission);
        }).catch(() => {});
      }
    }
  }

  showBrowserNotification(title, body) {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const cleanBody = (body || '').replace(/<[^>]*>?/gm, '');
        new Notification(title || 'రైతుసేవ Mandi Alert', {
          body: cleanBody,
          icon: 'favicon.ico'
        });
      } catch (e) {}
    }
  }

  showRealtimePopupToast(notification, booking = null, status = null) {
    const toast = document.getElementById('realtimePopupToast');
    if (!toast) return;

    const b = booking || (notification && notification.booking_id ? QueueManager.findBooking(notification.booking_id) : null);
    const token = (b && b.token) || (notification && (notification.booking_id || notification.token)) || 'RS2026';
    const date = (b && b.slotDate) || (notification && notification.createdAt ? notification.createdAt.split(' ')[0] : '20/09/2026');
    const time = (b && b.slotTime) || '10:00 AM';
    const centre = (b && (b.marketName || b.centre)) || 'Government Agricultural Market Yard';
    const currentStatus = (status || (b && b.status) || 'CONFIRMED').toUpperCase();

    const titleEl = document.getElementById('rtToastTitle');
    const msgEl = document.getElementById('rtToastMessage');
    const idEl = document.getElementById('rtToastBookingId');
    const dateEl = document.getElementById('rtToastDate');
    const timeEl = document.getElementById('rtToastTime');
    const centreEl = document.getElementById('rtToastCentre');
    const tokenEl = document.getElementById('rtToastToken');
    const smsBadge = document.getElementById('rtToastSmsBadge');
    const iconEl = document.getElementById('rtToastIcon');

    if (titleEl) titleEl.innerText = notification.title || '🔔 Slot Booking Confirmed';
    if (msgEl) msgEl.innerText = notification.message || 'Your procurement slot has been confirmed.';
    if (idEl) idEl.innerText = token;
    if (dateEl) dateEl.innerText = date;
    if (timeEl) timeEl.innerText = time;
    if (centreEl) centreEl.innerText = centre;
    if (tokenEl) tokenEl.innerText = token;

    if (smsBadge) {
      const s = (notification.sms_status || notification.smsStatus || 'NOT_CONFIGURED').toUpperCase();
      if (s === 'SENT') {
        smsBadge.className = 'sms-badge sent';
        smsBadge.innerText = 'SMS Sent ✓';
      } else if (s === 'NOT_CONFIGURED') {
        smsBadge.className = 'sms-badge not-configured';
        smsBadge.innerText = 'SMS Service Not Configured';
      } else {
        smsBadge.className = 'sms-badge failed';
        smsBadge.innerText = `SMS: ${s}`;
      }
    }

    if (iconEl) {
      if (currentStatus === 'CANCELLED') iconEl.innerText = '⚠️';
      else if (currentStatus === 'IN QUEUE') iconEl.innerText = '🚦';
      else if (currentStatus === 'PROCESSING') iconEl.innerText = '⚖️';
      else if (currentStatus === 'COMPLETED') iconEl.innerText = '✅';
      else iconEl.innerText = '🔔';
    }

    toast.className = `realtime-popup-toast show ${currentStatus === 'CANCELLED' ? 'status-cancelled' : ''}`;
    this.playChime(currentStatus === 'CANCELLED' ? 'notify' : 'success');

    // Wire up buttons
    const btnDismiss = document.getElementById('btnDismissRtToast');
    if (btnDismiss) {
      btnDismiss.onclick = () => toast.classList.remove('show');
    }

    const btnTrack = document.getElementById('btnRtToastTrack');
    if (btnTrack) {
      btnTrack.onclick = () => {
        toast.classList.remove('show');
        this.viewBookingDetails(token);
      };
    }

    const btnBell = document.getElementById('btnRtToastBell');
    if (btnBell) {
      btnBell.onclick = () => {
        toast.classList.remove('show');
        this.toggleNotificationDrawer(true);
      };
    }

    clearTimeout(this._rtToastTimer);
    this._rtToastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 9000);
  }

  async renderSlotAvailabilityCards(marketId = null, slotDate = null) {
    const grid = document.getElementById('slotAvailabilityGrid');
    if (!grid) return;

    const mktId = marketId || document.getElementById('bookMarket')?.value || 'eluru_amc';
    const sDate = slotDate || document.getElementById('bookDate')?.value || new Date().toISOString().split('T')[0];
    const selectEl = document.getElementById('bookTimeSlot');
    const alertEl = document.getElementById('slotAutoShiftAlert');
    const alertTitle = document.getElementById('autoShiftAlertTitle');
    const alertDesc = document.getElementById('autoShiftAlertDesc');

    grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:16px; color:#64748b;">Loading live 5-shift capacity...</div>';

    const availData = await QueueManager.fetchSlotAvailability(mktId, sDate);
    if (!availData || !Array.isArray(availData.slots) || availData.slots.length === 0) {
      grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:16px; color:#64748b;">Could not load slot availability. Standard shifts active.</div>';
      return;
    }

    grid.innerHTML = '';
    const currentSelected = this.selectedSlotTime || (selectEl ? selectEl.value : null) || availData.slots[0].slotTime;
    this.selectedSlotTime = currentSelected;
    if (selectEl) {
      selectEl.value = currentSelected;
    }

    availData.slots.forEach((slot, index) => {
      const isSelected = slot.slotTime === currentSelected || (currentSelected && currentSelected.includes(slot.slotTime));
      const card = document.createElement('div');
      const isFull = slot.availableCount <= 0 || slot.status === 'FULL';
      const statusClass = isFull ? 'full' : (slot.availableCount <= 3 ? 'limited' : 'available');
      card.className = `slot-card ${statusClass} ${isSelected ? 'selected' : ''} ${!slot.isEnabled ? 'disabled' : ''}`;
      card.dataset.slotTime = slot.slotTime;

      const pct = slot.maxCapacity > 0 ? Math.min(100, Math.round((slot.bookedCount / slot.maxCapacity) * 100)) : 0;
      const gaugeColor = isFull ? 'red' : (slot.availableCount <= 3 ? 'amber' : 'green');

      const shiftName = slot.shift || `Shift ${index + 1}`;
      const timeDisplay = slot.timeDisplay || (slot.slotTime.includes('-') ? slot.slotTime.replace(/:\d\d/g, '').replace('0', '') : slot.slotTime);

      card.innerHTML = `
        <div class="slot-card-time" style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
          <div>
            <div style="font-size:0.96rem; font-weight:800; color:#0f172a;">${shiftName}: ${timeDisplay}</div>
            <div style="font-size:0.75rem; color:#64748b; margin-top:2px;">${slot.slotTime}</div>
          </div>
          <span class="slot-badge-status ${statusClass}" style="white-space:nowrap; font-weight:700;">
            ${isFull ? '🔴 FULL' : (slot.availableCount <= 3 ? '🟠 ' + slot.availableCount + ' LEFT' : '🟢 AVAILABLE')}
          </span>
        </div>

        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:8px 10px; margin:6px 0;">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.88rem; font-weight:800; color:${isFull ? '#dc2626' : (slot.availableCount <= 3 ? '#d97706' : '#047857')};">
            <span>${slot.bookedCount}/${slot.maxCapacity} booked</span>
            <span>•</span>
            <span>${isFull ? 'FULL' : `${slot.availableCount} remaining`}</span>
          </div>
          <div style="font-size:0.74rem; color:#64748b; margin-top:4px; display:flex; justify-content:space-between; border-top:1px dashed #cbd5e1; padding-top:4px;">
            <span>Strict Capacity: 10 farmers</span>
            <span>Est. Turn Time: ~6–10 mins</span>
          </div>
        </div>

        <div class="slot-gauge-track" style="margin-top:4px;">
          <div class="slot-gauge-fill ${gaugeColor}" style="width:${pct}%"></div>
        </div>
      `;

      card.addEventListener('click', () => {
        if (!slot.isEnabled) return;
        document.querySelectorAll('.slot-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this.selectedSlotTime = slot.slotTime;
        if (selectEl) {
          selectEl.value = slot.slotTime;
        }

        if (isFull) {
          if (alertEl) {
            alertEl.style.display = 'flex';
            const idx = availData.slots.findIndex(s => s.slotTime === slot.slotTime);
            const searchList = availData.slots.slice(idx + 1);
            const nextAvail = searchList.find(s => s.availableCount > 0 && s.isEnabled);

            if (alertTitle) {
              alertTitle.innerText = 'Selected shift is full. You have been assigned to the next available shift.';
            }
            if (alertDesc) {
              if (nextAvail) {
                const nextTime = nextAvail.timeDisplay || nextAvail.slotTime;
                alertDesc.innerHTML = `Selected <strong>${shiftName} (${timeDisplay})</strong> is FULL (${slot.bookedCount}/${slot.maxCapacity}). The system will automatically assign you to <strong>${nextAvail.shift} (${nextTime})</strong> with <strong>${nextAvail.availableCount} remaining</strong>.`;
              } else {
                alertDesc.innerText = 'This shift and all subsequent shifts for this date are full. Please select another date.';
              }
            }
          }
        } else {
          if (alertEl) alertEl.style.display = 'none';
        }
      });

      grid.appendChild(card);
    });

    // Check initial selection
    const initialSlot = availData.slots.find(s => s.slotTime === currentSelected) || availData.slots[0];
    if (initialSlot && (initialSlot.availableCount <= 0 || initialSlot.status === 'FULL')) {
      if (alertEl) {
        alertEl.style.display = 'flex';
        const idx = availData.slots.findIndex(s => s.slotTime === initialSlot.slotTime);
        const searchList = availData.slots.slice(idx + 1);
        const nextAvail = searchList.find(s => s.availableCount > 0 && s.isEnabled);
        if (alertTitle) {
          alertTitle.innerText = 'Selected shift is full. You have been assigned to the next available shift.';
        }
        if (alertDesc) {
          if (nextAvail) {
            alertDesc.innerHTML = `Selected ${initialSlot.shift} is FULL (10/10). System will automatically allocate to ${nextAvail.shift} (${nextAvail.timeDisplay || nextAvail.slotTime}).`;
          } else {
            alertDesc.innerText = 'This shift and all subsequent shifts for this date are full. Please select another date.';
          }
        }
      }
    } else {
      if (alertEl) alertEl.style.display = 'none';
    }
  }

  setupSlotBooking() {
    const form = document.getElementById('slotBookingForm');
    const today = new Date().toISOString().split('T')[0];
    const dateInput = document.getElementById('bookDate');
    const marketSelect = document.getElementById('bookMarket');
    const btnRefreshSlots = document.getElementById('btnRefreshSlotsAvailability');
    const submitBtn = document.getElementById('btnConfirmBooking') || form?.querySelector('button[type="submit"]');

    if (dateInput) {
      dateInput.min = today;
      if (!dateInput.value) dateInput.value = today;
      dateInput.addEventListener('change', () => {
        this.renderSlotAvailabilityCards(marketSelect?.value, dateInput.value);
      });
    }

    if (marketSelect) {
      marketSelect.addEventListener('change', () => {
        this.renderSlotAvailabilityCards(marketSelect.value, dateInput?.value);
      });
    }

    if (btnRefreshSlots) {
      btnRefreshSlots.addEventListener('click', () => {
        this.renderSlotAvailabilityCards(marketSelect?.value, dateInput?.value);
        this.showToast('Slot availability refreshed from live system.');
      });
    }

    // Prefill fields if farmer previously entered them or logged in
    const fNameInput = document.getElementById('bookFarmerName');
    const fMobileInput = document.getElementById('bookMobile');
    const fQtyInput = document.getElementById('bookQuantity');
    const fAadhaarInput = document.getElementById('bookAadhaar');
    const fVillageInput = document.getElementById('bookVillage');

    if (fNameInput && !fNameInput.value) {
      const savedName = localStorage.getItem('rythu_last_farmer_name') || SecurityManager.currentUser?.name;
      if (savedName) fNameInput.value = savedName;
    }
    if (fMobileInput && !fMobileInput.value) {
      const savedMob = localStorage.getItem('rythu_last_farmer') || SecurityManager.currentUser?.mobile;
      if (savedMob) fMobileInput.value = savedMob;
    }
    if (fQtyInput && !fQtyInput.value) {
      fQtyInput.value = '45';
    }
    if (fAadhaarInput && !fAadhaarInput.value) {
      fAadhaarInput.value = '4109';
    }
    if (fVillageInput && !fVillageInput.value) {
      fVillageInput.value = 'Denduluru';
    }

    // Subscribe to real-time slot availability broadcasts from server
    QueueManager.subscribe('onSlotAvailabilityChanged', () => {
      this.renderSlotAvailabilityCards(marketSelect?.value, dateInput?.value);
      if (typeof this.renderAdminSlotCapacities === 'function') {
        this.renderAdminSlotCapacities();
      }
    });

    // Initial render of slot cards
    setTimeout(() => {
      this.renderSlotAvailabilityCards(marketSelect?.value, dateInput?.value);
    }, 400);

    const handleBookingSubmission = async (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }

      const activeBtn = document.getElementById('btnConfirmBooking') || submitBtn;
      const fName = (document.getElementById('bookFarmerName')?.value || '').trim();
      const fMobile = (document.getElementById('bookMobile')?.value || '').trim();
      const fMarketId = document.getElementById('bookMarket')?.value;
      const fDate = document.getElementById('bookDate')?.value;
      const fQuantity = Number(document.getElementById('bookQuantity')?.value);

      // Strict Requirement 1 & 2: Validate all required farmer and booking details
      if (!fName || fName.length < 2) {
        this.showToast('దయచేసి సరైన రైతు పేరు నమోదు చేయండి (Please enter valid farmer name).', 'notify');
        document.getElementById('bookFarmerName')?.focus();
        return;
      }

      const digitsOnly = fMobile.replace(/\D/g, '');
      if (!digitsOnly || digitsOnly.length < 10) {
        this.showToast('దయచేసి సరైన 10 అంకెల మొబైల్ నంబరు నమోదు చేయండి (Please enter a valid 10-digit mobile number).', 'notify');
        document.getElementById('bookMobile')?.focus();
        return;
      }

      if (!fMarketId) {
        this.showToast('దయచేసి కొనుగోలు కేంద్రాన్ని ఎంచుకోండి (Please select a procurement centre).', 'notify');
        document.getElementById('bookMarket')?.focus();
        return;
      }

      if (!fDate) {
        this.showToast('దయచేసి తేదీని ఎంచుకోండి (Please select a procurement date).', 'notify');
        document.getElementById('bookDate')?.focus();
        return;
      }

      if (!fQuantity || fQuantity <= 0) {
        this.showToast('దయచేసి సరైన పంట పరిమాణాన్ని నమోదు చేయండి (Please enter valid crop quantity in quintals).', 'notify');
        document.getElementById('bookQuantity')?.focus();
        return;
      }

      if (activeBtn) {
        activeBtn.disabled = true;
        activeBtn.innerHTML = '<span>⏳ Booking slot & allocating queue...</span>';
      }

      const chosenSlot = this.selectedSlotTime || document.getElementById('bookTimeSlot')?.value || '06:30 AM - 08:00 AM';

      const formData = {
        farmerName: fName,
        mobile: fMobile,
        aadhaar: document.getElementById('bookAadhaar')?.value || '4109',
        state: document.getElementById('bookState')?.value || 'andhra_pradesh',
        district: document.getElementById('bookDistrict')?.value || 'eluru',
        mandal: document.getElementById('bookMandal')?.value || '',
        village: document.getElementById('bookVillage')?.value || 'Denduluru',
        marketId: fMarketId,
        marketName: document.getElementById('bookMarket')?.selectedOptions[0]?.text || 'Government Agricultural Market Yard',
        cropId: document.getElementById('bookCrop')?.value || 'chilli',
        quantityQtl: fQuantity,
        vehicleType: document.getElementById('bookVehicle')?.value || 'minitruck',
        vehicleNo: document.getElementById('bookVehicleNo')?.value || '',
        slotDate: fDate,
        slotTime: chosenSlot
      };

      try {
        const newBooking = await QueueManager.createBooking(formData);

        if (activeBtn) {
          activeBtn.disabled = false;
          activeBtn.innerHTML = '<span style="font-size:1.2rem;">🎫</span> <span id="btnConfirmBookingLabel" data-i18n="btnGenerateToken">' + (t('btnGenerateToken') || 'Confirm Booking & Generate QR Token Pass') + '</span>';
        }

        QueueManager.activeFarmerToken = newBooking.token;
        QueueManager.activeFarmerId = newBooking.mobile;
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('rythu_last_farmer', newBooking.mobile);
          localStorage.setItem('rythu_last_token', newBooking.token);
          localStorage.setItem('rythu_last_farmer_name', newBooking.farmerName);
        }
        SecurityManager.currentUser = {
          name: newBooking.farmerName,
          mobile: newBooking.mobile,
          kisanId: newBooking.kisanId || ('KID-' + newBooking.mobile.slice(-4)),
          village: newBooking.village || 'Denduluru'
        };
        localStorage.setItem('rythu_farmer_profile', JSON.stringify(SecurityManager.currentUser));
        this.renderActiveUser();

        QueueManager.initWebSocket(newBooking.mobile);
        this.requestBrowserNotificationPermission();

        if (typeof QueueManager.fetchNotifications === 'function') {
          await QueueManager.fetchNotifications();
        }

        // Hide error banner if was showing
        const alertEl = document.getElementById('slotAutoShiftAlert');
        if (alertEl && !newBooking.isShifted) {
          alertEl.style.display = 'none';
        }

        if (newBooking.isShifted) {
          this.showToast('Selected shift is full. You have been assigned to the next available shift.', 'notify');
        } else {
          this.showToast(`${t('bookingSuccess') || 'Slot Booked Successfully!'} Token: ${newBooking.token}`, 'success');
        }

        this.renderTokenSlipModal(newBooking);
        this.renderLiveQueueBoard();
        this.renderFarmerLiveQueueCard();
        this.showSlotConfirmedBanner(newBooking);
        this.renderSlotAvailabilityCards(formData.marketId, formData.slotDate);
        this.renderFarmerBookingsHistory();

        // In-app notification popup via existing bell feature
        const latestNotif = (QueueManager.notifications && QueueManager.notifications[0]) || {
          title: newBooking.isShifted ? '🔔 Shift Updated' : '🔔 Slot Confirmed',
          message: newBooking.isShifted 
            ? `Selected shift is full. You have been assigned to the next available shift: ${newBooking.assignedShift || newBooking.assignedSlot}. Token: #${newBooking.tokenNumber || ''} (${newBooking.token}), Date: ${newBooking.slotDate}, Expected Arrival Time: ${newBooking.expectedTime}.`
            : `Slot Confirmed! Your procurement slot is confirmed for ${newBooking.assignedShift || newBooking.assignedSlot} on ${newBooking.slotDate}. Token: #${newBooking.tokenNumber || ''} (${newBooking.token}), Expected Arrival Time: ${newBooking.expectedTime}.`,
          sms_status: 'NOT_CONFIGURED',
          booking_id: newBooking.token
        };
        this.showRealtimePopupToast(latestNotif, newBooking, 'CONFIRMED');
      } catch (err) {
        if (activeBtn) {
          activeBtn.disabled = false;
          activeBtn.innerHTML = '<span style="font-size:1.2rem;">🎫</span> <span id="btnConfirmBookingLabel" data-i18n="btnGenerateToken">' + (t('btnGenerateToken') || 'Confirm Booking & Generate QR Token Pass') + '</span>';
        }
        const msg = err.message || 'Booking failed. All shifts for this date may be full.';
        this.showToast(msg, 'notify');
        const alertEl = document.getElementById('slotAutoShiftAlert');
        if (alertEl) {
          alertEl.style.display = 'flex';
          const alertTitle = document.getElementById('autoShiftAlertTitle');
          const alertDesc = document.getElementById('autoShiftAlertDesc');
          if (alertTitle) alertTitle.innerText = '⚠️ Booking Notice';
          if (alertDesc) alertDesc.innerText = msg;
        }
      }
    };

    if (form) {
      form.addEventListener('submit', handleBookingSubmission);
    }
    const confirmBtn = document.getElementById('btnConfirmBooking');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', (e) => {
        handleBookingSubmission(e);
      });
    }
  }

  async showPassModalForToken(token) {
    if (!token) return;
    const b = await QueueManager.findBookingAsync(token);
    if (b) {
      this.renderTokenSlipModal(b);
    } else {
      this.viewBookingDetails(token);
    }
  }

  showSlotConfirmedBanner(booking) {
    const bar = document.getElementById('slotConfirmedNotificationBar');
    if (!bar) return;
    bar.style.display = 'block';

    const mainText = document.getElementById('scNotifMainText');
    const subText = document.getElementById('scNotifSubText');

    if (booking.isShifted) {
      if (mainText) {
        mainText.innerHTML = `⚠️ <strong>Selected shift is full. You have been assigned to the next available shift.</strong>`;
      }
      if (subText) {
        subText.innerHTML = `<strong>Final Assigned Shift:</strong> ${booking.assignedShift || booking.assignedSlot} • <strong>Token Number:</strong> #${booking.tokenNumber || ''} (${booking.token}) • <strong>Date:</strong> ${booking.slotDate} • <strong>Expected Arrival Time:</strong> ${booking.expectedTime} • <strong>Centre:</strong> ${booking.marketName}`;
      }
    } else {
      if (mainText) {
        mainText.innerHTML = `🎉 <strong>Slot Confirmed!</strong> ${booking.farmerName} • Token: <strong>${booking.token}</strong>`;
      }
      if (subText) {
        subText.innerHTML = `<strong>Final Assigned Shift:</strong> ${booking.assignedShift || booking.assignedSlot} • <strong>Token Number:</strong> #${booking.tokenNumber || ''} (${booking.token}) • <strong>Date:</strong> ${booking.slotDate} • <strong>Expected Arrival Time:</strong> ${booking.expectedTime} • <strong>Centre:</strong> ${booking.marketName} • <strong>Gate:</strong> ${booking.gateNo || 'Gate 1'}`;
      }
    }

    const btnOpen = document.getElementById('btnOpenNotifsFromBanner');
    if (btnOpen) {
      btnOpen.onclick = (e) => {
        e.preventDefault();
        this.toggleNotificationDrawer(true);
      };
    }

    const btnQueue = document.getElementById('btnViewQueueFromBanner');
    if (btnQueue) {
      btnQueue.onclick = (e) => {
        e.preventDefault();
        this.switchTab('queue');
      };
    }

    const btnDismiss = document.getElementById('btnDismissSlotBanner');
    if (btnDismiss) {
      btnDismiss.onclick = (e) => {
        e.preventDefault();
        bar.style.display = 'none';
      };
    }

    const btnCancel = document.getElementById('btnCancelSlotFromBanner');
    if (btnCancel) {
      btnCancel.onclick = (e) => {
        e.preventDefault();
        this.handleCancelBooking(booking.token);
      };
    }

    bar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async renderFarmerBookingsHistory() {
    const listEl = document.getElementById('farmerBookingsHistoryList');
    if (!listEl) return;

    const allBookings = await QueueManager.fetchAllBookings();
    const activeFarmerMobile = QueueManager.activeFarmerId ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('rythu_last_farmer')) ||
      (SecurityManager.currentUser && SecurityManager.currentUser.mobile) ||
      null;

    let farmerBookings = allBookings;
    if (activeFarmerMobile) {
      const cleanMobile = activeFarmerMobile.replace(/\D/g, '').slice(-10);
      const filtered = allBookings.filter(b => {
        const bMob = (b.mobile || '').replace(/\D/g, '').slice(-10);
        return bMob && bMob === cleanMobile;
      });
      if (filtered.length > 0) {
        farmerBookings = filtered;
      }
    }

    if (!farmerBookings || farmerBookings.length === 0) {
      listEl.innerHTML = `
        <div style="text-align:center; padding:24px; color:#64748b; font-size:0.9rem;">
          🌾 ${t('noBookingsNotice') || 'మీరు ఇంకా ఎలాంటి స్లాట్‌లను బుక్ చేయలేదు. పై ఫారమ్‌ను ఉపయోగించి స్లాట్ బుక్ చేసుకోండి (No active bookings found).'}
        </div>
      `;
      return;
    }

    listEl.innerHTML = farmerBookings.slice(0, 10).map(b => {
      const isCancelled = (b.status || '').toLowerCase() === 'cancelled';
      const statusPill = isCancelled 
        ? '<span class="status-pill" style="background:#fee2e2; color:#dc2626;">రద్దు చేయబడింది (CANCELLED)</span>'
        : '<span class="status-pill pill-green">ఖరారైంది (CONFIRMED)</span>';
      
      const shiftName = b.assignedShift || b.assignedSlot || b.slotTime || 'Shift 1';
      const expTime = b.expectedTime || b.slotTime || '08:00 AM';
      const tokenNum = b.tokenNumber ? `#${b.tokenNumber}` : '';

      return `
        <div class="booking-history-item" style="background:#ffffff; border:1px solid ${isCancelled ? '#fca5a5' : '#cbd5e1'}; border-radius:10px; padding:14px; margin-bottom:12px; box-shadow:0 2px 6px rgba(0,0,0,0.04);">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px;">
            <div>
              <div style="display:flex; align-items:center; gap:8px;">
                <strong style="font-size:1.05rem; color:#0f172a;">${tokenNum} ${b.token}</strong>
                ${statusPill}
              </div>
              <div style="font-size:0.84rem; color:#334155; margin-top:4px;">
                👤 <strong>${b.farmerName}</strong> • 📱 ${b.mobile}
              </div>
            </div>
            <div style="text-align:right;">
              <span style="font-size:0.75rem; color:#64748b;">బుకింగ్ తేదీ (Booking Date)</span>
              <div style="font-weight:700; color:#0f172a; font-size:0.92rem;">📅 ${b.slotDate}</div>
            </div>
          </div>

          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:10px; background:#f8fafc; border-radius:8px; padding:10px; margin:10px 0; font-size:0.83rem;">
            <div>
              <span style="color:#64748b;">కేంద్రం (Centre):</span>
              <div style="font-weight:700; color:#1e293b;">${b.marketName || 'Procurement Centre'}</div>
            </div>
            <div>
              <span style="color:#64748b;">కేటాయించిన షిఫ్ట్ (Assigned Shift):</span>
              <div style="font-weight:700; color:#047857;">${shiftName}</div>
            </div>
            <div>
              <span style="color:#64748b;">రాక సమయం (Expected Arrival):</span>
              <div style="font-weight:700; color:#047857;">⏰ ${expTime}</div>
            </div>
            <div>
              <span style="color:#64748b;">పంట & పరిమాణం (Crop & Qty):</span>
              <div style="font-weight:700; color:#1e293b;">🌾 ${b.cropName || 'Chilli'} (${b.quantityQtl || 30} Qtl)</div>
            </div>
          </div>

          ${b.isShifted ? `
            <div style="font-size:0.78rem; color:#c2410c; background:#fff7ed; border:1px solid #fdba74; border-radius:6px; padding:6px 10px; margin-bottom:10px;">
              ⚠️ <strong>గమనిక:</strong> అసలు షిఫ్ట్ నిండడం వలన తదుపరి అందుబాటులో ఉన్న షిఫ్ట్‌కు ఆటోమేటిక్‌గా కేటాయించబడింది.
            </div>
          ` : ''}

          <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:8px;">
            <button type="button" class="btn btn-outline btn-sm" onclick="app.showPassModalForToken('${b.token}')" style="font-size:0.8rem;">
              🎫 డిజిటల్ పాస్ (View QR Pass)
            </button>
            ${!isCancelled ? `
              <button type="button" class="btn btn-sm" onclick="app.handleCancelBooking('${b.token}')" style="background:#fee2e2; color:#dc2626; border:1px solid #fca5a5; font-size:0.8rem;">
                ❌ రద్దు చేయండి (Cancel)
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  setupNotificationDrawer() {
    const bellBtn = document.getElementById('btnNotificationBell');
    const drawer = document.getElementById('notificationDrawer');
    const wrap = document.getElementById('notificationBellWrap');

    if (bellBtn) {
      bellBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.requestBrowserNotificationPermission();
        this.toggleNotificationDrawer();
      });
    }

    document.addEventListener('click', (e) => {
      if (drawer && wrap && !wrap.contains(e.target)) {
        drawer.style.display = 'none';
      }
    });

    const btnMarkRead = document.getElementById('btnMarkAllNotifsRead');
    if (btnMarkRead) {
      btnMarkRead.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof QueueManager.markAllNotificationsRead === 'function') {
          QueueManager.markAllNotificationsRead();
        } else {
          QueueManager.notifications.forEach(n => { n.isRead = true; n.read_status = true; });
          QueueManager.unreadNotificationCount = 0;
          QueueManager.saveNotifications();
          this.updateNotificationBadge(0);
          this.renderNotificationDrawer(QueueManager.notifications);
        }
      });
    }

    const btnClear = document.getElementById('btnClearAllNotifs');
    if (btnClear) {
      btnClear.addEventListener('click', (e) => {
        e.stopPropagation();
        QueueManager.notifications = [];
        QueueManager.unreadNotificationCount = 0;
        QueueManager.saveNotifications();
        this.updateNotificationBadge(0);
        this.renderNotificationDrawer([]);
      });
    }
  }

  toggleNotificationDrawer(forceOpen = false) {
    const drawer = document.getElementById('notificationDrawer');
    if (!drawer) return;
    const isCurrentlyOpen = drawer.style.display === 'block';
    const nextState = forceOpen ? true : !isCurrentlyOpen;
    drawer.style.display = nextState ? 'block' : 'none';
    if (nextState) {
      this.renderNotificationDrawer(QueueManager.notifications);
    }
  }

  updateNotificationBadge(count) {
    const badge = document.getElementById('notificationBadge');
    if (!badge) return;
    const unread = Number(count) || 0;
    if (unread > 0) {
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
      badge.textContent = '0';
    }
  }

  renderNotificationDrawer(notifs) {
    const list = document.getElementById('notificationDrawerList');
    if (!list) return;

    if (!notifs || notifs.length === 0) {
      list.innerHTML = `<div style="padding:24px; text-align:center; color:#64748b; font-size:0.85rem;" data-i18n="notifDrawerEmpty">🔔 కొత్త నోటిఫికేషన్లు ఏవీ లేవు (No notifications)</div>`;
      return;
    }

    list.innerHTML = notifs.map(n => {
      const isUnread = n.read_status === false || n.readStatus === false || n.isRead === false;
      const nId = n.notification_id || n.notificationId || n.id;
      const token = n.booking_id || n.bookingId || n.token || '';
      
      let icon = '📢';
      if (n.type === 'slot_booked' || n.type === 'slot_confirmed') icon = '🔔';
      else if (n.type === 'mandi_check_in') icon = '🏛️';
      else if (n.type === 'queue_position') icon = '🚦';
      else if (n.type === 'procurement_processing') icon = '⚖️';
      else if (n.type === 'procurement_completed') icon = '✅';
      else if (n.type === 'booking_cancelled') icon = '⚠️';

      const timeStr = n.createdAt || n.created_at || 'ఇప్పుడే';
      const smsStatus = (n.sms_status || n.smsStatus || 'NOT_CONFIGURED').toUpperCase();
      let smsBadgeHtml = '';
      if (smsStatus === 'SENT') {
        smsBadgeHtml = '<span class="sms-badge sent">SMS: Sent</span>';
      } else if (smsStatus === 'NOT_CONFIGURED') {
        smsBadgeHtml = '<span class="sms-badge not-configured" title="Configure FAST2SMS_API_KEY in .env">SMS: Not Configured</span>';
      } else {
        smsBadgeHtml = `<span class="sms-badge failed">SMS: ${smsStatus}</span>`;
      }

      return `
        <div class="notification-item ${isUnread ? 'unread' : ''}" onclick="app.handleNotificationItemClick(${nId}, '${token}')" style="cursor:pointer;">
          <div class="notification-icon">${icon}</div>
          <div class="notification-content">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:6px;">
              <div class="notification-title">${n.title || 'Mandi Alert'}</div>
              ${isUnread ? '<span style="width:8px; height:8px; background:#059669; border-radius:50%; flex-shrink:0;" title="Unread"></span>' : ''}
            </div>
            <div class="notification-desc" style="white-space:pre-line;">${n.message || ''}</div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px; flex-wrap:wrap; gap:4px;">
              <div class="notification-time">🕒 ${timeStr} ${token ? `• టోకెన్: <strong>${token}</strong>` : ''}</div>
              ${smsBadgeHtml}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  handleNotificationItemClick(notificationId, token) {
    if (notificationId && typeof QueueManager.markNotificationRead === 'function') {
      QueueManager.markNotificationRead(notificationId);
    }
    if (token) {
      this.viewBookingDetails(token);
    }
  }

  renderTokenSlipModal(booking) {
    const modal = document.getElementById('tokenSlipModal');
    const content = document.getElementById('tokenSlipContent');
    if (!modal || !content) return;

    const qrSvg = QueueManager.generateQrSvg(booking.token);
    const assignedSlot = booking.assignedSlot || booking.slotTime;
    const preferredSlot = booking.preferredSlot || booking.slotTime;
    const isShifted = Boolean(booking.isShifted);
    const expectedTime = booking.expectedTime || '10:15 AM';
    const slotPos = booking.slotPosition || booking.queuePosition || 1;
    const status = (booking.status || 'CONFIRMED').toUpperCase();

    let shiftAlertBadge = '';
    if (booking.status === 'WAITING_OVERFLOW') {
      shiftAlertBadge = `
        <div style="background:#fef3c7; border:1px solid #fcd34d; border-radius:8px; padding:10px 14px; margin:10px 0; color:#92400e; font-size:0.86rem;">
          ⏳ <strong>${t('waitingQueueTitle') || 'Waiting Queue'}:</strong> Position #${booking.waitingPosition || 1}. You will be allocated automatically when capacity frees.
        </div>
      `;
    } else if (isShifted) {
      shiftAlertBadge = `
        <div style="background:#fff7ed; border:1.5px solid #fdba74; border-radius:10px; padding:12px 14px; margin:12px 0; color:#9a3412;">
          <div style="font-weight:800; font-size:0.95rem; display:flex; align-items:center; gap:6px;">
            <span>⚠️</span>
            <span>Selected shift is full. You have been assigned to the next available shift.</span>
          </div>
          <div style="margin-top:6px; font-size:0.86rem; color:#7c2d12;">
            Selected: <span style="text-decoration:line-through;">${preferredSlot}</span> &rarr; Final Assigned Shift: <strong>${assignedSlot}</strong>
          </div>
        </div>
      `;
    }

    content.innerHTML = `
      <div class="digital-token-pass">
        <div class="pass-header">
          <div class="gov-emblem">🌾 RYTHU SEVA DIGITAL PASS</div>
          <div class="token-code">${booking.token}</div>
          <div class="pass-gate">${booking.gateNo || 'Gate 1 (Weighbridge Bay A)'}</div>
        </div>

        <div class="pass-body">
          <div class="pass-qr-wrap">
            ${qrSvg}
            <div class="scan-label">Scan at Mandi Entry Gate • FCFS Queue</div>
          </div>

          ${shiftAlertBadge}

          <div class="pass-details-grid">
            <div class="detail-item">
              <span class="detail-label">${t('fieldName') || 'Farmer Name'}:</span>
              <span class="detail-val font-bold">${booking.farmerName}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">${t('fieldVillage') || 'Village'}:</span>
              <span class="detail-val">${booking.village || booking.mandal || 'Denduluru'}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">${t('fieldCrop') || 'Crop'}:</span>
              <span class="detail-val">${booking.cropName || 'Paddy'} (${booking.quantityQtl || 35} Qtl)</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">${t('fieldMarket') || 'Mandi Centre'}:</span>
              <span class="detail-val">${booking.marketName || 'Government Procurement Centre'}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Final Assigned Shift:</span>
              <span class="detail-val font-bold text-emerald-700">${assignedSlot}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Token Number:</span>
              <span class="detail-val font-bold text-blue-700">#${booking.tokenNumber || ''} (${booking.token})</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Date:</span>
              <span class="detail-val font-bold text-slate-800">${booking.slotDate}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Expected Arrival Time:</span>
              <span class="detail-val font-bold text-emerald-700">${expectedTime}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Queue Position:</span>
              <span class="detail-val queue-num font-bold text-blue-700">#${slotPos} in Shift</span>
            </div>
            ${isShifted ? `
            <div class="detail-item">
              <span class="detail-label">Preferred Shift:</span>
              <span class="detail-val" style="color:#64748b; text-decoration:line-through;">${preferredSlot}</span>
            </div>
            ` : ''}
            <div class="detail-item">
              <span class="detail-label">Vehicle Reg:</span>
              <span class="detail-val">${booking.vehicleNo || 'AP 07 TR 4821'} (${(booking.vehicleType || 'tractor').toUpperCase()})</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Status:</span>
              <span class="detail-val font-bold ${status === 'CANCELLED' ? 'text-red-600' : 'text-emerald-700'}">${status}</span>
            </div>
          </div>
        </div>

        <div class="pass-footer" style="display:flex; gap:10px; flex-wrap:wrap; justify-content:space-between; align-items:center;">
          <button class="btn btn-primary" onclick="window.print()">🖨️ Print / Save Pass</button>
          <button class="btn btn-pass-cancel" id="btnCancelFromPassModal" data-token="${booking.token}">
            ❌ ${t('btnCancelBooking') || 'Cancel Booking'}
          </button>
          <button class="btn btn-secondary" id="closePassModal">Done</button>
        </div>
      </div>
    `;

    modal.classList.add('active');
    document.getElementById('closePassModal')?.addEventListener('click', () => {
      modal.classList.remove('active');
      this.switchTab('queue');
    });

    document.getElementById('btnCancelFromPassModal')?.addEventListener('click', () => {
      this.handleCancelBooking(booking.token);
    });
  }

  setupQueueUI() {
    const btnSimulate = document.getElementById('btnSimulateAdvance');
    if (btnSimulate) {
      btnSimulate.addEventListener('click', () => {
        const result = QueueManager.advanceQueue();
        this.renderLiveQueueBoard();
        this.showToast(`Calling Token ${result.nowServing}! Gate Pass verified.`);
        this.playChime('notify');
      });
    }
  }

  async refreshQueueSilently() {
    try {
      await QueueManager.syncWithBackend();
    } catch (e) {}
    this.renderLiveQueueBoard();
    this.checkBackendHealth();
  }

  renderLiveQueueBoard() {
    const servingEl = document.getElementById('nowServingTokenDisplay');
    const homeServing = document.getElementById('homeServingToken');
    const activeTableBody = document.getElementById('liveQueueTableBody');

    if (servingEl) servingEl.innerText = QueueManager.currentlyServingToken;
    if (homeServing) homeServing.innerText = QueueManager.currentlyServingToken;

    if (activeTableBody) {
      activeTableBody.innerHTML = '';
      QueueManager.bookings.slice(0, 10).forEach(b => {
        const tr = document.createElement('tr');
        const statusBadge = this.getStatusBadge(b.status);
        const shiftDisp = b.assignedShift || b.assignedSlot || b.slotTime || 'Shift 1';
        const expTime = b.expectedTime || b.slotTime || '08:00 AM';
        const qPos = b.slotPosition || b.queuePosition || 1;
        tr.innerHTML = `
          <td><strong>${b.token}</strong></td>
          <td>${b.farmerName}</td>
          <td><span class="badge badge-outline">${shiftDisp}</span></td>
          <td><strong style="color:#047857;">${expTime}</strong></td>
          <td><span class="badge ${b.estWaitMins <= 15 ? 'badge-green' : 'badge-amber'}">Pos #${qPos} (${b.estWaitMins || 10}m)</span></td>
          <td>${statusBadge}</td>
          <td>
            <button class="btn-table-action" onclick="app.viewBookingDetails('${b.token}')">View</button>
          </td>
        `;
        activeTableBody.appendChild(tr);
      });
    }
  }

  getStatusBadge(status) {
    switch (status) {
      case 'booked': return '<span class="status-pill pill-blue">Slot Booked</span>';
      case 'arrived': return '<span class="status-pill pill-amber">Gate Inward</span>';
      case 'inspected': return '<span class="status-pill pill-purple">Quality Passed</span>';
      case 'weighed': return '<span class="status-pill pill-indigo">Weighed</span>';
      case 'billed': return '<span class="status-pill pill-teal">MSP Bill Issued</span>';
      case 'paid': return '<span class="status-pill pill-green">DBT Paid</span>';
      default: return '<span class="status-pill">Pending</span>';
    }
  }

  setupBestSellingDestinations() {
    this.activeCropFilter = 'chilli';
    const pills = document.querySelectorAll('#bestCropFilterPills .crop-pill-btn');
    pills.forEach(btn => {
      btn.addEventListener('click', () => {
        pills.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const cropId = btn.getAttribute('data-crop');
        this.activeCropFilter = cropId;
        this.renderBestSellingDestinations(cropId);
      });
    });
    this.renderBestSellingDestinations('chilli');
  }

  renderBestSellingDestinations(cropId = 'chilli') {
    const container = document.getElementById('bestDestinationsView');
    if (!container) return;

    const data = BEST_SELLING_DESTINATIONS[cropId] || BEST_SELLING_DESTINATIONS.chilli;
    const crop = CROP_DATA[cropId] || CROP_DATA.chilli;
    const cropName = crop.name[currentLanguage] || crop.name.en;

    let mandisHtml = '';
    data.topSellingMandis.forEach((m, idx) => {
      const name = currentLanguage === 'te' && m.nameTe ? m.nameTe : m.name;
      const reason = currentLanguage === 'te' && m.reasonTe ? m.reasonTe : m.reason;
      mandisHtml += `
        <div class="mandi-rank-item ${idx === 0 ? 'top-rank' : ''}">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
            <div>
              <div style="display:flex; align-items:center; gap:6px;">
                <span class="badge ${idx === 0 ? 'badge-green' : 'badge-amber'}">#${idx + 1} Best Choice</span>
                <strong style="font-size:0.95rem; color:#0f172a;">${name}</strong>
              </div>
              <p style="font-size:0.78rem; color:#64748b; margin-top:2px;">📍 ${m.district}, ${m.state}</p>
            </div>
            <div style="text-align:right;">
              <div style="font-size:1.15rem; font-weight:800; color:#059669;">₹${m.price.toLocaleString('en-IN')}<span style="font-size:0.75rem; color:#64748b; font-weight:500;">/Qtl</span></div>
              <span style="font-size:0.72rem; color:#10b981; font-weight:700;">${m.benchmarkDiff}</span>
            </div>
          </div>
          <div style="font-size:0.82rem; color:#334155; margin-top:8px; line-height:1.4;">
            💡 <strong>${currentLanguage === 'te' ? 'ఎందుకు ఉత్తమం:' : 'Why it pays most:'}</strong> ${reason}
          </div>
          <div style="margin-top:8px; font-size:0.75rem; color:#047857; font-weight:600;">
            ${m.rating}
          </div>
        </div>
      `;
    });

    const primaryAreas = currentLanguage === 'te' && data.preferredBuyingHubs.primaryAreasTe ? data.preferredBuyingHubs.primaryAreasTe : data.preferredBuyingHubs.primaryAreas;
    let buyersHtml = '';
    data.preferredBuyingHubs.buyerClusters.forEach(b => {
      const bName = currentLanguage === 'te' && b.nameTe ? b.nameTe : b.name;
      const pref = currentLanguage === 'te' && b.preferenceTe ? b.preferenceTe : b.preference;
      buyersHtml += `
        <div class="buyer-cluster-item">
          <div style="font-weight:700; color:#1e293b; font-size:0.88rem;">🏢 ${bName}</div>
          <div style="font-size:0.78rem; color:#64748b; margin-top:2px;">📍 <strong>${currentLanguage === 'te' ? 'కొనుగోలు ప్రాంతాలు:' : 'Presence:'}</strong> ${b.presence}</div>
          <div style="font-size:0.82rem; color:#0f172a; margin-top:4px;">
            ✓ <strong>${currentLanguage === 'te' ? 'నాణ్యత ప్రమాణం:' : 'Preference:'}</strong> ${pref}
          </div>
        </div>
      `;
    });

    const whyText = currentLanguage === 'te' && data.preferredBuyingHubs.whyPreferThisAreaTe ? data.preferredBuyingHubs.whyPreferThisAreaTe : data.preferredBuyingHubs.whyPreferThisArea;

    container.innerHTML = `
      <div class="best-destinations-grid">
        <!-- Left: Top Ranked Mandis -->
        <div class="destinations-card">
          <h4 style="font-size:1rem; color:#064e3b; margin-bottom:12px; display:flex; align-items:center; gap:6px;">
            <span>🏆</span>
            <span data-i18n="topMandisSellTitle">${t('topMandisSellTitle')}</span> (${cropName})
          </h4>
          <div class="mandis-rank-list">
            ${mandisHtml}
          </div>
        </div>

        <!-- Right: Preferred Buying Hubs & Demand Clusters -->
        <div class="destinations-card">
          <h4 style="font-size:1rem; color:#1e40af; margin-bottom:12px; display:flex; align-items:center; gap:6px;">
            <span>🏢</span>
            <span data-i18n="whoPreferablyBuysTitle">${t('whoPreferablyBuysTitle')}</span>
          </h4>
          <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:var(--radius-sm); padding:10px 12px; margin-bottom:12px;">
            <div style="font-size:0.78rem; font-weight:700; color:#1e40af; text-transform:uppercase;">
              📍 ${currentLanguage === 'te' ? 'ప్రధాన కొనుగోలు ప్రాంతాలు:' : 'Primary Buying Hubs:'}
            </div>
            <div style="font-size:0.88rem; color:#1e3a8a; font-weight:600; margin-top:4px;">
              ${primaryAreas.join(' • ')}
            </div>
          </div>

          <div class="buyer-clusters-list">
            ${buyersHtml}
          </div>

          <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:var(--radius-sm); padding:10px 12px; margin-top:10px; font-size:0.8rem; color:#166534;">
            <strong>${t('whyBuyersPreferLabel')}</strong> ${whyText}
          </div>
        </div>
      </div>
    `;
  }

  setupMarketCalculator() {
    const calcBtn = document.getElementById('btnRunCalculator');
    const cropSel = document.getElementById('calcCrop');
    const qtyInput = document.getElementById('calcQuantity');
    const vehSel = document.getElementById('calcVehicle');
    const distSel = document.getElementById('calcDistrict');

    const triggerUpdate = () => {
      this.updateMarketListings();
      this.runProfitCalculation();
    };

    if (calcBtn) calcBtn.addEventListener('click', triggerUpdate);
    if (cropSel) cropSel.addEventListener('change', triggerUpdate);
    if (qtyInput) qtyInput.addEventListener('input', triggerUpdate);
    if (vehSel) vehSel.addEventListener('change', triggerUpdate);
    if (distSel) distSel.addEventListener('change', triggerUpdate);
  }

  updateMarketListings() {
    const stateId = document.getElementById('calcState')?.value || 'andhra_pradesh';
    const distId = document.getElementById('calcDistrict')?.value || 'guntur';
    const cropId = document.getElementById('calcCrop')?.value || 'chilli';
    const container = document.getElementById('districtMarketsList');

    if (!container) return;

    const state = STATES_DISTRICTS_DATA[stateId];
    const district = state?.districts[distId];

    if (!district || !district.markets || district.markets.length === 0) {
      container.innerHTML = `<div class="empty-notice">No government markets registered for this district yet.</div>`;
      return;
    }

    container.innerHTML = '';
    district.markets.forEach(m => {
      const cropInfo = m.crops && m.crops[cropId] ? m.crops[cropId] : null;
      const crop = CROP_DATA[cropId];
      const price = cropInfo ? cropInfo.price : crop.avgMarketPrice;
      const demand = cropInfo ? cropInfo.demand : crop.demandLevel;

      const name = currentLanguage === 'te' && m.nameTe ? m.nameTe : m.name;
      const card = document.createElement('div');
      card.className = 'market-info-card';
      card.innerHTML = `
        <div class="market-card-top">
          <div>
            <h4 class="market-name">${name}</h4>
            <span class="market-badge">${m.type}</span>
          </div>
          <div class="price-pill">
            <span class="rate-num">₹${price.toLocaleString('en-IN')}</span>
            <span class="rate-unit">/ Qtl</span>
          </div>
        </div>

        <div class="market-card-body">
          <p class="market-addr">📍 ${m.address}</p>
          <div class="market-meta-row">
            <span class="meta-item">🕒 ${m.operatingHours}</span>
            <span class="meta-item">📞 ${m.phone}</span>
            <span class="meta-item ${m.congestion === 'green' ? 'text-green' : (m.congestion === 'amber' ? 'text-amber' : 'text-red')}">
              🚦 ${m.currentQueueVehicles} Vehicles in Queue (~${m.currentWaitMins}m wait)
            </span>
          </div>
          <div class="demand-row">
            <span class="demand-badge ${demand}">
              ${demand === 'very_high' ? '🔥 ' + t('veryHighDemand') : (demand === 'high' ? '🟢 ' + t('highDemand') : '🟡 ' + t('steadyDemand'))}
            </span>
            <span class="msp-diff">${cropInfo ? cropInfo.mspComparison : 'Govt Benchmark'}</span>
          </div>
        </div>

        <div class="market-card-footer">
          <a href="${m.mapUrl}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">
            🗺️ ${t('viewOnMap')}
          </a>
          <button class="btn btn-secondary btn-sm" onclick="app.prefillSlot('${m.id}', '${cropId}')">
            ⚡ Book Slot Here
          </button>
        </div>
      `;
      container.appendChild(card);
    });
  }

  runProfitCalculation() {
    const stateId = document.getElementById('calcState')?.value || 'andhra_pradesh';
    const distId = document.getElementById('calcDistrict')?.value || 'guntur';
    const cropId = document.getElementById('calcCrop')?.value || 'chilli';
    const quantityQtl = Number(document.getElementById('calcQuantity')?.value) || 30;
    const vehicleType = document.getElementById('calcVehicle')?.value || 'minitruck';

    const results = ProfitCalculator.findBestMarkets({
      stateId,
      districtId: distId,
      cropId,
      quantityQtl,
      vehicleType
    });

    const resultsContainer = document.getElementById('profitResultsList');
    if (!resultsContainer) return;

    if (results.length === 0) {
      resultsContainer.innerHTML = `<div class="empty-notice">No calculation data available.</div>`;
      return;
    }

    resultsContainer.innerHTML = '';
    results.forEach((res, index) => {
      const card = document.createElement('div');
      card.className = `profit-result-card ${res.isBestChoice ? 'best-choice' : ''}`;
      
      const mktName = currentLanguage === 'te' && res.marketNameTe ? res.marketNameTe : res.marketName;

      card.innerHTML = `
        ${res.isBestChoice ? `<div class="best-choice-ribbon">${t('bestChoiceBadge')}</div>` : ''}
        <div class="result-card-header">
          <div>
            <span class="rank-number">#${index + 1}</span>
            <strong class="result-market-name">${mktName}</strong>
            <span class="dist-tag">~${res.distanceKm} km</span>
          </div>
          <div class="net-profit-badge">
            <span class="net-label">${t('netProfitAmount')}:</span>
            <span class="net-value">₹${res.netProfit.toLocaleString('en-IN')}</span>
          </div>
        </div>

        <div style="background:#f8fafc; border:1px solid #d1fae5; border-radius:6px; padding:8px 12px; margin: 8px 0 12px; font-size:0.84rem; color:#065f46; font-weight:600;">
          📐 <strong>Best Selling</strong> = ₹${res.grossRevenue.toLocaleString('en-IN')} (Price) − ₹${res.transportCost.toLocaleString('en-IN')} (Transport) − ₹${res.otherCharges.toLocaleString('en-IN')} (Charges) = <span style="color:#047857; font-weight:800;">₹${res.netProfit.toLocaleString('en-IN')}</span> Net Payout
        </div>

        <div class="formula-breakdown-grid">
          <div class="formula-col plus">
            <span class="f-label">${t('grossRevenue')}</span>
            <span class="f-val">₹${res.grossRevenue.toLocaleString('en-IN')}</span>
            <span class="f-sub">(₹${res.pricePerQtl}/Qtl × ${quantityQtl})</span>
          </div>
          <div class="formula-col minus">
            <span class="f-label">${t('transportDeduction')}</span>
            <span class="f-val">- ₹${res.transportCost.toLocaleString('en-IN')}</span>
            <span class="f-sub">(${res.distanceKm} km via ${res.breakdown.vehicleType.split('(')[0]})</span>
          </div>
          <div class="formula-col minus">
            <span class="f-label">${t('otherChargesDeduction')}</span>
            <span class="f-val">- ₹${res.otherCharges.toLocaleString('en-IN')}</span>
            <span class="f-sub">(Hamali ₹${res.breakdown.hamaliTotal} + Weighing ₹${res.breakdown.weighmentTotal})</span>
          </div>
          <div class="formula-col equals">
            <span class="f-label">${t('netPerQtl')}</span>
            <span class="f-val text-emerald-600">₹${res.netPerQtl.toLocaleString('en-IN')}</span>
            <span class="f-sub">Realized in Hand</span>
          </div>
        </div>

        <div class="result-action-bar">
          <a href="${res.mapUrl}" target="_blank" rel="noopener" class="text-link">📍 View Directions on Maps</a>
          <button class="btn btn-primary btn-sm" onclick="app.prefillSlot('${res.marketId}', '${cropId}')">
            Select & Book Slot (₹${res.netProfit.toLocaleString('en-IN')})
          </button>
        </div>
      `;
      resultsContainer.appendChild(card);
    });
  }

  prefillSlot(marketId, cropId) {
    this.switchTab('book');
    const cropSel = document.getElementById('bookCrop');
    if (cropSel && cropId) cropSel.value = cropId;
    const mktSel = document.getElementById('bookMarket');
    if (mktSel && marketId) mktSel.value = marketId;
    this.showToast(`Selected Market Yard for Slot Booking!`);
  }

  setupTracker() {
    const trackBtn = document.getElementById('btnSearchToken');
    const input = document.getElementById('trackTokenInput');
    const resultBox = document.getElementById('trackResultBox');

    const doTrack = async () => {
      const q = input.value.trim();
      if (!q) {
        this.showToast('Please enter a valid Token or Mobile Number', 'notify');
        return;
      }

      const booking = await QueueManager.findBookingAsync(q);
      if (!booking) {
        resultBox.style.display = 'block';
        resultBox.innerHTML = `
          <div class="not-found-card">
            <p>⚠️ No record found for "<strong>${q}</strong>". Try sample token: <code>AP-GNT-2026-0842</code> or your mobile number.</p>
          </div>
        `;
        return;
      }

      this.renderTrackerResult(booking);
    };

    if (trackBtn) trackBtn.addEventListener('click', doTrack);
    if (input) {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') doTrack();
      });
    }
  }

  async viewBookingDetails(token) {
    this.switchTab('track');
    const input = document.getElementById('trackTokenInput');
    if (input) input.value = token;
    const booking = await QueueManager.findBookingAsync(token);
    if (booking) {
      this.renderTrackerResult(booking);
    }
  }

  renderTrackerResult(b) {
    const resultBox = document.getElementById('trackResultBox');
    if (!resultBox) return;

    resultBox.style.display = 'block';

    const rawStatus = (b.status || 'booked').toUpperCase();
    const isCancelled = rawStatus === 'CANCELLED';

    const stages = [
      { id: 'BOOKED', label: '1. స్లాట్ బుక్ అయింది (BOOKED)', desc: `Reserved: ${b.slotDate} ${b.slotTime}` },
      { id: 'CONFIRMED', label: '2. స్లాట్ ఖరారైంది (CONFIRMED)', desc: 'Admin confirmed slot' },
      { id: 'CHECK-IN', label: '3. మార్కెట్ గేట్ ఎంట్రీ (CHECK-IN)', desc: `${b.gateNo || 'Gate 1'} check-in verified` },
      { id: 'IN QUEUE', label: '4. లైవ్ క్యూలో ఉన్నది (IN QUEUE)', desc: `Position #${b.queuePosition || 1} (~${b.estWaitMins || 15}m)` },
      { id: 'PROCESSING', label: '5. తూకం & నాణ్యత (PROCESSING)', desc: b.moisturePercent ? `Moisture: ${b.moisturePercent}%` : 'Weighbridge & Inspection' },
      { id: 'COMPLETED', label: '6. కొనుగోలు పూర్తయింది (COMPLETED)', desc: 'Direct DBT Bank Transfer' }
    ];

    const stageMap = {
      'BOOKED': 0,
      'CONFIRMED': 1,
      'CHECK-IN': 2,
      'ARRIVED': 2,
      'IN QUEUE': 3,
      'INSPECTED': 4,
      'WEIGHED': 4,
      'BILLED': 4,
      'PROCESSING': 4,
      'COMPLETED': 5,
      'PAID': 5
    };

    const currentIdx = stageMap[rawStatus] !== undefined ? stageMap[rawStatus] : 0;

    const stepsHtml = stages.map((st, idx) => {
      const isCompleted = !isCancelled && idx <= currentIdx;
      const isCurrent = !isCancelled && idx === currentIdx;
      return `
        <div class="tracker-step ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''}">
          <div class="step-circle">${isCompleted ? '✓' : idx + 1}</div>
          <div class="step-content">
            <div class="step-title">${st.label}</div>
            <div class="step-desc">${st.desc}</div>
          </div>
        </div>
      `;
    }).join('');

    const cancelNotice = isCancelled ? `
      <div style="background:#fee2e2; border:1px solid #fca5a5; border-radius:10px; padding:12px 16px; margin-bottom:16px; color:#b91c1c; display:flex; align-items:center; gap:8px;">
        <span style="font-size:1.4rem;">⚠️</span>
        <div>
          <strong>ఈ స్లాట్ రద్దు చేయబడింది (Slot Cancelled)</strong>
          <p style="margin:2px 0 0; font-size:0.82rem;">Your procurement slot has been cancelled by the mandi administration.</p>
        </div>
      </div>
    ` : '';

    resultBox.innerHTML = `
      <div class="tracker-card">
        ${cancelNotice}
        <div class="tracker-card-header">
          <div>
            <span class="token-title">${b.token}</span>
            <div class="farmer-meta">${b.farmerName} • 📱 ${b.mobile}</div>
          </div>
          <div class="amount-pill">
            <span>Status:</span>
            <strong style="color:${isCancelled ? '#ef4444' : '#059669'};">${rawStatus}</strong>
          </div>
        </div>

        <div class="tracker-stepper">
          ${stepsHtml}
        </div>

        <div class="dbt-status-box ${rawStatus === 'COMPLETED' || rawStatus === 'PAID' ? 'paid-success' : ''}">
          <div class="dbt-icon">🏛️</div>
          <div class="dbt-details">
            <span class="dbt-heading">DBT Bank Transfer Status:</span>
            <span class="dbt-msg">${b.dbtStatus || (rawStatus === 'COMPLETED' ? 'Direct DBT payment credited to registered bank account' : 'Awaiting procurement completion')}</span>
            <span class="dbt-account">Target Bank: ${b.dbtBank || 'State Bank of India'} (A/c **${b.dbtAccountLast4 || (b.mobile ? b.mobile.slice(-4) : '9102')})</span>
          </div>
        </div>

        ${(!isCancelled && rawStatus !== 'COMPLETED' && rawStatus !== 'PAID') ? `
        <div style="margin-top:16px; padding-top:14px; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <span style="font-size:0.82rem; color:#64748b;">మీరు ఈ సమయానికి హాజరుకాలేకపోతే స్లాట్ రద్దు చేసుకోవచ్చు:</span>
          <button type="button" class="btn btn-pass-cancel btn-tracker-cancel-booking" data-token="${b.token}">
            ❌ ${t('btnCancelBooking')}
          </button>
        </div>` : ''}
      </div>
    `;

    resultBox.querySelectorAll(".btn-tracker-cancel-booking").forEach(btn => {
      btn.onclick = () => {
        const tok = btn.getAttribute("data-token");
        this.handleCancelBooking(tok);
      };
    });
  }



  async renderFarmerLiveQueueCard() {
    const card = document.getElementById('farmerLiveQueueCard');
    if (!card) return;

    const activeToken = QueueManager.activeFarmerToken;
    const activeBooking = activeToken ? QueueManager.findBooking(activeToken) : null;
    const marketId = activeBooking ? activeBooking.marketId : 'eluru_amc';
    const slotDate = activeBooking ? activeBooking.slotDate : null;

    const data = await QueueManager.fetchLiveQueueStatus(marketId, slotDate, activeToken);
    if (!data) return;

    const f = data.farmer || {};
    const village = f.village || (activeBooking && activeBooking.village) || 'Denduluru';
    const centre = f.procurementCentre || (activeBooking && activeBooking.marketName) || 'Denduluru Procurement Centre';
    const yourToken = f.yourToken || (activeBooking ? (activeBooking.tokenNumber || 42) : 42);
    const fullToken = f.fullToken || activeToken || 'AP-ELU-2026-0042';
    const currentlyServing = data.currentlyServingNumber || 35;
    const farmersAhead = f.farmersAhead !== undefined ? f.farmersAhead : Math.max(0, yourToken - currentlyServing);
    const waitTime = f.estimatedWaitingTime || `${Math.max(10, farmersAhead * 10)} min`;
    const expectedTurn = (activeBooking && activeBooking.expectedTime) ? activeBooking.expectedTime : (f.expectedTurn || '12:40 PM');
    const recommendedArrival = (activeBooking && activeBooking.expectedTime) ? activeBooking.expectedTime : (f.recommendedArrival || '12:25 PM');
    const activeCounters = data.activeCounters || 1;
    const congestion = data.congestionLevel || 'Medium Congestion';
    const centreStatus = data.centreStatus || 'OPEN';

    // Populate DOM elements
    const elVillage = document.getElementById('flqFarmerVillage');
    const elCentre = document.getElementById('flqProcurementCentre');
    const elShift = document.getElementById('flqAssignedShift');
    const elYourTok = document.getElementById('flqYourToken');
    const elFullTok = document.getElementById('flqTokenFullId');
    const elServing = document.getElementById('flqCurrentlyServing');
    const elAhead = document.getElementById('flqFarmersAhead');
    const elWait = document.getElementById('flqEstimatedWaitTime');
    const elTurn = document.getElementById('flqExpectedTurn');
    const elArrival = document.getElementById('flqRecommendedArrival');
    const elCounters = document.getElementById('flqActiveCounters');
    const elCongestion = document.getElementById('flqCongestionBadge');
    const elStatus = document.getElementById('flqStatusBadge');
    const elCentreBadge = document.getElementById('flqCentreStatusBadge');

    if (elVillage) elVillage.innerText = village;
    if (elCentre) elCentre.innerText = centre;
    if (elShift) elShift.innerText = (activeBooking && (activeBooking.assignedShift || activeBooking.assignedSlot || activeBooking.slotTime)) || f.assignedShift || 'Shift 1 (06:30 AM - 08:00 AM)';
    if (elYourTok) elYourTok.innerText = yourToken;
    if (elFullTok) elFullTok.innerText = fullToken;
    if (elServing) elServing.innerText = currentlyServing;
    if (elAhead) elAhead.innerText = farmersAhead;
    if (elWait) elWait.innerText = waitTime;
    if (elTurn) elTurn.innerText = expectedTurn;
    if (elArrival) elArrival.innerText = recommendedArrival;
    if (elCounters) elCounters.innerText = `${activeCounters} Counter${activeCounters > 1 ? 's' : ''} Active`;

    if (elCongestion) {
      elCongestion.innerText = congestion;
      if (data.congestionKey === 'low') elCongestion.className = 'badge badge-green';
      else if (data.congestionKey === 'high') elCongestion.className = 'badge badge-outline text-red';
      else elCongestion.className = 'badge badge-amber';
    }

    if (elCentreBadge) {
      if (centreStatus === 'PAUSED') {
        elCentreBadge.className = 'flq-centre-pill paused';
        elCentreBadge.innerText = '🔴 CENTRE: PAUSED';
      } else {
        elCentreBadge.className = 'flq-centre-pill';
        elCentreBadge.innerText = '🟢 CENTRE: OPEN';
      }
    }

    if (elStatus) {
      elStatus.innerText = f.queueStatusLabel || (farmersAhead <= 2 ? '🟢 Your turn is approaching' : '🟡 Waiting in queue');
    }

    // Connect cancel booking trigger
    const btnCancel = document.getElementById('btnCancelMyBooking');
    if (btnCancel && fullToken) {
      btnCancel.onclick = () => {
        this.handleCancelBooking(fullToken);
      };
    }
  }

  async renderAdminLiveQueueConsole() {
    const consoleCard = document.querySelector('.admin-queue-console-card');
    if (!consoleCard) return;

    const data = await QueueManager.fetchLiveQueueStatus('eluru_amc');
    if (!data) return;

    const nowServingEl = document.getElementById('adminNowServingToken');
    const countersSelect = document.getElementById('adminActiveCountersInput');
    const speedInput = document.getElementById('adminAvgProcessingMins');
    const indicatorEl = document.getElementById('adminCurrentCongestionIndicator');
    const btnPause = document.getElementById('btnAdminPauseQueue');
    const btnResume = document.getElementById('btnAdminResumeQueue');

    if (nowServingEl) {
      nowServingEl.innerText = `Token ${data.currentlyServingNumber || 35}`;
    }
    if (countersSelect && !countersSelect.dataset.userEdited) {
      countersSelect.value = String(data.activeCounters || 1);
    }
    if (speedInput && !speedInput.dataset.userEdited) {
      speedInput.value = String(data.avgProcessingMins || 10);
    }
    if (indicatorEl) {
      indicatorEl.innerText = `Current: ${data.congestionLevel} (${data.totalFarmersWaiting} waiting in line)`;
    }

    if (btnPause && btnResume) {
      if (data.centreStatus === 'PAUSED') {
        btnPause.style.display = 'none';
        btnResume.style.display = 'inline-block';
      } else {
        btnPause.style.display = 'inline-block';
        btnResume.style.display = 'none';
      }
    }

    // Wire action buttons once
    const btnNext = document.getElementById('btnAdminNextToken');
    if (btnNext && !btnNext.dataset.bound) {
      btnNext.dataset.bound = 'true';
      btnNext.addEventListener('click', async () => {
        this.showToast('Advancing queue to next farmer...', 'notify');
        const res = await QueueManager.advanceQueue('eluru_amc');
        if (res) {
          this.showToast(`Queue advanced! Token ${res.servingNumber} is now calling.`, 'success');
          this.renderAdminLiveQueueConsole();
          this.renderAdminBookings();
        }
      });
    }

    const btnProcess = document.getElementById('btnAdminMarkProcessing');
    if (btnProcess && !btnProcess.dataset.bound) {
      btnProcess.dataset.bound = 'true';
      btnProcess.addEventListener('click', async () => {
        const curTok = data.currentlyServingToken;
        if (curTok) {
          await QueueManager.updateBookingStatus(curTok, 'PROCESSING');
          this.showToast(`Token ${curTok} marked as Processing (Weighbridge active).`, 'success');
          this.renderAdminLiveQueueConsole();
          this.renderAdminBookings();
        }
      });
    }

    if (btnPause && !btnPause.dataset.bound) {
      btnPause.dataset.bound = 'true';
      btnPause.addEventListener('click', async () => {
        await QueueManager.pauseQueue('eluru_amc', 'pause');
        this.showToast('Procurement operations temporarily paused.', 'notify');
        this.renderAdminLiveQueueConsole();
      });
    }

    if (btnResume && !btnResume.dataset.bound) {
      btnResume.dataset.bound = 'true';
      btnResume.addEventListener('click', async () => {
        await QueueManager.pauseQueue('eluru_amc', 'resume');
        this.showToast('Procurement operations resumed.', 'success');
        this.renderAdminLiveQueueConsole();
      });
    }

    const btnSaveConfig = document.getElementById('btnAdminSaveQueueConfig');
    if (btnSaveConfig && !btnSaveConfig.dataset.bound) {
      btnSaveConfig.dataset.bound = 'true';
      btnSaveConfig.addEventListener('click', async () => {
        const activeCounters = Number(document.getElementById('adminActiveCountersInput')?.value) || 1;
        const avgProcessingMins = Number(document.getElementById('adminAvgProcessingMins')?.value) || 10;
        await QueueManager.updateQueueConfig({
          market_id: 'eluru_amc',
          active_counters: activeCounters,
          avg_processing_mins: avgProcessingMins
        });
        this.showToast(`Queue config updated! Active counters: ${activeCounters}, Speed: ${avgProcessingMins}m/truck.`, 'success');
        this.renderAdminLiveQueueConsole();
        this.renderFarmerLiveQueueCard();
      });
    }
  }

  setupAdminDashboard() {
    const refreshBtn = document.getElementById('btnAdminRefreshBookings');
    const reloadSlotsBtn = document.getElementById('btnAdminReloadSlots');
    const dateFilter = document.getElementById('adminSlotDateFilter');

    if (dateFilter) {
      const today = new Date().toISOString().split('T')[0];
      dateFilter.value = today;
      dateFilter.addEventListener('change', () => {
        this.renderAdminSlotCapacities();
        this.renderAdminWaitingQueue();
      });
    }

    if (reloadSlotsBtn) {
      reloadSlotsBtn.addEventListener('click', () => {
        this.renderAdminSlotCapacities();
        this.renderAdminWaitingQueue();
        this.showToast('Slot capacities and waiting queue refreshed.', 'success');
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this.renderAdminBookings();
        this.renderAdminSlotCapacities();
        this.renderAdminWaitingQueue();
        this.fetchAdminSmsStatus();
        this.showToast('Admin data refreshed from live database');
      });
    }

    const filterSel = document.getElementById('adminStatusFilter');
    if (filterSel) {
      filterSel.addEventListener('change', () => {
        this.renderAdminBookings();
      });
    }

    // Initial load
    this.fetchAdminSmsStatus();
    this.renderAdminBookings();
    this.renderAdminLiveQueueConsole();
    this.renderAdminSlotCapacities();
    this.renderAdminWaitingQueue();

    // Re-render when switching to Admin tab
    const adminNavBtn = document.getElementById('navBtnAdmin');
    if (adminNavBtn) {
      adminNavBtn.addEventListener('click', () => {
        this.renderAdminBookings();
        this.renderAdminLiveQueueConsole();
        this.renderAdminSlotCapacities();
        this.renderAdminWaitingQueue();
        this.fetchAdminSmsStatus();
      });
    }
  }

  async renderAdminSlotCapacities() {
    const tbody = document.getElementById('adminSlotCapacityTableBody');
    if (!tbody) return;

    const sDate = document.getElementById('adminSlotDateFilter')?.value || new Date().toISOString().split('T')[0];
    const data = await QueueManager.fetchSlotAvailability('eluru_amc', sDate);

    if (!data || !Array.isArray(data.slots)) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:16px; color:#64748b;">Could not load slot capacities.</td></tr>';
      return;
    }

    tbody.innerHTML = data.slots.map(slot => {
      const isFull = slot.status === 'FULL';
      const statusColor = isFull ? '#ef4444' : (slot.status === 'LIMITED' ? '#d97706' : '#059669');
      const safeTimeId = slot.slotTime.replace(/[^a-zA-Z0-9]/g, '_');

      return `
        <tr>
          <td style="font-weight:700; color:#0f172a;">
            ${slot.slotTime}
          </td>
          <td>
            <input type="number" id="capInput_${safeTimeId}" class="form-control" value="${slot.maxCapacity}" min="1" max="100" style="width:75px; font-size:0.85rem; padding:4px 8px;" />
          </td>
          <td>
            <strong style="color:#1e293b;">${slot.bookedCount}</strong> farmers
          </td>
          <td>
            <strong style="color:${statusColor}">${slot.availableCount}</strong> left
          </td>
          <td>
            <span class="slot-badge-status ${(slot.status || 'available').toLowerCase()}">${slot.status}</span>
          </td>
          <td>
            <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-size:0.82rem;">
              <input type="checkbox" id="enabledCheck_${safeTimeId}" ${slot.isEnabled ? 'checked' : ''} />
              <span>${slot.isEnabled ? 'Enabled' : 'Disabled'}</span>
            </label>
          </td>
          <td style="text-align:right;">
            <button type="button" class="btn btn-sm btn-primary" onclick="app.adminSaveSlotCapacity('eluru_amc', '${sDate}', '${slot.slotTime}', 'capInput_${safeTimeId}', 'enabledCheck_${safeTimeId}')">
              💾 Save
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  async adminSaveSlotCapacity(marketId, slotDate, slotTime, capInputId, checkId) {
    const maxCap = Number(document.getElementById(capInputId)?.value) || 10;
    const isEnabled = document.getElementById(checkId)?.checked ?? true;

    this.showToast(`Updating capacity for ${slotTime}...`, 'notify');
    const res = await QueueManager.updateSlotCapacity(marketId, slotDate, slotTime, maxCap, isEnabled);
    if (res && res.status === 'SUCCESS') {
      this.showToast(`✓ Capacity updated: ${maxCap} farmers for ${slotTime}.`, 'success');
      this.renderAdminSlotCapacities();
      this.renderSlotAvailabilityCards(marketId, slotDate);
    } else {
      this.showToast(`Failed to update capacity: ${res?.message || 'Error'}`, 'notify');
    }
  }

  async renderAdminWaitingQueue() {
    const tbody = document.getElementById('adminWaitingQueueTableBody');
    const badge = document.getElementById('adminWaitingCountBadge');
    if (!tbody) return;

    const sDate = document.getElementById('adminSlotDateFilter')?.value || new Date().toISOString().split('T')[0];
    const queue = await QueueManager.fetchWaitingQueue('eluru_amc', sDate);

    if (badge) badge.innerText = `${queue.length} Waiting Farmers`;

    if (!queue || queue.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:16px; color:#92400e;">No farmers in waiting queue for selected date.</td></tr>';
      return;
    }

    tbody.innerHTML = queue.map((f, idx) => {
      return `
        <tr>
          <td style="font-weight:700; color:#b45309; padding:8px 10px;">#${idx + 1}</td>
          <td style="font-weight:700; padding:8px 10px;">${f.token}</td>
          <td style="padding:8px 10px;">${f.farmerName}</td>
          <td style="padding:8px 10px;">📱 ${f.mobile}</td>
          <td style="padding:8px 10px;">${f.village || f.mandal || 'Denduluru'}</td>
          <td style="padding:8px 10px; color:#64748b;">${f.preferredSlot || f.slotTime}</td>
          <td style="padding:8px 10px;">
            <span class="badge badge-amber" style="font-size:0.75rem;">WAITING</span>
          </td>
        </tr>
      `;
    }).join('');
  }

  async fetchAdminSmsStatus() {
    const apiBase = QueueManager.getApiBase();
    try {
      const res = await fetch(`${apiBase}/api/sms/service-status`);
      if (res.ok) {
        const data = await res.json();
        const badge = document.getElementById('adminSmsStatusBadge');
        const name = document.getElementById('adminSmsGatewayName');
        const desc = document.getElementById('adminSmsGatewayDesc');
        const card = document.getElementById('adminSmsGatewayCard');

        if (badge) {
          if (data.configured) {
            badge.className = 'sms-badge sent';
            badge.innerText = `ACTIVE (${data.provider || 'FAST2SMS'})`;
            if (card) card.className = 'admin-sys-card gateway-card active';
          } else {
            badge.className = 'sms-badge not-configured';
            badge.innerText = 'NOT CONFIGURED';
            if (card) card.className = 'admin-sys-card gateway-card';
          }
        }
        if (name) {
          name.innerText = data.configured ? `${data.provider} SMS Gateway Connected` : 'SMS Service Not Configured';
        }
        if (desc) {
          desc.innerText = data.instructions || 'In-App notifications are fully functional. To dispatch real SMS, add FAST2SMS_API_KEY in backend/.env.';
        }
      }
    } catch (e) {
      console.warn('[Admin] Failed to fetch SMS service status:', e);
    }
  }

  async renderAdminBookings() {
    const tbody = document.getElementById('adminBookingsTableBody');
    if (!tbody) return;

    const bookings = await QueueManager.fetchAllBookings();
    const filter = document.getElementById('adminStatusFilter')?.value || 'ALL';

    const countEl = document.getElementById('adminTotalBookingsCount');
    const confirmedCountEl = document.getElementById('adminConfirmedCount');

    if (countEl) countEl.innerText = `${bookings.length} Bookings`;
    if (confirmedCountEl) {
      const confCount = bookings.filter(b => (b.status || '').toUpperCase() === 'CONFIRMED').length;
      const qCount = bookings.filter(b => (b.status || '').toUpperCase() === 'IN QUEUE').length;
      confirmedCountEl.innerText = `${confCount} Confirmed • ${qCount} In Queue`;
    }

    const filtered = bookings.filter(b => {
      if (filter === 'ALL') return true;
      return (b.status || '').toUpperCase() === filter.toUpperCase();
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:#64748b;">No bookings found matching filter "${filter}".</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(b => {
      const st = (b.status || 'booked').toUpperCase();
      let statusPill = `<span class="status-pill pill-blue">${st}</span>`;
      if (st === 'CONFIRMED') statusPill = `<span class="status-pill pill-green">CONFIRMED</span>`;
      else if (st === 'CHECK-IN' || st === 'ARRIVED') statusPill = `<span class="status-pill pill-amber">CHECK-IN</span>`;
      else if (st === 'IN QUEUE') statusPill = `<span class="status-pill pill-purple">IN QUEUE (Pos: ${b.queuePosition || 1})</span>`;
      else if (st === 'PROCESSING') statusPill = `<span class="status-pill pill-indigo">PROCESSING</span>`;
      else if (st === 'COMPLETED' || st === 'PAID') statusPill = `<span class="status-pill pill-teal">COMPLETED</span>`;
      else if (st === 'CANCELLED') statusPill = `<span class="status-pill" style="background:#fee2e2; color:#dc2626;">CANCELLED</span>`;

      return `
        <tr>
          <td>
            <strong>${b.token}</strong>
            <div style="font-size:0.72rem; color:#64748b;">${b.kisanId || 'KS-Farmer'}</div>
          </td>
          <td>
            <div style="font-weight:700;">${b.farmerName}</div>
            <div style="font-size:0.75rem; color:#64748b;">📱 ${b.mobile}</div>
          </td>
          <td>
            <div>${b.cropName || b.cropId}</div>
            <div style="font-size:0.75rem; color:#059669; font-weight:700;">${b.quantityQtl} Qtl</div>
          </td>
          <td>
            <div>${b.marketName || 'Mandi Centre'}</div>
            <div style="font-size:0.75rem; color:#64748b;">📅 ${b.slotDate} • <strong>${b.assignedShift || b.assignedSlot || b.slotTime}</strong></div>
            <div style="font-size:0.75rem; color:#047857; font-weight:700;">⏰ Expected: ${b.expectedTime || b.slotTime}</div>
            ${(b.scheduleStatus === 'DELAYED' || b.scheduleStatus === 'RESCHEDULED') ? `<div style="font-size:0.72rem; color:#dc2626; font-weight:700;">⚠️ ${b.scheduleStatus}: ${b.scheduleNote || 'Time revised'}</div>` : ''}
          </td>
          <td>
            ${statusPill}
          </td>
          <td>
            <div class="admin-action-btn-group">
              <button class="btn-adm confirm" onclick="app.adminChangeStatus('${b.token}', 'CONFIRMED')" title="Confirm farmer slot and trigger automatic notification & SMS">✅ Confirm</button>
              <button class="btn-adm delay" style="background:#fef3c7; color:#92400e; border:1px solid #fcd34d;" onclick="app.adminRescheduleBooking('${b.token}', '${b.expectedTime || '08:00 AM'}', '${b.assignedSlot || b.slotTime}')" title="Delay or adjust shift/time and automatically notify the farmer">⏱️ Delay / Reschedule</button>
              <button class="btn-adm checkin" onclick="app.adminChangeStatus('${b.token}', 'CHECK-IN')" title="Record gate entry check-in">🚪 Check-In</button>
              <button class="btn-adm queue" onclick="app.adminChangeStatus('${b.token}', 'IN QUEUE')" title="Place token into active yard queue">🚦 In Queue</button>
              <button class="btn-adm process" onclick="app.adminChangeStatus('${b.token}', 'PROCESSING')" title="Start weighbridge weighing and inspection">⚖️ Process</button>
              <button class="btn-adm complete" onclick="app.adminChangeStatus('${b.token}', 'COMPLETED')" title="Mark procurement complete & trigger DBT transfer">🎉 Complete</button>
              <button class="btn-adm cancel" onclick="app.adminChangeStatus('${b.token}', 'CANCELLED')" title="Cancel slot booking">❌ Cancel</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  async adminChangeStatus(token, targetStatus) {
    try {
      this.showToast(`Updating ${token} to ${targetStatus}...`, 'notify');
      const res = await QueueManager.updateBookingStatus(token, targetStatus);
      this.showToast(`✓ ${token} updated to ${targetStatus}! Automatic notification dispatched.`, 'success');
      this.renderAdminBookings();
    } catch (err) {
      this.showToast(`Error updating status: ${err.message}`, 'notify');
    }
  }

  async adminRescheduleBooking(token, currentExpectedTime, currentSlot) {
    const delayChoice = prompt(
      `Adjust Procurement Schedule for Token: ${token}\nCurrent Expected Time: ${currentExpectedTime}\n\nEnter delay in minutes (+15, +30, +45, +60) OR enter a revised time (e.g. 09:30 AM):`,
      "15"
    );
    if (!delayChoice) return;

    let delayMinutes = null;
    let newExpectedTime = null;

    if (/^\+?\d+$/.test(delayChoice.trim())) {
      delayMinutes = parseInt(delayChoice.trim().replace('+', ''), 10);
    } else {
      newExpectedTime = delayChoice.trim();
    }

    const reason = prompt("Enter reason for change / delay (Farmer will receive this notification):", "Procurement yard congestion / weighbridge calibration") || "Operational schedule adjustment";

    try {
      this.showToast(`Updating schedule for ${token}...`, 'notify');
      const res = await QueueManager.rescheduleBooking(token, {
        delayMinutes: delayMinutes,
        newExpectedTime: newExpectedTime,
        reason: reason,
        changeType: delayMinutes ? "delayed" : "rescheduled"
      });
      this.showToast(`✓ ${token} schedule updated! Farmer notified: Revised time is ${res.booking.expectedTime}.`, 'success');
      this.renderAdminBookings();
      this.renderLiveQueueBoard();
      this.renderFarmerLiveQueueCard();
    } catch (err) {
      this.showToast(`Failed to reschedule: ${err.message}`, 'notify');
    }
  }

  setupVoiceUI() {
    // Voice Assistant DOM events are cleanly attached by VoiceAssistant.attachDomListeners()
    // in js/voice.js with duplicate protection (data-bound flags) to prevent multi-triggering.
  }
}

window.app = new RythuSevaApp();
document.addEventListener('DOMContentLoaded', () => {
  window.app.init();
});
