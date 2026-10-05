import { Router, Request, Response } from 'express';
import { getDb, getPortalDefaultContent, PORTAL_FILE_NAMES } from '../database';
import { mikroTikService } from '../services/mikrotik';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

function isValidFilename(name: string): boolean {
  return (PORTAL_FILE_NAMES as readonly string[]).includes(name);
}

function upsertPortalFile(name: string, content: string): any {
  const db = getDb();
  db.prepare(
    `INSERT INTO portal_files (name, content, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(name) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
  ).run(name, content);
  return db.prepare('SELECT name, content, updated_at FROM portal_files WHERE name = ?').get(name);
}

router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const files = db
      .prepare('SELECT name, length(content) AS size, updated_at FROM portal_files ORDER BY rowid')
      .all();
    res.json({ files: files || [] });
  } catch (error) {
    console.error('Get portal files error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/file/:name', (req: Request, res: Response) => {
  try {
    const name = req.params.name;
    if (!isValidFilename(name)) {
      res.status(400).json({ error: 'Unknown portal file' });
      return;
    }

    const db = getDb();
    const row = db.prepare('SELECT name, content, updated_at FROM portal_files WHERE name = ?').get(name) as any;
    if (!row) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.json(row);
  } catch (error) {
    console.error('Get portal file error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/file/:name', (req: Request, res: Response) => {
  try {
    const name = req.params.name;
    if (!isValidFilename(name)) {
      res.status(400).json({ error: 'Unknown portal file' });
      return;
    }

    const { content } = req.body;
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    const row = upsertPortalFile(name, content);
    res.json({ message: 'File saved', file: row });
  } catch (error: any) {
    console.error('Save portal file error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/reset/:name', (req: Request, res: Response) => {
  try {
    const name = req.params.name;
    if (!isValidFilename(name)) {
      res.status(400).json({ error: 'Unknown portal file' });
      return;
    }

    const content = getPortalDefaultContent(name);
    if (content === null) {
      res.status(500).json({ error: 'Default template not found on server' });
      return;
    }

    const row = upsertPortalFile(name, content);
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

    const requested = req.body?.files;
    const names =
      Array.isArray(requested) && requested.length > 0
        ? requested.filter((n: any) => typeof n === 'string' && isValidFilename(n))
        : [...PORTAL_FILE_NAMES];

    if (names.length === 0) {
      res.status(400).json({ error: 'No valid files to push' });
      return;
    }

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const db = getDb();
    const results: { file: string; ok: boolean; error?: string }[] = [];

    for (const name of names) {
      const row = db.prepare('SELECT content FROM portal_files WHERE name = ?').get(name) as any;
      if (!row) {
        results.push({ file: name, ok: false, error: 'Not found in local database' });
        continue;
      }
      try {
        await mikroTikService.uploadFile(routerId, name, row.content);
        results.push({ file: name, ok: true });
      } catch (err: any) {
        results.push({ file: name, ok: false, error: err.message });
      }
    }

    const failed = results.filter((r) => !r.ok);
    res.json({
      message: failed.length === 0 ? 'All files pushed to router' : `${failed.length} file(s) failed to push`,
      results,
    });
  } catch (error: any) {
    console.error('Push portal files error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
