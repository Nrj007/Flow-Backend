import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS } from '../../constants/permissions.js';
import { INVENTORY_ALLOWED_ROLES } from '../../constants/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { scopeToShop } from '../../middleware/scopeToShop.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../middleware/errorHandler.js';
import {
  getStockQty,
  getUnitPrice,
  isProductActive,
  getExpiryStatus,
} from '../../utils/product.js';
import { generateCSV } from '../../utils/csv.js';
import { isOfferActive } from '../../utils/offer.js';
import { listOffers } from '../offers/offer.repository.js';
import { createAuditEntry, AUDIT_ACTIONS } from '../audit/audit.repository.js';
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  updateProduct,
  bulkCreateOrUpdateProducts,
} from './inventory.repository.js';

const supplierSchema = z
  .object({
    name: z.string().optional(),
    contact: z.string().optional(),
  })
  .optional()
  .nullable();

const productObjectSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  description: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  barcode: z.string().optional().nullable(),
  batchNumber: z.string().optional().nullable(),
  lotNumber: z.string().optional().nullable(),
  mfgDate: z.string().optional().nullable(),
  unitPrice: z.number().positive().optional(),
  price: z.number().positive().optional(), // legacy alias
  costPrice: z.number().min(0),
  quantityInStock: z.number().int().min(0).optional(),
  quantity: z.number().int().min(0).optional(), // legacy alias
  unit: z.string().min(1),
  reorderThreshold: z.number().int().min(0),
  status: z.enum(['active', 'inactive', 'discontinued']),
  imageUrl: z.union([z.string().url(), z.literal(''), z.null()]).optional(),
  supplier: supplierSchema,
  supplierName: z.string().optional().nullable(),
  supplierContact: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  availableOnline: z.boolean().optional(),
  taxPercent: z.number().min(0).max(100).optional(),
  isBundle: z.boolean().optional(),
  bundleComponents: z
    .array(
      z.object({
        productId: z.string(),
        name: z.string().optional(),
        quantity: z.number().int().positive().optional(),
        unitPrice: z.number().optional(),
      })
    )
    .optional(),
});

const productCreateBodySchema = productObjectSchema.superRefine((data, ctx) => {
  if (data.unitPrice === undefined && data.price === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'unitPrice is required',
      path: ['unitPrice'],
    });
  }
  if (data.quantityInStock === undefined && data.quantity === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'quantityInStock is required',
      path: ['quantityInStock'],
    });
  }
});

const createSchema = z.object({ body: productCreateBodySchema });
const updateSchema = z.object({
  body: productObjectSchema.partial(),
  params: z.object({ shopId: z.string().uuid(), productId: z.string().uuid() }),
});

const bulkImportSchema = z.object({
  body: z.object({
    items: z.array(z.record(z.any())).min(1, 'At least 1 product row is required'),
    duplicateStrategy: z.enum(['skip', 'update']).default('skip'),
  }),
});

const inventoryReadAuth = [
  authenticate,
  authorize(...INVENTORY_ALLOWED_ROLES),
  requirePermission(PERMISSIONS.INVENTORY_VIEW),
  scopeToShop('shopId'),
];

const inventoryManageAuth = [
  authenticate,
  authorize(...INVENTORY_ALLOWED_ROLES),
  requirePermission(PERMISSIONS.INVENTORY_MANAGE),
  scopeToShop('shopId'),
];

async function listHandler(req, res, next) {
  try {
    const products = await listProducts(req.params.shopId);
    res.json({ success: true, data: products });
  } catch (err) {
    next(err);
  }
}

