/*
 * JuanFi centralized - roaming device session token client.
 *
 * Token storage strategy
 * ----------------------
 * The portal pages (login.html / status.html) are served from the MikroTik's
 * hotspot IP, which is DIFFERENT per SSID. A cookie set on SSID-A's portal IP
 * is not available when the device roams to SSID-B (different portal IP).
 *
 * To solve this, we embed a hidden iframe that points to the panel's
 * /session/token-frame endpoint. The iframe runs in a first-party context for
 * the panel's origin (constant IP across all SSIDs), so cookies set inside the
 * iframe persist across SSIDs. The parent page and iframe communicate via
 * postMessage.
 *
 * Fallback: if the iframe doesn't load within 3 seconds (e.g. panel down, or
 * browser blocks third-party iframes), we fall back to direct API calls with
 * localStorage. This won't survive cross-SSID roaming but still works for
 * reconnects on the same SSID.
 */
(function (window) {
  'use strict';

  var apiBase =
    typeof controllerApiUrl !== 'undefined' && controllerApiUrl
      ? String(controllerApiUrl).replace(/\/+$/, '')
      : '';
  var cookieName =
    typeof sessionCookieName !== 'undefined' && sessionCookieName
      ? sessionCookieName
      : 'juanfi_sid';

  var TOKEN_RE = /^[a-f0-9]{48}$/;
  var IFRAME_TIMEOUT = 3000;

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
      // iframe creation failed (e.g. no document.body yet) — fall through
    }
  }

  function requestTokenFromIframe(mac, ip, server) {
    return new Promise(function (resolve) {
      tokenResolver = resolve;
      function send() {
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({ type: 'get-token', mac: mac, ip: ip, server: server }, '*');
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

  /*
   * Ensure this browser owns a token. Tries iframe first (cross-SSID persistent),
   * falls back to localStorage + direct API.
   */
  function ensureToken(mac, ip, server) {
    if (!configured()) return Promise.resolve(null);

    // Try iframe first — this is the cross-SSID persistent store
    if (iframe !== undefined) {
      initIframe();
      return requestTokenFromIframe(mac, ip, server).then(function (tok) {
        if (tok) { localSetToken(tok); return tok; }
        // iframe failed — fall back to direct API
        return directEnsureToken(mac, ip, server);
      });
    }
    return directEnsureToken(mac, ip, server);
  }

  function directEnsureToken(mac, ip, server) {
    var existing = localGetToken();
    if (existing) return Promise.resolve(existing);
    return post('/session/init', { mac: mac, ip: ip, server: server }, 5000)
      .then(function (data) {
        if (data && data.token) { localSetToken(data.token); return data.token; }
        return null;
      })
      .catch(function () { return null; });
  }

  /*
   * Roam restore: send token + new MAC to the panel. If the token matches a
   * known session, the panel rebinds and returns credentials + remaining time.
   */
  function restore(mac, ip, server) {
    if (!configured()) return Promise.resolve(null);

    // Get token from iframe or localStorage
    var tok = localGetToken();
    if (!tok) return Promise.resolve(null);

    var body = { token: tok, mac: mac, ip: ip, server: server };
    return post('/session/restore', body, 6000)
      .then(function (data) { return data || null; })
      .catch(function () { return null; });
  }

  /*
   * After login: bind the token to this MAC + username and adopt the live
   * session time.
   */
  function bind(mac, username, server, sessionTimeLeftSecs) {
    return ensureToken(mac, '', server).then(function (t) {
      if (!t || !username) return null;
      sendTokenToIframe(t);
      return post('/session/bind', {
        token: t, mac: mac, username: username, server: server, sessionTimeLeft: sessionTimeLeftSecs
      }, 6000)
        .then(function (data) { return data || null; })
        .catch(function () { return null; });
    });
  }

  /* Heartbeat / pause / logout snapshot. */
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
