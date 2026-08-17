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

export function normalizeProductInput(data) {
  const unitPrice = Number(data.unitPrice ?? data.price);
  const quantityInStock = Number(data.quantityInStock ?? data.quantity ?? 0);
  const costPrice = Number(data.costPrice ?? 0);
  const reorderThreshold = Number(data.reorderThreshold ?? 5);

  return {
    name: String(data.name || '').trim(),
    category: String(data.category || 'general').trim() || 'general',
    description: data.description ?? '',
    sku: data.sku?.trim() || null,
    barcode: data.barcode?.trim() || data.sku?.trim() || null,
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
    expiryDate: data.expiryDate || null,
    availableOnline:
      data.availableOnline !== undefined
        ? !!data.availableOnline
        : (data.status || 'active') === 'active',
    taxPercent: Math.max(0, Math.min(100, Number(data.taxPercent ?? 0))),
  };
}
