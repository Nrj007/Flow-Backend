import express from 'express';
import { ROLES } from '../../constants/roles.js';
import { AppError } from '../../middleware/errorHandler.js';
import {
  listDepartments,
  getDepartment,
  createDepartment,
  deleteDepartment,
  topUpDepartmentQuota,
  chargeDepartmentQuota,
  listDepartmentTransactions,
} from './department.repository.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { scopeToShop } from '../../middleware/scopeToShop.js';

const router = express.Router({ mergeParams: true });

const departmentAuth = [
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.SHOP_MANAGER, ROLES.SHOP_STAFF),
  scopeToShop('shopId'),
];

router.use(...departmentAuth);

router.get('/', async (req, res, next) => {
  try {
    const departments = await listDepartments(req.params.shopId);
    res.json({ success: true, data: departments });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    if (!String(req.body?.name || '').trim()) {
      throw new AppError('Department name is required', 400, 'DEPT_ERROR');
    }
    const department = await createDepartment(req.params.shopId, {
      ...req.body,
      createdBy: req.user?.userId,
    });
    res.status(201).json({ success: true, data: department });
  } catch (err) {
    next(err);
  }
});

router.get('/transactions', async (req, res, next) => {
  try {
    const transactions = await listDepartmentTransactions(req.params.shopId, req.query.deptId || null);
    res.json({ success: true, data: transactions });
  } catch (err) {
    next(err);
  }
});

router.get('/:deptId', async (req, res, next) => {
  try {
    const department = await getDepartment(req.params.shopId, req.params.deptId);
    if (!department) {
      return res.status(404).json({ success: false, message: 'Department not found' });
    }
    res.json({ success: true, data: department });
  } catch (err) {
    next(err);
  }
});

router.delete('/:deptId', async (req, res, next) => {
  try {
    const department = await deleteDepartment(req.params.shopId, req.params.deptId, {
      actorId: req.user?.userId,
      actorName: req.user?.name,
    });
    res.json({ success: true, data: department });
  } catch (err) {
    if (err.message === 'Department not found') {
      return next(new AppError(err.message, 404, 'NOT_FOUND'));
    }
    next(err);
  }
});

router.post('/:deptId/topup', async (req, res, next) => {
  try {
    const updated = await topUpDepartmentQuota(req.params.shopId, req.params.deptId, {
      ...req.body,
      actorId: req.user?.userId,
      actorName: req.user?.name,
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

router.post('/:deptId/charge', async (req, res, next) => {
  try {
    const updated = await chargeDepartmentQuota(req.params.shopId, req.params.deptId, {
      ...req.body,
      actorId: req.user?.userId,
      actorName: req.user?.name,
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
