import { Router } from 'express';
import { ROLES } from '../../constants/roles.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { scopeToShop } from '../../middleware/scopeToShop.js';
import { listAuditLog, AUDIT_ACTIONS } from './audit.repository.js';

const router = Router({ mergeParams: true });

const auditAuth = [
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.SHOP_MANAGER),
  requirePermission(PERMISSIONS.AUDIT_VIEW),
  scopeToShop('shopId'),
];

router.get('/', auditAuth, async (req, res, next) => {
  try {
    const { from, to, action, limit } = req.query;
    const entries = await listAuditLog(req.params.shopId, { from, to, action, limit });
    res.json({
      success: true,
      data: entries,
      meta: { actions: Object.values(AUDIT_ACTIONS) },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
