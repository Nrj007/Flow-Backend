import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS } from '../../constants/permissions.js';
import { ROLES } from '../../constants/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { scopeToShop } from '../../middleware/scopeToShop.js';
import { validate } from '../../middleware/validate.js';
import { createAuditEntry, AUDIT_ACTIONS } from '../audit/audit.repository.js';
import { getSalesReport, reportToCsv } from './report.repository.js';

const querySchema = z.object({
  query: z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    timeZone: z.string().min(1).optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  }),
});

const readAuth = [authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.SHOP_MANAGER), requirePermission(PERMISSIONS.REPORTS_VIEW), scopeToShop('shopId')];
const exportAuth = [authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.SHOP_MANAGER), requirePermission(PERMISSIONS.REPORTS_EXPORT), scopeToShop('shopId')];
const router = Router({ mergeParams: true });

router.get('/sales', [...readAuth, validate(querySchema)], async (req, res, next) => {
  try { res.json({ success: true, data: await getSalesReport(req.params.shopId, req.query) }); } catch (err) { next(err); }
});

router.get('/sales.csv', [...exportAuth, validate(querySchema)], async (req, res, next) => {
  try {
    const report = await getSalesReport(req.params.shopId, req.query);
    await createAuditEntry({ shopId: req.params.shopId, action: AUDIT_ACTIONS.REPORT_EXPORTED, entityType: 'REPORT', actorId: req.user.userId, actorName: req.user.name, meta: { format: 'csv', from: req.query.from, to: req.query.to } });
    res.type('text/csv').attachment(`sales-${req.params.shopId}.csv`).send(reportToCsv(report));
  } catch (err) { next(err); }
});

export default router;