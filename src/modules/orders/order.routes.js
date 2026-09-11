import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS } from '../../constants/permissions.js';
import { normalizePaymentMethod, ORDER_SUB_TYPES, PAYMENT_STATUS } from '../../constants/payments.js';
import { ROLES } from '../../constants/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { scopeToShop } from '../../middleware/scopeToShop.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../middleware/errorHandler.js';
import { recordCustomerSale, reverseCustomerSale } from '../customers/customer.repository.js';
import { computePointsForAmount, getRewardsConfig } from '../rewards/rewards.repository.js';
import { saveOrderReceipt } from '../receipts/receipt.repository.js';
import { createAuditEntry, AUDIT_ACTIONS } from '../audit/audit.repository.js';
import { getCurrentShift } from '../shifts/shift.repository.js';
import { createNotification } from '../notifications/notification.repository.js';
import { redeemVoucher } from '../gift-vouchers/gift-voucher.repository.js';
import {
  createOnsiteOrder,
  createOrder,
  createOrderAdjustment,
  getShopOrder,
  listOrderAdjustments,
  listShopOrders,
  listStudentOrders,
  cancelStudentOrder,
  ORDER_STATUS,
  updateOrderItems,
  updateOrderLoyalty,
  updateOrderStatus,
  settleDuePayment,
} from './order.repository.js';
import { getDepartment } from '../departments/department.repository.js';
import { listShopUsers } from '../users/user.repository.js';
import { initSSEConnection, sendToUser, sendToShop, userClients, shopClients } from '../../utils/sse.js';

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
    paymentMethod: z.enum(['cash', 'upi', 'card', 'dept_quota', 'due', 'other']).optional(),
    paymentStatus: z.enum(['paid', 'due']).optional(),
    deptId: z.string().uuid().optional().nullable(),
    deptName: z.string().optional().nullable(),
    requisitionRef: z.string().optional().nullable(),
    authorizedBy: z.string().optional().nullable(),
    cashReceived: z.number().optional().nullable(),
    changeAmount: z.number().optional().nullable(),
    pointsRedeemed: z.number().nonnegative().optional(),
    pointsDiscount: z.number().nonnegative().optional(),
    voucherCode: z.string().optional().nullable(),
    voucherDiscount: z.number().nonnegative().optional(),
    receiptTemplateId: z.string().uuid().optional().nullable(),
    receiptTemplateName: z.string().optional().nullable(),
    receiptHtml: z.string().optional().nullable(),
    fulfillImmediately: z.boolean().optional(),
    orderSubType: z.enum(['sale', 'kot']).optional(),
    billingAction: z.enum(['save', 'save_print', 'ebill', 'kot', 'kot_print', 'settle']).optional(),
    isEbill: z.boolean().optional(),
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

const adjustOrderSchema = z.object({
  body: z.object({
    type: z.enum(['return', 'refund', 'credit_note']),
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantity: z.number().int().positive(),
        })
      )
      .min(1),
  }),
  params: z.object({ shopId: z.string().uuid(), orderId: z.string().uuid() }),
});

const settleDueSchema = z.object({
  body: z.object({
    paymentMethod: z.enum(['cash', 'upi', 'card', 'other']),
    cashReceived: z.number().optional().nullable(),
    changeAmount: z.number().optional().nullable(),
  }),
  params: z.object({ shopId: z.string().uuid(), orderId: z.string().uuid() }),
});