async function getHandler(req, res, next) {
  try {
    const product = await getProduct(req.params.shopId, req.params.productId);
    if (!product) throw new AppError('Product not found', 404, 'NOT_FOUND');
    res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
}

async function createHandler(req, res, next) {
  try {
    const product = await createProduct(
      req.params.shopId,
      req.body,
      req.user.userId
    );
    await createAuditEntry({
      shopId: req.params.shopId,
      action: AUDIT_ACTIONS.PRODUCT_CREATED,
      entityType: 'PRODUCT',
      entityId: product.productId,
      actorId: req.user.userId,
      actorName: req.user.name,
      after: product,
    });
    res.status(201).json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
}

async function updateHandler(req, res, next) {
  try {
    const existing = await getProduct(req.params.shopId, req.params.productId);
    if (!existing) throw new AppError('Product not found', 404, 'NOT_FOUND');
    const product = await updateProduct(
      req.params.shopId,
      req.params.productId,
      req.body,
      req.user.userId
    );
    await createAuditEntry({
      shopId: req.params.shopId,
      action: existing.unitPrice !== product.unitPrice
        ? AUDIT_ACTIONS.PRICE_CHANGED
        : AUDIT_ACTIONS.PRODUCT_UPDATED,
      entityType: 'PRODUCT',
      entityId: product.productId,
      actorId: req.user.userId,
      actorName: req.user.name,
      before: existing,
      after: product,
    });
    res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
}

async function deleteHandler(req, res, next) {
  try {
    const existing = await getProduct(req.params.shopId, req.params.productId);
    if (!existing) throw new AppError('Product not found', 404, 'NOT_FOUND');
    await deleteProduct(req.params.shopId, req.params.productId);
    await createAuditEntry({
      shopId: req.params.shopId,
      action: AUDIT_ACTIONS.PRODUCT_UPDATED,
      entityType: 'PRODUCT',
      entityId: existing.productId,
      actorId: req.user.userId,
      actorName: req.user.name,
      before: existing,
      meta: { operation: 'deleted' },
    });
    res.json({ success: true, message: 'Product deleted' });
  } catch (err) {
    next(err);
  }
}

async function bulkImportHandler(req, res, next) {
  try {
    const { items, duplicateStrategy } = req.body;
    const shopId = req.params.shopId;

    // Intra-payload duplicate SKU check
    const seenSkus = new Set();
    const sanitizedItems = [];
    const internalErrors = [];

    items.forEach((item, index) => {
      const rowNum = item._rowIndex || index + 1;
      const name = String(item.name || '').trim();
      const sku = item.sku ? String(item.sku).trim() : null;
      const unitPrice = Number(item.unitPrice ?? item.price);
      const costPrice = Number(item.costPrice ?? 0);
      const quantityInStock = Number(item.quantityInStock ?? item.quantity ?? item.openingStock ?? 0);

      if (!name) {
        internalErrors.push({ row: rowNum, error: 'Product name is required', sku });
        return;
      }
      if (isNaN(unitPrice) || unitPrice <= 0) {
        internalErrors.push({ row: rowNum, error: 'Valid selling price (unitPrice > 0) is required', sku, name });
        return;
      }
      if (isNaN(quantityInStock) || quantityInStock < 0) {
        internalErrors.push({ row: rowNum, error: 'Valid stock quantity (>= 0) is required', sku, name });
        return;
      }

      if (sku) {
        const lowerSku = sku.toLowerCase();
        if (seenSkus.has(lowerSku) && duplicateStrategy === 'skip') {
          internalErrors.push({ row: rowNum, error: `Duplicate SKU "${sku}" found within uploaded CSV`, sku, name });
          return;
        }
        seenSkus.add(lowerSku);
      }

      sanitizedItems.push({
        _rowIndex: rowNum,
        name,
        category: item.category || 'general',
        sku,
        barcode: item.barcode ? String(item.barcode).trim() : sku,
        batchNumber: item.batchNumber || item.lotNumber || null,
        lotNumber: item.batchNumber || item.lotNumber || null,
        mfgDate: item.mfgDate || null,
        expiryDate: item.expiryDate || null,
        unitPrice,
        price: unitPrice,
        costPrice: isNaN(costPrice) ? 0 : costPrice,
        quantityInStock,
        quantity: quantityInStock,
        unit: item.unit || 'piece',
        reorderThreshold: Number(item.reorderThreshold ?? 5),
        status: ['active', 'inactive', 'discontinued'].includes(item.status) ? item.status : 'active',
        taxPercent: Number(item.taxPercent ?? 0),
        supplier: item.supplierName ? { name: item.supplierName, contact: item.supplierContact || '' } : item.supplier,
        description: item.description || '',
        availableOnline: item.availableOnline !== false && item.availableOnline !== 'false',
      });
    });

    const result = await bulkCreateOrUpdateProducts(shopId, sanitizedItems, {
      duplicateStrategy,
      actorUserId: req.user.userId,
    });

    result.errors.push(...internalErrors);
    result.errorCount = result.errors.length;

    await createAuditEntry({
      shopId,
      action: AUDIT_ACTIONS.PRODUCT_CREATED,
      entityType: 'INVENTORY_IMPORT',
      entityId: shopId,
      actorId: req.user.userId,
      actorName: req.user.name,
      meta: {
        total: items.length,
        created: result.createdCount,
        updated: result.updatedCount,
        skipped: result.skippedCount,
        errors: result.errorCount,
        strategy: duplicateStrategy,
      },
    });

    res.json({
      success: true,
      data: {
        total: items.length,
        importedCount: result.createdCount,
        updatedCount: result.updatedCount,
        skippedCount: result.skippedCount,
        errorCount: result.errorCount,
        errors: result.errors,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function exportHandler(req, res, next) {
  try {
    const products = await listProducts(req.params.shopId);
    const headers = [
      { key: 'name', label: 'Product Name' },
      { key: 'category', label: 'Category' },
      { key: 'sku', label: 'SKU' },
      { key: 'barcode', label: 'Barcode' },
      { key: 'batchNumber', label: 'Batch / Lot No' },
      { key: 'mfgDate', label: 'Mfg Date' },
      { key: 'expiryDate', label: 'Expiry Date' },
      { key: 'expiryStatus', label: 'Expiry Status' },
      { key: 'unitPrice', label: 'Selling Price' },
      { key: 'costPrice', label: 'Cost Price' },
      { key: 'taxPercent', label: 'Tax Percent' },
      { key: 'quantityInStock', label: 'Stock Qty' },
      { key: 'unit', label: 'Unit' },
      { key: 'reorderThreshold', label: 'Reorder Level' },
      { key: 'status', label: 'Status' },
      { key: 'supplierName', label: 'Supplier Name' },
      { key: 'supplierContact', label: 'Supplier Contact' },
      { key: 'availableOnline', label: 'Available Online' },
    ];

    const rows = products.map((p) => {
      const exp = getExpiryStatus(p);
      return {
        name: p.name || '',
        category: p.category || '',
        sku: p.sku || '',
        barcode: p.barcode || '',
        batchNumber: p.batchNumber || p.lotNumber || '',
        mfgDate: p.mfgDate || '',
        expiryDate: p.expiryDate || '',
        expiryStatus: exp.status,
        unitPrice: getUnitPrice(p),
        costPrice: p.costPrice ?? 0,
        taxPercent: p.taxPercent ?? 0,
        quantityInStock: getStockQty(p),
        unit: p.unit || 'piece',
        reorderThreshold: p.reorderThreshold ?? 5,
        status: p.status || 'active',
        supplierName: p.supplier?.name || '',
        supplierContact: p.supplier?.contact || '',
        availableOnline: p.availableOnline !== false ? 'Yes' : 'No',
      };
    });

    const csvData = generateCSV(headers, rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=inventory_${req.params.shopId}.csv`);
    res.send(csvData);
  } catch (err) {
    next(err);
  }
}

const router = Router({ mergeParams: true });

router.get('/', inventoryReadAuth, listHandler);
router.get('/export', inventoryReadAuth, exportHandler);
router.post('/bulk-import', [...inventoryManageAuth, validate(bulkImportSchema)], bulkImportHandler);
router.get('/:productId', inventoryReadAuth, getHandler);
router.post('/', [...inventoryManageAuth, validate(createSchema)], createHandler);
router.put('/:productId', [...inventoryManageAuth, validate(updateSchema)], updateHandler);
router.delete('/:productId', inventoryManageAuth, deleteHandler);

const publicRouter = Router({ mergeParams: true });

publicRouter.get('/', async (req, res, next) => {
  try {
    const products = await listProducts(req.params.shopId);
    const publicProducts = products
      .filter((p) => isProductActive(p) && p.availableOnline !== false)
      .map((p) => {
        const stock = getStockQty(p);
        const { quantity, quantityInStock, costPrice, ...rest } = p;
        return {
          ...rest,
          unitPrice: getUnitPrice(p),
          price: getUnitPrice(p),
          inStock: stock > 0,
        };
      });
    res.json({ success: true, data: publicProducts });
  } catch (err) {
    next(err);
  }
});

publicRouter.get('/offers', async (req, res, next) => {
  try {
    const offers = await listOffers(req.params.shopId);
    res.json({
      success: true,
      data: offers.filter((o) => isOfferActive(o)),
    });
  } catch (err) {
    next(err);
  }
});

export { router as inventoryRouter, publicRouter as publicProductsRouter };

