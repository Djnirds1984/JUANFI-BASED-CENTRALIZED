// JuanFi Portal - Customer wallet
//
// Money in (coins), time out (this device). Every amount that ends up in the
// balance is read by the CONTROLLER from the coin machine, never typed by the
// phone, so this file only ever asks the panel to settle a session - it never
// reports a coin total.
//
// Talks to /api/wallet on this same origin, which is important: a captive
// customer can reach the controller and nothing else, so the wallet has to work
// with no internet at all. Only the coin machine handshake goes directly from
// the browser to the machine (http://<vendo-ip>), exactly like INSERT COIN does.

var WALLET_TOKEN_KEY = 'juanfi_wallet_token';

var wallet = {
	token: '',
	account: null,
	config: null,
	machines: [],
	view: 'signin',
	historyOpen: false,
};

// Coin session state (independent of the INSERT COIN flow in portal.js so the
// two can never hand each other a wrong voucher code).
var wcoin = { code: '', ip: '', name: '', deviceId: 0, timer: null, total: 0, busy: false };

// ---- tiny helpers ----
function wEl(id) { return document.getElementById(id); }

function wMoney(value) {
	var n = Number(value);
	if (!isFinite(n)) n = 0;
	return '\u20b1' + n.toFixed(2);
}

function wEsc(text) {
	return String(text === undefined || text === null ? '' : text)
		.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// The portal's device identity, shared with portal.js.
function wMac() { return (typeof mac !== 'undefined' && mac) ? mac : ''; }
function wRouterId() { return (typeof routerId !== 'undefined' && routerId) ? routerId : ''; }

function wShow(view) {
	wallet.view = view;
	['signin', 'register', 'forgot', 'reset', 'home'].forEach(function (name) {
		var el = wEl('wView' + name.charAt(0).toUpperCase() + name.slice(1));
		if (el) el.style.display = (name === view) ? '' : 'none';
	});
}

function wOpenModal(view) {
	var el = wEl('walletModal');
	if (!el) return;
	el.style.display = 'flex';
	if (view) wShow(view);
	if (view === 'home' || !view) walletRefresh();
}

function wCloseModal() {
	var el = wEl('walletModal');
	if (el) el.style.display = 'none';
}

function wStatus(text, color) {
	var el = wEl('wStatus');
	if (!el) return;
	el.textContent = text || '';
	el.style.color = color || '#475569';
}

// ---- api ----
function wApi(path, method, body, auth) {
	var headers = { 'Content-Type': 'application/json' };
	if (auth !== false && wallet.token) headers.Authorization = 'Bearer ' + wallet.token;
	return fetch('/api/wallet' + path, {
		method: method || 'GET',
		headers: headers,
		body: body ? JSON.stringify(body) : undefined,
	}).then(function (r) {
		return r.json().catch(function () { return {}; }).then(function (d) {
			return { ok: r.ok, status: r.status, data: d || {} };
		});
	});
}

// Unauthenticated calls answer 401 when the stored token went stale (frozen
// account, password change, server restart with a new secret). Sign the device
// out locally instead of showing a wall of errors.
function wHandleAuthLoss(res) {
	if (res.status === 401 && wallet.token) {
		wallet.token = '';
		wallet.account = null;
		try { localStorage.removeItem(WALLET_TOKEN_KEY); } catch (e) {}
		wOpenModal('signin');
		wStatus(res.data && res.data.error ? res.data.error : 'Session expired, please sign in again', '#dc2626');
		return true;
	}
	return false;
}

// ---- boot ----
document.addEventListener('DOMContentLoaded', function () {
	var stored = '';
	try { stored = localStorage.getItem(WALLET_TOKEN_KEY) || ''; } catch (e) {}
	wallet.token = stored;

	wApi('/config', 'GET', null, false).then(function (res) {
		if (res.ok && res.data) {
			wallet.config = res.data;
			var btn = wEl('walletBtn');
			var btn2 = wEl('walletBtnConnected');
			var hidden = !res.data.enabled;
			if (btn) btn.style.display = hidden ? 'none' : '';
			if (btn2) btn2.style.display = hidden ? 'none' : '';
		}
		if (wallet.token) walletRefresh();
	});

	wireWalletButtons();
});

function wireWalletButtons() {
	// The view switches are <a href="#"> so they look like links on the small
	// portal; without stopping the default the browser jumps to the top of the
	// page (and the captive webview sometimes re-requests the portal) on a tap.
	var link = function (id, fn) {
		var el = wEl(id);
		if (!el) return;
		el.addEventListener('click', function (e) { e.preventDefault(); fn(); });
	};
	var open = function () { wOpenModal(wallet.account ? 'home' : 'signin'); };
	if (wEl('walletBtn')) wEl('walletBtn').addEventListener('click', open);
	if (wEl('walletBtnConnected')) wEl('walletBtnConnected').addEventListener('click', open);
	if (wEl('wCloseBtn')) wEl('wCloseBtn').addEventListener('click', wCloseModal);
	if (wEl('walletModal')) wEl('walletModal').addEventListener('click', function (e) {
		if (e.target === this) wCloseModal();
	});

	link('wToRegister', function () { wShow('register'); wStatus(''); });
	link('wToSignin', function () { wShow('signin'); wStatus(''); });
	link('wToSignin2', function () { wShow('signin'); wStatus(''); });
	link('wToForgot', function () { wShow('forgot'); wStatus(''); });
	link('wToReset', function () { wShow('reset'); wStatus(''); });
	link('wSignoutBtn', wSignout);
	if (wEl('wSigninBtn')) wEl('wSigninBtn').addEventListener('click', wSignin);
	if (wEl('wRegisterBtn')) wEl('wRegisterBtn').addEventListener('click', wRegister);
	if (wEl('wForgotBtn')) wEl('wForgotBtn').addEventListener('click', wForgot);
	if (wEl('wResetBtn')) wEl('wResetBtn').addEventListener('click', wReset);
	if (wEl('wLoadBtn')) wEl('wLoadBtn').addEventListener('click', wStartTopup);
	if (wEl('wHistoryBtn')) wEl('wHistoryBtn').addEventListener('click', wToggleHistory);
	if (wEl('wPinBtn')) wEl('wPinBtn').addEventListener('click', wSavePin);

	if (wEl('wcDoneBtn')) wEl('wcDoneBtn').addEventListener('click', function () { wClaim('manual'); });
	if (wEl('wcCancelBtn')) wEl('wcCancelBtn').addEventListener('click', wCancelTopup);
}

// ---- account ----
function wSignin() {
	var email = (wEl('wSigninEmail').value || '').trim();
	var password = wEl('wSigninPass').value || '';
	if (!email || !password) { wStatus('Enter your email and password', '#dc2626'); return; }
	wStatus('Signing in...');
	wApi('/login', 'POST', { email: email, password: password, mac: wMac(), routerId: wRouterId() }, false)
		.then(function (res) {
			if (!res.ok || !res.data.token) { wStatus(res.data.error || 'Sign in failed', '#dc2626'); return; }
			wSetToken(res.data.token);
			wallet.account = res.data.account;
			wStatus('');
			wOpenModal('home');
		});
}

function wRegister() {
	var body = {
		email: (wEl('wRegEmail').value || '').trim(),
		password: wEl('wRegPass').value || '',
		pin: (wEl('wRegPin').value || '').trim(),
		full_name: (wEl('wRegName').value || '').trim(),
		mobile: (wEl('wRegMobile').value || '').trim(),
		mac: wMac(),
		routerId: wRouterId(),
	};
	if (body.password !== (wEl('wRegPass2').value || '')) { wStatus('Passwords do not match', '#dc2626'); return; }
	if (body.pin && !/^\d{4}$/.test(body.pin)) { wStatus('PIN must be exactly 4 digits', '#dc2626'); return; }
	wStatus('Creating account...');
	wApi('/register', 'POST', body, false).then(function (res) {
		if (!res.ok) { wStatus(res.data.error || 'Registration failed', '#dc2626'); return; }
		wSetToken(res.data.token);
		wallet.account = res.data.account;
		if (wEl('wSigninEmail')) wEl('wSigninEmail').value = body.email;
		wStatus('');
		wOpenModal('home');
	});
}

function wForgot() {
	var email = (wEl('wForgotEmail').value || '').trim();
	if (!email) { wStatus('Enter the email of your wallet', '#dc2626'); return; }
	wStatus('Sending code...');
	wApi('/forgot', 'POST', { email: email, mac: wMac(), routerId: wRouterId() }, false).then(function (res) {
		wStatus((res.data && res.data.message) || 'Request received', '#059669');
		wShow('reset');
		if (wEl('wResetEmail')) wEl('wResetEmail').value = email;
	});
}

function wReset() {
	var body = {
		email: (wEl('wResetEmail').value || '').trim(),
		code: (wEl('wResetCode').value || '').trim(),
		password: wEl('wResetPass').value || '',
		mac: wMac(),
	};
	if (body.password !== (wEl('wResetPass2').value || '')) { wStatus('Passwords do not match', '#dc2626'); return; }
	wStatus('Changing password...');
	wApi('/reset', 'POST', body, false).then(function (res) {
		if (!res.ok) { wStatus(res.data.error || 'Could not restore the password', '#dc2626'); return; }
		wSetToken(res.data.token);
		wallet.account = res.data.account;
		wStatus('Password changed on this device', '#059669');
		wOpenModal('home');
	});
}

function wSetToken(token) {
	wallet.token = token || '';
	try {
		if (token) localStorage.setItem(WALLET_TOKEN_KEY, token);
		else localStorage.removeItem(WALLET_TOKEN_KEY);
	} catch (e) {}
}

// Signing out of the wallet never logs the customer out of the internet: those
// are different things and the session they are paying for must keep running.
function wSignout() {
	wSetToken('');
	wallet.account = null;
	wallet.historyOpen = false;
	wOpenModal('signin');
	wStatus('Signed out of your wallet', '#475569');
}

function walletRefresh() {
	wApi('/me').then(function (res) {
		if (wHandleAuthLoss(res)) return;
		if (!res.ok) {
			wStatus(res.data.error || 'Wallet is unavailable right now', '#dc2626');
			return;
		}
		wallet.account = res.data.account;
		if (res.data.rates) wallet.rates = res.data.rates;
		renderWalletHome(res.data);
	});
}

function renderWalletHome(me) {
	wShow('home');
	var acc = me.account || {};
	if (wEl('wName')) wEl('wName').textContent = acc.full_name || acc.email || '';
	if (wEl('wEmail')) wEl('wEmail').textContent = acc.email || '';
	if (wEl('wBalance')) wEl('wBalance').textContent = wMoney(acc.balance);

	var warn = wEl('wWarn');
	if (warn) {
		var msgs = [];
		if (me.verification_required) msgs.push('This account still needs confirmation - see an agent.');
		if (acc.status && acc.status !== 'active') msgs.push('This account is frozen. Please see an agent.');
		warn.textContent = msgs.join(' ');
		warn.style.display = msgs.length ? '' : 'none';
	}

	if (wEl('wPinHelp')) {
		wEl('wPinHelp').textContent = acc.has_pin
			? 'Enter your 4-digit PIN to buy time. Leave the box empty and press SAVE PIN to remove it.'
			: 'Optional: set a 4-digit PIN so a borrowed phone cannot spend your balance.';
	}
	if (wEl('wPinCurrent')) wEl('wPinCurrent').value = '';
	if (wEl('wPinNew')) wEl('wPinNew').value = '';

	renderWalletPackages();
	renderWalletPending(me.pending || []);
	if (wallet.historyOpen) loadWalletHistory();
	else if (wEl('wHistoryPanel')) wEl('wHistoryPanel').style.display = 'none';
}

function renderWalletPackages() {
	var box = wEl('wPackages');
	if (!box) return;
	var rates = wallet.rates || (wallet.config && wallet.config.rates) || [];
	if (!rates.length) {
		box.innerHTML = '<div style="padding:10px;color:#94a3b8;font-size:13px;">No time packages are configured yet.</div>';
		return;
	}
	var balance = Number((wallet.account && wallet.account.balance) || 0);
	box.innerHTML = rates.map(function (r) {
		var can = balance >= Number(r.amount);
		return '<div style="display:flex;align-items:center;justify-content:space-between;border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;margin-bottom:8px;">'
			+ '<div><div style="font-weight:600;color:#334155;font-size:14px;">' + wEsc(r.label) + '</div>'
			+ '<div style="font-size:12px;color:#64748b;">' + wMoney(r.amount) + ' &rarr; ' + Number(r.minutes) + ' minute(s)</div></div>'
			+ '<button data-rate="' + r.id + '" data-min="' + Number(r.minutes) + '" data-amt="' + Number(r.amount) + '"'
			+ (can ? '' : ' disabled') + ' class="wBuyBtn" style="min-width:78px;padding:8px 10px;border:none;border-radius:10px;font-weight:700;font-size:13px;color:#fff;cursor:pointer;background:'
			+ (can ? 'linear-gradient(135deg,#10b981,#059669)' : '#cbd5e1') + ';">' + (can ? 'BUY' : 'LOW') + '</button>'
			+ '</div>';
	}).join('');

	var buttons = box.querySelectorAll('.wBuyBtn');
	for (var i = 0; i < buttons.length; i++) {
		buttons[i].addEventListener('click', function () {
			wConvert(this.getAttribute('data-rate'), this.getAttribute('data-min'), this.getAttribute('data-amt'));
		});
	}
}

function renderWalletPending(pending) {
	var box = wEl('wPending');
	if (!box) return;
	if (!pending.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
	box.style.display = '';
	box.innerHTML = '<div style="font-size:12px;font-weight:700;color:#b45309;margin-bottom:6px;">UNCLAIMED COIN SESSIONS</div>'
		+ pending.map(function (p) {
			return '<div style="display:flex;align-items:center;justify-content:space-between;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:8px 10px;margin-bottom:6px;">'
				+ '<div style="font-size:12px;color:#78350f;">' + wEsc(p.device_name || 'coin machine')
				+ ' &middot; code ' + wEsc(p.code) + (Number(p.coins) > 0 ? ' &middot; ' + p.coins + ' coin(s) held' : '') + '</div>'
				+ '<button data-code="' + wEsc(p.code) + '" class="wClaimBtn" style="padding:6px 10px;border:none;border-radius:8px;font-weight:700;font-size:12px;color:#fff;background:#d97706;cursor:pointer;">CLAIM</button>'
				+ '</div>';
		}).join('');
	var btns = box.querySelectorAll('.wClaimBtn');
	for (var i = 0; i < btns.length; i++) {
		btns[i].addEventListener('click', function () {
			wClaimPending(this.getAttribute('data-code'));
		});
	}
}

function wToggleHistory() {
	wallet.historyOpen = !wallet.historyOpen;
	var panel = wEl('wHistoryPanel');
	if (!panel) return;
	panel.style.display = wallet.historyOpen ? '' : 'none';
	if (wallet.historyOpen) loadWalletHistory();
}

function loadWalletHistory() {
	var box = wEl('wHistoryList');
	if (!box) return;
	box.innerHTML = '<div style="padding:8px;color:#94a3b8;font-size:13px;">Loading...</div>';
	var kindNames = {
		coin_topup: 'Coins loaded',
		time_purchase: 'Time purchased',
		admin_credit: 'Added by staff',
		admin_debit: 'Removed by staff',
	};
	wApi('/transactions?limit=30').then(function (res) {
		if (wHandleAuthLoss(res)) return;
		var list = (res.data && res.data.transactions) || [];
		if (!list.length) {
			box.innerHTML = '<div style="padding:8px;color:#94a3b8;font-size:13px;">No wallet activity yet.</div>';
			return;
		}
		box.innerHTML = list.map(function (t) {
			var up = Number(t.amount) >= 0;
			return '<div style="display:flex;justify-content:space-between;border-bottom:1px solid #f1f5f9;padding:7px 2px;">'
				+ '<div><div style="font-size:13px;color:#334155;font-weight:600;">' + wEsc(kindNames[t.kind] || t.kind)
				+ (t.minutes ? ' &middot; ' + t.minutes + ' min' : '') + '</div>'
				+ '<div style="font-size:11px;color:#94a3b8;">' + wEsc(t.created_at) + (t.note ? ' &middot; ' + wEsc(t.note) : '') + '</div></div>'
				+ '<div style="text-align:right;"><div style="font-size:13px;font-weight:700;color:' + (up ? '#059669' : '#dc2626') + ';">'
				+ (up ? '+' : '-') + wMoney(Math.abs(Number(t.amount))) + '</div>'
				+ '<div style="font-size:11px;color:#94a3b8;">' + wMoney(t.balance) + '</div></div>'
				+ '</div>';
		}).join('');
	});
}

function wSavePin() {
	var pin = (wEl('wPinNew').value || '').trim();
	var current = wEl('wPinCurrent').value || '';
	if (pin && !/^\d{4}$/.test(pin)) { wStatus('PIN must be exactly 4 digits', '#dc2626'); return; }
	if (!current) { wStatus('Type your password to change the wallet PIN', '#dc2626'); return; }
	wApi('/pin', 'POST', { pin: pin, current: current }).then(function (res) {
		if (wHandleAuthLoss(res)) return;
		if (!res.ok) { wStatus(res.data.error || 'Could not save the PIN', '#dc2626'); return; }
		wStatus(pin ? 'Wallet PIN saved' : 'Wallet PIN removed', '#059669');
		walletRefresh();
	});
}

// ---- spend balance on time ----
function wConvert(rateId, minutes, amount) {
	if (!wMac()) { wStatus('This device could not be identified. Reload the portal.', '#dc2626'); return; }
	if (!confirm('Use ' + wMoney(amount) + ' for ' + minutes + ' minute(s) on this device?')) return;

	var acc = wallet.account || {};
	var needsPin = !!acc.has_pin;
	var pin = '';
	if (needsPin) {
		pin = (wEl('wBuyPin') && wEl('wBuyPin').value) || '';
		if (!/^\d{4}$/.test(pin)) { wStatus('Type your 4-digit wallet PIN, then press BUY again', '#dc2626'); return; }
	}

	wStatus('Buying time...');
	wApi('/convert', 'POST', { rateId: Number(rateId), pin: pin, mac: wMac(), routerId: wRouterId() })
		.then(function (res) {
			if (wHandleAuthLoss(res)) return;
			if (wEl('wBuyPin')) wEl('wBuyPin').value = '';
			if (!res.ok) { wStatus(res.data.error || 'Purchase failed', '#dc2626'); return; }
			wStatus('');
			if (wEl('wBalance')) wEl('wBalance').textContent = wMoney(res.data.balance);
			wTimeGranted(res.data);
			walletRefresh();
		});
}

// Time landed on this device's account. Bring the device online (or refresh the
// countdown if it already is), same finish line as the INSERT COIN flow.
function wTimeGranted(result) {
	var message = 'Loaded ' + result.minutes + ' minute(s). Balance ' + wMoney(result.balance) + '.';
	if (typeof isConnected !== 'undefined' && isConnected) {
		if (typeof refreshSessionAfterExtend === 'function') refreshSessionAfterExtend();
		if (typeof syncSessionTime === 'function') setTimeout(syncSessionTime, 2500);
		alert(message + ' Your remaining time was updated.');
		return;
	}
	if (typeof macVoucherCode === 'function' && typeof doLogin === 'function') {
		var input = wEl('voucherInput') || document.getElementById('voucherInput');
		if (input) input.value = macVoucherCode();
		alert(message + ' Connecting you now.');
		setTimeout(function () { doLogin(); }, 400);
		setTimeout(function () { if (typeof checkSessionState === 'function') checkSessionState(); }, 3500);
		return;
	}
	alert(message);
}

// ---- load balance with coins ----
function wStartTopup() {
	if (!wallet.account) { wOpenModal('signin'); wStatus('Sign in first, then your coins land in your wallet', '#dc2626'); return; }
	wApi('/machines', 'GET', null, false).then(function (res) {
		wallet.machines = (res.data && res.data.machines) || [];
		if (!wallet.machines.length) {
			wStatus('No coin machine is registered on the panel yet, so wallet loading is unavailable. Please see an agent.', '#dc2626');
			return;
		}
		wOpenCoinModal();
	});
}

function wOpenCoinModal() {
	var sel = wEl('wcMachine');
	if (sel) {
		var current = (typeof vendorIpAddress !== 'undefined') ? vendorIpAddress : '';
		sel.innerHTML = wallet.machines.map(function (m) {
			return '<option value="' + m.id + '" data-ip="' + wEsc(m.ip) + '"'
				+ (m.ip === current ? ' selected' : '') + '>' + wEsc(m.name || m.ip) + ' (' + wEsc(m.ip) + ')</option>';
		}).join('');
		sel.disabled = false;
	}
	var min = (wallet.config && wallet.config.min_topup) || 0;
	if (wEl('wcHint')) {
		wEl('wcHint').textContent = 'Coins go to your wallet balance, not to internet time. Insert at least '
			+ wMoney(min) + ' worth, then press DONE PAYING.';
	}
	if (wEl('wcTotal')) wEl('wcTotal').textContent = '0';
	if (wEl('wcValue')) wEl('wcValue').textContent = wMoney(0);
	if (wEl('wcRemain')) wEl('wcRemain').textContent = '';
	wSetCoinStatus('Starting the coin slot...');
	var accountModal = wEl('walletModal');
	if (accountModal) accountModal.style.display = 'none';
	if (wEl('walletCoinModal')) wEl('walletCoinModal').style.display = 'flex';
	if (typeof playCoinSound === 'function' && typeof insertCoinSound !== 'undefined') playCoinSound(insertCoinSound, true);
	wPrepareSession();
}

function wSetCoinStatus(text, color) {
	var el = wEl('wcStatus');
	if (el) { el.textContent = text || ''; el.style.color = color || '#475569'; }
}

// Ask the panel for a code, then hand that code to the machine. The code is the
// only thing linking these coins to this account, and the panel - not the phone
// - is the one that later asks the machine how many coins it holds.
function wPrepareSession() {
	var sel = wEl('wcMachine');
	var deviceId = sel ? Number(sel.value) : 0;
	var done = wEl('wcDoneBtn');
	if (done) done.disabled = true;

	wApi('/topup/start', 'POST', { deviceId: deviceId, mac: wMac(), routerId: wRouterId() })
		.then(function (res) {
			if (wHandleAuthLoss(res)) { wCloseCoinModal(); return; }
			if (!res.ok) {
				wSetCoinStatus(res.data.error || 'The coin slot could not be prepared', '#dc2626');
				setTimeout(wCloseCoinModal, 2500);
				return;
			}
			wcoin.code = res.data.code;
			wcoin.ip = res.data.device_ip;
			wcoin.name = res.data.device_name || '';
			wcoin.deviceId = deviceId;
			wcoin.total = 0;
			if (wEl('wcCode')) wEl('wcCode').textContent = res.data.code;
			// Locked while the code lives: switching machine mid-session would
			// leave the first machine holding coins nobody is polling for.
			if (sel) sel.disabled = true;
			wMachinePost('/topUp', 'voucher=' + encodeURIComponent(res.data.code) + '&mac=' + encodeURIComponent(wMac()))
				.then(function (data) {
					if (data && data.status === 'true') {
						wSetCoinStatus('Insert coins now', '#059669');
						if (!wcoin.timer) wcoin.timer = setInterval(wPollCoin, 1000);
						return;
					}
					wSetCoinStatus('Coin slot: ' + ((data && data.errorCode) === 'coinslot.busy'
						? 'another customer is using this machine. Wait for them or pick another machine.'
						: (data && data.errorCode) || 'not available'), '#dc2626');
					wcoin.code = '';
				})
				.catch(function () {
					wSetCoinStatus('Cannot reach that machine from here. Check you are on its wifi.', '#dc2626');
					wcoin.code = '';
				});
		});
}

function wMachinePost(path, body) {
	return fetch('http://' + wcoin.ip + path, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: body,
		mode: 'cors',
	}).then(function (r) { return r.text(); }).then(function (text) {
		try { return JSON.parse(text); } catch (e) { return { status: 'false', errorCode: 'machine.reply.unreadable' }; }
	});
}

function wPollCoin() {
	if (!wcoin.code || !wcoin.ip) return;
	wMachinePost('/checkCoin', 'voucher=' + encodeURIComponent(wcoin.code)).then(function (data) {
		if (!data) return;
		if (data.status === 'true') {
			wcoin.total = Number(data.totalCoin) || 0;
			wShowCoins(wcoin.total);
			wSetCoinStatus('Coin accepted - insert more or press DONE PAYING', '#059669');
			if (typeof playCoinSound === 'function' && typeof coinDropSound !== 'undefined') playCoinSound(coinDropSound, true);
			var done = wEl('wcDoneBtn');
			if (done) done.disabled = wcoin.total <= 0;
			return;
		}
		if (data.errorCode === 'coin.is.reading') {
			wSetCoinStatus('Reading coin...', '#475569');
			return;
		}
		if (data.errorCode === 'coin.not.inserted') {
			var total = Number(data.totalCoin) || 0;
			if (total !== wcoin.total) wShowCoins(total);
			wcoin.total = total;
			var remainMs = Number(data.remainTime) || 0;
			var remainSec = Math.max(0, Math.round(remainMs / 1000));
			if (wEl('wcRemain')) wEl('wcRemain').textContent = remainSec > 0 ? ('Coin slot closes in ' + remainSec + 's') : '';
			var done = wEl('wcDoneBtn');
			if (done) done.disabled = total <= 0;

			// The machine stops listening after its wait window and hands those
			// coins to a plain time account instead - which is not what a wallet
			// load is for. Claim a few seconds early so the money always arrives.
			if (remainMs <= 8000 && total > 0 && !wcoin.busy) {
				wSetCoinStatus('Slot closing - sending your coins to the wallet...', '#b45309');
				wClaim('auto');
			}
			return;
		}
		if (data.errorCode === 'coinslot.busy' || data.errorCode === 'coins.wait.expired') {
			if (wcoin.timer) { clearInterval(wcoin.timer); wcoin.timer = null; }
			if (wcoin.total > 0) {
				wSetCoinStatus('Slot closed - claiming the coins you inserted...', '#b45309');
				wClaim('expired');
				return;
			}
			wSetCoinStatus('Coin slot closed with no coins.', '#dc2626');
			setTimeout(wCloseCoinModal, 1800);
		}
	});
}

function wShowCoins(coins) {
	if (wEl('wcTotal')) wEl('wcTotal').textContent = String(coins);
	var per = (wallet.config && wallet.config.coin_value) || 1;
	if (wEl('wcValue')) wEl('wcValue').textContent = wMoney(Number(coins) * Number(per));
}

function wClaim(reason) {
	if (wcoin.busy) return;
	if (!wcoin.code) { wSetCoinStatus('No coin session is open', '#dc2626'); return; }
	wcoin.busy = true;
	if (wcoin.timer) { clearInterval(wcoin.timer); wcoin.timer = null; }
	var done = wEl('wcDoneBtn');
	if (done) { done.disabled = true; done.textContent = 'SENDING...'; }
	wSetCoinStatus('Counting your coins...', '#475569');

	// Let the machine finish its own settle step before the controller asks it
	// for the total, so the two never read the counter at the same instant.
	var wait = (reason === 'expired') ? 1200 : 0;
	setTimeout(function () {
		wApi('/topup/claim', 'POST', { code: wcoin.code }).then(function (res) {
			if (wHandleAuthLoss(res)) { wCloseCoinModal(); return; }
			if (done) done.textContent = 'DONE PAYING';
			if (!res.ok) {
				wcoin.busy = false;
				// 502 means the coins are still inside the machine: keep the modal
				// open so the customer can press the button again.
				if (res.status === 502) {
					wSetCoinStatus(res.data.error || 'The machine did not answer. Your coins are safe - try again.', '#dc2626');
					if (done) done.disabled = false;
					if (wcoin.timer) { clearInterval(wcoin.timer); wcoin.timer = null; }
					wcoin.timer = setInterval(wPollCoin, 2000);
					return;
				}
				wSetCoinStatus(res.data.error || 'Could not load those coins. Please see an agent.', '#dc2626');
				setTimeout(wCloseCoinModal, 2600);
				return;
			}
			var amount = Number(res.data.amount) || 0;
			wSetCoinStatus('Loaded ' + wMoney(amount) + ' (' + res.data.coins + ' coins). Balance ' + wMoney(res.data.balance), '#059669');
			if (res.data.router_cleanup === 'pending') {
				wSetCoinStatus('Loaded ' + wMoney(amount) + '. Balance ' + wMoney(res.data.balance)
					+ ' - tell an agent so they can close the leftover machine account.', '#b45309');
			}
			wcoin.code = '';
			wcoin.total = 0;
			wcoin.busy = false;
			if (wEl('wBalance')) wEl('wBalance').textContent = wMoney(res.data.balance);
			setTimeout(function () {
				wCloseCoinModal();
				var modal = wEl('walletModal');
				if (modal) modal.style.display = 'flex';
				walletRefresh();
			}, 1600);
		});
	}, wait);
}

// Claiming a session started earlier (page was closed, phone locked).
function wClaimPending(code) {
	if (!code) return;
	wSetCoinStatus('');
	wApi('/topup/claim', 'POST', { code: code }).then(function (res) {
		if (wHandleAuthLoss(res)) return;
		if (!res.ok) { wStatus(res.data.error || 'Could not claim that session', '#dc2626'); walletRefresh(); return; }
		wStatus('Claimed ' + wMoney(res.data.amount) + '. Balance ' + wMoney(res.data.balance), '#059669');
		walletRefresh();
	});
}

function wCancelTopup() {
	if (wcoin.timer) { clearInterval(wcoin.timer); wcoin.timer = null; }
	// Coins already counted for this code stay claimable from the wallet page,
	// so only tell the machine to let go when nothing was inserted.
	if (wcoin.ip && wcoin.code && wcoin.total === 0) {
		wMachinePost('/cancelTopUp', 'voucher=' + encodeURIComponent(wcoin.code) + '&mac=' + encodeURIComponent(wMac()))
			.catch(function () {});
	}
	wcoin.code = '';
	wcoin.busy = false;
	wCloseCoinModal();
	var modal = wEl('walletModal');
	if (modal) modal.style.display = 'flex';
	walletRefresh();
}

function wCloseCoinModal() {
	if (wcoin.timer) { clearInterval(wcoin.timer); wcoin.timer = null; }
	var sel = wEl('wcMachine');
	if (sel) sel.disabled = false;
	var done = wEl('wcDoneBtn');
	if (done) { done.disabled = false; done.textContent = 'DONE PAYING'; }
	if (typeof stopCoinLoop === 'function') stopCoinLoop();
	var modal = wEl('walletCoinModal');
	if (modal) modal.style.display = 'none';
}
