// JuanFi Portal - Core JavaScript
// Self-contained portal with disconnected/connected states

// ---- Configuration ----
var macAsVoucherCode = true;

// ---- CHAP parameters from URL ----
var params = new URLSearchParams(window.location.search);
var mac = params.get('mac') || '';
var ip = params.get('ip') || '';
var chapId = params.get('chap-id') || '';
var chapChallenge = params.get('chap-challenge') || '';
var linkLoginOnly = params.get('link-login-only') || '';
var linkStatus = params.get('link-status') || '/status';
var routerId = params.get('router-id') || '';

// ---- Vendo config ----
var vendoConfig = null;
var vendorIpAddress = '';
var voucher = '';
var totalCoinReceived = 0;
var coinTimer = null;
var topupMode = 'INTERNET';

// ---- Session state ----
var isConnected = false;
var remainingSeconds = 0;
var countdownTimer = null;
var sessionExpiresAt = null;
var isExtendMode = false;

// ---- Initialize on DOM load ----
document.addEventListener('DOMContentLoaded', function() {
	document.getElementById('ip-display').textContent = ip || '-';
	document.getElementById('mac-display').textContent = mac || '-';
	document.sendin.action = linkLoginOnly;

	setupEventListeners();
	loadVendoConfig();
	checkSessionState();
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
	document.getElementById('eloadCloseBtn').addEventListener('click', function() { hideModal('eloadModal'); });

	// Connected panel
	document.getElementById('extendBtn').addEventListener('click', function() {
		isExtendMode = true;
		insertBtnAction();
	});
	document.getElementById('connectedPromoRateBtn').addEventListener('click', function() { showModal('promoModal'); loadPromoRates(); });
	document.getElementById('pauseTimeBtn').addEventListener('click', function() { alert('Pause time feature coming soon.'); });
	document.getElementById('logoutBtn').addEventListener('click', function() { doLogout(); });

	// Coin modal
	document.getElementById('coinSaveBtn').addEventListener('click', function() {
		this.disabled = true;
		saveVoucherAndLogin();
	});
	document.getElementById('coinCancelBtn').addEventListener('click', function() {
		if (coinTimer) { clearInterval(coinTimer); coinTimer = null; }
		hideModal('coinModal');
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
	stopCountdown();
	document.getElementById('disconnectedPanel').style.display = '';
	document.getElementById('connectedPanel').style.display = 'none';
	document.getElementById('statusBadge').style.background = 'rgba(239, 68, 68, 0.1)';
	document.getElementById('statusBadge').style.color = '#ef4444';
	document.getElementById('statusBadge').style.borderColor = 'rgba(239, 68, 68, 0.2)';
	document.getElementById('statusText').textContent = 'Disconnected';
	document.getElementById('statusText').className = 'blinking1 text-danger font-weight-bold';
}

function showConnectedState(remaining) {
	isConnected = true;
	remainingSeconds = Math.max(0, Math.floor(remaining));
	sessionExpiresAt = Date.now() + remainingSeconds * 1000;

	document.getElementById('disconnectedPanel').style.display = 'none';
	document.getElementById('connectedPanel').style.display = '';
	document.getElementById('statusBadge').style.background = 'rgba(16, 185, 129, 0.1)';
	document.getElementById('statusBadge').style.color = '#10b981';
	document.getElementById('statusBadge').style.borderColor = 'rgba(16, 185, 129, 0.2)';
	document.getElementById('statusText').textContent = 'Connected';
	document.getElementById('statusText').className = 'blinking2 text-success font-weight-bold';

	updateCountdownDisplay();
	startCountdown();
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
			if (data.hasSession && data.remainingSeconds > 0) {
				showConnectedState(data.remainingSeconds);
			} else {
				showDisconnectedState();
			}
		})
		.catch(function(e) {
			console.error('Session check failed:', e);
			showDisconnectedState();
		});
}

// ---- Vendo Config ----
function loadVendoConfig() {
	fetch('/api/portal/vendo-config')
		.then(function(r) { return r.json(); })
		.then(function(cfg) {
			vendoConfig = cfg;
			vendorIpAddress = cfg.vendorIpAddress || '';
			populateVendoSelect('vendoSelected', 'vendoSelectDiv', cfg);
			populateVendoSelect('connectedVendoSelected', 'connectedVendoSelectDiv', cfg);
			updateActionButtons();
		})
		.catch(function(e) { console.error('Failed to load vendo config:', e); });
}

function populateVendoSelect(selectId, divId, cfg) {
	var sel = document.getElementById(selectId);
	var selDiv = document.getElementById(divId);

	if (cfg.isMultiVendo && cfg.multiVendoAddresses.length > 0) {
		if (cfg.multiVendoOption === 0) {
			selDiv.style.display = '';
			sel.innerHTML = '';
			cfg.multiVendoAddresses.forEach(function(v) {
				var opt = document.createElement('option');
				opt.value = v.vendoIp;
				opt.textContent = v.vendoName;
				sel.appendChild(opt);
			});
			var stored = localStorage.getItem('selectedVendo');
			if (stored) { sel.value = stored; vendorIpAddress = stored; }
			sel.addEventListener('change', function() {
				vendorIpAddress = sel.value;
				localStorage.setItem('selectedVendo', vendorIpAddress);
				syncVendoSelect(selectId);
				updateActionButtons();
			});
		} else {
			selDiv.style.display = 'none';
			cfg.multiVendoAddresses.forEach(function(v) {
				vendorIpAddress = v.vendoIp;
			});
		}
	} else {
		selDiv.style.display = 'none';
	}
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

function showModal(id) { document.getElementById(id).style.display = 'flex'; }
function hideModal(id) { document.getElementById(id).style.display = 'none'; }

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

var errorCodeMap = {
	'coins.wait.expired': 'Coin slot expired',
	'coin.not.inserted': 'Coin not inserted',
	'coinslot.cancelled': 'Coin slot was cancelled',
	'coinslot.busy': 'Coin slot is busy',
	'coin.slot.banned': 'Banned from coin slot',
	'coin.slot.notavailable': 'Coin slot not available',
	'no.internet.detected': 'No internet connection',
	'product.hash.invalid': 'Product hash invalid',
	'convertVoucher.empty': 'Please enter voucher code',
	'convertVoucher.invalid': 'Invalid voucher code',
	'load.not.enough': 'Insufficient load',
	'eload.failed': 'E-load failed',
};
function errorMsg(code) { return errorCodeMap[code] || code || 'Unknown error'; }

// ---- Login ----
function doLogin() {
	var vc = document.getElementById('voucherInput').value.trim();

	if (macAsVoucherCode && vc === '') {
		var macNoColon = replaceAll(mac, ':');
		document.getElementById('voucherInput').value = macNoColon;
		vc = macNoColon;
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
	document.sendin.password.value = hexMD5(chapId + vc + chapChallenge);
	document.sendin.dst.value = linkStatus;
	// Submit to hidden iframe so portal page stays put — no redirect to status.html
	document.sendin.target = 'loginFrame';
	document.sendin.submit();
	return false;
}

// ---- Logout ----
function doLogout() {
	if (!confirm('Are you sure you want to logout?')) return;
	stopCountdown();
	// Submit MikroTik logout
	var form = document.createElement('form');
	form.method = 'POST';
	form.action = '/logout';
	var input = document.createElement('input');
	input.type = 'hidden';
	input.name = 'erase-cookie';
	input.value = 'true';
	form.appendChild(input);
	document.body.appendChild(form);
	form.submit();
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

	var storedVoucher = localStorage.getItem('activeVoucher') || '';
	var postData = 'voucher=' + storedVoucher + '&mac=' + mac;

	showModal('coinModal');
	document.getElementById('coinModalTitle').textContent = isExtendMode
		? 'Insert coin to extend time'
		: 'Please insert the coin';

	nodeMcuPost('/topUp', postData)
		.then(function(resp) {
			document.getElementById('coinLoader').style.display = 'none';
			var data;
			try { data = JSON.parse(resp); } catch(e) { data = { status: 'false', errorCode: 'coin.slot.notavailable' }; }
			if (data.status === 'true') {
				voucher = data.voucher;
				document.getElementById('coinCodeBlock').style.display = 'none';
				if (vendoConfig && vendoConfig.isMultiVendo) {
					var sel = document.getElementById(isConnected ? 'connectedVendoSelected' : 'vendoSelected');
					if (sel.selectedIndex >= 0) {
						document.getElementById('coinModalTitle').textContent =
							(isExtendMode ? 'Extend time on ' : 'Insert coin on ') + sel.options[sel.selectedIndex].text;
					}
				}
				if (!coinTimer) coinTimer = setInterval(checkCoin, 1000);
			} else {
				alert(errorMsg(data.errorCode));
				hideModal('coinModal');
			}
		})
		.catch(function() {
			document.getElementById('coinLoader').style.display = 'none';
			alert('Coin slot is not available as of the moment, Please try again later');
			hideModal('coinModal');
		});
}

function checkCoin() {
	nodeMcuPost('/checkCoin', 'voucher=' + voucher)
		.then(function(resp) {
			var data;
			try { data = JSON.parse(resp); } catch(e) { return; }
			document.getElementById('coinNotice').style.display = 'none';

			if (data.status === 'true') {
				totalCoinReceived = parseInt(data.totalCoin) || 0;
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
		.catch(function() { console.error('checkCoin error'); });
}

function saveVoucherAndLogin() {
	if (coinTimer) { clearInterval(coinTimer); coinTimer = null; }
	var macNoColon = replaceAll(mac, ':');
	
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
				var durationMin = data.timeAdded || data.validity || 0;
				var validityMin = data.validity || durationMin;

				// If extend mode and already connected, just call coin-auth with extend flag
				if (isExtendMode && isConnected) {
					console.log('[saveVoucher] Extend mode — calling coin-auth with extend=true, duration=' + durationMin);
					fetch(window.location.origin + '/api/vouchers/coin-auth', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ mac: macNoColon, durationMinutes: durationMin, routerId: routerId, extend: true }),
					}).then(function(r) { return r.json(); })
					.then(function(result) {
						console.log('[saveVoucher] coin-auth extend result:', result);
						hideModal('coinModal');
						saveBtn.textContent = 'SAVE';
						// Refresh session state from server
						refreshSessionAfterExtend();
					}).catch(function(err) {
						console.error('[saveVoucher] coin-auth extend error:', err);
						hideModal('coinModal');
						saveBtn.textContent = 'SAVE';
						refreshSessionAfterExtend();
					});
				} else {
					// Initial login flow — call coin-auth then show connected state
					console.log('[saveVoucher] Initial login — calling coin-auth with mac=' + macNoColon + ', duration=' + durationMin);
					fetch(window.location.origin + '/api/vouchers/coin-auth', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ mac: macNoColon, durationMinutes: durationMin, routerId: routerId }),
					}).then(function(r) { return r.json(); })
					.then(function(result) {
						console.log('[saveVoucher] coin-auth result:', result);
						hideModal('coinModal');
						saveBtn.textContent = 'SAVE';
						// Use validity for expiration calculation (matches MikroTik portal behavior)
						showConnectedState(validityMin * 60);
						// Submit login to MikroTik in background (via iframe)
						document.getElementById('voucherInput').value = macNoColon;
						setTimeout(function() { doLogin(); }, 500);
					}).catch(function(err) {
						console.error('[saveVoucher] coin-auth error:', err);
						hideModal('coinModal');
						saveBtn.textContent = 'SAVE';
						// Still show connected state even if coin-auth fails
						showConnectedState(validityMin * 60);
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
			console.error('[saveVoucher] useVoucher error:', err);
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
			if (data.hasSession && data.remainingSeconds > 0) {
				remainingSeconds = Math.max(0, Math.floor(data.remainingSeconds));
				sessionExpiresAt = Date.now() + remainingSeconds * 1000;
				updateCountdownDisplay();
			}
		})
		.catch(function(e) { console.error('Session refresh failed:', e); });
}

// ---- PROMO RATES ----
function loadPromoRates() {
	var list = document.getElementById('promoRatesList');
	list.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">Loading...</div>';
	nodeMcuGet('/getRates?rateType=1&date=' + Date.now())
		.then(function(data) {
			var rows = data.split('|');
			var html = '';
			rows.forEach(function(row) {
				if (!row) return;
				var cols = row.split('#');
				html += '<div style="background:#f5f5f5;border-radius:10px;padding:12px;margin-bottom:8px;">';
				html += '<div style="font-weight:bold;color:#333;">' + (cols[0] || '') + '</div>';
				html += '<div style="color:#888;font-size:13px;">Validity: ' + secondsToDhms(parseInt(cols[3] || '0') * 60) + '</div>';
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
