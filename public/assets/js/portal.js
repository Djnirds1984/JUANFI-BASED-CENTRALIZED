// JuanFi Portal - Core JavaScript
// Self-contained portal with disconnected/connected states

// ---- Configuration ----
var macAsVoucherCode = true;

// ---- CHAP parameters from URL ----
// Persisted to localStorage: when the user re-opens the portal later in a
// full browser (Chrome app) instead of the captive-portal popup, the
// MikroTik redirect params are gone. Restoring them allows Add-Time
// re-login (doLogin) to work without the redirect.
var params = new URLSearchParams(window.location.search);
function storedParam(key, urlVal) {
	if (urlVal) { try { localStorage.setItem('portal_' + key, urlVal); } catch (e) {} return urlVal; }
	try { return localStorage.getItem('portal_' + key) || ''; } catch (e) { return ''; }
}
var mac = params.get('mac') || '';
var ip = params.get('ip') || '';
var chapId = storedParam('chap-id', params.get('chap-id') || '');
var chapChallenge = storedParam('chap-challenge', params.get('chap-challenge') || '');
var linkLoginOnly = storedParam('link-login-only', params.get('link-login-only') || '');
var linkStatus = params.get('link-status') || storedParam('link-status', '') || '/status';
var routerId = params.get('router-id') || storedParam('router-id', '');
// Roaming token bridge (session.js) reads these at call time.
window.controllerRouterId = routerId || '';

// ---- Vendo config ----
var vendoConfig = null;
var vendorIpAddress = '';
// Set while this phone is holding an AirCoins coin session on the panel. An
// empty value means the selected machine is a JuanFi one and is called directly.
var airCoinsSessionId = '';
var voucher = '';
var totalCoinReceived = 0;
var coinTimer = null;
var topupMode = 'INTERNET';

// ---- Session state ----
var isConnected = false;
var isPaused = false;
var remainingSeconds = 0;
var countdownTimer = null;
var sessionSyncTimer = null;
var sessionExpiresAt = null;
var isExtendMode = false;
var tokenBound = false;
var payRates = [];
var payCurrency = 'PHP';

// ---- Coin sounds ----
// Uploaded on the admin Portal > Sounds page. Both come from this same origin,
// which matters: a customer who is still captive has the controller address
// open in the walled garden and nothing else, so the sound arrives exactly like
// the portal page does. An empty slot falls back to the shipped file.
var coinSounds = { insert_coin: '', coin_drop: '' };
var coinSoundDefaults = {
	insert_coin: '/hotspot-assets/assets/insertcoinbg.mp3',
	coin_drop: '/hotspot-assets/assets/coin-received.mp3',
};
var insertCoinSound = null;
var coinDropSound = null;

function armCoinSounds() {
	// Re-arming must not interrupt a slot that is already listening for coins.
	var looping = insertCoinSound && !insertCoinSound.paused;
	insertCoinSound = new Audio(coinSounds.insert_coin || coinSoundDefaults.insert_coin);
	insertCoinSound.loop = true;
	coinDropSound = new Audio(coinSounds.coin_drop || coinSoundDefaults.coin_drop);
	// preload 'none' on purpose: a captive webview reloads this page every few
	// seconds while it waits for the portal, and would re-download both sounds
	// each time even when nobody touches the coin slot.
	insertCoinSound.preload = 'none';
	coinDropSound.preload = 'none';
	if (looping) playCoinSound(insertCoinSound, false);
}

function loadCoinSounds() {
	// Ready to play even if the request never lands.
	armCoinSounds();
	fetch('/api/settings/sounds')
		.then(function(r) { return r.ok ? r.json() : null; })
		.then(function(s) {
			if (!s) return;
			coinSounds.insert_coin = s.insert_coin || '';
			coinSounds.coin_drop = s.coin_drop || '';
			if (s.defaults) {
				coinSoundDefaults.insert_coin = s.defaults.insert_coin || coinSoundDefaults.insert_coin;
				coinSoundDefaults.coin_drop = s.defaults.coin_drop || coinSoundDefaults.coin_drop;
			}
			armCoinSounds();
		})
		.catch(function() {});
}

// play() returns a promise that rejects when the browser has not been given
// permission for audio yet; an unhandled rejection there can break the coin
// polling loop in some webviews.
function playCoinSound(sound, fromStart) {
	if (!sound) return;
	try {
		if (fromStart) sound.currentTime = 0;
		var p = sound.play();
		if (p && p.catch) p.catch(function() {});
	} catch (e) {}
}

function stopCoinLoop() {
	if (!insertCoinSound) return;
	try {
		insertCoinSound.pause();
		insertCoinSound.currentTime = 0;
	} catch (e) {}
}

// ---- Portal banner ----
// Uploaded on the admin Portal > Banner Uploader page and served from this same
// origin, for the same reason as the sounds: a captive phone can reach the
// controller and nothing else. The markup is not touched - portal.html keeps the
// <img> the operator may have edited, and only its src is swapped here.
function loadPortalBanner() {
	fetch('/api/settings/branding')
		.then(function(r) { return r.ok ? r.json() : null; })
		.then(function(s) {
			if (!s) return;
			var src = s.portal_banner || s.default_banner || '';
			if (!src) return;
			var images = document.querySelectorAll('.brand-img-container img');
			for (var i = 0; i < images.length; i++) images[i].src = src;
		})
		.catch(function() {});
}


// ---- Initialize on DOM load ----
document.addEventListener('DOMContentLoaded', function() {
	document.getElementById('ip-display').textContent = ip || '-';
	document.getElementById('mac-display').textContent = mac || '-';
	document.sendin.action = linkLoginOnly;

	setupEventListeners();
	loadVendoConfig();
	loadPaymentConfig();
	loadCoinSounds();
	loadPortalBanner();

	// Fast roam FIRST: a browser that already owns a token (it came from another
	// SSID with another MAC) does not need to ask the router anything to know it
	// must restore. The captive webview reloads this page every few seconds, so
	// the restore has to be the first request out - running it only after
	// check-session answered cost a whole extra round trip per reload and the
	// device stayed captive for seconds on end.
	if (mac && juanFiSessionAvailable() && window.JuanFiSession.getToken()) {
		tryRoamingRestore(null, true);
	}
	checkSessionState();

	// Returned from PayMongo (GCash).
	var pay = params.get('pay');
	if (pay === 'success') {
		var ref = params.get('ref') || '';
		if (ref) { verifyPayment(ref); } else { alert('Payment received! Your time will be credited shortly.'); }
	} else if (pay === 'cancel') {
		alert('Payment cancelled.');
	}
});

// ---- Event Listeners ----
function setupEventListeners() {
	// Disconnected panel
	document.getElementById('connectBtn').addEventListener('click', function() { doLogin(); });
	document.getElementById('voucherInput').addEventListener('keypress', function(e) {
		if (e.key === 'Enter') doLogin();
	});
	document.getElementById('insertBtn').addEventListener('click', function() {
		isExtendMode = false;
		insertBtnAction();
	});
	document.getElementById('promoRateBtn').addEventListener('click', function() { showModal('promoModal'); loadPromoRates(); });
	document.getElementById('promoCloseBtn').addEventListener('click', function() { hideModal('promoModal'); });
	document.getElementById('chargingBtn').addEventListener('click', function() { showModal('chargingModal'); loadChargingStations(); });
	document.getElementById('chargingCloseBtn').addEventListener('click', function() { hideModal('chargingModal'); });
	document.getElementById('eloadBtn').addEventListener('click', function() { showModal('eloadModal'); });
	document.getElementById('payGcashBtn').addEventListener('click', function() { showPayRates(); });
	document.getElementById('payGcashBtnConnected').addEventListener('click', function() { showPayRates(); });
	document.getElementById('eloadCloseBtn').addEventListener('click', function() { hideModal('eloadModal'); });

	// TRIAL button (panel-tracked free time). Guarded: portal.html is admin-
	// editable and an older copy may not have the button at all.
	var trialBtnEl = document.getElementById('trialBtn');
	if (trialBtnEl) trialBtnEl.addEventListener('click', function() { doTrial(); });

	// Connected panel
	document.getElementById('extendBtn').addEventListener('click', function() {
		isExtendMode = true;
		insertBtnAction();
	});
	document.getElementById('connectedPromoRateBtn').addEventListener('click', function() { showModal('promoModal'); loadPromoRates(); });
	document.getElementById('pauseTimeBtn').addEventListener('click', function() {
		if (isPaused) doResume(); else doPause();
	});

	// Coin modal
	document.getElementById('coinSaveBtn').addEventListener('click', function() {
		this.disabled = true;
		saveVoucherAndLogin();
	});
	document.getElementById('coinCancelBtn').addEventListener('click', function() {
		if (coinTimer) { clearInterval(coinTimer); coinTimer = null; }
		hideModal('coinModal');
		if (airCoinsSessionId) {
			// Anything dropped stays with the customer: the panel has already
			// credited it, so cancelling only stops the slot waiting for more.
			panelPost('/coins/cancel', { deviceId: airCoinsDevice(), sessionId: airCoinsSessionId })
				.catch(function() {});
			airCoinsSessionId = '';
			return;
		}
		if (totalCoinReceived === 0) {
			nodeMcuPost('/cancelTopUp', 'voucher=' + voucher + '&mac=' + mac).catch(function() {});
		}
	});

	// Modal backdrop close
	['promoModal', 'chargingModal', 'eloadModal'].forEach(function(id) {
		document.getElementById(id).addEventListener('click', function(e) {
			if (e.target === this) hideModal(id);
		});
	});
}

