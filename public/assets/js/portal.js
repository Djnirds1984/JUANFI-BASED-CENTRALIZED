// JuanFi Portal - Core JavaScript
// This file handles the captive portal login flow for the centralized panel

// ---- Configuration ----
// For centralized system, always use MAC as voucher code
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

// ---- Initialize on DOM load ----
document.addEventListener('DOMContentLoaded', function() {
	document.getElementById('ip-display').textContent = ip || '-';
	document.getElementById('mac-display').textContent = mac || '-';
	document.sendin.action = linkLoginOnly;
	
	setupEventListeners();
	loadVendoConfig();
	checkAndRestoreSession();
});

// ---- Event Listeners ----
function setupEventListeners() {
	document.getElementById('connectBtn').addEventListener('click', function() { doLogin(); });
	document.getElementById('voucherInput').addEventListener('keypress', function(e) {
		if (e.key === 'Enter') doLogin();
	});
	document.getElementById('insertBtn').addEventListener('click', function() { insertBtnAction(); });
	document.getElementById('promoRateBtn').addEventListener('click', function() { showModal('promoModal'); loadPromoRates(); });
	document.getElementById('promoCloseBtn').addEventListener('click', function() { hideModal('promoModal'); });
	document.getElementById('chargingBtn').addEventListener('click', function() { showModal('chargingModal'); loadChargingStations(); });
	document.getElementById('chargingCloseBtn').addEventListener('click', function() { hideModal('chargingModal'); });
	document.getElementById('eloadBtn').addEventListener('click', function() { showModal('eloadModal'); });
	document.getElementById('eloadCloseBtn').addEventListener('click', function() { hideModal('eloadModal'); });
	
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
	
	['promoModal', 'chargingModal', 'eloadModal'].forEach(function(id) {
		document.getElementById(id).addEventListener('click', function(e) {
			if (e.target === this) hideModal(id);
		});
	});
}

// ---- Vendo Config ----
function loadVendoConfig() {
	fetch('/api/portal/vendo-config')
		.then(function(r) { return r.json(); })
		.then(function(cfg) {
			vendoConfig = cfg;
			vendorIpAddress = cfg.vendorIpAddress || '';
			var sel = document.getElementById('vendoSelected');
			var selDiv = document.getElementById('vendoSelectDiv');
			
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
			updateActionButtons();
		})
		.catch(function(e) { console.error('Failed to load vendo config:', e); });
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
	
	// When macAsVoucherCode is true and input is empty, use MAC
	if (macAsVoucherCode && vc === '') {
		var macNoColon = replaceAll(mac, ':');
		document.getElementById('voucherInput').value = macNoColon;
		vc = macNoColon;
	}
	
	if (!vc) { alert('Please enter a voucher code'); return false; }
	
	document.sendin.username.value = vc;
	document.sendin.password.value = hexMD5(chapId + vc + chapChallenge);
	document.sendin.dst.value = '/status';
	document.sendin.submit();
	return false;
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
	document.getElementById('coinModalTitle').textContent = 'Please insert the coin';
	
	nodeMcuPost('/topUp', postData)
		.then(function(resp) {
			document.getElementById('coinLoader').style.display = 'none';
			var data;
			try { data = JSON.parse(resp); } catch(e) { data = { status: 'false', errorCode: 'coin.slot.notavailable' }; }
			if (data.status === 'true') {
				voucher = data.voucher;
				// Hide the generated voucher code since we use MAC as voucher
				document.getElementById('coinCodeBlock').style.display = 'none';
				if (vendoConfig && vendoConfig.isMultiVendo) {
					var sel = document.getElementById('vendoSelected');
					if (sel.selectedIndex >= 0) {
						document.getElementById('coinModalTitle').textContent = 'Please insert the coin on ' + sel.options[sel.selectedIndex].text;
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
				// Hide voucher code display since we use MAC
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
					// Hide voucher code display
					document.getElementById('coinCodeBlock').style.display = 'none';
				}
				if (remainTime === 0) {
					hideModal('coinModal');
					if (coinTimer) { clearInterval(coinTimer); coinTimer = null; }
					if (totalCoinReceived > 0) {
						alert('Coin slot expired! But processed ' + totalCoinReceived + ' coin(s). Auto-login shortly.');
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
				console.log('[saveVoucher] Calling coin-auth with mac=' + macNoColon + ', duration=' + data.validity + ', routerId=' + routerId);
				fetch(window.location.origin + '/api/vouchers/coin-auth', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ mac: macNoColon, durationMinutes: data.validity || 0, routerId: routerId }),
				}).then(function(r) {
					console.log('[saveVoucher] coin-auth response status:', r.status);
					return r.json();
				}).then(function(result) {
					console.log('[saveVoucher] coin-auth result:', result);
					hideModal('coinModal');
					saveBtn.textContent = 'SAVE';
					// Use MAC as voucher code for login
					document.getElementById('voucherInput').value = macNoColon;
					setTimeout(function() { doLogin(); }, 500);
				}).catch(function(err) {
					console.error('[saveVoucher] coin-auth error:', err);
					hideModal('coinModal');
					saveBtn.textContent = 'SAVE';
					// Use MAC as voucher code for login
					document.getElementById('voucherInput').value = macNoColon;
					setTimeout(function() { doLogin(); }, 500);
				});
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
				// Use MAC as voucher code for login
				document.getElementById('voucherInput').value = macNoColon;
				setTimeout(function() { doLogin(); }, 1000);
			} else {
				alert('Failed to save voucher. Please try again.');
			}
		});
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

// ---- Restore session on load ----
function checkAndRestoreSession() {
	if (!mac || !routerId) return;
	fetch('/api/portal/check-session?mac=' + encodeURIComponent(mac) + '&routerId=' + encodeURIComponent(routerId))
		.then(function(r) { return r.json(); })
		.then(function(data) {
			if (data.hasSession && data.remainingSeconds > 0) {
				// Auto-login with MAC as username
				document.getElementById('voucherInput').value = data.username;
				setTimeout(function() { doLogin(); }, 500);
			}
		})
		.catch(function(e) { console.error('Session check failed:', e); });
}
