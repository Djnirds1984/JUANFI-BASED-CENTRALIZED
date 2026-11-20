import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { buildSalesReport } from '../services/salesReport';

const router = Router();
router.use(authMiddleware);

// GET /api/sales/report?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=1000
// Aggregates sub-vendo coin counters, redeemed vouchers and paid GCash
// payments. Voucher/payment rows are filtered by the UTC date range;
// sub-vendo counters are device lifetime totals (not date-filterable).
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

export default router;