// ---- State Management ----
function showDisconnectedState() {
	isConnected = false;
	isPaused = false;
	stopCountdown();
	stopSessionSync();
	document.getElementById('disconnectedPanel').style.display = '';
	document.getElementById('connectedPanel').style.display = 'none';
	document.getElementById('statusBadge').style.background = 'rgba(239, 68, 68, 0.1)';
	document.getElementById('statusBadge').style.color = '#ef4444';
	document.getElementById('statusBadge').style.borderColor = 'rgba(239, 68, 68, 0.2)';
	document.getElementById('statusText').textContent = 'Disconnected';
	document.getElementById('statusText').className = 'blinking1 text-danger font-weight-bold';
	setPauseButton(false);
}

function showConnectedState(remaining) {
	isConnected = true;
	isPaused = false;
	remainingSeconds = Math.max(0, Math.floor(remaining));
	sessionExpiresAt = Date.now() + remainingSeconds * 1000;

	document.getElementById('disconnectedPanel').style.display = 'none';
	document.getElementById('connectedPanel').style.display = '';
	document.getElementById('statusBadge').style.background = 'rgba(16, 185, 129, 0.1)';
	document.getElementById('statusBadge').style.color = '#10b981';
	document.getElementById('statusBadge').style.borderColor = 'rgba(16, 185, 129, 0.2)';
	document.getElementById('statusText').textContent = 'Connected';
	document.getElementById('statusText').className = 'blinking2 text-success font-weight-bold';
	document.getElementById('timeRemainingDisplay').parentNode.style.background = 'linear-gradient(135deg, #10b981, #059669)';
	setPauseButton(false);

	updateCountdownDisplay();
	startCountdown();
	startSessionSync();
}

// PAUSED: paid time is frozen server-side (account disabled, balance stored).
// Show the connected panel with an amber frozen countdown and a RESUME button;
// keep the session sync running so a top-up / external resume is picked up.
function showPausedState(remaining) {
	isConnected = false;
	isPaused = true;
	remainingSeconds = Math.max(0, Math.floor(remaining));
	sessionExpiresAt = null;
	stopCountdown();

	document.getElementById('disconnectedPanel').style.display = 'none';
	document.getElementById('connectedPanel').style.display = '';
	document.getElementById('statusBadge').style.background = 'rgba(245, 158, 11, 0.12)';
	document.getElementById('statusBadge').style.color = '#d97706';
	document.getElementById('statusBadge').style.borderColor = 'rgba(245, 158, 11, 0.3)';
	document.getElementById('statusText').textContent = 'Paused';
	document.getElementById('statusText').className = 'font-weight-bold';
	document.getElementById('timeRemainingDisplay').parentNode.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
	setPauseButton(true);

	updateCountdownDisplay();
	document.getElementById('expirationDisplay').textContent = 'Time frozen — press RESUME TIME to continue';
	startSessionSync();
}

// PAUSE TIME (amber) <-> RESUME TIME (green).
function setPauseButton(resumeMode) {
	var btn = document.getElementById('pauseTimeBtn');
	if (!btn) return;
	btn.disabled = false;
	btn.textContent = resumeMode ? 'RESUME TIME' : 'PAUSE TIME';
	btn.style.background = resumeMode
		? 'linear-gradient(135deg, #10b981, #059669)'
		: 'linear-gradient(135deg, #f59e0b, #d97706)';
}

function startCountdown() {
	stopCountdown();
	countdownTimer = setInterval(function() {
		if (!isConnected || remainingSeconds <= 0) {
			stopCountdown();
			if (isConnected) showDisconnectedState();
			return;
		}
		remainingSeconds--;
		updateCountdownDisplay();
	}, 1000);
}

function stopCountdown() {
	if (countdownTimer) {
		clearInterval(countdownTimer);
		countdownTimer = null;
	}
}

// ---- Panel session-time-left sync ----
// The panel's Active Devices tab shows the router's live `session-time-left`.
// Re-read the same value periodically so the portal's running countdown stays
// equal to the panel's instead of drifting away after a top-up / pause.
function syncSessionTime() {
	if (!mac || !routerId) return;
	fetch('/api/portal/check-session?mac=' + encodeURIComponent(mac) + '&routerId=' + encodeURIComponent(routerId))
		.then(function(r) { return r.json(); })
		.then(function(data) {
			if (data && data.paused && data.remainingSeconds > 0) {
				showPausedState(data.remainingSeconds);
				return;
			}
			if (sessionIsOnline(data)) {
				remainingSeconds = Math.max(0, Math.floor(data.remainingSeconds));
				sessionExpiresAt = Date.now() + remainingSeconds * 1000;
				if (!isConnected) {
					showConnectedState(remainingSeconds);
				} else {
					updateCountdownDisplay();
				}
			} else {
				if (isConnected || isPaused) showDisconnectedState();
				// Roamed off this SSID, or the live session died: kick a restore right
				// away so the device does not sit in the captive portal until the user
				// taps something. Restores are throttled, so this is safe at 5s polls.
				tryRoamingRestore(data);
			}
		})
		.catch(function() {});
}

function startSessionSync() {
	stopSessionSync();
	sessionSyncTimer = setInterval(syncSessionTime, 5000);
}

function stopSessionSync() {
	if (sessionSyncTimer) {
		clearInterval(sessionSyncTimer);
		sessionSyncTimer = null;
	}
}

function updateCountdownDisplay() {
	document.getElementById('timeRemainingDisplay').textContent = secondsToDhms(remainingSeconds);
	if (sessionExpiresAt) {
		var expDate = new Date(sessionExpiresAt);
		var h = expDate.getHours();
		var m = expDate.getMinutes();
		var ampm = h >= 12 ? 'PM' : 'AM';
		h = h % 12 || 12;
		document.getElementById('expirationDisplay').textContent =
			expDate.toLocaleDateString() + ' at ' + h + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
	}
}

// ---- Session Check ----
function checkSessionState() {
	if (!mac || !routerId) {
		showDisconnectedState();
		return;
	}
	fetch('/api/portal/check-session?mac=' + encodeURIComponent(mac) + '&routerId=' + encodeURIComponent(routerId))
		.then(function(r) { return r.json(); })
		.then(function(data) {
			if (data && data.paused && data.remainingSeconds > 0) {
				showPausedState(data.remainingSeconds);
				if (!tokenBound) {
					tokenBound = true;
					bindRoamingToken(data.username || macVoucherCode(), data.remainingSeconds);
				}
			} else if (sessionIsOnline(data)) {
				showConnectedState(data.remainingSeconds);
				if (!tokenBound) {
					tokenBound = true;
					// Bind the ORIGINAL account identity (data.username). After a
					// roam the current MAC differs from the account username —
					// binding the new MAC here would overwrite the session's
					// identity and break the next roam restore.
					bindRoamingToken(data.username || macVoucherCode(), data.remainingSeconds);
				}
			} else {
				showDisconnectedState();
				tryRoamingRestore(data);
			}
		})
		.catch(function(e) {
			showDisconnectedState();
			tryRoamingRestore(null);
		});
}

// A session counts as "connected" only when the device is actually online on
// the router. `hasSession` alone can be true while offline (stored paid time);
// showing the connected panel then leads to a top-up that tries to extend a
// session that does not exist. When we could not check the router, fall back to
// the stored time.
function sessionIsOnline(data) {
	if (!data || !data.hasSession || !(data.remainingSeconds > 0)) return false;
	if (data.liveChecked === true && data.online === false) return false;
	return true;
}

// ---- Roaming session token (cross-SSID) ----
function juanFiSessionAvailable() {
	return (typeof window.JuanFiSession !== 'undefined') && window.JuanFiSession.isConfigured();
}

// Persist the token <-> MAC/username binding + remaining time so a later roam
// to another SSID (new MAC) can restore the session.
function bindRoamingToken(username, remainingSecs) {
	if (!mac || !juanFiSessionAvailable()) return;
	try {
		window.JuanFiSession.bind(mac, username || macVoucherCode(), '', remainingSecs);
	} catch (e) {}
}

// Roam: this browser already owns a token (possibly from another SSID with a
// different MAC). If the panel restores it, re-login with the ORIGINAL username
// so the account + remaining time follow the device.
//
// "Almost perfect" is not enough for a captive portal: a single lost/failed
// attempt used to park the device in the captive portal until the user tapped
// something. The restore is therefore throttled (never a request storm), it
// retries transient failures, it rescues a lost token by logging in directly
// with the identity from check-session, and it self-heals when the re-login did
// not stick.
var restoreInFlight = false;
var lastRestoreAt = 0;
var lastRescueAt = 0;

