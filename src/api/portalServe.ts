import { Router, Request, Response } from 'express';
import path from 'path';
import { getDb } from '../database';
import { renderPortalFile, renderStatusPage, generateChapChallenge, getPortalFilePath, PortalContext } from '../services/portalRenderer';
import { portalLogin, portalLogout, getActiveSession, storeChapContext } from '../services/portalAuth';

const router = Router();

function getRouterOr404(res: Response, routerIdStr: string): { id: number; portal_mode: string } | null {
  const routerId = parseInt(routerIdStr, 10);
  if (isNaN(routerId)) {
    res.status(404).send('Not found');
    return null;
  }
  const db = getDb();
  const row = db.prepare('SELECT id, portal_mode FROM routers WHERE id = ?').get(routerId) as any;
  if (!row) {
    res.status(404).send('Router not found');
    return null;
  }
  if (row.portal_mode !== 'radius') {
    res.status(403).send('Portal not enabled for this router');
    return null;
  }
  return row;
}

function buildCtx(routerId: number, req: Request, extra: Partial<PortalContext> = {}): PortalContext {
  const mac = (req.query.mac as string) || (req.body?.mac as string) || '';
  const ip = (req.query.ip as string) || (req.body?.ip as string) || '';

  return {
    routerId,
    mac,
    ip,
    linkLoginOnly: `/portal/${routerId}/login?mac=${encodeURIComponent(mac)}&ip=${encodeURIComponent(ip)}`,
    linkLogout: `/portal/${routerId}/logout?mac=${encodeURIComponent(mac)}&ip=${encodeURIComponent(ip)}`,
    linkStatus: `/portal/${routerId}/status.html?mac=${encodeURIComponent(mac)}&ip=${encodeURIComponent(ip)}`,
    ...extra,
  };
}

router.get('/:routerId/login.html', (req: Request, res: Response) => {
  const r = getRouterOr404(res, req.params.routerId);
  if (!r) return;

  const chap = generateChapChallenge();
  const ctx = buildCtx(r.id, req, { chapId: chap.chapId, chapChallenge: chap.chapChallenge });

  storeChapContext(r.id, ctx.mac, chap.chapId, chap.chapChallenge);

  const html = renderPortalFile('login.html', ctx);

  if (html === null) {
    res.status(404).send('Login page not found');
    return;
  }
  res.type('html').send(html);
});

router.get('/:routerId/status.html', (req: Request, res: Response) => {
  const r = getRouterOr404(res, req.params.routerId);
  if (!r) return;

  const mac = (req.query.mac as string) || '';
  const session = getActiveSession(r.id, mac);

  const ctx = buildCtx(r.id, req, {
    username: session?.username || (req.query.username as string) || '',
  });

  const html = renderStatusPage(ctx);
  if (html === null) {
    res.status(404).send('Status page not found');
    return;
  }
  res.type('html').send(html);
});

router.get('/:routerId/rlogin.html', (req: Request, res: Response) => {
  const r = getRouterOr404(res, req.params.routerId);
  if (!r) return;

  const ctx = buildCtx(r.id, req);
  const html = renderPortalFile('rlogin.html', ctx);
  if (html === null) {
    res.status(404).send('Not found');
    return;
  }
  res.type('html').send(html);
});

router.get('/:routerId/redirect.html', (req: Request, res: Response) => {
  const r = getRouterOr404(res, req.params.routerId);
  if (!r) return;

  const ctx = buildCtx(r.id, req);
  const html = renderPortalFile('redirect.html', ctx);
  if (html === null) {
    res.status(404).send('Not found');
    return;
  }
  res.type('html').send(html);
});

router.get('/:routerId/logout.html', (req: Request, res: Response) => {
  const r = getRouterOr404(res, req.params.routerId);
  if (!r) return;

  const ctx = buildCtx(r.id, req);
  const html = renderPortalFile('logout.html', ctx);
  if (html === null) {
    res.status(404).send('Not found');
    return;
  }
  res.type('html').send(html);
});

router.get('/:routerId/error.html', (req: Request, res: Response) => {
  const r = getRouterOr404(res, req.params.routerId);
  if (!r) return;

  const ctx = buildCtx(r.id, req, { error: (req.query.error as string) || '' });
  const html = renderPortalFile('error.html', ctx);
  if (html === null) {
    res.status(404).send('Not found');
    return;
  }
  res.type('html').send(html);
});

router.get('/:routerId/alogo.html', (req: Request, res: Response) => {
  const r = getRouterOr404(res, req.params.routerId);
  if (!r) return;

  const ctx = buildCtx(r.id, req);
  const html = renderPortalFile('alogin.html', ctx);
  if (html === null) {
    res.status(404).send('Not found');
    return;
  }
  res.type('html').send(html);
});

router.post('/:routerId/login', async (req: Request, res: Response) => {
  const r = getRouterOr404(res, req.params.routerId);
  if (!r) return;

  const mac = (req.query.mac as string) || '';
  const ip = (req.query.ip as string) || '';
  const username = req.body?.username || '';
  const chapResponse = req.body?.password || '';

  const result = await portalLogin({
    routerId: r.id,
    username,
    chapResponse: chapResponse || undefined,
    mac,
    ip,
  });

  if (!result.success) {
    const ctx = buildCtx(r.id, req, {
      error: result.error || 'Login failed',
      username,
    });
    const chap = generateChapChallenge();
    ctx.chapId = chap.chapId;
    ctx.chapChallenge = chap.chapChallenge;
    storeChapContext(r.id, mac, chap.chapId, chap.chapChallenge);
    const html = renderPortalFile('login.html', ctx);
    if (html) {
      res.type('html').send(html);
    } else {
      res.status(401).json({ error: result.error });
    }
    return;
  }

  const redirectUrl = req.body?.dst || result.redirectUrl || `/portal/${r.id}/status.html`;
  res.redirect(redirectUrl);
});

router.post('/:routerId/logout', async (req: Request, res: Response) => {
  const r = getRouterOr404(res, req.params.routerId);
  if (!r) return;

  const mac = (req.query.mac as string) || (req.body?.mac as string) || '';
  const ip = (req.query.ip as string) || (req.body?.ip as string) || '';
  const username = (req.body?.username as string) || '';

  await portalLogout({ routerId: r.id, username, mac, ip });

  res.redirect(`/portal/${r.id}/login.html?mac=${encodeURIComponent(mac)}&ip=${encodeURIComponent(ip)}`);
});

router.get('/:routerId/logout', async (req: Request, res: Response) => {
  const r = getRouterOr404(res, req.params.routerId);
  if (!r) return;

  const mac = (req.query.mac as string) || '';
  const ip = (req.query.ip as string) || '';

  await portalLogout({ routerId: r.id, mac, ip });

  res.redirect(`/portal/${r.id}/login.html?mac=${encodeURIComponent(mac)}&ip=${encodeURIComponent(ip)}`);
});

router.get('/:routerId/assets/*', (req: Request, res: Response) => {
  const r = getRouterOr404(res, req.params.routerId);
  if (!r) return;

  const relativePath = req.params[0];
  const filePath = `assets/${relativePath}`;
  const fullPath = getPortalFilePath(filePath);

  if (!fullPath) {
    res.status(404).send('Not found');
    return;
  }

  const ext = path.extname(fullPath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.map': 'application/json',
  };

  res.type(mimeTypes[ext] || 'application/octet-stream');
  res.sendFile(fullPath);
});

export default router;
