// Portal chat widget — lets hotspot users message the admin with or without a session
(function () {
	'use strict';

	var API = (window.controllerApiUrl || '/api') + '/chat';
	var POLL_OPEN_MS = 3000;
	var POLL_IDLE_MS = 8000;
	var MAX_IMAGE_INPUT = 10 * 1024 * 1024;

	var identity = resolveIdentity();
	var lastId = 0;
	var unread = 0;
	var isOpen = false;
	var pollTimer = null;
	var sending = false;
	var pendingImage = null;
	var rendered = {};

	function resolveIdentity() {
		var params = new URLSearchParams(window.location.search);
		function pick(urlVal, storeKey, fallback) {
			if (urlVal) {
				try { localStorage.setItem(storeKey, urlVal); } catch (e) {}
				return urlVal;
			}
			var stored = '';
			try { stored = localStorage.getItem(storeKey) || ''; } catch (e) {}
			return stored || fallback || '';
		}
		return {
			mac: pick(params.get('mac') || '', 'chat_mac', window.mac || ''),
			ip: pick(params.get('ip') || '', 'chat_ip', window.ip || ''),
			routerId: pick(params.get('router-id') || '', 'chat_router_id', window.controllerRouterId || '')
		};
	}

	function hasIdentity() {
		return !!(identity.mac || identity.ip);
	}

	function identityQuery() {
		var q = [];
		if (identity.mac) q.push('mac=' + encodeURIComponent(identity.mac));
		if (identity.ip) q.push('ip=' + encodeURIComponent(identity.ip));
		if (identity.routerId) q.push('routerId=' + encodeURIComponent(identity.routerId));
		return q.join('&');
	}

	function identityBody() {
		return { mac: identity.mac, ip: identity.ip, routerId: identity.routerId };
	}

	function el(tag, cls, text) {
		var node = document.createElement(tag);
		if (cls) node.className = cls;
		if (text != null) node.textContent = text;
		return node;
	}

	function icon(pathD) {
		var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		p.setAttribute('d', pathD);
		svg.appendChild(p);
		return svg;
	}

	var ICONS = {
		chat: 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z',
		image: 'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z',
		send: 'M2.01 21L23 12 2.01 3 2 10l15 2-15 2z'
	};

	var root, fab, badge, panel, list, textarea, sendBtn, attachBtn, fileInput, imagePreview, previewImg, previewName, errorBox;

	function buildUi() {
		root = el('div', 'chat-widget-root');

		fab = el('button', 'chat-fab');
		fab.type = 'button';
		fab.title = 'Chat with admin';
		fab.appendChild(icon(ICONS.chat));
		badge = el('span', 'chat-fab-badge', '0');
		fab.appendChild(badge);
		fab.addEventListener('click', togglePanel);

		panel = el('div', 'chat-panel');

		var header = el('div', 'chat-panel-header');
		var headerText = el('div');
		var title = el('h5');
		title.appendChild(icon(ICONS.chat));
		title.appendChild(document.createTextNode('Chat with Admin'));
		var status = el('span', 'chat-admin-status', 'We usually reply within a few minutes');
		headerText.appendChild(title);
		headerText.appendChild(status);
		var closeBtn = el('button', 'chat-panel-close', '\u00d7');
		closeBtn.type = 'button';
		closeBtn.setAttribute('aria-label', 'Close chat');
		closeBtn.addEventListener('click', togglePanel);
		header.appendChild(headerText);
		header.appendChild(closeBtn);

		list = el('div', 'chat-messages');

		var composer = el('div', 'chat-composer');
		imagePreview = el('div', 'chat-image-preview');
		previewImg = el('img');
		previewName = el('span');
		var removeImage = el('button', '', '\u00d7');
		removeImage.type = 'button';
		removeImage.setAttribute('aria-label', 'Remove image');
		removeImage.addEventListener('click', clearPendingImage);
		imagePreview.appendChild(previewImg);
		imagePreview.appendChild(previewName);
		imagePreview.appendChild(removeImage);

		errorBox = el('div', 'chat-error');

		var row = el('div', 'chat-input-row');
		attachBtn = el('button', 'chat-attach');
		attachBtn.type = 'button';
		attachBtn.title = 'Send an image';
		attachBtn.appendChild(icon(ICONS.image));
		attachBtn.addEventListener('click', function () { fileInput.click(); });

		fileInput = document.createElement('input');
		fileInput.type = 'file';
		fileInput.accept = 'image/png,image/jpeg,image/webp';
		fileInput.style.display = 'none';
		fileInput.addEventListener('change', handleFilePick);

		textarea = el('textarea', 'chat-textarea');
		textarea.placeholder = 'Type a message...';
		textarea.rows = 1;
		textarea.addEventListener('keydown', function (e) {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				send();
			}
		});
		textarea.addEventListener('input', function () {
			textarea.style.height = 'auto';
			textarea.style.height = Math.min(textarea.scrollHeight, 96) + 'px';
		});

		sendBtn = el('button', 'chat-send');
		sendBtn.type = 'button';
		sendBtn.append(icon(ICONS.send));
		sendBtn.addEventListener('click', send);

		row.appendChild(attachBtn);
		row.appendChild(textarea);
		row.appendChild(sendBtn);
		composer.appendChild(imagePreview);
		composer.appendChild(errorBox);
		composer.appendChild(row);
		composer.appendChild(fileInput);

		panel.appendChild(header);
		panel.appendChild(list);
		panel.appendChild(composer);

		var lightbox = el('div', 'chat-lightbox');
		var lightImg = el('img');
		lightbox.appendChild(lightImg);
		lightbox.addEventListener('click', function () {
			lightbox.classList.remove('open');
			lightImg.removeAttribute('src');
		});
		panel.addEventListener('click', function (e) {
			var target = e.target;
			if (target && target.tagName === 'IMG' && target.dataset.full) {
				lightImg.src = target.dataset.full;
				lightbox.classList.add('open');
			}
		});

		root.appendChild(fab);
		root.appendChild(panel);
		root.appendChild(lightbox);
		document.body.appendChild(root);

		if (!hasIdentity()) {
			textarea.disabled = true;
			attachBtn.disabled = true;
			sendBtn.disabled = true;
			textarea.placeholder = 'Device not identified';
			showError('We could not identify your device. Reopen the portal from the WiFi login page.');
		}
		setBusy(false);
	}

	function setBusy(busy) {
		sending = busy;
		sendBtn.disabled = busy || !hasIdentity();
		attachBtn.disabled = busy || !hasIdentity();
	}

	function showError(message) {
		errorBox.textContent = message;
		errorBox.classList.add('show');
		setTimeout(function () { errorBox.classList.remove('show'); }, 5000);
	}

	function togglePanel() {
		isOpen = !isOpen;
		panel.classList.toggle('open', isOpen);
		if (isOpen) {
			clearUnread();
			textarea.focus();
			poll(true);
		}
		schedulePoll();
	}

	function clearUnread() {
		unread = 0;
		renderBadge();
		if (!hasIdentity()) return;
		fetch(API + '/read', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(identityBody())
		}).catch(function () {});
	}

	function renderBadge() {
		badge.textContent = unread > 99 ? '99+' : String(unread);
		badge.classList.toggle('show', unread > 0 && !isOpen);
	}

	function schedulePoll() {
		clearTimeout(pollTimer);
		if (!hasIdentity()) return;
		pollTimer = setTimeout(function () { poll(false); }, isOpen ? POLL_OPEN_MS : POLL_IDLE_MS);
	}

	function poll(force) {
		if (!hasIdentity()) return;
		var url = API + '/thread?' + identityQuery() + (lastId ? '&after=' + lastId : '');
		fetch(url, { cache: 'no-store' })
			.then(function (res) {
				if (!res.ok) throw new Error('Chat server unavailable');
				return res.json();
			})
			.then(function (data) {
				(data.messages || []).forEach(function (msg) { appendMessage(msg); });
				if (isOpen) {
					if (data.unread) clearUnread();
				} else {
					unread = data.unread || 0;
					renderBadge();
				}
			})
			.catch(function () {})
			.then(schedulePoll);
	}

	function renderEmpty() {
		if (list.querySelector('.chat-msg')) return;
		list.innerHTML = '';
		list.appendChild(el('div', 'chat-empty', 'Hi! Need help with your connection? Send us a message and our admin will reply.'));
	}

	function formatTime(iso) {
		if (!iso) return '';
		var date = new Date(iso.replace(' ', 'T') + (iso.indexOf('Z') === -1 ? 'Z' : ''));
		if (isNaN(date.getTime())) return '';
		return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	function appendMessage(msg) {
		if (!msg || rendered[msg.id]) return;
		rendered[msg.id] = true;
		var emptyEl = list.querySelector('.chat-empty');
		if (emptyEl) emptyEl.remove();

		var wrap = el('div', 'chat-msg ' + (msg.sender === 'admin' ? 'admin' : 'user'));
		var bubble = el('div', 'chat-bubble');
		if (msg.image_path) {
			var img = el('img');
			img.src = msg.image_path;
			img.alt = 'Chat image';
			img.dataset.full = msg.image_path;
			img.loading = 'lazy';
			bubble.appendChild(img);
		} else {
			bubble.textContent = msg.body;
		}
		wrap.appendChild(bubble);
		var meta = formatTime(msg.created_at);
		if (meta) wrap.appendChild(el('div', 'chat-meta', meta));
		list.appendChild(wrap);
		if (msg.id > lastId) lastId = msg.id;
		scrollToBottom();
	}

	function scrollToBottom() {
		list.scrollTop = list.scrollHeight;
	}

	function send() {
		if (!hasIdentity()) return;
		if (pendingImage) {
			sendImage();
			return;
		}
		var text = textarea.value.trim();
		if (!text || sending) return;
		setBusy(true);
		fetch(API + '/messages', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(Object.assign(identityBody(), { body: text }))
		})
			.then(function (res) {
				return res.json().then(function (data) {
					if (!res.ok) throw new Error(data.error || 'Message failed to send');
					return data;
				});
			})
			.then(function (data) {
				textarea.value = '';
				textarea.style.height = 'auto';
				if (data.message) appendMessage(data.message);
			})
			.catch(function (error) { showError(error.message || 'Message failed to send'); })
			.then(function () { setBusy(false); });
	}

	function handleFilePick(e) {
		var file = e.target.files && e.target.files[0];
		fileInput.value = '';
		if (!file) return;
		if (file.size > MAX_IMAGE_INPUT) {
			showError('Image is too large (max 10MB)');
			return;
		}
		compressImage(file)
			.then(function (blob) {
				pendingImage = blob;
				var url = URL.createObjectURL(blob);
				if (previewImg.dataset.url) URL.revokeObjectURL(previewImg.dataset.url);
				previewImg.dataset.url = url;
				previewImg.src = url;
				previewName.textContent = 'Image ready — tap send';
				imagePreview.classList.add('show');
			})
			.catch(function () { showError('Could not read that image'); });
	}

	function compressImage(file) {
		return new Promise(function (resolve, reject) {
			var reader = new FileReader();
			reader.onerror = function () { reject(new Error('read failed')); };
			reader.onload = function () {
				var img = new Image();
				img.onerror = function () { reject(new Error('decode failed')); };
				img.onload = function () {
					var maxSide = 1280;
					var scale = Math.min(1, maxSide / Math.max(img.width, img.height));
					var canvas = document.createElement('canvas');
					canvas.width = Math.max(1, Math.round(img.width * scale));
					canvas.height = Math.max(1, Math.round(img.height * scale));
					var ctx = canvas.getContext('2d');
					ctx.fillStyle = '#ffffff';
					ctx.fillRect(0, 0, canvas.width, canvas.height);
					ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
					canvas.toBlob(function (blob) {
						if (blob) resolve(blob);
						else reject(new Error('encode failed'));
					}, 'image/jpeg', 0.85);
				};
				img.src = reader.result;
			};
			reader.readAsDataURL(file);
		});
	}

	function clearPendingImage() {
		pendingImage = null;
		imagePreview.classList.remove('show');
		if (previewImg.dataset.url) {
			URL.revokeObjectURL(previewImg.dataset.url);
			delete previewImg.dataset.url;
		}
		previewImg.removeAttribute('src');
	}

	function sendImage() {
		if (!pendingImage || sending) return;
		setBusy(true);
		fetch(API + '/messages/image?' + identityQuery(), {
			method: 'POST',
			headers: { 'Content-Type': 'image/jpeg' },
			body: pendingImage
		})
			.then(function (res) {
				return res.json().then(function (data) {
					if (!res.ok) throw new Error(data.error || 'Image failed to send');
					return data;
				});
			})
			.then(function (data) {
				clearPendingImage();
				if (data.message) appendMessage(data.message);
			})
			.catch(function (error) { showError(error.message || 'Image failed to send'); })
			.then(function () { setBusy(false); });
	}

	function init() {
		if (document.getElementById('chatWidgetRoot')) return;
		buildUi();
		root.id = 'chatWidgetRoot';
		renderEmpty();
		poll(false);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
