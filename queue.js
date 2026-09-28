// RythuSeva Queue Management, Slot Booking & 6-Stage Procurement Tracker
// Resilient Hybrid Architecture: Live FastAPI Backend Sync + Offline LocalStorage Fallback (Zero-Crash)

import { INITIAL_BOOKINGS, STATES_DISTRICTS_DATA, CROP_DATA } from './data.js';
import { currentLanguage, t } from './i18n.js';

export const QueueManager = {
  bookings: [],
  notifications: [],
  unreadNotificationCount: 0,
  listeners: {},
  _lastNotifToken: null,
  activeFarmerToken: null,
  activeFarmerId: null,
  playChime: null,
  ws: null,
  wsReconnectTimer: null,
  currentlyServingToken: 'AP-GNT-2026-0839',
  servingNumber: 839,
  isBackendConnected: false,

  subscribe(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
    return () => {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    };
  },

  notifyListeners(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => {
        try { cb(data); } catch (e) { console.warn('[QueueManager] Listener error:', e); }
      });
    }
  },

  initWebSocket(farmerId) {
    if (typeof window === 'undefined' || !window.WebSocket) return;
    const cid = (farmerId || this.activeFarmerId || this.activeFarmerToken || 'guest').trim();
    this.activeFarmerId = cid;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws/farmer/${encodeURIComponent(cid)}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[QueueManager] Real-time WebSocket connected for farmer:', cid);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[QueueManager] Real-time WS message received:', data);
          this.handleRealtimeEvent(data);
        } catch (err) {
          console.warn('[QueueManager] Failed parsing WS message:', err);
        }
      };

      this.ws.onerror = (e) => {
        console.warn('[QueueManager] WS error:', e);
      };

      this.ws.onclose = () => {
        console.info('[QueueManager] WS closed. Retrying in 5 seconds...');
        clearTimeout(this.wsReconnectTimer);
        this.wsReconnectTimer = setTimeout(() => {
          this.initWebSocket(this.activeFarmerId);
        }, 5000);
      };
    } catch (e) {
      console.warn('[QueueManager] WebSocket initialization failed:', e);
    }
  },

  handleRealtimeEvent(data) {
    if (!data) return;

    if (data.booking && data.booking.token) {
      const cleanToken = data.booking.token.toUpperCase();
      const idx = this.bookings.findIndex(b => b.token && b.token.toUpperCase() === cleanToken);
      if (idx >= 0) {
        this.bookings[idx] = { ...this.bookings[idx], ...data.booking };
      } else {
        this.bookings.unshift(data.booking);
      }
      this.saveBookings();
    }

    if (data.notification) {
      const nId = data.notification.notification_id || data.notification.id;
      const alreadyExists = this.notifications.some(n => (n.notification_id && n.notification_id === nId) || (n.id && n.id === nId));
      if (!alreadyExists) {
        this.notifications.unshift(data.notification);
        this.unreadNotificationCount = (this.unreadNotificationCount || 0) + 1;
        this.saveNotifications();
      }
    }

    if (typeof this.playChime === 'function') {
      this.playChime('ping');
    }

    this.notifyListeners('onNotification', {
      unreadCount: this.unreadNotificationCount,
      notification: data.notification,
      notifications: this.notifications,
      booking: data.booking,
      status: data.status || (data.booking ? data.booking.status : null)
    });

    this.notifyListeners('onStatusUpdate', {
      booking: data.booking,
      status: data.status || (data.booking ? data.booking.status : null),
      token: data.token || (data.booking ? data.booking.token : null)
    });

    if (data.type === 'QUEUE_MOVEMENT' || data.type === 'QUEUE_STATUS_CHANGE' || data.type === 'QUEUE_CONFIG_UPDATED') {
      this.notifyListeners('onQueueMovement', data);
    }

    if (data.type === 'SLOT_AVAILABILITY_CHANGED') {
      this.notifyListeners('onSlotAvailabilityChanged', data);
    }
  },

  getApiBase() {
    if (typeof window !== 'undefined' && window.FARMDIRECT_API_BASE) {
      return window.FARMDIRECT_API_BASE.replace(/\/+$/, '');
    }
    return '';
  },

  async init() {
    // 1. Instant hydration from local storage
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('rythu_bookings') : null;
    if (saved) {
      try {
        this.bookings = JSON.parse(saved);
      } catch (e) {
        this.bookings = [...INITIAL_BOOKINGS];
      }
    } else {
      this.bookings = [...INITIAL_BOOKINGS];
      this.saveBookings();
    }

    const savedNotifs = typeof localStorage !== 'undefined' ? localStorage.getItem('rythu_notifications') : null;
    if (savedNotifs) {
      try {
        this.notifications = JSON.parse(savedNotifs);
        this.unreadNotificationCount = this.notifications.filter(n => !n.isRead).length;
      } catch (e) {
        this.notifications = [];
      }
    }

    // 2. Asynchronous background synchronization with FastAPI backend
    await this.syncWithBackend();
    await this.fetchNotifications();
  },

  saveBookings() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('rythu_bookings', JSON.stringify(this.bookings));
      }
    } catch (e) {
      console.warn('[QueueManager] LocalStorage write failed:', e);
    }
  },

  saveNotifications() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('rythu_notifications', JSON.stringify(this.notifications));
      }
    } catch (e) {
      console.warn('[QueueManager] LocalStorage notifications write failed:', e);
    }
  },

  async syncWithBackend() {
    const apiBase = this.getApiBase();
    try {
      // Fetch live bookings
      const bRes = await fetch(`${apiBase}/api/bookings?limit=50`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });
      if (bRes.ok) {
        const serverBookings = await bRes.json();
        if (Array.isArray(serverBookings) && serverBookings.length > 0) {
          // Merge server bookings with local bookings (server takes precedence for matching tokens)
          const mergedMap = new Map();
          this.bookings.forEach(b => mergedMap.set(b.token, b));
          serverBookings.forEach(sb => mergedMap.set(sb.token, sb));
          this.bookings = Array.from(mergedMap.values());
          this.saveBookings();
        }
        this.isBackendConnected = true;
      }

      // Fetch live queue status
      const qRes = await fetch(`${apiBase}/api/queue/status`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });
      if (qRes.ok) {
        const qData = await qRes.json();
        if (qData.currentlyServingToken) {
          this.currentlyServingToken = qData.currentlyServingToken;
          this.servingNumber = qData.servingNumber || this.servingNumber;
        }
        this.isBackendConnected = true;
      }
    } catch (e) {
      // Offline fallback: continue flawlessly with local state
      console.info('[QueueManager] Running in offline / local cache mode:', e.message || e);
    }
  },

  /**
   * Generates a deterministic SVG QR code representation
   */
  generateQrSvg(text) {
    const hash = Array.from(text || 'TOKEN').reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) | 0, 0);
    const size = 140;
    const cells = 15;
    const cellSize = size / cells;
    let rects = '';

    // Corner Finder Patterns
    const drawCorner = (startX, startY) => {
      let str = '';
      str += `<rect x="${startX * cellSize}" y="${startY * cellSize}" width="${7 * cellSize}" height="${7 * cellSize}" fill="#059669" rx="3"/>`;
      str += `<rect x="${(startX + 1) * cellSize}" y="${(startY + 1) * cellSize}" width="${5 * cellSize}" height="${5 * cellSize}" fill="#ffffff" rx="2"/>`;
      str += `<rect x="${(startX + 2) * cellSize}" y="${(startY + 2) * cellSize}" width="${3 * cellSize}" height="${3 * cellSize}" fill="#059669" rx="1"/>`;
      return str;
    };

    rects += drawCorner(0, 0);
    rects += drawCorner(cells - 7, 0);
    rects += drawCorner(0, cells - 7);

    // Inner data matrix pseudorandom pattern based on token hash
    for (let r = 0; r < cells; r++) {
      for (let c = 0; c < cells; c++) {
        if ((r < 7 && c < 7) || (r < 7 && c >= cells - 7) || (r >= cells - 7 && c < 7)) continue;
        const bit = ((hash ^ (r * 17 + c * 37)) & 3) === 0;
        if (bit) {
          rects += `<rect x="${c * cellSize}" y="${r * cellSize}" width="${cellSize - 0.5}" height="${cellSize - 0.5}" fill="#0f172a" rx="1"/>`;
        }
      }
    }

    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" style="background:#ffffff; border-radius:12px; padding:8px; box-shadow:0 4px 12px rgba(0,0,0,0.08);">${rects}</svg>`;
  },

  /**
   * Fetches real-time capacity and availability status for all slots of a centre.
   */
  async fetchSlotAvailability(marketId = 'eluru_amc', slotDate = null) {
    const apiBase = this.getApiBase();
    const sDate = slotDate || new Date().toISOString().split('T')[0];
    try {
      const resp = await fetch(`${apiBase}/api/slots/availability?market_id=${encodeURIComponent(marketId)}&slot_date=${encodeURIComponent(sDate)}`, {
        signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(4000) : undefined
      });
      if (resp.ok) {
        return await resp.json();
      }
    } catch (e) {
      console.warn('[QueueManager] Slot availability fetch failed:', e);
    }

    // Local in-memory fallback calculation
    const standardShifts = [
      { shift: 'Shift 1', time: '05:00 AM - 08:00 AM', label: 'Shift 1: Early Morning (05:00 AM – 08:00 AM)' },
      { shift: 'Shift 2', time: '08:00 AM - 12:00 PM', label: 'Shift 2: Morning (08:00 AM – 12:00 PM)' },
      { shift: 'Shift 3', time: '12:00 PM - 04:00 PM', label: 'Shift 3: Afternoon (12:00 PM – 04:00 PM)' },
      { shift: 'Shift 4', time: '04:00 PM - 08:00 PM', label: 'Shift 4: Evening (04:00 PM – 08:00 PM)' },
      { shift: 'Shift 5', time: '08:00 PM - 11:00 PM', label: 'Shift 5: Night (08:00 PM – 11:00 PM)' }
    ];

    const activeBookings = (this.bookings || []).filter(b => 
      b.marketId === marketId && 
      b.slotDate === sDate && 
      (b.status || '').toLowerCase() !== 'cancelled' && 
      (b.status || '').toLowerCase() !== 'canceled'
    );

    let totalBooked = 0;
    const slots = standardShifts.map(s => {
      const bookedInShift = activeBookings.filter(b => 
        b.assignedSlot === s.label || 
        b.assignedSlot === s.time || 
        b.assignedSlot === s.shift || 
        b.slotTime === s.time || 
        b.slotTime === s.label
      ).length;
      totalBooked += bookedInShift;
      const available = Math.max(0, 10 - bookedInShift);
      const isFull = available <= 0;
      return {
        shift: s.shift,
        slotTime: s.time,
        label: s.label,
        bookedCount: bookedInShift,
        maxCapacity: 10,
        availableCount: available,
        remainingSlots: available,
        isFull: isFull,
        status: isFull ? 'FULL' : (available <= 3 ? 'FEW_LEFT' : 'AVAILABLE'),
        statusColor: isFull ? 'red' : (available <= 3 ? 'amber' : 'green'),
        statusText: isFull ? '🔴 Full (10/10)' : (available <= 3 ? `🟠 Few slots remaining (${available} left)` : `🟢 Available (${available} slots)`),
        isEnabled: true,
        capacityDisplay: `${bookedInShift}/10`,
        farmers: []
      };
    });

    return {
      marketId,
      slotDate: sDate,
      totalCapacity: 50,
      totalBooked,
      totalAvailable: Math.max(0, 50 - totalBooked),
      allFull: totalBooked >= 50,
      slots
    };
  },

  /**
   * Admin method to configure slot max capacity and toggle availability.
   */
  async updateSlotCapacity(marketId, slotDate, slotTime, maxCapacity, isEnabled = true) {
    const apiBase = this.getApiBase();
    try {
      const resp = await fetch(`${apiBase}/api/admin/slots/capacity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market_id: marketId,
          slot_date: slotDate,
          slot_time: slotTime,
          max_capacity: Number(maxCapacity),
          is_enabled: Boolean(isEnabled)
        })
      });
      return await resp.json();
    } catch (e) {
      console.warn('[QueueManager] Slot capacity update failed:', e);
      return null;
    }
  },

  /**
   * Fetches farmers in Waiting / Overflow queue.
   */
  async fetchWaitingQueue(marketId = 'eluru_amc', slotDate = null) {
    const apiBase = this.getApiBase();
    const sDate = slotDate || new Date().toISOString().split('T')[0];
    try {
      const resp = await fetch(`${apiBase}/api/admin/waiting-queue?market_id=${encodeURIComponent(marketId)}&slot_date=${encodeURIComponent(sDate)}`, {
        signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(4000) : undefined
      });
      if (resp.ok) {
        return await resp.json();
      }
    } catch (e) {
      console.warn('[QueueManager] Waiting queue fetch failed:', e);
    }
    return [];
  },

  async createBooking(formData) {
    const apiBase = this.getApiBase();
    const statePrefix = formData.state === 'andhra_pradesh' ? 'AP' : (formData.state === 'telangana' ? 'TG' : 'IN');
    const distPrefix = formData.district ? formData.district.slice(0, 3).toUpperCase() : 'MND';
    const randNum = Math.floor(1000 + Math.random() * 9000);
    const tempToken = `${statePrefix}-${distPrefix}-2026-${randNum}`;

    const crop = CROP_DATA[formData.cropId] || {};
    const cropName = crop.name ? (crop.name[currentLanguage] || crop.name.en) : formData.cropId;

    let finalBooking = null;

    // 1. Try real-time server booking creation first to get strict capacity & auto-shift allocation
    try {
      const resp = await fetch(`${apiBase}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farmerName: formData.farmerName,
          mobile: formData.mobile,
          kisanId: formData.aadhaar || 'KS-' + randNum,
          state: formData.state,
          district: formData.district,
          mandal: formData.mandal || '',
          village: formData.village || formData.mandal || 'Denduluru',
          marketId: formData.marketId,
          marketName: formData.marketName || 'Government Agricultural Market Yard',
          cropId: formData.cropId,
          cropName,
          quantityQtl: Number(formData.quantityQtl),
          vehicleType: formData.vehicleType,
          vehicleNo: formData.vehicleNo || 'AP 07 TR ' + Math.floor(1000 + Math.random() * 9000),
          slotDate: formData.slotDate,
          slotTime: formData.slotTime,
          lang: currentLanguage || 'te'
        }),
        signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(6000) : undefined
      });

      if (resp.ok) {
        const resData = await resp.json();
        if (resData && resData.booking) {
          finalBooking = resData.booking;
        }
      } else {
        const errData = await resp.json().catch(() => ({}));
        const errMsg = errData.detail || `Booking request failed with status ${resp.status}.`;
        const err = new Error(errMsg);
        err.isServerError = true;
        throw err;
      }
    } catch (err) {
      if (err.isServerError) {
        throw err;
      }
      if (err.message && (err.name === 'TypeError' || err.message.includes('Failed to fetch') || err.message.includes('timeout'))) {
        console.warn('[QueueManager] Server create booking offline fallback:', err);
      } else {
        throw err;
      }
    }

    // 2. Offline fallback if server was unreachable
    if (!finalBooking) {
      const standardShifts = [
        { shift: 'Shift 1', time: '05:00 AM - 08:00 AM', label: 'Shift 1: Early Morning (05:00 AM – 08:00 AM)' },
        { shift: 'Shift 2', time: '08:00 AM - 12:00 PM', label: 'Shift 2: Morning (08:00 AM – 12:00 PM)' },
        { shift: 'Shift 3', time: '12:00 PM - 04:00 PM', label: 'Shift 3: Afternoon (12:00 PM – 04:00 PM)' },
        { shift: 'Shift 4', time: '04:00 PM - 08:00 PM', label: 'Shift 4: Evening (04:00 PM – 08:00 PM)' },
        { shift: 'Shift 5', time: '08:00 PM - 11:00 PM', label: 'Shift 5: Night (08:00 PM – 11:00 PM)' }
      ];

      const activeBookings = (this.bookings || []).filter(b => 
        b.marketId === formData.marketId && 
        b.slotDate === formData.slotDate && 
        (b.status || '').toLowerCase() !== 'cancelled' && 
        (b.status || '').toLowerCase() !== 'canceled'
      );

      const shiftCounts = standardShifts.map(s => {
        const count = activeBookings.filter(b => 
          b.assignedSlot === s.label || 
          b.assignedSlot === s.time || 
          b.assignedSlot === s.shift || 
          b.slotTime === s.time || 
          b.slotTime === s.label
        ).length;
        return { ...s, count, available: Math.max(0, 10 - count) };
      });

      // Find preferred shift
      let prefIdx = shiftCounts.findIndex(s => s.time === formData.slotTime || s.label === formData.slotTime);
      if (prefIdx === -1) prefIdx = 0;

      let assignedShift = null;
      let isShifted = false;
      let shiftReason = '';

      if (shiftCounts[prefIdx].available > 0) {
        assignedShift = shiftCounts[prefIdx];
      } else {
        // Automatically move 11th farmer to next available later shift (FORWARD ONLY)
        const forwardShifts = shiftCounts.slice(prefIdx + 1);
        assignedShift = forwardShifts.find(s => s.available > 0);
        if (!assignedShift) {
          throw new Error('This shift is full and all later shifts for this date are also full. Please select another date.');
        }
        isShifted = true;
        shiftReason = `Selected ${shiftCounts[prefIdx].shift} is full. You have been automatically assigned to ${assignedShift.shift}.`;
      }

      const slotPosition = assignedShift.count + 1;
      const expectedTime = assignedShift.time.split('-')[0].trim();

      finalBooking = {
        token: tempToken,
        farmerName: formData.farmerName,
        mobile: formData.mobile,
        kisanId: formData.aadhaar || 'KS-' + randNum,
        state: formData.state,
        district: formData.district,
        mandal: formData.mandal || '',
        village: formData.village || formData.mandal || 'Denduluru',
        marketId: formData.marketId,
        marketName: formData.marketName || 'Government Agricultural Market Yard',
        cropId: formData.cropId,
        cropName,
        quantityQtl: Number(formData.quantityQtl),
        vehicleType: formData.vehicleType,
        vehicleNo: formData.vehicleNo || 'AP 07 TR ' + Math.floor(1000 + Math.random() * 9000),
        slotDate: formData.slotDate,
        slotTime: assignedShift.time,
        preferredSlot: shiftCounts[prefIdx].label,
        assignedSlot: assignedShift.label,
        assignedShift: assignedShift.shift,
        preferredShift: shiftCounts[prefIdx].shift,
        slotPosition: slotPosition,
        isShifted: isShifted,
        shiftReason: shiftReason,
        expectedTime: expectedTime,
        tokenNumber: randNum,
        gateNo: 'Gate ' + (1 + Math.floor(Math.random() * 3)) + ' (Weighbridge Bay A)',
        status: 'booked',
        queuePosition: slotPosition,
        estWaitMins: Math.max(5, (slotPosition - 1) * 6),
        moisturePercent: null,
        qualityGrade: null,
        grossWeightQtl: null,
        tareWeightQtl: null,
        netWeightQtl: null,
        ratePerQtl: crop.avgMarketPrice || 2400,
        totalAmount: (crop.avgMarketPrice || 2400) * Number(formData.quantityQtl),
        dbtBank: 'State Bank of India (Direct Farmer Account)',
        dbtAccountLast4: formData.aadhaar ? formData.aadhaar.slice(-4) : '9102',
        dbtStatus: 'Pending Mandi Verification',
        createdAt: new Date().toISOString()
      };

      // Add local in-app notification
      const localNotif = {
        id: Date.now(),
        token: tempToken,
        mobile: formData.mobile,
        title: isShifted ? `🔔 Auto-Shifted — ${assignedShift.shift}` : `🔔 Slot Confirmed — ${assignedShift.shift}`,
        message: isShifted 
          ? `This shift is full. You have been automatically assigned to the next available shift: ${assignedShift.shift} (${assignedShift.time}). Token: #${randNum} (${tempToken}).`
          : `Booking confirmed. Token #${randNum}. You are allocated to ${assignedShift.shift}, ${assignedShift.time} at ${formData.marketName || 'Mandi Yard'}.`,
        type: isShifted ? 'slot_shifted' : 'slot_booked',
        lang: currentLanguage || 'te',
        isRead: false,
        createdAt: new Date().toISOString()
      };
      this.notifications.unshift(localNotif);
      this.unreadNotificationCount = this.notifications.filter(n => !n.isRead).length;
    }

    // Update active farmer context
    this.activeFarmerToken = finalBooking.token;
    this.activeFarmerId = finalBooking.mobile;

    // Save to local cache
    const existingIdx = this.bookings.findIndex(b => b.token && b.token.toUpperCase() === finalBooking.token.toUpperCase());
    if (existingIdx >= 0) {
      this.bookings[existingIdx] = finalBooking;
    } else {
      this.bookings.unshift(finalBooking);
    }
    this.saveBookings();

    // Re-fetch notifications from server to get accurate shift messages
    await this.fetchNotifications();

    this.notifyListeners('onStatusUpdate', {
      token: finalBooking.token,
      status: finalBooking.status,
      booking: finalBooking
    });
    this.notifyListeners('onSlotAvailabilityChanged', {
      marketId: finalBooking.marketId,
      slotDate: finalBooking.slotDate,
      booking: finalBooking
    });

    return finalBooking;
  },

  async createLocalFallbackBooking(formData) {
    return await this.createBooking(formData);
  },

  async fetchNotifications() {
    const apiBase = this.getApiBase();
    const token = this.activeFarmerToken;
    try {
      const url = token ? `${apiBase}/api/notifications?token=${encodeURIComponent(token)}` : `${apiBase}/api/notifications`;
      const resp = await fetch(url, { signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(4000) : undefined });
      if (resp && resp.ok) {
        const serverNotifs = await resp.json();
        if (Array.isArray(serverNotifs)) {
          const tokenChanged = Boolean(this._lastNotifToken && this.activeFarmerToken && this._lastNotifToken !== this.activeFarmerToken);
          const hasUnread = serverNotifs.some(n => !n.isRead);
          const hasSlotBooked = serverNotifs.some(n => n.type === 'slot_booked');

          this.notifications = serverNotifs;
          this.unreadNotificationCount = serverNotifs.filter(n => !n.isRead).length;

          // Audio notification/chime condition: plays when a newly booked slot notification arrives,
          // even if the active token has changed!
          if ((tokenChanged && hasUnread) || hasSlotBooked || (tokenChanged && serverNotifs.length > 0) || hasUnread) {
            if (typeof this.playChime === 'function') {
              this.playChime('ping');
            }
          }

          this._lastNotifToken = this.activeFarmerToken;
          this.saveNotifications();
          this.notifyListeners('onNotification', {
            unreadCount: this.unreadNotificationCount,
            notifications: this.notifications
          });
          return this.notifications;
        }
      }
    } catch (e) {
      if (this._lastNotifToken && this.activeFarmerToken && this._lastNotifToken !== this.activeFarmerToken) {
        const hasUnread = this.notifications.some(n => !n.isRead);
        if (hasUnread && typeof this.playChime === 'function') {
          this.playChime('ping');
        }
        this._lastNotifToken = this.activeFarmerToken;
      }
    }
    return this.notifications;
  },

  async markNotificationRead(notificationId) {
    if (!notificationId) return;
    const n = this.notifications.find(item => (item.notification_id && item.notification_id === notificationId) || (item.id && item.id === notificationId));
    if (n) {
      n.read_status = true;
      n.readStatus = true;
      n.isRead = true;
      this.unreadNotificationCount = Math.max(0, (this.unreadNotificationCount || 1) - 1);
      this.saveNotifications();
      this.notifyListeners('onNotification', {
        unreadCount: this.unreadNotificationCount,
        notifications: this.notifications
      });
    }

    try {
      const apiBase = this.getApiBase();
      await fetch(`${apiBase}/api/notifications/${notificationId}/read`, {
        method: 'PATCH',
        signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(3000) : undefined
      });
    } catch (e) {
      console.warn('[QueueManager] Failed to mark read on server:', e);
    }
  },

  async markAllNotificationsRead() {
    this.notifications.forEach(n => {
      n.read_status = true;
      n.readStatus = true;
      n.isRead = true;
    });
    this.unreadNotificationCount = 0;
    this.saveNotifications();
    this.notifyListeners('onNotification', {
      unreadCount: 0,
      notifications: this.notifications
    });

    try {
      const apiBase = this.getApiBase();
      await fetch(`${apiBase}/api/notifications/mark-all-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ farmer_id: this.activeFarmerId || this.activeFarmerToken }),
        signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(3000) : undefined
      });
    } catch (e) {
      console.warn('[QueueManager] Failed mark all read on server:', e);
    }
  },

  async updateBookingStatus(token, statusPayload) {
    const apiBase = this.getApiBase();
    const cleanToken = token.trim().toUpperCase();
    const resp = await fetch(`${apiBase}/api/bookings/${encodeURIComponent(cleanToken)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(typeof statusPayload === 'string' ? { status: statusPayload } : statusPayload)
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || `Failed to update status (${resp.status})`);
    }
    return await resp.json();
  },

  async fetchAllBookings() {
    const apiBase = this.getApiBase();
    try {
      const resp = await fetch(`${apiBase}/api/bookings?limit=100`, {
        signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(4000) : undefined
      });
      if (resp.ok) {
        const bookings = await resp.json();
        if (Array.isArray(bookings)) {
          this.bookings = bookings;
          this.saveBookings();
          return bookings;
        }
      }
    } catch (e) {
      console.warn('[QueueManager] Could not fetch all bookings from server:', e);
    }
    return this.bookings;
  },

  async sendBookingToBackend(booking) {
    const apiBase = this.getApiBase();
    try {
      const resp = await fetch(`${apiBase}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farmerName: booking.farmerName,
          mobile: booking.mobile,
          kisanId: booking.kisanId,
          state: booking.state,
          district: booking.district,
          mandal: booking.mandal,
          village: booking.village || booking.mandal || 'Denduluru',
          marketId: booking.marketId,
          marketName: booking.marketName,
          cropId: booking.cropId,
          cropName: booking.cropName,
          quantityQtl: booking.quantityQtl,
          vehicleType: booking.vehicleType,
          vehicleNo: booking.vehicleNo,
          slotDate: booking.slotDate,
          slotTime: booking.slotTime,
          token: booking.token,
          gateNo: booking.gateNo
        }),
        signal: AbortSignal.timeout(6000)
      });
      if (resp.ok) {
        const data = await resp.json();
        console.log('[QueueManager] Booking persisted to backend:', data);
        this.isBackendConnected = true;
      }
    } catch (e) {
      console.info('[QueueManager] Backend sync deferred (offline cache):', e.message);
    }
  },


  async fetchLiveQueueStatus(marketId = null, slotDate = null, token = null) {
    const apiBase = this.getApiBase();
    const cleanToken = token || this.activeFarmerToken;
    const params = new URLSearchParams();
    if (marketId) params.append('market_id', marketId);
    if (slotDate) params.append('slot_date', slotDate);
    if (cleanToken) params.append('token', cleanToken);

    try {
      const resp = await fetch(`${apiBase}/api/queue/status?${params.toString()}`, {
        signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(4000) : undefined
      });
      if (resp.ok) {
        const data = await resp.json();
        this.liveQueueData = data;
        return data;
      }
    } catch (e) {
      console.warn('[QueueManager] Failed to fetch live queue status:', e);
    }
    return null;
  },

  async advanceQueue(marketId = null) {
    const apiBase = this.getApiBase();
    try {
      const resp = await fetch(`${apiBase}/api/queue/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ market_id: marketId || 'eluru_amc' })
      });
      return await resp.json();
    } catch (e) {
      console.warn('[QueueManager] Advance queue error:', e);
      return null;
    }
  },

  async pauseQueue(marketId = null, action = 'pause') {
    const apiBase = this.getApiBase();
    try {
      const resp = await fetch(`${apiBase}/api/queue/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ market_id: marketId || 'eluru_amc', action })
      });
      return await resp.json();
    } catch (e) {
      console.warn('[QueueManager] Pause queue error:', e);
      return null;
    }
  },

  async updateQueueConfig(config) {
    const apiBase = this.getApiBase();
    try {
      const resp = await fetch(`${apiBase}/api/queue/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      return await resp.json();
    } catch (e) {
      console.warn('[QueueManager] Update queue config error:', e);
      return null;
    }
  },

  async rescheduleBooking(token, reschedulePayload) {
    const apiBase = this.getApiBase();
    const cleanToken = token.trim().toUpperCase();
    try {
      const resp = await fetch(`${apiBase}/api/bookings/${encodeURIComponent(cleanToken)}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reschedulePayload)
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.detail || `Reschedule failed (${resp.status})`);
      }
      // Update local booking cache if present
      const idx = this.bookings.findIndex(b => b.token && b.token.toUpperCase() === cleanToken);
      if (idx >= 0 && data.booking) {
        this.bookings[idx] = { ...this.bookings[idx], ...data.booking };
        this.saveBookings();
        this.notifyListeners('onStatusUpdate', {
          token: cleanToken,
          status: this.bookings[idx].status,
          booking: this.bookings[idx]
        });
      }
      this.notifyListeners('onSlotAvailabilityChanged', { rescheduledToken: cleanToken });
      return data;
    } catch (e) {
      console.warn('[QueueManager] Reschedule booking error:', e);
      throw e;
    }
  },

  async cancelBooking(token, reason = 'Farmer requested cancellation') {
    const apiBase = this.getApiBase();
    const cleanToken = token.trim().toUpperCase();
    try {
      const resp = await fetch(`${apiBase}/api/bookings/${encodeURIComponent(cleanToken)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });
      const data = await resp.json();
      // Update local booking
      const idx = this.bookings.findIndex(b => b.token && b.token.toUpperCase() === cleanToken);
      if (idx >= 0) {
        this.bookings[idx].status = 'cancelled';
        this.saveBookings();
        this.notifyListeners('onStatusUpdate', {
          token: cleanToken,
          status: 'cancelled',
          booking: this.bookings[idx]
        });
      }
      this.notifyListeners('onSlotAvailabilityChanged', { cancelledToken: cleanToken });
      return data;
    } catch (e) {
      console.warn('[QueueManager] Cancel booking error:', e);
      return null;
    }
  },

  advanceQueue() {
    this.servingNumber += 1;
    this.currentlyServingToken = `AP-GNT-2026-0${this.servingNumber}`;

    // Adjust wait times and queue positions for active bookings
    this.bookings.forEach(b => {
      if (b.status === 'booked') {
        b.status = 'arrived';
        b.queuePosition = Math.max(1, b.queuePosition - 1);
        b.estWaitMins = Math.max(5, b.estWaitMins - 6);
      } else if (b.status === 'arrived') {
        b.queuePosition = Math.max(0, b.queuePosition - 1);
        if (b.queuePosition === 0) {
          b.status = 'inspected';
          b.moisturePercent = (10.5 + Math.random() * 2).toFixed(1);
          b.qualityGrade = 'Grade A (MSP Approved)';
          b.estWaitMins = 0;
        }
      } else if (b.status === 'inspected') {
        b.status = 'weighed';
        b.grossWeightQtl = (b.quantityQtl + 0.3).toFixed(1);
        b.tareWeightQtl = '0.3';
        b.netWeightQtl = b.quantityQtl.toFixed(1);
      } else if (b.status === 'weighed') {
        b.status = 'billed';
        b.dbtStatus = 'Bill Generated • Pushed to DBT Gateway';
      } else if (b.status === 'billed') {
        b.status = 'paid';
        b.dbtStatus = `DBT ₹${b.totalAmount ? b.totalAmount.toLocaleString('en-IN') : '25,000'} Credited to Bank A/c ending ${b.dbtAccountLast4 || '4109'}`;
      }
    });

    this.saveBookings();
    return {
      nowServing: this.currentlyServingToken,
      activeBookings: this.bookings
    };
  },

  findBooking(query) {
    if (!query) return null;
    const cleanQuery = query.trim().toUpperCase();
    return this.bookings.find(b => 
      (b.token && b.token.toUpperCase() === cleanQuery) || 
      (b.mobile && b.mobile.includes(cleanQuery)) ||
      (b.kisanId && b.kisanId.toUpperCase().includes(cleanQuery))
    );
  },

  async findBookingAsync(query) {
    if (!query) return null;
    const cleanQuery = query.trim().toUpperCase();

    // 1. Instant check in memory
    const local = this.findBooking(query);
    if (local) return local;

    // 2. Query backend if not found locally
    const apiBase = this.getApiBase();
    try {
      const resp = await fetch(`${apiBase}/api/bookings/${encodeURIComponent(cleanQuery)}`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(4000)
      });
      if (resp.ok) {
        const serverBooking = await resp.json();
        if (serverBooking && serverBooking.token) {
          this.bookings.unshift(serverBooking);
          this.saveBookings();
          return serverBooking;
        }
      }
    } catch (e) {
      console.warn('[QueueManager] Remote booking lookup failed:', e.message);
    }
    return null;
  }
};