function tryRoamingRestore(sessionData, force) {
	if (!mac) return;
	if (restoreInFlight) return;
	var now = Date.now();
	if (!force && now - lastRestoreAt < 8000) return;
	lastRestoreAt = now;
	restoreInFlight = true;
	// Watchdog: a request that never settles must not lock restores for the
	// lifetime of this page load (that is how devices ended up parked in the
	// portal with the panel saying nothing).
	setTimeout(function() { restoreInFlight = false; }, 12000);
	roamingRestoreAttempt(sessionData, 2).then(function() { restoreInFlight = false; });
}

// The CHAP response depends on the router's loginOption (username-only hashes
// an EMPTY password, voucher mode hashes the code). Guessing it produces a
// rejected login and another captive cycle, so give the config fetch a brief
// chance to land before submitting.
function withVendoConfig(cb) {
	if (vendoConfig) { cb(); return; }
	var waited = 0;
	var timer = setInterval(function() {
		waited += 100;
		if (vendoConfig || waited >= 1500) {
			clearInterval(timer);
			cb();
		}
	}, 100);
}

function roamingRestoreAttempt(sessionData, attemptsLeft) {
	if (!juanFiSessionAvailable() || !window.JuanFiSession.getToken()) {
		// No token (cleared storage, different browser): fall back to a direct
		// login with the account identity the panel knows for this MAC.
		directRescueLogin(sessionData);
		return Promise.resolve();
	}
	return window.JuanFiSession.ensureToken(mac, ip, '').then(function(token) {
		if (!token) {
			directRescueLogin(sessionData);
			return;
		}
		return window.JuanFiSession.restore(mac, ip, '').then(function(res) {
			// Paused on another SSID: stay paused here too — show the frozen
			// balance with RESUME instead of re-logging in (RADIUS would reject
			// the disabled account anyway).
			if (res && res.reason === 'paused' && res.remaining > 0) {
				tokenBound = true;
				showPausedState(res.remaining);
				return;
			}
			// Same MAC already live on the router: do NOT re-login (it would
			// race the working session). Show the balance; live sync keeps it
			// fresh and confirms the connected state.
			if (res && res.reason === 'already-online' && res.remaining > 0) {
				tokenBound = true;
				showConnectedState(res.remaining);
				setTimeout(function() { syncSessionTime(); }, 3000);
				return;
			}
			if (res && res.restore === true && res.username) {
				tokenBound = true;
				withVendoConfig(function() { doLogin(res.username); });
				// Show the restored time right away (the login submits into a hidden
				// iframe, so nothing else would switch the panel to connected), then
				// let the live sync confirm/adjust it once the router session is up.
				if (res.remaining > 0 && chapId && chapChallenge && linkLoginOnly) {
					showConnectedState(res.remaining);
				}
				setTimeout(function() { syncSessionTime(); }, 3000);
				setTimeout(function() { syncSessionTime(); }, 8000);
				// Self-heal: the CHAP login is fire-and-forget into the iframe. If the
				// device is still not online 5s later (shared-users race, router busy)
				// try the whole restore once more instead of sitting in captive.
				setTimeout(function() {
					fetch('/api/portal/check-session?mac=' + encodeURIComponent(mac) + '&routerId=' + encodeURIComponent(routerId))
						.then(function(r) { return r.json(); })
						.then(function(data) {
							if (!sessionIsOnline(data) && attemptsLeft > 0) tryRoamingRestore(data, true);
						})
						.catch(function() {});
				}, 5000);
				return;
			}
			if (res && (res.reason === 'never-logged-in' || res.reason === 'unknown-token')) {
				// Token lost server-side: log in directly as the known account.
				directRescueLogin(sessionData);
				return;
			}
			// Transient failure (router unreachable, timeout): retry shortly.
			if (!res && attemptsLeft > 0) {
				setTimeout(function() { tryRoamingRestore(sessionData, true); }, 1500);
			}
		});
	}).catch(function() {
		if (attemptsLeft > 0) setTimeout(function() { tryRoamingRestore(sessionData, true); }, 1500);
	});
}

// Last resort: check-session already told us this MAC owns a paid account that
// is simply offline (roamed / kicked). Submit the CHAP login with that identity
// directly — RADIUS accepts it through the device_macs alias — without waiting
// for a token round trip.
function directRescueLogin(sessionData) {
	if (!sessionData || !sessionData.hasSession || sessionData.paused || sessionData.online) return false;
	if (!(sessionData.remainingSeconds > 0) || !sessionData.username) return false;
	if (!chapId || !chapChallenge || !linkLoginOnly) return false;
	if (Date.now() - lastRescueAt < 20000) return false;
	lastRescueAt = Date.now();
	withVendoConfig(function() { doLogin(sessionData.username); });
	showConnectedState(sessionData.remainingSeconds);
	setTimeout(function() { syncSessionTime(); }, 3000);
	setTimeout(function() { syncSessionTime(); }, 8000);
	return true;
}

// ---- Vendo Config ----
function loadVendoConfig() {
	var url = '/api/portal/vendo-config';
	var query = [];
	// The panel cannot see the customer's address through nginx, and it is the
	// one thing that says which network (and so which sub-vendo) they belong to.
	if (ip) query.push('ip=' + encodeURIComponent(ip));
	if (routerId) query.push('routerId=' + encodeURIComponent(routerId));
	if (query.length) url += '?' + query.join('&');
	fetch(url)
		.then(function(r) { return r.json(); })
		.then(function(cfg) {
			vendoConfig = cfg;
			vendorIpAddress = cfg.vendorIpAddress || '';
			populateVendoSelect('vendoSelected', 'vendoSelectDiv', cfg);
			populateVendoSelect('connectedVendoSelected', 'connectedVendoSelectDiv', cfg);
			updateActionButtons();
			// Free trial offer from the panel (System Settings). The claim check
			// is server-side (once per device per day) - a used trial hides itself
			// after the 429 instead of taunting the customer all day.
			var trialBtn = document.getElementById('trialBtn');
			if (trialBtn) {
				if (cfg.trialEnabled && cfg.trialMinutes > 0 && localStorage.getItem('trialUsedToday') !== todayStamp()) {
					trialBtn.style.display = '';
					trialBtn.textContent = 'FREE TRIAL (' + cfg.trialMinutes + ' MIN)';
				} else {
					trialBtn.style.display = 'none';
				}
			}
		})
		.catch(function() {});
}

function populateVendoSelect(selectId, divId, cfg) {
	var sel = document.getElementById(selectId);
	var selDiv = document.getElementById(divId);

	// The phone's network owns exactly one machine. Nothing else was even sent,
	// and the picker is no longer a choice: offering a list here is how a
	// customer ends up feeding the vendo on the other side of the wall. VLAN
	// isolation already keeps the machines apart; this keeps the pesos apart.
	var locked = cfg.vendoLocked && cfg.lockedVendo ? String(cfg.lockedVendo) : '';
	if (locked) {
		selDiv.style.display = '';
		var label = selDiv.querySelector ? selDiv.querySelector('label') : null;
		if (label) label.textContent = 'Coin machine for your network';
		sel.innerHTML = '';
		var onlyOption = document.createElement('option');
		onlyOption.value = locked;
		onlyOption.textContent = cfg.lockedVendoName || locked;
		sel.appendChild(onlyOption);
		sel.value = locked;
		sel.disabled = true;
		vendorIpAddress = locked;
		localStorage.setItem('selectedVendo', locked);
		showAutoVendoNote(divId, cfg);
		return;
	}

	var juanfi = (cfg.isMultiVendo && cfg.multiVendoAddresses) ? cfg.multiVendoAddresses : [];
	var aircoins = cfg.aircoinsVendos || [];

	if (juanfi.length === 0 && aircoins.length === 0) {
		selDiv.style.display = 'none';
		return;
	}

	if (cfg.isMultiVendo && juanfi.length > 0 && cfg.multiVendoOption !== 0) {
		// A fixed JuanFi machine: no dropdown, and the coins go to the last entry,
		// which is what this has always done.
		selDiv.style.display = 'none';
		juanfi.forEach(function(v) {
			vendorIpAddress = v.vendoIp;
		});
		return;
	}

	selDiv.style.display = '';
	sel.innerHTML = '';

	// A JuanFi vendo is addressed by IP and answers the phone itself. An AirCoins
	// machine has no web server at all, so its option carries the panel id and
	// the phone talks to /api/portal/coins/* instead. The prefix is what tells
	// the two apart when INSERT COIN is pressed.
	var wanted = [];
	juanfi.forEach(function(v) {
		var opt = document.createElement('option');
		opt.value = v.vendoIp;
		opt.textContent = v.vendoName;
		sel.appendChild(opt);
		wanted.push(v.vendoIp);
	});
	aircoins.forEach(function(v) {
		var opt = document.createElement('option');
		opt.value = 'aircoins:' + v.deviceId;
		opt.textContent = v.vendoName;
		sel.appendChild(opt);
		wanted.push('aircoins:' + v.deviceId);
	});

	// Which machine serves this phone comes from its own address: the hotspot
	// hands out one lease per DHCP server and each sub-vendo is wired to one of
	// those networks, so the list simply opens on the right machine. A pick made
	// by hand is still honoured while that machine exists - a replaced or
	// renumbered one used to be trusted blindly, and the phone POSTed to an
	// address that was not the one on screen.
	var auto = typeof cfg.autoVendo === 'string' ? cfg.autoVendo : '';
	var stored = localStorage.getItem('selectedVendo');
	var chosen = auto && wanted.indexOf(auto) >= 0
		? auto
		: (wanted.indexOf(stored) >= 0 ? stored : wanted[0]);
	sel.value = chosen;
	vendorIpAddress = chosen;
	if (stored !== chosen) localStorage.setItem('selectedVendo', chosen);
	showAutoVendoNote(divId, auto && chosen === auto ? cfg : null);

	sel.addEventListener('change', function() {
		vendorIpAddress = sel.value;
		localStorage.setItem('selectedVendo', vendorIpAddress);
		showAutoVendoNote(divId, null);
		syncVendoSelect(selectId);
		updateActionButtons();
	});
}

