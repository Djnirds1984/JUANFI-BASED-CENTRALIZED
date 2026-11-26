import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getDb } from '../database';
import { buildSalesReport, normalizeRange } from '../services/salesReport';
import { SHOP_SQL_SHIFT } from '../services/shopTime';

const router = Router();
router.use(authMiddleware);

// GET /api/sales/report?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=1000
// Aggregates sub-vendo coin counters, redeemed vouchers and paid GCash
// payments. Voucher/payment rows are filtered by the date range on the shop
// clock (UTC+8); sub-vendo counters are device lifetime totals (not
// date-filterable).
router.get('/report', async (req: Request, res: Response) => {
  try {
    const { from, to, limit } = req.query;
    const report = await buildSalesReport({
      from: typeof from === 'string' ? from : undefined,
      to: typeof to === 'string' ? to : undefined,
      limit: typeof limit === 'string' ? parseInt(limit, 10) : undefined,
    });
    res.json(report);
  } catch (error: any) {
    console.error('Sales report error:', error);
    res.status(500).json({ error: error.message || 'Failed to build sales report' });
  }
});

// DELETE /api/sales/aircoins/:id
// Drops one recorded coin sale from the ledger - a test sale, or one punched on
// the wrong machine. Only the report row goes: minutes already credited to a
// customer stay with them, so this corrects the books, not somebody's time.
router.delete('/aircoins/:id', (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid sale id' });
  }
  try {
    const info = getDb().prepare('DELETE FROM aircoins_sales WHERE id = ?').run(id);
    res.json({ deleted: info.changes });
  } catch (error: any) {
    console.error('Delete AirCoins sale error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete sale' });
  }
});

// DELETE /api/sales/aircoins?from=YYYY-MM-DD&to=YYYY-MM-DD
// Clears every sale inside the range the report is showing. Missing dates fall
// back to today, the same default the report uses, so an accidental call can
// never wipe the whole ledger.
router.delete('/aircoins', (req: Request, res: Response) => {
  const { from, to } = normalizeRange(
    typeof req.query.from === 'string' ? req.query.from : undefined,
    typeof req.query.to === 'string' ? req.query.to : undefined,
  );
  try {
    const info = getDb()
      .prepare(`DELETE FROM aircoins_sales WHERE date(created_at, '${SHOP_SQL_SHIFT}') BETWEEN ? AND ?`)
      .run(from, to);
    res.json({ deleted: info.changes, from, to });
  } catch (error: any) {
    console.error('Delete AirCoins sales error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete sales' });
  }
});

export default router;