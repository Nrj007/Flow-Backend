import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '../../constants/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { scopeToShop } from '../../middleware/scopeToShop.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../middleware/errorHandler.js';
import { recordCustomerSale } from '../customers/customer.repository.js';
import { saveOrderReceipt } from '../receipts/receipt.repository.js';
import {
  createOnsiteOrder,
  createOrder,
  listShopOrders,
  listStudentOrders,
  ORDER_STATUS,
  updateOrderItems,
  updateOrderStatus,
} from './order.repository.js';

const placeOrderSchema = z.object({
  body: z.object({
    shopId: z.string().uuid(),
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantity: z.number().int().positive(),
          discPct: z.number().min(0).max(100).optional(),
        })
      )
      .min(1),
  }),
});

const onsiteOrderSchema = z.object({
  body: z.object({
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantity: z.number().int().positive(),
          discPct: z.number().min(0).max(100).optional(),
        })
      )
      .min(1),
    customerName: z.string().optional(),
    customerId: z.string().uuid().optional().nullable(),
    customerEmail: z.string().optional().nullable(),
    customerPhone: z.string().optional().nullable(),
    paymentMethod: z.enum(['cash', 'upi']).optional(),
    cashReceived: z.number().optional().nullable(),
    changeAmount: z.number().optional().nullable(),
    receiptTemplateId: z.string().uuid().optional().nullable(),
    receiptTemplateName: z.string().optional().nullable(),
    receiptHtml: z.string().optional().nullable(),
    fulfillImmediately: z.boolean().optional(),
  }),
});

const updateStatusSchema = z.object({
  body: z.object({
    status: z.enum(['pending', 'confirmed', 'fulfilled', 'cancelled']),
  }),
});

const updateItemsSchema = z.object({
  body: z.object({
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantity: z.number().int().nonnegative(),
        })
      )
      .min(1),
  }),
});

function mapOrderError(err, next) {
  if (
    err.message?.includes('Insufficient stock') ||
    err.message?.includes('not found') ||
    err.message?.includes('Cannot change status') ||
    err.message?.includes('Only pending') ||
    err.message?.includes('Cannot edit') ||
    err.message?.includes('must have at least')
  ) {
    return next(new AppError(err.message, 400, 'ORDER_ERROR'));
  }
  return next(err);
}

const studentRouter = Router();

studentRouter.post(
  '/',
  authenticate,
  authorize(ROLES.STUDENT),
  validate(placeOrderSchema),
  async (req, res, next) => {
    try {
      const order = await createOrder({
        studentId: req.user.userId,
        shopId: req.body.shopId,
        items: req.body.items,
      });
      res.status(201).json({ success: true, data: order });
    } catch (err) {
      mapOrderError(err, next);
    }
  }
);

studentRouter.get(
  '/',
  authenticate,
  authorize(ROLES.STUDENT),
  async (req, res, next) => {
    try {
      const orders = await listStudentOrders(req.user.userId);
      res.json({ success: true, data: orders });
    } catch (err) {
      next(err);
    }
  }
);

const shopRouter = Router({ mergeParams: true });

const shopOrderAuth = [
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.SHOP_MANAGER, ROLES.SHOP_STAFF),
  scopeToShop('shopId'),
];

shopRouter.get('/', shopOrderAuth, async (req, res, next) => {
  try {
    const orders = await listShopOrders(req.params.shopId);
    res.json({ success: true, data: orders });
  } catch (err) {
    next(err);
  }
});

shopRouter.post(
  '/onsite',
  [...shopOrderAuth, validate(onsiteOrderSchema)],
  async (req, res, next) => {
    try {
      const paymentMethod = req.body.paymentMethod === 'cash' ? 'cash' : 'upi';
      const customerName = req.body.customerName || 'Customer';

      let pointsEarned = 0;
      let linkedCustomerId = req.body.customerId || null;

      const order = await createOnsiteOrder({
        shopId: req.params.shopId,
        items: req.body.items,
        createdBy: req.user.userId,
        customerName,
        customerId: linkedCustomerId,
        customerEmail: req.body.customerEmail,
        customerPhone: req.body.customerPhone,
        paymentMethod,
        cashReceived: req.body.cashReceived != null ? Number(req.body.cashReceived) : null,
        changeAmount: req.body.changeAmount != null ? Number(req.body.changeAmount) : null,
        pointsEarned: 0,
        receiptTemplateId: req.body.receiptTemplateId || null,
        receiptTemplateName: req.body.receiptTemplateName || null,
        fulfillImmediately: req.body.fulfillImmediately ?? true,
      });

      if (req.body.fulfillImmediately ?? true) {
        const saleResult = await recordCustomerSale(req.params.shopId, {
          customerId: linkedCustomerId,
          name: req.body.customerName,
          email: req.body.customerEmail,
          phone: req.body.customerPhone,
          orderTotal: order.total,
        });
        pointsEarned = saleResult.pointsEarned;
        if (saleResult.customer) {
          linkedCustomerId = saleResult.customer.customerId;
          order.customerId = linkedCustomerId;
          order.pointsEarned = pointsEarned;
        }
      }

      if (req.body.receiptHtml) {
        await saveOrderReceipt(req.params.shopId, {
          orderId: order.orderId,
          templateId: req.body.receiptTemplateId,
          templateName: req.body.receiptTemplateName,
          html: req.body.receiptHtml,
          createdBy: req.user.userId,
        });
      }

      res.status(201).json({
        success: true,
        data: {
          ...order,
          customerId: linkedCustomerId,
          pointsEarned,
          cashReceived: order.cashReceived,
          changeAmount: order.changeAmount,
        },
      });
    } catch (err) {
      mapOrderError(err, next);
    }
  }
);

shopRouter.patch(
  '/:orderId/status',
  [...shopOrderAuth, validate(updateStatusSchema)],
  async (req, res, next) => {
    try {
      const order = await updateOrderStatus(
        req.params.shopId,
        req.params.orderId,
        req.body.status,
        req.user.userId
      );
      if (!order) throw new AppError('Order not found', 404, 'NOT_FOUND');
      res.json({ success: true, data: order });
    } catch (err) {
      mapOrderError(err, next);
    }
  }
);

shopRouter.put(
  '/:orderId/items',
  [...shopOrderAuth, validate(updateItemsSchema)],
  async (req, res, next) => {
    try {
      const order = await updateOrderItems(
        req.params.shopId,
        req.params.orderId,
        req.body.items
      );
      if (!order) throw new AppError('Order not found', 404, 'NOT_FOUND');
      res.json({ success: true, data: order });
    } catch (err) {
      mapOrderError(err, next);
    }
  }
);

export { studentRouter, shopRouter, ORDER_STATUS };