// A short line under the dropdown, so the customer knows the portal placed them
// on their network's machine instead of having to trust the first entry.
function showAutoVendoNote(divId, cfg) {
	var div = document.getElementById(divId);
	if (!div) return;
	var note = document.getElementById(divId + 'Auto');
	if (!note) {
		note = document.createElement('small');
		note.id = divId + 'Auto';
		note.style.display = 'none';
		note.style.color = '#0f766e';
		note.style.fontSize = '12px';
		div.appendChild(note);
	}
	if (!cfg) { note.style.display = 'none'; return; }
	note.textContent = cfg.vendoLocked
		? 'The only coin machine on your network' + (cfg.lockedVendoName ? ': ' + cfg.lockedVendoName : '')
		: 'Auto-selected for your network' + (cfg.autoVendoName ? ': ' + cfg.autoVendoName : '');
	note.style.display = '';
}

function syncVendoSelect(changedId) {
	var otherId = changedId === 'vendoSelected' ? 'connectedVendoSelected' : 'vendoSelected';
	var other = document.getElementById(otherId);
	if (other && other.options.length > 0) {
		other.value = vendorIpAddress;
	}
}

function updateActionButtons() {
	if (!vendoConfig) return;
	var chargingBtn = document.getElementById('chargingBtn');
	var eloadBtn = document.getElementById('eloadBtn');
	var chargingOn = vendoConfig.chargingEnable;
	var eloadOn = vendoConfig.eloadEnable;
	if (vendoConfig.isMultiVendo && vendoConfig.multiVendoAddresses.length > 0) {
		vendoConfig.multiVendoAddresses.forEach(function(v) {
			if (v.vendoIp === vendorIpAddress) {
				chargingOn = v.chargingEnable;
				eloadOn = v.eloadEnable;
			}
		});
	}
	chargingBtn.style.display = chargingOn ? '' : 'none';
	eloadBtn.style.display = eloadOn ? '' : 'none';
}

// ---- Utility Functions ----
// Single source of truth for MAC-as-voucher identity (panel-served portal).
// Auth (doLogin / check-session / coin-auth / logout) all use the MAC
// without colons, UPPERCASE. Never use the NodeMCU random voucher for auth.
function macVoucherCode() {
	return String(mac || '').replace(/:/g, '').replace(/-/g, '').toUpperCase();
}
function replaceAll(str, rep) {
	var aa = str;
	while (aa.indexOf(rep) > 0) aa = aa.replace(rep, '');
	return aa;
}

function secondsToDhms(seconds) {
	seconds = Number(seconds);
	var d = Math.floor(seconds / 86400);
	var h = Math.floor(seconds % 86400 / 3600);
	var m = Math.floor(seconds % 3600 / 60);
	var s = Math.floor(seconds % 60);
	var dD = d > 0 ? d + (d === 1 ? ' Day ' : ' Days ') : '';
	return dD + (h < 10 ? '0' : '') + h + 'h : ' + (m < 10 ? '0' : '') + m + 'm : ' + (s < 10 ? '0' : '') + s + 's';
}

function showModal(id, silent) {
	document.getElementById(id).style.display = 'flex';
	// The coin modal only ever opens from the INSERT COIN / ADD TIME press, so
	// this is still inside the customer's tap - the one moment the browser is
	// guaranteed to allow audio. `silent` is for the flow that arms the loop in
	// the tap and opens the dialog only after the slot has answered.
	if (id === 'coinModal' && !silent) playCoinSound(insertCoinSound, true);
}
function hideModal(id) {
	document.getElementById(id).style.display = 'none';
	if (id === 'coinModal') {
		stopCoinLoop();
		stopCoinWait();
	}
}

// ---- Coin slot countdown ----
// The slot is open for a short window only. The panel (AirCoins) or the vendo
// itself (JuanFi) owns the real deadline and reports it on every poll; this is
// the copy the customer watches, and the safety net that closes the dialog and
// cancels the transaction when no coin arrives.
var COIN_WAIT_SECONDS = 60;
var COIN_OPEN_TIMEOUT_MS = 7000;
var coinDeadline = 0;
var coinWaitTimer = null;

function coinModalOpen() {
	var modal = document.getElementById('coinModal');
	return !!modal && modal.style.display !== 'none';
}

function renderCoinWait() {
	var el = document.getElementById('coinWaitTimer');
	if (!el) return;
	var left = Math.max(0, Math.ceil((coinDeadline - Date.now()) / 1000));
	el.textContent = left > 0 ? 'Waiting for coin... ' + left + 's' : 'No coin inserted';
	el.style.color = left <= 10 ? '#dc2626' : '#9c27b0';
}

function startCoinWait(ms) {
	var seconds = Math.round((parseInt(ms, 10) || 0) / 1000);
	if (!(seconds > 0)) seconds = COIN_WAIT_SECONDS;
	coinDeadline = Date.now() + seconds * 1000;
	renderCoinWait();
	if (coinWaitTimer) return;
	coinWaitTimer = setInterval(function() {
		if (!coinDeadline) return;
		renderCoinWait();
		if (Date.now() >= coinDeadline) {
			stopCoinWait();
			if (coinModalOpen()) coinWaitExpired();
		}
	}, 250);
}

// Server truth wins, but a poll is only once a second: do not let rounding
// jitter the number on screen.
function syncCoinWait(remainMs) {
	var left = parseInt(remainMs, 10);
	if (!(left > 0) || !coinDeadline) return;
	if (Math.abs(Date.now() + left - coinDeadline) > 1200) coinDeadline = Date.now() + left;
}

function stopCoinWait() {
	if (coinWaitTimer) { clearInterval(coinWaitTimer); coinWaitTimer = null; }
	coinDeadline = 0;
	var el = document.getElementById('coinWaitTimer');
	if (el) el.textContent = '';
}

// Out of time: close the dialog and cancel the transaction. Anything already
// counted was credited as it landed, so the customer keeps it either way - and
// a customer who dropped nothing is simply told the slot closed.
function coinWaitExpired() {
	var got = totalCoinReceived;
	var onPanel = !!airCoinsSessionId;
	if (coinTimer) { clearInterval(coinTimer); coinTimer = null; }
	if (onPanel) {
		panelPost('/coins/cancel', { deviceId: airCoinsDevice(), sessionId: airCoinsSessionId }).catch(function() {});
		airCoinsSessionId = '';
	}
	document.getElementById('coinLoader').style.display = 'none';
	hideModal('coinModal');
	if (got > 0) {
		alert('Coin slot closed. ' + got + ' peso(s) were already added to this device.');
		if (onPanel) afterAirCoinsCredit();
		else saveVoucherAndLogin();
		return;
	}
	if (!onPanel) nodeMcuPost('/cancelTopUp', 'voucher=' + voucher + '&mac=' + mac).catch(function() {});
	totalCoinReceived = 0;
	localStorage.removeItem('totalCoinReceived');
	alert('No coin inserted. The coin slot has been cancelled.');
}

function nodeMcuPost(apiPath, data) {
	return fetch('http://' + vendorIpAddress + apiPath, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: data,
		mode: 'cors',
	}).then(function(r) { return r.text(); });
}

function nodeMcuGet(apiPath) {
	return fetch('http://' + vendorIpAddress + apiPath, { mode: 'cors' }).then(function(r) { return r.text(); });
}

// ---- AirCoins coin session ----
// The selected machine, or 0 when a JuanFi vendo is on screen.
function airCoinsDevice() {
	var value = String(vendorIpAddress || '');
	if (value.indexOf('aircoins:') !== 0) return 0;
	return parseInt(value.substring(9), 10) || 0;
}

function panelPost(apiPath, payload) {
	// Every coin action carries the phone's own lease: nginx makes the panel see
	// this box as the client, and the address is what proves the customer is on
	// the machine's network instead of feeding another sub-vendo's slot.
	var body = payload || {};
	if (ip) body.ip = ip;
	if (routerId) body.routerId = routerId;
	return fetch(window.location.origin + '/api/portal' + apiPath, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	}).then(function(r) { return r.json(); });
}

