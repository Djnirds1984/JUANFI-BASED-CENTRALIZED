import { Router, Request, Response } from 'express';
import {
  initSession,
  restoreSession,
  bindSession,
  updateSessionState,
  isValidToken,
} from '../services/deviceSessions';

const router = Router();

// ---------------------------------------------------------------------------
// Basic in-memory rate limiter (these endpoints are reachable pre-login)
// ---------------------------------------------------------------------------
const WINDOW_MS = 60_000;
const MAX_HITS = 120;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(req: Request, res: Response, next: () => void): void {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  if (hits.size > 2000) {
    for (const [key, entry] of hits) {
      if (entry.resetAt < now) hits.delete(key);
    }
  }

  const entry = hits.get(ip);
  if (!entry || entry.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    next();
    return;
  }

  entry.count += 1;
  if (entry.count > MAX_HITS) {
    res.status(429).json({ error: 'Too many requests' });
    return;
  }
  next();
}

router.use(rateLimited);

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;
const normalizeBodyMac = (raw: any): string => String(raw || '').trim().toLowerCase().replace(/-/g, ':');

// ---------------------------------------------------------------------------
// Token frame — hidden iframe served from the panel's own origin.
//
// The portal pages (login.html / status.html) are hosted on the MikroTik at
// different IPs per SSID. A cookie set on SSID-A's portal IP is NOT available
// on SSID-B's portal IP. By embedding a hidden iframe that points back to the
// panel (constant IP), the iframe runs in a first-party context for the panel
// and can read/write cookies on the panel's domain. The parent page and the
// iframe communicate via postMessage.
// ---------------------------------------------------------------------------
router.get('/token-frame', (_req: Request, res: Response) => {
  res.type('html').send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>JuanFi Session</title></head>
<body>
<script>
(function(){
  var COOKIE_NAME='juanfi_sid';
  var TOKEN_RE=/^[a-f0-9]{48}$/;
  var TEN_YEARS=3650;

  function getCookie(n){
    var eq=n+'=';var ca=document.cookie.split(';');
    for(var i=0;i<ca.length;i++){
      var c=ca[i];while(c.charAt(0)==' ')c=c.substring(1,c.length);
      if(c.indexOf(eq)===0)return c.substring(eq.length,c.length);
    }
    return null;
  }
  function setCookie(n,v,d){
    var e='';if(d){var t=new Date();t.setTime(t.getTime()+d*24*60*60*1000);e='; expires='+t.toUTCString();}
    document.cookie=n+'='+(v||'')+e+'; path=/; SameSite=Lax';
  }

  window.addEventListener('message',function(e){
    var d=e.data||{};
    if(!e.source)return;
    if(d.type==='get-token'){
      var tok=getCookie(COOKIE_NAME);
      if(tok&&TOKEN_RE.test(tok)){
        e.source.postMessage({type:'token',token:tok},'*');
      }else if(d.mac){
        var X=new XMLHttpRequest();
        X.open('POST','/api/session/init',true);
        X.setRequestHeader('Content-Type','application/json');
        X.onload=function(){
          try{
            var r=JSON.parse(X.responseText);
            if(r&&r.token){setCookie(COOKIE_NAME,r.token,TEN_YEARS);e.source.postMessage({type:'token',token:r.token},'*');}
          }catch(ex){}
        };
        X.send(JSON.stringify({mac:d.mac,ip:d.ip||'',server:d.server||''}));
      }
    }else if(d.type==='set-token'){
      if(d.token&&TOKEN_RE.test(d.token))setCookie(COOKIE_NAME,d.token,TEN_YEARS);
    }
  });
  if(window.parent!==window)window.parent.postMessage({type:'token-frame-ready'},'*');
})();
</script>
</body></html>`);
});

// POST /api/session/init - first visit: issue (or reuse) the permanent token
router.post('/init', (req: Request, res: Response) => {
  try {
    const mac = normalizeBodyMac(req.body?.mac);
    if (!MAC_RE.test(mac)) {
      res.status(400).json({ error: 'Valid mac is required' });
      return;
    }

    const result = initSession({
      mac,
      ip: req.body?.ip,
      server: req.body?.server,
      routerId: parseInt(req.body?.routerId || '1', 10) || 1,
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/session/restore - roam: token + new MAC -> credentials + remaining
// Pure token+MAC design: the device carries the token, the server compares it
// against the stored token+MAC binding. Same token on a new MAC = same owner
// roaming -> rebind and restore the remaining time. No passwords, no prompts.
router.post('/restore', async (req: Request, res: Response) => {
  try {
    const token = req.body?.token;
    const mac = normalizeBodyMac(req.body?.mac);

    if (!isValidToken(token)) {
      res.status(400).json({ error: 'Valid token is required' });
      return;
    }
    if (!MAC_RE.test(mac)) {
      res.status(400).json({ error: 'Valid mac is required' });
      return;
    }

    const result = await restoreSession({
      token,
      mac,
      ip: req.body?.ip,
      server: req.body?.server,
      routerId: parseInt(req.body?.routerId || '1', 10) || 1,
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/session/bind - after a successful login: token <-> MAC + username
router.post('/bind', (req: Request, res: Response) => {
  try {
    const mac = normalizeBodyMac(req.body?.mac);
    const username = String(req.body?.username || '').trim();

    if (!MAC_RE.test(mac)) {
      res.status(400).json({ error: 'Valid mac is required' });
      return;
    }
    if (!username) {
      res.status(400).json({ error: 'username is required' });
      return;
    }
    if (req.body?.token && !isValidToken(req.body.token)) {
      res.status(400).json({ error: 'Invalid token' });
      return;
    }

    const result = bindSession({
      token: req.body?.token,
      mac,
      username,
      server: req.body?.server,
      sessionTimeLeft: req.body?.sessionTimeLeft,
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/session/state - status page heartbeat / pause / logout snapshots
router.post('/state', (req: Request, res: Response) => {
  try {
    const token = req.body?.token;
    if (!isValidToken(token)) {
      res.status(400).json({ error: 'Valid token is required' });
      return;
    }

    const result = updateSessionState({
      token,
      event: req.body?.event,
      remaining: req.body?.remaining,
    });

    if (!result.ok) {
      res.status(404).json(result);
      return;
    }

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
