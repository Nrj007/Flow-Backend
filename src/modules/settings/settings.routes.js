import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '../../constants/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../middleware/errorHandler.js';
import { createAuditEntry, AUDIT_ACTIONS } from '../audit/audit.repository.js';
import { getSettings, updateSettings } from './settings.repository.js';

const settingsSchema = z.object({
  body: z.object({
    profile: z.object({ name: z.string().min(1).optional() }).optional(),
    notifications: z.object({
      orderAlerts: z.boolean(),
      lowStockAlerts: z.boolean(),
    }).optional(),
    shop: z.object({
      taxPercent: z.number().min(0).max(100),
      receipt: z.object({
        showTax: z.boolean(),
        footer: z.string().max(500),
      }),
    }).optional(),
  }),
});

const router = Router();

router.get('/', authenticate, async (req, res, next) => {
  try {
    res.json({ success: true, data: await getSettings(req.user) });
  } catch (err) {
    next(err);
  }
});

router.put('/', authenticate, validate(settingsSchema), async (req, res, next) => {
  try {
    if (
      req.body.shop &&
      ![ROLES.SUPER_ADMIN, ROLES.SHOP_MANAGER].includes(req.user.role)
    ) {
      throw new AppError('Only shop managers can update shop settings', 403, 'FORBIDDEN');
    }
    const data = await updateSettings(req.user, req.body);
    if (req.user.shopId) {
      await createAuditEntry({
        shopId: req.user.shopId,
        action: AUDIT_ACTIONS.SETTINGS_CHANGED,
        entityType: 'SETTINGS',
        actorId: req.user.userId,
        actorName: req.user.name,
        after: req.body,
      });
    }
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

export default router;