// The coins are credited as they land, so closing the session never needs a
// voucher step: the device only has to pick up the new time.
function afterAirCoinsCredit() {
	if (coinTimer) { clearInterval(coinTimer); coinTimer = null; }
	airCoinsSessionId = '';
	totalCoinReceived = 0;
	localStorage.removeItem('totalCoinReceived');
	hideModal('coinModal');
	// The coin flow always authenticates as the MAC, whatever the slot did.
	document.getElementById('voucherInput').value = macVoucherCode();
	if (!(isExtendMode && isConnected) && chapId && chapChallenge && linkLoginOnly) {
		setTimeout(function() { doLogin(); }, 500);
	}
	refreshSessionAfterExtend();
	setTimeout(function() { syncSessionTime(); }, 2500);
}

function airCoinsCheck() {
	// A close already happened (SAVE, CANCEL or the countdown), so a reply that
	// lands afterwards must not credit or close anything a second time.
	if (!airCoinsSessionId || !coinModalOpen()) return;
	panelPost('/coins/check', { deviceId: airCoinsDevice(), sessionId: airCoinsSessionId })
		.then(function(data) {
			document.getElementById('coinNotice').style.display = 'none';
			if (!data || !airCoinsSessionId) return;
			syncCoinWait(data.remainTime);

			totalCoinReceived = parseInt(data.totalCoin) || 0;
			document.getElementById('modalTotalCoin').textContent = String(totalCoinReceived);
			document.getElementById('modalTotalTime').textContent = secondsToDhms(parseInt(data.timeAdded) || 0);
			if (totalCoinReceived > 0) {
				document.getElementById('coinSaveBtn').disabled = false;
				document.getElementById('coinSaveBtn').style.opacity = '1';
				document.getElementById('coinCodeBlock').style.display = 'none';
				localStorage.setItem('totalCoinReceived', totalCoinReceived);
			}

			if (data.status === 'true') {
				playCoinSound(coinDropSound, true);
				return;
			}

			if (data.errorCode === 'coins.wait.expired' || data.errorCode === 'coin.slot.notavailable') {
				// The window closed. Anything dropped was already credited batch by
				// batch, so the customer loses nothing by us closing here.
				var got = totalCoinReceived;
				afterAirCoinsCredit();
				if (got > 0) {
					alert('Coin slot expired! ' + got + ' peso(s) were already added to this device.');
				} else {
					alert('Coin slot expired');
				}
			}
		})
		.catch(function() {});
}

var errorCodeMap = {
	'coins.wait.expired': 'Coin slot expired',
	'coin.not.inserted': 'Coin not inserted',
	'coinslot.cancelled': 'Coin slot was cancelled',
	'coinslot.busy': 'Coin slot is busy',
	'coin.slot.banned': 'Banned from coin slot',
	'coin.slot.notavailable': 'Coin slot not available',
	'coin.slot.offline': 'This sub-vendo is offline. Please tell the operator.',
	'coin.slot.wrong.network': 'This machine does not serve your network. Please insert the coin at the machine on your own station.',
	'coins.no.rate': 'Not enough for the lowest rate yet',
	'invalid.mac': 'Invalid device address, please refresh the portal',
	'server.error': 'The panel could not answer, please try again',
	'no.internet.detected': 'No internet connection',
	'product.hash.invalid': 'Product hash invalid',
	'convertVoucher.empty': 'Please enter voucher code',
	'convertVoucher.invalid': 'Invalid voucher code',
	'load.not.enough': 'Insufficient load',
	'eload.failed': 'E-load failed',
};
function errorMsg(code) { return errorCodeMap[code] || code || 'Unknown error'; }

// ---- Login ----
function doLogin(loginAs) {
	var vc;
	if (loginAs) {
		// Roam restore: log in with the ORIGINAL identity from the session token
		// (not the new MAC) so the account is found on the router/RADIUS.
		vc = String(loginAs);
		document.getElementById('voucherInput').value = vc;
	} else {
		vc = document.getElementById('voucherInput').value.trim();
		// MAC-as-voucher: the identity stays the MAC. A GENERATED voucher code
		// typed here is redeemed onto the MAC account (like a coin insert) and
		// then we log in as the MAC — never authenticate as the code itself.
		if (macAsVoucherCode) {
			var macCode = macVoucherCode();
			var typedKey = vc.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
			if (vc && typedKey !== macCode) {
				redeemVoucher(vc);
				return false;
			}
			vc = macCode;
			document.getElementById('voucherInput').value = vc;
		}
	}

	if (!vc) { alert('Please enter a voucher code'); return false; }
	
	// Validate required CHAP parameters
	if (!chapId || !chapChallenge) {
		alert('Login parameters missing. Please access portal through MikroTik redirect.');
		return false;
	}
	
	// Validate login URL
	if (!linkLoginOnly) {
		alert('Login URL not configured. Please access portal through MikroTik redirect.');
		return false;
	}

	document.sendin.username.value = vc;
	// Must match hotspot/login.html: loginOption 0 (username-only) hashes an
	// EMPTY password; loginOption 1 hashes the voucher. Hashing vc here while
	// the router has no password for the user = wrong CHAP response = login
	// rejected = device stays in captive portal with no internet.
	var loginOpt = (vendoConfig && typeof vendoConfig.loginOption !== 'undefined')
		? parseInt(vendoConfig.loginOption, 10) : 0;
	if (loginOpt === 0) {
		document.sendin.password.value = hexMD5(chapId + '' + chapChallenge);
	} else {
		document.sendin.password.value = hexMD5(chapId + vc + chapChallenge);
	}
	document.sendin.dst.value = linkStatus;
	// Submit to hidden iframe so portal page stays put — no redirect to status.html
	document.sendin.target = 'loginFrame';
	document.sendin.submit();

	// Keep the roaming token bound to the RESOLVED account identity so a later
	// roam restores it. Binding the submitted name (usually the current MAC)
	// would overwrite the session's original identity after a roam / voucher
	// redeem and make check-session report "no time" while the device is online.
	setTimeout(function() {
		if (!mac || !routerId || !juanFiSessionAvailable()) return;
		fetch('/api/portal/check-session?mac=' + encodeURIComponent(mac) + '&routerId=' + encodeURIComponent(routerId))
			.then(function(r) { return r.json(); })
			.then(function(data) {
				if (data && data.username && data.hasSession) {
					bindRoamingToken(data.username, data.remainingSeconds);
				}
			})
			.catch(function() {});
	}, 2500);
	return false;
}

// Redeem a generated voucher code onto this device's MAC account, then log in
// as the MAC (single identity: pause/resume, roam and coin top-ups keep working).
function redeemVoucher(code) {
	fetch('/api/vouchers/redeem', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ mac: mac, code: code, routerId: routerId }),
	}).then(function(r) {
		return r.json().then(function(d) { return { ok: r.ok, d: d }; });
	}).then(function(res) {
		if (res.ok && res.d && res.d.success) {
			document.getElementById('voucherInput').value = macVoucherCode();
			doLogin();
			showConnectedState(res.d.remainingSeconds);
			setTimeout(function() { syncSessionTime(); }, 2500);
			setTimeout(function() { syncSessionTime(); }, 8000);
		} else {
			alert('Voucher: ' + ((res.d && res.d.error) || 'could not be redeemed'));
		}
	}).catch(function() {
		alert('Voucher redemption failed. Please try again.');
	});
}

// ---- FREE TRIAL ----
// The panel credits trial minutes onto this device's MAC account (same tracked
// path as a coin insert - the router's own trial login bypasses RADIUS and is
// removed on radius routers), then logs in as the MAC exactly like redeemVoucher
// does. Once per device per day, enforced server-side.
function todayStamp() {
	// Local YYYY-MM-DD - must match the server's claim day boundary.
	var d = new Date();
	var p = function(n) { return (n < 10 ? '0' : '') + n; };
	return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function doTrial() {
	if (!mac || !routerId) { alert('Missing device parameters. Please access the portal through the MikroTik redirect.'); return; }
	var btn = document.getElementById('trialBtn');
	if (btn) { btn.disabled = true; btn.textContent = 'PLEASE WAIT...'; }
	fetch('/api/portal/trial', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		// ip lets the server refuse a second trial from the same hotspot address,
		// which is what a phone with a randomized MAC looks like.
		body: JSON.stringify({ mac: mac, routerId: routerId, ip: ip }),
	}).then(function(r) {
		return r.json().then(function(d) { return { ok: r.ok, d: d }; });
	}).then(function(res) {
		if (res.ok && res.d && res.d.success) {
			try { localStorage.setItem('trialUsedToday', todayStamp()); } catch (e) {}
			document.getElementById('voucherInput').value = macVoucherCode();
			doLogin();
			showConnectedState(res.d.remainingSeconds);
			setTimeout(function() { syncSessionTime(); }, 2500);
			setTimeout(function() { syncSessionTime(); }, 8000);
			alert('Enjoy your free ' + (res.d.minutes || '') + ' minutes!');
		} else {
			if (btn) { btn.disabled = false; btn.textContent = 'FREE TRIAL'; }
			if (res.d && res.d.error && /already used today/i.test(res.d.error)) {
				try { localStorage.setItem('trialUsedToday', todayStamp()); } catch (e) {}
				if (btn) btn.style.display = 'none';
			}
			alert('Trial: ' + ((res.d && res.d.error) || 'not available'));
		}
	}).catch(function() {
		if (btn) { btn.disabled = false; btn.textContent = 'FREE TRIAL'; }
		alert('Trial request failed. Please try again.');
	});
}

