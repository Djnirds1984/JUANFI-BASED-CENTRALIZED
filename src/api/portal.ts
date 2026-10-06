import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { getDb, getPortalDefaultContent, listHotspotFiles, EDITABLE_EXTENSIONS } from '../database';
import { mikroTikService } from '../services/mikrotik';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

function validatePortalPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.includes('..')) return false;
  const hotspotRoot = path.resolve(__dirname, '..', '..', 'hotspot');
  const full = path.resolve(__dirname, '..', '..', 'hotspot', normalized);
  return full.startsWith(hotspotRoot + path.sep) || full === hotspotRoot;
}

function isEditable(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return EDITABLE_EXTENSIONS.has(ext);
}

function upsertPortalFile(filePath: string, content: string): any {
  const db = getDb();
  db.prepare(
    `INSERT INTO portal_files (path, content, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
  ).run(filePath, content);
  return db.prepare('SELECT path, content, updated_at FROM portal_files WHERE path = ?').get(filePath);
}

router.get('/', (req: Request, res: Response) => {
  try {
    const files = listHotspotFiles();
    const db = getDb();
    const dbRows = db.prepare('SELECT path, updated_at FROM portal_files').all() as any[];
    const dbMap = new Map(dbRows.map((r: any) => [r.path, r.updated_at]));

    const result = files.map((f) => ({
      path: f.path,
      editable: f.editable,
      size: f.size,
      modified: dbMap.get(f.path) || null,
    }));

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

    const db = getDb();
    const row = db.prepare('SELECT path, content, updated_at FROM portal_files WHERE path = ?').get(filePath) as any;
    if (!row) {
      const content = getPortalDefaultContent(filePath);
      if (content === null) {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      res.json({ path: filePath, content, updated_at: null });
      return;
    }
    res.json(row);
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

    const row = upsertPortalFile(filePath, content);

    const diskPath = path.join(__dirname, '..', '..', 'hotspot', filePath);
    try {
      fs.mkdirSync(path.dirname(diskPath), { recursive: true });
      fs.writeFileSync(diskPath, content, 'utf8');
    } catch (err: any) {
      console.warn(`Could not write file to disk: ${err.message}`);
    }

    res.json({ message: 'File saved', file: row });
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

    const row = upsertPortalFile(filePath, content);

    const diskPath = path.join(__dirname, '..', '..', 'hotspot', filePath);
    try {
      fs.mkdirSync(path.dirname(diskPath), { recursive: true });
      fs.writeFileSync(diskPath, content, 'utf8');
    } catch (err: any) {
      console.warn(`Could not write file to disk: ${err.message}`);
    }

    res.json({ message: 'File reset to default', file: row });
  } catch (error: any) {
    console.error('Reset portal file error:', error);
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
    const db = getDb();
    const hotspotRoot = path.resolve(__dirname, '..', '..', 'hotspot');
    const results: { file: string; ok: boolean; error?: string }[] = [];

    for (const f of allFiles) {
      try {
        const routerPath = `hotspot/${f.path}`;
        if (f.editable) {
          const row = db.prepare('SELECT content FROM portal_files WHERE path = ?').get(f.path) as any;
          const content: string = row ? row.content : getPortalDefaultContent(f.path)!;
          await mikroTikService.uploadFile(routerId, routerPath, content);
        } else {
          const fullPath = path.join(hotspotRoot, f.path);
          const data = fs.readFileSync(fullPath);
          await mikroTikService.uploadFile(routerId, routerPath, data);
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
