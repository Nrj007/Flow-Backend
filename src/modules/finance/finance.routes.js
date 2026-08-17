import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS } from '../../constants/permissions.js';
import { FINANCE_ALLOWED_ROLES } from '../../constants/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize, blockStaffFromFinance } from '../../middleware/authorize.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { scopeToShop } from '../../middleware/scopeToShop.js';
import { validate } from '../../middleware/validate.js';
import {
  createExpenditure,
  createTransaction,
  getDailySummaries,
  getDaySummary,
  getFinanceSummary,
  listExpenditures,
  listTransactions,
  setDayOpeningBalance,
} from './finance.repository.js';

const EXPENDITURE_CATEGORIES = ['restocking', 'utilities', 'salary', 'maintenance', 'misc'];
const PAYMENT_MODES = ['cash', 'upi', 'card', 'bank_transfer', 'other'];

const txnSchema = z.object({
  body: z.object({
    type: z.enum(['income', 'expense']),
    amount: z.number().positive(),
    note: z.string().optional(),
  }),
});

const expenditureSchema = z.object({
  body: z.object({
    category: z.enum(EXPENDITURE_CATEGORIES),
    amount: z.number().positive(),
    vendor: z.string().min(1, 'Vendor / Paid To is required'),
    paymentMode: z.enum(PAYMENT_MODES),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    note: z.string().optional(),
    receiptUrl: z.string().url().optional().or(z.literal('')),
  }),
});

const dayBalanceSchema = z.object({
  body: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    openingBalance: z.number(),
  }),
});

const financeAuth = [
  authenticate,
  blockStaffFromFinance,
  authorize(...FINANCE_ALLOWED_ROLES),
  requirePermission(PERMISSIONS.FINANCE_MANAGE),
  scopeToShop('shopId'),
];

const router = Router({ mergeParams: true });

router.get('/summary', financeAuth, async (req, res, next) => {
  try {
    const { date, from, to } = req.query;
    const summary = await getFinanceSummary(req.params.shopId, { date, from, to });
    res.json({ success: true, data: summary });
  } catch (err) {
    next(err);
  }
});

router.get('/daily', financeAuth, async (req, res, next) => {
  try {
    const { date, from, to } = req.query;
    if (date) {
      const day = await getDaySummary(req.params.shopId, date);
      return res.json({ success: true, data: day });
    }
    const days = await getDailySummaries(req.params.shopId, { from, to });
    res.json({ success: true, data: days });
  } catch (err) {
    next(err);
  }
});

router.put(
  '/day-balance',
  [...financeAuth, validate(dayBalanceSchema)],
  async (req, res, next) => {
    try {
      const item = await setDayOpeningBalance(
        req.params.shopId,
        req.body.date,
        req.body.openingBalance,
        req.user.userId
      );
      res.json({ success: true, data: item });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/', financeAuth, async (req, res, next) => {
  try {
    const { date, from, to } = req.query;
    const transactions = await listTransactions(req.params.shopId, { date, from, to });
    res.json({ success: true, data: transactions });
  } catch (err) {
    next(err);
  }
});

router.post('/', [...financeAuth, validate(txnSchema)], async (req, res, next) => {
  try {
    const txn = await createTransaction(req.params.shopId, {
      ...req.body,
      createdBy: req.user.userId,
    });
    res.status(201).json({ success: true, data: txn });
  } catch (err) {
    next(err);
  }
});

// ── Expenditure routes ────────────────────────────────────────────────────────

router.get('/expenditure', financeAuth, async (req, res, next) => {
  try {
    const { date, from, to } = req.query;
    const expenditures = await listExpenditures(req.params.shopId, { date, from, to });
    res.json({ success: true, data: expenditures });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/expenditure',
  [...financeAuth, validate(expenditureSchema)],
  async (req, res, next) => {
    try {
      const expenditure = await createExpenditure(req.params.shopId, {
        ...req.body,
        recordedBy: req.user.userId,
      });
      res.status(201).json({ success: true, data: expenditure });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