// ---- Logout ----
function doLogout() {
	if (!confirm('Are you sure you want to logout?')) return;
	stopCountdown();
	if (juanFiSessionAvailable()) { try { window.JuanFiSession.reportState('logout'); } catch (e) {} }

	fetch('/api/portal/logout', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ mac: mac, routerId: routerId }),
	}).then(function(r) { return r.json(); })
	.then(function() {
		localStorage.removeItem('activeVoucher');
		showDisconnectedState();
	})
	.catch(function() {
		localStorage.removeItem('activeVoucher');
		showDisconnectedState();
	});
}

// ---- PAUSE / RESUME TIME ----
// Pause freezes the balance server-side (kicks the live session, disables the
// account so time cannot drain) and resume re-enables it with the full balance
// then re-logs in with the ORIGINAL identity (roam-safe).
function doPause() {
	if (!mac || !routerId) { alert('Missing device parameters. Please access the portal through the MikroTik redirect.'); return; }
	var btn = document.getElementById('pauseTimeBtn');
	btn.disabled = true;
	btn.textContent = 'PAUSING...';
	fetch('/api/portal/pause', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ mac: mac, routerId: routerId }),
	}).then(function(r) { return r.json(); })
	.then(function(data) {
		if (data && data.success) {
			if (juanFiSessionAvailable()) { try { window.JuanFiSession.reportState('pause'); } catch (e) {} }
			showPausedState(data.remainingSeconds);
		} else {
			setPauseButton(isPaused);
			alert('Could not pause: ' + ((data && data.error) || 'unknown error'));
		}
	}).catch(function() {
		setPauseButton(isPaused);
		alert('Pause request failed. Please try again.');
	});
}

function doResume() {
	if (!mac || !routerId) { alert('Missing device parameters. Please access the portal through the MikroTik redirect.'); return; }
	var btn = document.getElementById('pauseTimeBtn');
	btn.disabled = true;
	btn.textContent = 'RESUMING...';
	fetch('/api/portal/resume', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ mac: mac, routerId: routerId }),
	}).then(function(r) { return r.json(); })
	.then(function(data) {
		if (data && data.success) {
			if (juanFiSessionAvailable()) { try { window.JuanFiSession.reportState('active'); } catch (e) {} }
			// Re-login with the ORIGINAL account identity (after a roam the
			// current MAC differs from the username). Hidden-iframe submit, so
			// flip the panel to connected right away and let live sync confirm.
			if (chapId && chapChallenge && linkLoginOnly) {
				doLogin(data.username);
			}
			showConnectedState(data.remainingSeconds);
			setTimeout(function() { syncSessionTime(); }, 3000);
			setTimeout(function() { syncSessionTime(); }, 8000);
		} else {
			setPauseButton(isPaused);
			alert('Could not resume: ' + ((data && data.error) || 'unknown error'));
		}
	}).catch(function() {
		setPauseButton(isPaused);
		alert('Resume request failed. Please try again.');
	});
}

// ---- INSERT COIN ----
function insertBtnAction() {
	totalCoinReceived = 0;
	var stored = localStorage.getItem('totalCoinReceived');
	if (stored) totalCoinReceived = parseInt(stored) || 0;

	document.getElementById('modalTotalCoin').textContent = '0';
	document.getElementById('modalTotalTime').textContent = secondsToDhms(0);
	document.getElementById('coinSaveBtn').disabled = true;
	document.getElementById('coinSaveBtn').style.opacity = '0.5';
	document.getElementById('coinCancelBtn').disabled = false;
	document.getElementById('coinCodeBlock').style.display = 'none';
	document.getElementById('coinNotice').style.display = 'none';
	document.getElementById('coinLoader').style.display = '';

	if (!vendorIpAddress) { alert('No vendo machine configured'); return; }

	// MAC-as-voucher: the coin slot tracks credit under the MAC identity.
	// Never re-send a stored random voucher — the NodeMCU would credit the
	// wrong account and conflict with the coin-auth MAC session.
	if (macAsVoucherCode) {
		voucher = macVoucherCode();
		document.getElementById('voucherInput').value = voucher;
	}
	var postData = 'voucher=' + voucher + '&mac=' + mac;

	// An AirCoins machine serves nothing, so its half of this conversation runs
	// on the panel. Both answers are JSON with the same field names, which keeps
	// everything below identical for the two kinds of vendo.
	var airDevice = airCoinsDevice();
	var request = airDevice
		? panelPost('/coins/topup', { deviceId: airDevice, mac: mac, routerId: routerId, voucher: voucher })
		: nodeMcuPost('/topUp', postData).then(function(resp) {
			try { return JSON.parse(resp); } catch(e) { return { status: 'false', errorCode: 'coin.slot.notavailable' }; }
		});

	// Ask the slot FIRST, show the dialog second. A vendo that is unplugged used
	// to open the dialog and only then fail inside it, which looked ready and
	// left the customer feeding a dead box. The tap still arms the coin loop,
	// because by the time the answer comes back the browser no longer allows
	// audio to start on its own.
	setCoinButtonBusy(true);
	playCoinSound(insertCoinSound, true);
	coinOpenRequest(request).then(function(data) {
		if (!data || data.status !== 'true') {
			coinSlotUnavailable(data);
			return;
		}
		openCoinSlot(data, airDevice);
	}).catch(function() {
		coinSlotUnavailable({ errorCode: 'coin.slot.offline' });
	});
}

// Nothing at all is the same answer as "offline": the phone must not wait on a
// box that is not there.
function coinOpenRequest(request) {
	return new Promise(function(resolve, reject) {
		var settled = false;
		var timer = setTimeout(function() {
			if (settled) return;
			settled = true;
			reject({ errorCode: 'coin.slot.offline' });
		}, COIN_OPEN_TIMEOUT_MS);
		request.then(function(data) {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(data);
		}, function(err) {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(err);
		});
	});
}

// No slot to feed: say why and leave the dialog closed.
function coinSlotUnavailable(data) {
	var code = (data && data.errorCode) || 'coin.slot.offline';
	airCoinsSessionId = '';
	if (coinTimer) { clearInterval(coinTimer); coinTimer = null; }
	setCoinButtonBusy(false);
	document.getElementById('coinLoader').style.display = 'none';
	hideModal('coinModal');
	alert(errorMsg(code));
}

// The slot is open: show the dialog, start the countdown and poll for coins.
function openCoinSlot(data, airDevice) {
	// MAC-as-voucher: keep the MAC identity. Never adopt the NodeMCU random
	// voucher for auth — it would conflict with the coin-auth MAC session.
	if (!macAsVoucherCode && data.voucher) {
		voucher = data.voucher;
	} else {
		voucher = macVoucherCode();
		document.getElementById('voucherInput').value = voucher;
	}
	airCoinsSessionId = data.sessionId || '';
	document.getElementById('coinCodeBlock').style.display = 'none';
	document.getElementById('coinLoader').style.display = 'none';
	document.getElementById('coinModalTitle').textContent = isExtendMode
		? 'Insert coin to extend time'
		: 'Please insert the coin';
	if ((vendoConfig && vendoConfig.isMultiVendo) || airDevice) {
		var sel = document.getElementById(isConnected ? 'connectedVendoSelected' : 'vendoSelected');
		if (sel && sel.selectedIndex >= 0) {
			document.getElementById('coinModalTitle').textContent =
				(isExtendMode ? 'Extend time on ' : 'Insert coin on ') + sel.options[sel.selectedIndex].text;
		}
	}
	setCoinButtonBusy(false);
	showModal('coinModal', true);
	startCoinWait(data.waitTime);
	syncCoinWait(data.remainTime);
	if (!coinTimer) coinTimer = setInterval(checkCoin, 1000);
}

// INSERT COIN / ADD TIME both wait on the slot; say so without opening a dialog
// the customer would read as "the machine is ready".
function setCoinButtonBusy(busy) {
	['insertBtn', 'extendBtn'].forEach(function(id) {
		var btn = document.getElementById(id);
		if (!btn) return;
		if (busy) {
			if (btn.getAttribute('data-label') === null) btn.setAttribute('data-label', btn.textContent);
			btn.disabled = true;
			btn.textContent = 'CHECKING SLOT...';
			return;
		}
		btn.disabled = false;
		if (btn.getAttribute('data-label') !== null) btn.textContent = btn.getAttribute('data-label');
	});
}

