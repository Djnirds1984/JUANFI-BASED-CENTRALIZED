/*
 * JuanFi centralized - roaming device session token client.
 *
 * A device gets ONE permanent token (stored in a long-lived first-party cookie
 * on the hotspot portal origin). When the phone roams to a different SSID of
 * the same hotspot system, the portal reads this token, posts it together with
 * the new MAC to the controller, which re-binds the session and returns the
 * credentials + remaining time so the user is restored without re-entering a
 * voucher.
 *
 * Requires (defined by config.js):
 *   var controllerApiUrl = "http://<controller-lan-ip>:3000/api";
 *   var sessionCookieName = "juanfi_sid";
 *
 * The controller URL must be reachable BEFORE login -> add it to the MikroTik
 * IP > Hotspot > Walled Garden (the controller does this automatically).
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

  var TEN_YEARS = 3650; // token cookie effectively never expires
  var TOKEN_RE = /^[a-f0-9]{48}$/;

  function setCookie(name, value, days) {
    var expires = '';
    if (days) {
      var date = new Date();
      date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
      expires = '; expires=' + date.toUTCString();
    }
    document.cookie = name + '=' + (value || '') + expires + '; path=/; SameSite=Lax';
  }

  function getCookie(name) {
    var nameEQ = name + '=';
    var ca = document.cookie.split(';');
    for (var i = 0; i < ca.length; i++) {
      var c = ca[i];
      while (c.charAt(0) === ' ') c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
  }

  function eraseCookie(name) {
    document.cookie = name + '=; Max-Age=-99999999; path=/';
  }

  function configured() {
    return !!apiBase;
  }

  function getToken() {
    var t = getCookie(cookieName);
    return t && TOKEN_RE.test(t) ? t : null;
  }

  function post(path, body, timeoutMs) {
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, timeoutMs || 6000);

    return fetch(apiBase + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
      credentials: 'omit',
    })
      .then(function (res) {
        clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .catch(function (err) {
        clearTimeout(timer);
        throw err;
      });
  }

  /*
   * Make sure this browser owns a token. If the cookie already holds a valid
   * token we keep it (this is what survives roaming across SSIDs). Only when
   * there is none do we ask the controller to issue one for the current MAC.
   */
  function ensureToken(mac, ip, server) {
    var existing = getToken();
    if (existing) return Promise.resolve(existing);
    if (!configured()) return Promise.resolve(null);

    return post('/session/init', { mac: mac, ip: ip, server: server }, 5000)
      .then(function (data) {
        if (data && data.token) {
          setCookie(cookieName, data.token, TEN_YEARS);
          return data.token;
        }
        return null;
      })
      .catch(function () {
        return null; // never block the login page on the controller
      });
  }

  /*
   * Roam restore: present the cookie token + current MAC. On success the
   * response carries { username, password, remaining, rebind } so the caller
   * (login.html, which has access to the CHAP variables) can log back in.
   * When the token cookie was lost (SSID switch in a captive-portal browser
   * with isolated storage), pass username too so the server can adopt that
   * voucher's live session by name instead of stranding its time.
   */
  function restore(mac, ip, server, username) {
    var token = getToken();
    if ((!token && !username) || !configured()) return Promise.resolve(null);

    var body = { token: token, mac: mac, ip: ip, server: server };
    if (username) body.username = username;
    return post('/session/restore', body, 6000)
      .then(function (data) {
        // Adopt the surviving token when the server merged sessions.
        if (data && data.token && TOKEN_RE.test(data.token) && data.token !== token) {
          setCookie(cookieName, data.token, TEN_YEARS);
        }
        return data || null;
      })
      .catch(function () {
        return null;
      });
  }

  /*
   * Called from status.html right after a successful login: bind the token to
   * this MAC + username and adopt the live session-time-left. When the server
   * merged a fresh token into the surviving session (roam with lost cookie),
   * adopt that surviving token so later heartbeats hit the right row.
   */
  function bind(mac, username, server, sessionTimeLeftSecs) {
    var token = ensureToken(mac, '', server);
    return token.then(function (t) {
      if (!t || !username) return null;
      return post(
        '/session/bind',
        { token: t, mac: mac, username: username, server: server, sessionTimeLeft: sessionTimeLeftSecs },
        6000
      ).then(function (data) {
        if (data && data.adoptToken && TOKEN_RE.test(data.adoptToken) && data.adoptToken !== t) {
          setCookie(cookieName, data.adoptToken, TEN_YEARS);
        }
        return data || null;
      }).catch(function () {
        return null;
      });
    });
  }

  /* Best-effort heartbeat / pause / logout snapshot. */
  function reportState(event, remainingSecs) {
    var token = getToken();
    if (!token || !configured()) return Promise.resolve(null);
    return post('/session/state', { token: token, event: event, remaining: remainingSecs }, 5000).catch(
      function () {
        return null;
      }
    );
  }

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
