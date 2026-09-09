/**
 * Product field helpers for inventory/orders — legacy + new schema.
 */

export function getUnitPrice(product) {
  return Number(product?.unitPrice ?? product?.price ?? 0);
}

export function getStockQty(product) {
  return Number(product?.quantityInStock ?? product?.quantity ?? 0);
}

export function getReorderThreshold(product) {
  const t = product?.reorderThreshold;
  return t === undefined || t === null ? 5 : Number(t);
}

export function isLowStock(product) {
  return getStockQty(product) <= getReorderThreshold(product);
}

export function isOutOfStock(product) {
  return getStockQty(product) <= 0;
}

export function isProductActive(product) {
  return (product?.status || 'active') === 'active';
}

export function getTaxPercent(product) {
  return Math.max(0, Math.min(100, Number(product?.taxPercent ?? 0)));
}

/**
 * Returns days difference between today and the expiry date.
 * Negative number means already expired.
 */
export function getDaysToExpiry(expiryDate, now = new Date()) {
  if (!expiryDate) return null;
  const target = new Date(expiryDate);
  if (isNaN(target.getTime())) return null;

  // Compare on midnight boundaries in local timezone
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const expDay = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const diffTime = expDay.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Determines expiry status: 'expired' | 'near_expiry' | 'valid' | 'none'
 */
export function getExpiryStatus(product, warningDays = 30, now = new Date()) {
  const dateStr = product?.expiryDate;
  if (!dateStr) return { status: 'none', daysRemaining: null };

  const days = getDaysToExpiry(dateStr, now);
  if (days === null) return { status: 'none', daysRemaining: null };

  if (days < 0) {
    return { status: 'expired', daysRemaining: days };
  }
  if (days <= warningDays) {
    return { status: 'near_expiry', daysRemaining: days };
  }
  return { status: 'valid', daysRemaining: days };
}

export function isExpired(product, now = new Date()) {
  return getExpiryStatus(product, 30, now).status === 'expired';
}

export function isNearExpiry(product, warningDays = 30, now = new Date()) {
  const status = getExpiryStatus(product, warningDays, now).status;
  return status === 'near_expiry' || status === 'expired';
}

export function isBundle(product) {
  return !!product?.isBundle && Array.isArray(product?.bundleComponents) && product.bundleComponents.length > 0;
}

export function getBundleComponents(product) {
  return isBundle(product) ? product.bundleComponents : [];
}

/**
 * Calculates max possible bundle units given available stock of each component.
 */
export function computeBundleStock(bundle, productMap = {}) {
  const components = getBundleComponents(bundle);
  if (components.length === 0) return 0;

  let maxPossible = Infinity;
  for (const comp of components) {
    const compProduct = productMap[comp.productId] || comp;
    const availableStock = getStockQty(compProduct);
    const requiredPerBundle = Math.max(1, Number(comp.quantity) || 1);
    const possibleFromThisComp = Math.floor(availableStock / requiredPerBundle);
    if (possibleFromThisComp < maxPossible) {
      maxPossible = possibleFromThisComp;
    }
  }

  return maxPossible === Infinity ? 0 : Math.max(0, maxPossible);
}

export function normalizeProductInput(data) {
  const unitPrice = Number(data.unitPrice ?? data.price);
  const quantityInStock = Number(data.quantityInStock ?? data.quantity ?? 0);
  const costPrice = Number(data.costPrice ?? 0);
  const reorderThreshold = Number(data.reorderThreshold ?? 5);

  const batchNumber = data.batchNumber?.trim() || data.lotNumber?.trim() || null;
  const mfgDate = data.mfgDate ? String(data.mfgDate).trim().slice(0, 10) : null;
  const expiryDate = data.expiryDate ? String(data.expiryDate).trim().slice(0, 10) : null;

  const isBundleFlag = !!data.isBundle;
  const bundleComponents = Array.isArray(data.bundleComponents)
    ? data.bundleComponents.map((c) => ({
        productId: String(c.productId || ''),
        name: String(c.name || '').trim(),
        quantity: Math.max(1, Number(c.quantity) || 1),
        unitPrice: Number(c.unitPrice ?? c.price ?? 0),
      }))
    : [];

  return {
    name: String(data.name || '').trim(),
    category: String(data.category || 'general').trim() || 'general',
    description: data.description ?? '',
    sku: data.sku?.trim() || null,
    barcode: data.barcode?.trim() || data.sku?.trim() || null,
    batchNumber,
    lotNumber: batchNumber, // synonym for compatibility
    mfgDate,
    expiryDate,
    isBundle: isBundleFlag,
    bundleComponents,
    unitPrice,
    // keep legacy alias for older order deduct paths
    price: unitPrice,
    costPrice,
    quantityInStock,
    quantity: quantityInStock,
    unit: data.unit || 'piece',
    reorderThreshold,
    status: data.status || 'active',
    imageUrl: data.imageUrl?.trim() ? data.imageUrl.trim() : null,
    supplier: data.supplier
      ? {
          name: data.supplier.name?.trim() || '',
          contact: data.supplier.contact?.trim() || '',
        }
      : data.supplierName || data.supplierContact
        ? {
            name: String(data.supplierName || '').trim(),
            contact: String(data.supplierContact || '').trim(),
          }
        : null,
    availableOnline:
      data.availableOnline !== undefined
        ? !!data.availableOnline
        : (data.status || 'active') === 'active',
    taxPercent: Math.max(0, Math.min(100, Number(data.taxPercent ?? 0))),
  };
}