function mapOrderError(err, next) {
  if (
    err.message?.includes('Insufficient stock') ||
    err.message?.includes('not found') ||
    err.message?.includes('Cannot change status') ||
    err.message?.includes('Only pending') ||
    err.message?.includes('Cannot edit') ||
    err.message?.includes('must have at least') ||
    err.message?.includes('Only fulfilled') ||
    err.message?.includes('Cannot return') ||
    err.message?.includes('Cannot refund') ||
    err.message?.includes('Adjustment') ||
    err.message?.includes('Select at least') ||
    err.message?.includes('outstanding due') ||
    err.message?.includes('collection method') ||
    err.message?.includes('Department is required') ||
    err.message?.includes('Insufficient department quota') ||
    err.message?.includes('Could not complete sale')
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
      await createNotification({
        userId: req.user.userId,
        shopId: req.body.shopId,
        type: 'order_placed',
        title: 'Order placed',
        body: `Order ${order.orderId.slice(-8)} was placed successfully.`,
      });
      // Push real-time SSE event to shop managers/staff watching this shop
      sendToShop(req.body.shopId, 'order:new', {
        orderId: order.orderId,
        status: order.status,
        shopId: req.body.shopId,
        order,
      });
      // Notify shop managers and staff so their notification badge & inbox update in real time
      listShopUsers(req.body.shopId)
        .then((users) => {
          for (const u of users) {
            if (u.userId) {
              createNotification({
                userId: u.userId,
                shopId: req.body.shopId,
                type: 'order_received',
                title: 'New order received',
                body: `Order ${order.orderId.slice(-8)} was received.`,
              }).catch(() => {});
            }
          }
        })
        .catch(() => {});
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

studentRouter.post(
  '/:orderId/cancel',
  authenticate,
  authorize(ROLES.STUDENT),
  async (req, res, next) => {
    try {
      const order = await cancelStudentOrder({
        studentId: req.user.userId,
        orderId: req.params.orderId,
      });
      if (order?.shopId) {
        sendToShop(order.shopId, 'order:status', {
          orderId: order.orderId,
          status: order.status,
          shopId: order.shopId,
        });
      }
      sendToUser(req.user.userId, 'order:status', {
        orderId: order.orderId,
        status: order.status,
      });
      res.json({ success: true, data: order });
    } catch (err) {
      mapOrderError(err, next);
    }
  }
);

/**
 * SSE stream — student receives live order-status pushes for their own orders.
 * GET /api/orders/events
 */
studentRouter.get(
  '/events',
  authenticate,
  authorize(ROLES.STUDENT),
  (req, res) => {
    const userId = req.user.userId;
    const cleanup = initSSEConnection(res, userId, userClients);
    req.on('close', cleanup);
  }
);

const shopRouter = Router({ mergeParams: true });

const shopOrderReadAuth = [
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.SHOP_MANAGER, ROLES.SHOP_STAFF),
  requirePermission(PERMISSIONS.ORDERS_VIEW),
  scopeToShop('shopId'),
];

const shopOrderManageAuth = [
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.SHOP_MANAGER, ROLES.SHOP_STAFF),
  requirePermission(PERMISSIONS.ORDERS_MANAGE),
  scopeToShop('shopId'),
];

