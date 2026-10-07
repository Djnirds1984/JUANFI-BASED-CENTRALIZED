import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { getPortalDefaultContent, listHotspotFiles, EDITABLE_EXTENSIONS } from '../database';
import { mikroTikService } from '../services/mikrotik';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

const HOTSPOT_ROOT = path.resolve(__dirname, '..', '..', 'hotspot');

function resolveDiskPath(filePath: string): string {
  return path.join(HOTSPOT_ROOT, filePath.replace(/\\/g, '/'));
}

function validatePortalPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.includes('..')) return false;
  const full = path.resolve(HOTSPOT_ROOT, normalized);
  return full.startsWith(HOTSPOT_ROOT + path.sep) || full === HOTSPOT_ROOT;
}

function isEditable(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return EDITABLE_EXTENSIONS.has(ext);
}

router.get('/', (req: Request, res: Response) => {
  try {
    const files = listHotspotFiles();
    const result = files.map((f) => {
      const diskPath = resolveDiskPath(f.path);
      let mtime: string | null = null;
      try {
        mtime = fs.statSync(diskPath).mtime.toISOString();
      } catch {}
      return {
        path: f.path,
        editable: f.editable,
        size: f.size,
        modified: mtime,
      };
    });

    res.json({ files: result });
  } catch (error) {
    console.error('Get portal files error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/file/*', (req: Request, res: Response) => {
  try {
    const filePath = req.params[0];
    if (!validatePortalPath(filePath)) {
      res.status(400).json({ error: 'Invalid file path' });
      return;
    }
    if (!isEditable(filePath)) {
      res.status(400).json({ error: 'File is not editable (binary asset)' });
      return;
    }

    const diskPath = resolveDiskPath(filePath);
    let content: string | null = null;
    let mtime: string | null = null;

    try {
      content = fs.readFileSync(diskPath, 'utf8');
      mtime = fs.statSync(diskPath).mtime.toISOString();
    } catch {}

    if (content === null) {
      content = getPortalDefaultContent(filePath);
      if (content === null) {
        res.status(404).json({ error: 'File not found' });
        return;
      }
    }

    res.json({ path: filePath, content, updated_at: mtime });
  } catch (error) {
    console.error('Get portal file error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/file/*', (req: Request, res: Response) => {
  try {
    const filePath = req.params[0];
    if (!validatePortalPath(filePath)) {
      res.status(400).json({ error: 'Invalid file path' });
      return;
    }
    if (!isEditable(filePath)) {
      res.status(400).json({ error: 'File is not editable (binary asset)' });
      return;
    }

    const { content } = req.body;
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    const diskPath = resolveDiskPath(filePath);
    fs.mkdirSync(path.dirname(diskPath), { recursive: true });
    fs.writeFileSync(diskPath, content, 'utf8');

    res.json({ message: 'File saved' });
  } catch (error: any) {
    console.error('Save portal file error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/reset/*', (req: Request, res: Response) => {
  try {
    const filePath = req.params[0];
    if (!validatePortalPath(filePath)) {
      res.status(400).json({ error: 'Invalid file path' });
      return;
    }
    if (!isEditable(filePath)) {
      res.status(400).json({ error: 'File is not editable (binary asset)' });
      return;
    }

    const content = getPortalDefaultContent(filePath);
    if (content === null) {
      res.status(500).json({ error: 'Default template not found on server' });
      return;
    }

    const diskPath = resolveDiskPath(filePath);
    fs.mkdirSync(path.dirname(diskPath), { recursive: true });
    fs.writeFileSync(diskPath, content, 'utf8');

    res.json({ message: 'File reset to default' });
  } catch (error: any) {
    console.error('Reset portal file error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/push-file/:routerId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (isNaN(routerId)) {
      res.status(400).json({ error: 'Invalid router id' });
      return;
    }

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const { file: filePath } = req.body;
    if (!filePath || typeof filePath !== 'string') {
      res.status(400).json({ error: 'file is required' });
      return;
    }

    if (!validatePortalPath(filePath)) {
      res.status(400).json({ error: 'Invalid file path' });
      return;
    }

    const routerPath = `hotspot/${filePath}`;
    const editable = isEditable(filePath);

    if (editable) {
      const diskPath = resolveDiskPath(filePath);
      let content: string;
      try {
        content = fs.readFileSync(diskPath, 'utf8');
      } catch {
        const def = getPortalDefaultContent(filePath);
        if (!def) {
          res.status(404).json({ error: 'File not found' });
          return;
        }
        content = def;
      }
      await mikroTikService.uploadFileSFTP(routerId, routerPath, content);
    } else {
      const fullPath = path.join(HOTSPOT_ROOT, filePath);
      const data = fs.readFileSync(fullPath);
      await mikroTikService.uploadFileSFTP(routerId, routerPath, data);
    }

    res.json({ message: `${filePath} pushed to router` });
  } catch (error: any) {
    console.error('Push single portal file error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/push/:routerId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (isNaN(routerId)) {
      res.status(400).json({ error: 'Invalid router id' });
      return;
    }

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const allFiles = listHotspotFiles();
    const results: { file: string; ok: boolean; error?: string }[] = [];

    for (const f of allFiles) {
      try {
        const routerPath = `hotspot/${f.path}`;
        if (f.editable) {
          const diskPath = resolveDiskPath(f.path);
          let content: string;
          try {
            content = fs.readFileSync(diskPath, 'utf8');
          } catch {
            const def = getPortalDefaultContent(f.path);
            if (!def) {
              results.push({ file: f.path, ok: false, error: 'File not found' });
              continue;
            }
            content = def;
          }
          await mikroTikService.uploadFileSFTP(routerId, routerPath, content);
        } else {
          const fullPath = path.join(HOTSPOT_ROOT, f.path);
          const data = fs.readFileSync(fullPath);
          await mikroTikService.uploadFileSFTP(routerId, routerPath, data);
        }
        results.push({ file: f.path, ok: true });
      } catch (err: any) {
        results.push({ file: f.path, ok: false, error: err.message });
      }
    }

    const failed = results.filter((r) => !r.ok);
    res.json({
      message: failed.length === 0
        ? `All ${results.length} files pushed to router`
        : `${failed.length} of ${results.length} file(s) failed to push`,
      results,
    });
  } catch (error: any) {
    console.error('Push portal files error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