function checkCoin() {
	// The dialog is the only place this poll belongs: once SAVE, CANCEL or the
	// countdown closed it, a late answer must not credit anything again.
	if (!coinModalOpen()) return;
	// The panel-held session answers for an AirCoins machine; a JuanFi one is
	// asked directly, as before.
	if (airCoinsSessionId) { airCoinsCheck(); return; }
	nodeMcuPost('/checkCoin', 'voucher=' + voucher)
		.then(function(resp) {
			var data;
			try { data = JSON.parse(resp); } catch(e) { return; }
			// The countdown may have closed the dialog while this was in flight.
			if (!coinModalOpen()) return;
			document.getElementById('coinNotice').style.display = 'none';

			if (data.status === 'true') {
				totalCoinReceived = parseInt(data.totalCoin) || 0;
				playCoinSound(coinDropSound, true);
				document.getElementById('modalTotalCoin').textContent = data.totalCoin;
				document.getElementById('modalTotalTime').textContent = secondsToDhms(parseInt(data.timeAdded) || 0);
				document.getElementById('coinCodeBlock').style.display = 'none';
				localStorage.setItem('activeVoucher', voucher);
				localStorage.setItem('totalCoinReceived', totalCoinReceived);
			} else if (data.errorCode === 'coin.is.reading') {
				document.getElementById('coinNotice').style.display = '';
				document.getElementById('coinNotice').textContent = 'Verifying, please wait..';
			} else if (data.errorCode === 'coin.not.inserted') {
				var remainTime = parseInt(parseInt(data.remainTime) / 1000);
				// The vendo re-opens the slot after every coin, so its own remaining
				// time is what the countdown has to show.
				syncCoinWait(data.remainTime);
				totalCoinReceived = parseInt(data.totalCoin) || 0;
				if (totalCoinReceived > 0) {
					document.getElementById('coinSaveBtn').disabled = false;
					document.getElementById('coinSaveBtn').style.opacity = '1';
					document.getElementById('coinCancelBtn').disabled = true;
					document.getElementById('coinCodeBlock').style.display = 'none';
				}
				if (remainTime === 0) {
					hideModal('coinModal');
					if (coinTimer) { clearInterval(coinTimer); coinTimer = null; }
					if (totalCoinReceived > 0) {
						var msg = isExtendMode
							? 'Coin slot expired! Processed ' + totalCoinReceived + ' coin(s). Extending time..'
							: 'Coin slot expired! But processed ' + totalCoinReceived + ' coin(s). Auto-login shortly.';
						alert(msg);
						setTimeout(function() { saveVoucherAndLogin(); }, 2000);
					} else {
						alert('Coin slot expired');
					}
				} else {
					document.getElementById('modalTotalCoin').textContent = data.totalCoin;
					document.getElementById('modalTotalTime').textContent = secondsToDhms(parseInt(data.timeAdded) || 0);
				}
			} else if (data.errorCode === 'coinslot.busy') {
				if (coinTimer) { clearInterval(coinTimer); coinTimer = null; }
				hideModal('coinModal');
				if (totalCoinReceived === 0) {
					alert('Coin slot was cancelled');
				} else {
					alert('Coin slot cancelled! But processed ' + totalCoinReceived + ' coin(s).');
					setTimeout(function() { saveVoucherAndLogin(); }, 2000);
				}
			} else {
				alert(errorMsg(data.errorCode));
				if (coinTimer) { clearInterval(coinTimer); coinTimer = null; }
				hideModal('coinModal');
			}
		})
		.catch(function() {});
}

// SAVE on an AirCoins session. The coins were credited as they landed, so this
// only closes the slot and lets the device pick the time up. Asking the voucher
// route here as well would pay the same pesos a second time.
function saveAirCoinsSession() {
	var saveBtn = document.getElementById('coinSaveBtn');
	saveBtn.disabled = true;
	saveBtn.textContent = 'SAVING...';

	panelPost('/coins/use', { deviceId: airCoinsDevice(), sessionId: airCoinsSessionId })
		.then(function(data) {
			saveBtn.textContent = 'SAVE';
			if (data && data.status === 'true') {
				afterAirCoinsCredit();
				return;
			}
			saveBtn.disabled = false;
			alert(errorMsg(data && data.errorCode));
		})
		.catch(function() {
			// The money is already on the device; only the close call failed.
			saveBtn.textContent = 'SAVE';
			afterAirCoinsCredit();
		});
}

function saveVoucherAndLogin() {
	if (airCoinsSessionId) { saveAirCoinsSession(); return; }
	if (coinTimer) { clearInterval(coinTimer); coinTimer = null; }
	// Panel MAC-as-voucher auth: identity is ALWAYS the MAC. Never the
	// random voucher the NodeMCU returned from /topUp.
	var macNoColon = macVoucherCode();
	if (macAsVoucherCode) {
		voucher = macNoColon;
		document.getElementById('voucherInput').value = voucher;
	}

	// Validate MAC before proceeding
	if (!macNoColon || macNoColon.length < 12) {
		alert('Invalid MAC address. Please refresh the portal and try again.');
		hideModal('coinModal');
		var saveBtn = document.getElementById('coinSaveBtn');
		saveBtn.disabled = false;
		saveBtn.textContent = 'SAVE';
		return;
	}

	localStorage.setItem('activeVoucher', voucher);

	var saveBtn = document.getElementById('coinSaveBtn');
	saveBtn.disabled = true;
	saveBtn.textContent = 'SAVING...';

	nodeMcuPost('/useVoucher', 'voucher=' + voucher)
		.then(function(resp) {
			var data;
			try { data = JSON.parse(resp); } catch(e) { data = { status: 'false' }; }
			if (data.status === 'true') {
				totalCoinReceived = 0;
				localStorage.removeItem('totalCoinReceived');
				var durationSec = parseInt(data.timeAdded) || 0;
				var durationMin = Math.floor(durationSec / 60);
				// Credit the PAID time: timeAdded is the uptime the coins bought (the
				// same number the coin dialog shows). data.validity is how long the
				// voucher CODE stays usable - a different vendo rate column - so
				// sending it as durationMinutes credited whatever the operator had
				// typed there (a "10 peso / 2hour" rate with validity 4320 handed out
				// 3 days). Only fall back to it if the vendo sent no time at all.
				var creditMin = durationMin > 0 ? durationMin : (parseInt(data.validity) || 0);

					// If extend mode and already connected: HIT-LESS top-up.
				// Never kick, never redirect, never re-login — that chain is what
				// stranded the device in the captive loop. coin-auth stacks
				// expiry_at AND pushes a RADIUS CoA Session-Timeout so the live
				// MikroTik Active entry shows the new time in place. Portal side:
				// just refresh the countdown from check-session.
				if (isExtendMode && isConnected) {
					fetch(window.location.origin + '/api/vouchers/coin-auth', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ mac: macNoColon, durationMinutes: creditMin, routerId: routerId, extend: true }),
					}).then(function(r) { return r.json(); })
					.then(function(result) {
						hideModal('coinModal');
						saveBtn.textContent = 'SAVE';
						if (result && result.error) {
							alert('Could not add time: ' + result.error);
							return;
						}
						refreshSessionAfterExtend();
						alert('Time extended! Your session stays connected — the added time applies automatically.');
					}).catch(function(err) {
						hideModal('coinModal');
						saveBtn.textContent = 'SAVE';
						refreshSessionAfterExtend();
						alert('Time extended! Your session stays connected — the added time applies automatically.');
					});
				} else {
					// Initial login flow — call coin-auth then show connected state
					fetch(window.location.origin + '/api/vouchers/coin-auth', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ mac: macNoColon, durationMinutes: creditMin, routerId: routerId }),
					}).then(function(r) { return r.json(); })
					.then(function(result) {
						hideModal('coinModal');
						saveBtn.textContent = 'SAVE';
						if (result && result.error) {
							alert('Could not add time: ' + result.error);
							return;
						}
						// Prefer the server's stacked total (remaining + new) over just this coin.
						var totalSec = (result && result.remainingSeconds) ? result.remainingSeconds : durationSec;
						showConnectedState(totalSec);
						// Submit login to MikroTik in background (via iframe)
						document.getElementById('voucherInput').value = macNoColon;
						setTimeout(function() { doLogin(); }, 500);
						setTimeout(function() { syncSessionTime(); }, 2500);
					}).catch(function(err) {
						hideModal('coinModal');
						saveBtn.textContent = 'SAVE';
						showConnectedState(durationSec);
						document.getElementById('voucherInput').value = macNoColon;
						setTimeout(function() { doLogin(); }, 500);
					});
				}
			} else {
				saveBtn.disabled = false;
				saveBtn.textContent = 'SAVE';
				alert(errorMsg(data.errorCode));
			}
		})
		.catch(function(err) {
			saveBtn.disabled = false;
			saveBtn.textContent = 'SAVE';
			if (totalCoinReceived > 0) {
				alert('Vendo communication failed, but coins processed. Voucher: ' + voucher);
				hideModal('coinModal');
				if (isExtendMode && isConnected) {
					refreshSessionAfterExtend();
				} else {
					document.getElementById('voucherInput').value = macNoColon;
					setTimeout(function() { doLogin(); }, 1000);
				}
			} else {
				alert('Failed to save voucher. Please try again.');
			}
		});
}

