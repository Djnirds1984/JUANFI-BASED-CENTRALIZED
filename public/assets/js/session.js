/*
 * JuanFi centralized - roaming device session token client (PANEL portal).
 *
 * The panel portal is served from the panel origin, so the token cookie is
 * first-party (the hidden iframe is still used for consistency). A permanent
 * token binds this browser to a device session; when the phone roams to another
 * SSID the MAC changes, /session/restore rebinds the token to the new MAC and
 * the login is re-issued with the ORIGINAL username so the account + remaining
 * time follow the device.
 *
 * Globals (set by the host page):
 *   window.controllerApiUrl   base URL of the panel API (e.g. '/api')
 *   window.controllerRouterId the panel router id this portal belongs to
 *   window.sessionCookieName  cookie/localStorage key (default juanfi_sid)
 */
(function (window) {
  'use strict';

  var apiBase =
    typeof window.controllerApiUrl !== 'undefined' && window.controllerApiUrl
      ? String(window.controllerApiUrl).replace(/\/+$/, '')
      : '';
  var cookieName =
    typeof window.sessionCookieName !== 'undefined' && window.sessionCookieName
      ? window.sessionCookieName
      : 'juanfi_sid';

  var TOKEN_RE = /^[a-f0-9]{48}$/;
  var IFRAME_TIMEOUT = 3000;

  function currentRouterId() {
    var id = window.controllerRouterId;
    if (id === undefined || id === null || id === '') return undefined;
    var n = parseInt(id, 10);
    return isNaN(n) ? undefined : n;
  }

  // ---- iframe bridge ----
  var iframe = null;
  var iframeReady = false;
  var pendingQueue = [];
  var tokenResolver = null;

  function initIframe() {
    if (iframe || !apiBase) return;
    try {
      iframe = document.createElement('iframe');
      iframe.src = apiBase + '/session/token-frame';
      iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;';
      iframe.setAttribute('aria-hidden', 'true');
      (document.body || document.documentElement).appendChild(iframe);

      window.addEventListener('message', function (e) {
        if (!iframe || !iframe.contentWindow || e.source !== iframe.contentWindow) return;
        var d = e.data || {};
        if (d.type === 'token-frame-ready') {
          iframeReady = true;
          for (var i = 0; i < pendingQueue.length; i++) pendingQueue[i]();
          pendingQueue = [];
        } else if (d.type === 'token' && typeof d.token === 'string') {
          if (tokenResolver) {
            var fn = tokenResolver;
            tokenResolver = null;
            fn(d.token);
          }
        }
      });

      setTimeout(function () {
        if (!iframeReady) {
          iframeReady = false;
          for (var i = 0; i < pendingQueue.length; i++) pendingQueue[i]();
          pendingQueue = [];
        }
      }, IFRAME_TIMEOUT);
    } catch (ex) {
      // iframe creation failed - fall through to direct API
    }
  }

  function requestTokenFromIframe(mac, ip, server) {
    return new Promise(function (resolve) {
      tokenResolver = resolve;
      function send() {
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage(
            { type: 'get-token', mac: mac, ip: ip, server: server, routerId: currentRouterId() }, '*'
          );
        } else {
          resolve(null);
        }
      }
      if (iframeReady) send();
      else pendingQueue.push(send);
    });
  }

  function sendTokenToIframe(token) {
    if (iframe && iframe.contentWindow && TOKEN_RE.test(token)) {
      iframe.contentWindow.postMessage({ type: 'set-token', token: token }, '*');
    }
  }

  // ---- localStorage fallback ----
  function localGetToken() {
    try {
      var t = localStorage.getItem(cookieName);
      return t && TOKEN_RE.test(t) ? t : null;
    } catch (e) { return null; }
  }

  function localSetToken(t) {
    try { if (t && TOKEN_RE.test(t)) localStorage.setItem(cookieName, t); } catch (e) {}
  }

  // ---- direct API (fallback) ----
  function post(path, body, timeoutMs) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 6000);
    return fetch(apiBase + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
      credentials: 'omit',
    })
      .then(function (res) { clearTimeout(timer); if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .catch(function (err) { clearTimeout(timer); throw err; });
  }

  function configured() { return !!apiBase; }

  // ---- public API ----

  function ensureToken(mac, ip, server) {
    if (!configured()) return Promise.resolve(null);
    if (iframe !== undefined) {
      initIframe();
      return requestTokenFromIframe(mac, ip, server).then(function (tok) {
        if (tok) { localSetToken(tok); return tok; }
        return directEnsureToken(mac, ip, server);
      });
    }
    return directEnsureToken(mac, ip, server);
  }

  function directEnsureToken(mac, ip, server) {
    var existing = localGetToken();
    if (existing) return Promise.resolve(existing);
    return post('/session/init', { mac: mac, ip: ip, server: server, routerId: currentRouterId() }, 5000)
      .then(function (data) {
        if (data && data.token) { localSetToken(data.token); return data.token; }
        return null;
      })
      .catch(function () { return null; });
  }

  function restore(mac, ip, server) {
    if (!configured()) return Promise.resolve(null);
    var tok = localGetToken();
    if (!tok) return Promise.resolve(null);
    var body = { token: tok, mac: mac, ip: ip, server: server, routerId: currentRouterId() };
    return post('/session/restore', body, 6000)
      .then(function (data) { return data || null; })
      .catch(function () { return null; });
  }

  function bind(mac, username, server, sessionTimeLeftSecs) {
    return ensureToken(mac, '', server).then(function (t) {
      if (!t || !username) return null;
      sendTokenToIframe(t);
      return post('/session/bind', {
        token: t, mac: mac, username: username, server: server,
        sessionTimeLeft: sessionTimeLeftSecs, routerId: currentRouterId(),
      }, 6000)
        .then(function (data) { return data || null; })
        .catch(function () { return null; });
    });
  }

  function reportState(event, remainingSecs) {
    var tok = localGetToken();
    if (!tok || !configured()) return Promise.resolve(null);
    return post('/session/state', { token: tok, event: event, remaining: remainingSecs }, 5000)
      .catch(function () { return null; });
  }

  function getToken() { return localGetToken(); }

  window.JuanFiSession = {
    isConfigured: configured,
    getToken: getToken,
    ensureToken: ensureToken,
    restore: restore,
    bind: bind,
    reportState: reportState,
    cookieName: cookieName,
  };
})(window);