shopRouter.get('/', shopOrderReadAuth, async (req, res, next) => {
  try {
    const result = await listShopOrders(req.params.shopId, {
      scope: req.query.scope || 'sales',
      source: req.query.source || 'all',
      from: req.query.from || undefined,
      to: req.query.to || undefined,
      status: req.query.status || undefined,
      orderType: req.query.orderType || undefined,
      paymentStatus: req.query.paymentStatus || undefined,
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * SSE stream — shop managers/staff receive live order-status pushes for their shop.
 * GET /api/shops/:shopId/orders/events
 */
shopRouter.get('/events', shopOrderReadAuth, (req, res) => {
  const shopId = req.params.shopId;
  const cleanup = initSSEConnection(res, shopId, shopClients);
  req.on('close', cleanup);
});

shopRouter.get('/:orderId', shopOrderReadAuth, async (req, res, next) => {
  try {
    const order = await getShopOrder(req.params.shopId, req.params.orderId);
    if (!order) throw new AppError('Order not found', 404, 'NOT_FOUND');
    const adjustments = await listOrderAdjustments(req.params.shopId, req.params.orderId);
    res.json({ success: true, data: { ...order, adjustments } });
  } catch (err) {
    next(err);
  }
});

shopRouter.post(
  '/onsite',
  [...shopOrderManageAuth, validate(onsiteOrderSchema)],
  async (req, res, next) => {
    try {
      const paymentMethod = normalizePaymentMethod(req.body.paymentMethod);
      const customerName = req.body.customerName || 'Customer';
      const currentShift = await getCurrentShift(req.params.shopId);
      if (!currentShift) {
        throw new AppError('Open a cash shift before completing a sale', 400, 'SHIFT_REQUIRED');
      }
      const orderSubType = req.body.orderSubType === ORDER_SUB_TYPES.KOT
        ? ORDER_SUB_TYPES.KOT
        : ORDER_SUB_TYPES.SALE;
      const fulfillImmediately = orderSubType === ORDER_SUB_TYPES.KOT
        ? false
        : (req.body.fulfillImmediately ?? true);

      if (paymentMethod === 'dept_quota') {
        if (!req.body.deptId) {
          throw new AppError('Department is required for dept quota payment', 400, 'ORDER_ERROR');
        }
        const dept = await getDepartment(req.params.shopId, req.body.deptId);
        if (!dept) {
          throw new AppError('Department not found', 404, 'NOT_FOUND');
        }
        req.body.deptName = req.body.deptName || dept.name;
        const remaining = Number(dept.remainingBalance) || 0;
        if (remaining <= 0) {
          throw new AppError('This department has no remaining quota', 400, 'ORDER_ERROR');
        }
      }

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
        paymentStatus: req.body.paymentStatus,
        cashReceived: req.body.cashReceived != null ? Number(req.body.cashReceived) : null,
        changeAmount: req.body.changeAmount != null ? Number(req.body.changeAmount) : null,
        shiftId: currentShift?.shiftId || null,
        pointsEarned: 0,
        pointsRedeemed: req.body.pointsRedeemed || 0,
        pointsDiscount: req.body.pointsDiscount || 0,
        voucherCode: req.body.voucherCode || null,
        voucherDiscount: req.body.voucherDiscount || 0,
        receiptTemplateId: req.body.receiptTemplateId || null,
        receiptTemplateName: req.body.receiptTemplateName || null,
        fulfillImmediately,
        orderSubType,
        billingAction: req.body.billingAction || null,
        isEbill: req.body.isEbill ?? false,
        deptId: req.body.deptId || null,
        deptName: req.body.deptName || null,
        requisitionRef: req.body.requisitionRef || null,
        authorizedBy: req.body.authorizedBy || null,
      });

      // If voucher code was used and discount > 0, redeem from voucher balance
      if (req.body.voucherCode && (Number(req.body.voucherDiscount) || 0) > 0) {
        try {
          await redeemVoucher(req.params.shopId, req.body.voucherCode, req.body.voucherDiscount, {
            orderId: order.orderId,
            note: `Redeemed on Order #${order.orderId.slice(0, 8)}`,
            actorUser: req.user,
          });
        } catch (vchErr) {
          console.error('Failed to auto-redeem voucher on checkout:', vchErr.message);
        }
      }

      if (fulfillImmediately) {
        const saleResult = await recordCustomerSale(req.params.shopId, {
          customerId: linkedCustomerId,
          name: req.body.customerName,
          email: req.body.customerEmail,
          phone: req.body.customerPhone,
          orderTotal: order.total,
          pointsRedeemed: req.body.pointsRedeemed || 0,
        });
        pointsEarned = saleResult.pointsEarned;
        if (saleResult.customer) {
          linkedCustomerId = saleResult.customer.customerId;
          order.customerId = linkedCustomerId;
          order.pointsEarned = pointsEarned;
          await updateOrderLoyalty(req.params.shopId, order.orderId, {
            customerId: linkedCustomerId,
            pointsEarned,
          });
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

      // Push real-time SSE event to shop managers/staff watching this shop
      sendToShop(req.params.shopId, 'order:new', {
        orderId: order.orderId,
        status: order.status,
        shopId: req.params.shopId,
        order,
      });

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
  [...shopOrderManageAuth, validate(updateStatusSchema)],
  async (req, res, next) => {
    try {
      const order = await updateOrderStatus(
        req.params.shopId,
        req.params.orderId,
        req.body.status,
        req.user.userId
      );
      if (!order) throw new AppError('Order not found', 404, 'NOT_FOUND');
      if (req.body.status === ORDER_STATUS.FULFILLED) {
        await createAuditEntry({
          shopId: req.params.shopId,
          action: AUDIT_ACTIONS.ORDER_FULFILLED,
          entityType: 'ORDER',
          entityId: order.orderId,
          actorId: req.user.userId,
          actorName: req.user.name,
          after: { status: order.status },
        });
      }
      if (order.studentId) {
        await createNotification({
          userId: order.studentId,
          shopId: req.params.shopId,
          type: `order_${req.body.status}`,
          title: `Order ${req.body.status}`,
          body: `Your order ${order.orderId.slice(-8)} is now ${req.body.status}.`,
        });
        // Push real-time SSE event to the student
        sendToUser(order.studentId, 'order:status', {
          orderId: order.orderId,
          status: req.body.status,
        });
      }
      // Push real-time SSE event to all shop staff/managers watching this shop
      sendToShop(req.params.shopId, 'order:status', {
        orderId: order.orderId,
        status: req.body.status,
      });
      res.json({ success: true, data: order });
    } catch (err) {
      mapOrderError(err, next);
    }
  }
);

shopRouter.put(
  '/:orderId/items',
  [...shopOrderManageAuth, validate(updateItemsSchema)],
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

shopRouter.post(
  '/:orderId/settle-due',
  [...shopOrderManageAuth, validate(settleDueSchema)],
  async (req, res, next) => {
    try {
      const order = await settleDuePayment(req.params.shopId, req.params.orderId, {
        paymentMethod: req.body.paymentMethod,
        cashReceived: req.body.cashReceived != null ? Number(req.body.cashReceived) : null,
        changeAmount: req.body.changeAmount != null ? Number(req.body.changeAmount) : null,
      });
      await createAuditEntry({
        shopId: req.params.shopId,
        action: 'due_payment_settled',
        entityType: 'ORDER',
        entityId: order.orderId,
        actorId: req.user.userId,
        actorName: req.user.name,
        after: {
          paymentMethod: order.paymentMethod,
          paymentStatus: order.paymentStatus,
          total: order.total,
        },
      });
      res.json({ success: true, data: order });
    } catch (err) {
      mapOrderError(err, next);
    }
  }
);

shopRouter.post(
  '/:orderId/adjust',
  [...shopOrderManageAuth, validate(adjustOrderSchema)],
  async (req, res, next) => {
    try {
      const result = await createOrderAdjustment(
        req.params.shopId,
        req.params.orderId,
        { type: req.body.type, items: req.body.items },
        req.user.userId
      );
      if (!result) throw new AppError('Order not found', 404, 'NOT_FOUND');

      const auditAction =
        req.body.type === 'return'
          ? AUDIT_ACTIONS.RETURN_PROCESSED
          : req.body.type === 'credit_note'
          ? 'credit_note_issued'
          : AUDIT_ACTIONS.REFUND_PROCESSED;

      await createAuditEntry({
        shopId: req.params.shopId,
        action: auditAction,
        entityType: 'ORDER',
        entityId: req.params.orderId,
        actorId: req.user.userId,
        actorName: req.user.name,
        after: {
          adjustmentOrderId: result.adjustmentOrder.orderId,
          items: req.body.items,
          creditNoteCode: result.creditNote?.code || null,
        },
      });

      let pointsReversed = 0;
      if (result.customerId && result.adjustmentTotal > 0) {
        const rewardsConfig = await getRewardsConfig(req.params.shopId);
        pointsReversed = computePointsForAmount(result.adjustmentTotal, rewardsConfig);
        await reverseCustomerSale(req.params.shopId, {
          customerId: result.customerId,
          amount: result.adjustmentTotal,
          points: pointsReversed,
          decrementOrderCount: false,
        });
      }

      res.status(201).json({
        success: true,
        data: {
          ...result.adjustmentOrder,
          parentOrderId: result.parentOrderId,
          adjustmentTotal: result.adjustmentTotal,
          pointsReversed,
          creditNote: result.creditNote || null,
        },
      });
    } catch (err) {
      mapOrderError(err, next);
    }
  }
);

export { studentRouter, shopRouter };
export { ORDER_STATUS } from './order.repository.js';