function refreshSessionAfterExtend() {
	// Re-check session to get updated remaining time
	if (!mac || !routerId) return;
	fetch('/api/portal/check-session?mac=' + encodeURIComponent(mac) + '&routerId=' + encodeURIComponent(routerId))
		.then(function(r) { return r.json(); })
		.then(function(data) {
			if (data && data.paused && data.remainingSeconds > 0) {
				showPausedState(data.remainingSeconds);
				return;
			}
			if (data.hasSession && data.remainingSeconds > 0) {
				remainingSeconds = Math.max(0, Math.floor(data.remainingSeconds));
				sessionExpiresAt = Date.now() + remainingSeconds * 1000;
				if (isPaused) {
					// A top-up while paused unpauses the account server-side.
					showConnectedState(remainingSeconds);
				} else {
					updateCountdownDisplay();
				}
			}
		})
		.catch(function() {});
}

// ---- ONLINE PAYMENT (PAY GCASH via PayMongo) ----
function loadPaymentConfig() {
	fetch('/api/payments/config')
		.then(function(r) { return r.json(); })
		.then(function(cfg) {
			if (!cfg || !cfg.enabled) return;
			payCurrency = cfg.currency || 'PHP';
			payRates = (cfg.rates && cfg.rates.length)
				? cfg.rates
				: (cfg.amount > 0 ? [{ id: 0, label: cfg.description || 'Internet Time', amount: cfg.amount, minutes: cfg.minutes }] : []);
			if (!payRates.length) return;
			// Show on BOTH the disconnected and the connected panel, so time can be
			// added online even while the device already has a session.
			['payGcashBtn', 'payGcashBtnConnected'].forEach(function(id) {
				var b = document.getElementById(id);
				if (b) { b.style.display = ''; b.textContent = (cfg.button_label || 'PAY GCASH').toUpperCase(); }
			});
		})
		.catch(function() {});
}

function showPayRates() {
	// Pick the rates panel of whichever state is currently visible.
	var disc = document.getElementById('disconnectedPanel');
	var conn = document.getElementById('connectedPanel');
	var panel = null;
	if (conn && conn.style.display !== 'none') panel = document.getElementById('payRatesPanelConnected');
	if (!panel && disc && disc.style.display !== 'none') panel = document.getElementById('payRatesPanel');
	if (!panel) panel = document.getElementById('payRatesPanel') || document.getElementById('payRatesPanelConnected');
	if (!panel) return;
	if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
	if (!payRates.length) { alert('Online payment is not available right now.'); return; }
	var html = '<div style="font-weight:bold;color:#333;margin-bottom:8px;">Choose an amount to pay</div>';
	payRates.forEach(function(r) {
		html += '<button type="button" class="btn portal-btn mb-2" style="display:block;width:100%;background:linear-gradient(135deg, #007dfe, #0057e7);color:#fff;" onclick="payOnline(' + r.id + '); return false;">' +
			payCurrency + ' ' + r.amount + ' → ' + r.minutes + ' min' + (r.label ? ' (' + r.label + ')' : '') + '</button>';
	});
	panel.innerHTML = html;
	panel.style.display = '';
}

function verifyPayment(reference, attempt) {
	attempt = attempt || 0;
	fetch('/api/payments/verify', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ reference: reference }),
	})
		.then(function(r) { return r.json(); })
		.then(function(d) {
			if (d && d.ok) {
				alert('Payment received! ' + (d.minutes || '') + ' minutes credited.');
				// The device may still be in the captive (unauthenticated) state, so log
				// it in exactly like the coin flow does - otherwise the paid time never
				// reaches the router and the phone stays unauthenticated.
				if (!isConnected) {
					setTimeout(function() { doLogin(); }, 400);
				}
				syncSessionTime();
				setTimeout(function() { syncSessionTime(); }, 5000);
				setTimeout(function() { syncSessionTime(); }, 12000);
			} else if (attempt < 5) {
				// PayMongo may still be settling; re-verify a few times.
				setTimeout(function() { verifyPayment(reference, attempt + 1); }, 4000);
			} else {
				alert('Payment is still being confirmed. Please refresh the page in a moment.');
			}
		})
		.catch(function() {
			if (attempt < 5) setTimeout(function() { verifyPayment(reference, attempt + 1); }, 4000);
			else alert('Payment is still being confirmed. Please refresh the page in a moment.');
		});
}

function payOnline(rateId) {
	if (!mac) { alert('Missing device MAC.'); return; }
	fetch('/api/payments/checkout', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ mac: mac, routerId: routerId, rateId: rateId }),
	})
		.then(function(r) { return r.json(); })
		.then(function(d) {
			if (d && d.checkoutUrl) { window.location.href = d.checkoutUrl; }
			else { alert('Payment error: ' + ((d && d.error) || 'unknown')); }
		})
		.catch(function() { alert('Payment request failed. Please try again.'); });
}

// ---- PROMO RATES ----
// An AirCoins box serves no page: the panel holds its rate ladder and is the
// one that prices the coins, so the quote has to come from there. A JuanFi
// vendo still answers /getRates itself, exactly as before.
function loadAirCoinsPromoRates(list) {
	var url = window.location.origin + '/api/portal/coins/rates?deviceId=' + airCoinsDevice();
	if (ip) url += '&ip=' + encodeURIComponent(ip);
	if (routerId) url += '&routerId=' + encodeURIComponent(routerId);
	fetch(url, { cache: 'no-store' })
		.then(function(r) { return r.json(); })
		.then(function(data) {
			// The panel refuses a machine that does not serve this phone's network.
			// Say so plainly: an empty rate list looks like a broken promo page.
			if (data && data.error && !data.rates) {
				list.innerHTML = '';
				var refusal = document.createElement('div');
				refusal.style.cssText = 'text-align:center;color:#f44336;padding:12px;';
				refusal.textContent = data.error;
				list.appendChild(refusal);
				return;
			}
			var rates = (data && data.rates) || [];
			var html = '';
			rates.forEach(function(rate) {
				if (!rate) return;
				html += '<div style="background:#f5f5f5;border-radius:10px;padding:12px;margin-bottom:8px;">';
				html += '<div style="font-weight:bold;color:#333;">' + (rate.name || '') + '</div>';
				html += '<div style="color:#888;font-size:13px;">Time: ' + secondsToDhms(parseInt(rate.minutes || '0') * 60) + '</div>';
				html += '<div style="color:#888;font-size:13px;">Data: unlimited</div>';
				html += '</div>';
			});
			list.innerHTML = html || '<div style="text-align:center;color:#999;">No rates</div>';
		})
		.catch(function() { list.innerHTML = '<div style="text-align:center;color:#f44336;">Failed to load rates</div>'; });
}

function loadPromoRates() {
	var list = document.getElementById('promoRatesList');
	list.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">Loading...</div>';
	if (airCoinsDevice() > 0) {
		loadAirCoinsPromoRates(list);
		return;
	}
	nodeMcuGet('/getRates?rateType=1&date=' + Date.now())
		.then(function(data) {
			var rows = data.split('|');
			var html = '';
			rows.forEach(function(row) {
				if (!row) return;
				var cols = row.split('#');
				html += '<div style="background:#f5f5f5;border-radius:10px;padding:12px;margin-bottom:8px;">';
				html += '<div style="font-weight:bold;color:#333;">' + (cols[0] || '') + '</div>';
				// Show the time the rate BUYS (cols[2], minutes). cols[3] is the
				// voucher-code validity, not session time, and on a misconfigured rate
				// it reads like a 3-day balance next to a "2hour" title.
				html += '<div style="color:#888;font-size:13px;">Time: ' + secondsToDhms(parseInt(cols[2] || '0') * 60) + '</div>';
				if (cols[4]) html += '<div style="color:#888;font-size:13px;">Data: ' + cols[4] + ' MB</div>';
				else html += '<div style="color:#888;font-size:13px;">Data: unlimited</div>';
				html += '</div>';
			});
			list.innerHTML = html || '<div style="text-align:center;color:#999;">No rates</div>';
		})
		.catch(function() { list.innerHTML = '<div style="text-align:center;color:#f44336;">Failed to load rates</div>'; });
}

// ---- CHARGING STATION ----
function loadChargingStations() {
	var list = document.getElementById('chargingList');
	list.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">Loading...</div>';
	nodeMcuGet('/getChargingStation?date=' + Date.now())
		.then(function(data) {
			var rows = data.split('|');
			var html = '';
			rows.forEach(function(row) {
				if (!row) return;
				var cols = row.split('#');
				html += '<div style="background:#f5f5f5;border-radius:10px;padding:12px;margin-bottom:8px;">';
				html += '<div style="font-weight:bold;color:#333;">Port: ' + (cols[0] || '') + '</div>';
				html += '<div style="color:#888;font-size:13px;">Status: Available</div>';
				html += '</div>';
			});
			list.innerHTML = html || '<div style="text-align:center;color:#999;">No charging stations</div>';
		})
		.catch(function() { list.innerHTML = '<div style="text-align:center;color:#f44336;">Failed to load</div>'; });
}
