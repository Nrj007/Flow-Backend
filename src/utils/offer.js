import { roundMoney } from './money.js';

export const OFFER_TYPES = {
  PERCENT_OFF: 'percent_off',
  FIXED_OFF: 'fixed_off',
  BOGO: 'bogo',
  ORDER_UNDER: 'order_under',
};

export function isOfferActive(offer, at = new Date()) {
  if (!offer || offer.active === false) return false;
  const now = at.getTime();
  if (offer.startDate && new Date(offer.startDate).getTime() > now) return false;
  if (offer.endDate && new Date(offer.endDate).getTime() < now) return false;
  return true;
}

export function findActiveOfferForProduct(productId, offers, at = new Date()) {
  return (
    (offers || []).find(
      (offer) =>
        offer.type !== OFFER_TYPES.ORDER_UNDER &&
        isOfferActive(offer, at) &&
        Array.isArray(offer.productIds) &&
        offer.productIds.includes(productId)
    ) || null
  );
}

export function findActiveOrderUnderOffer(offers, at = new Date()) {
  return (
    (offers || []).find(
      (offer) => offer.type === OFFER_TYPES.ORDER_UNDER && isOfferActive(offer, at)
    ) || null
  );
}

export function offerLabel(offer) {
  if (!offer) return null;
  if (offer.type === OFFER_TYPES.BOGO) return 'Buy 1 Get 1';
  if (offer.type === OFFER_TYPES.PERCENT_OFF) return `${offer.value}% OFF`;
  if (offer.type === OFFER_TYPES.FIXED_OFF) return `₹${offer.value} OFF`;
  if (offer.type === OFFER_TYPES.ORDER_UNDER) {
    return `₹${offer.value} off above ₹${offer.threshold ?? 1000}`;
  }
  return offer.name || 'Offer';
}

/** Units removed from inventory — same as cart quantity (physical units). */
export function getStockUnitsForLine(quantity) {
  return Number(quantity) || 0;
}

/** Max cart quantity allowed given on-hand stock. */
export function getMaxCartQty(stock) {
  return Number(stock) || 0;
}

/** Snap cart quantity to valid range. */
export function normalizeCartQty(qty, _offer, maxStock) {
  const max = getMaxCartQty(maxStock);
  return Math.max(0, Math.min(max, Number(qty) || 0));
}

export function computeOfferAmount(unitPrice, quantity, offer) {
  if (!offer || quantity <= 0) {
    return {
      subtotal: unitPrice * quantity,
      offerDiscount: 0,
      paidQuantity: quantity,
      physicalQuantity: quantity,
      listGross: unitPrice * quantity,
    };
  }

  if (offer.type === OFFER_TYPES.BOGO) {
    const physicalQuantity = quantity;
    const listGross = unitPrice * physicalQuantity;
    const freeQty = Math.floor(physicalQuantity / 2);
    const paidQuantity = physicalQuantity - freeQty;
    const subtotal = unitPrice * paidQuantity;
    return { subtotal, offerDiscount: listGross - subtotal, paidQuantity, physicalQuantity, listGross };
  }

  const listGross = unitPrice * quantity;

  if (offer.type === OFFER_TYPES.PERCENT_OFF) {
    const offerDiscount = listGross * (Number(offer.value) / 100);
    return {
      subtotal: listGross - offerDiscount,
      offerDiscount,
      paidQuantity: quantity,
      physicalQuantity: quantity,
      listGross,
    };
  }

  if (offer.type === OFFER_TYPES.FIXED_OFF) {
    const perUnit = Math.max(0, unitPrice - Number(offer.value));
    const subtotal = perUnit * quantity;
    return {
      subtotal,
      offerDiscount: listGross - subtotal,
      paidQuantity: quantity,
      physicalQuantity: quantity,
      listGross,
    };
  }

  return {
    subtotal: listGross,
    offerDiscount: 0,
    paidQuantity: quantity,
    physicalQuantity: quantity,
    listGross,
  };
}

export function computeLinePricing({
  unitPrice,
  quantity,
  taxPercent = 0,
  discPct = 0,
  offer = null,
}) {
  const { subtotal: afterOffer, offerDiscount, listGross, physicalQuantity } = computeOfferAmount(
    unitPrice,
    quantity,
    offer
  );
  const manualDiscAmt = afterOffer * (Math.min(100, Math.max(0, Number(discPct) || 0)) / 100);
  const taxableBase = afterOffer - manualDiscAmt;
  const taxAmt = roundMoney(taxableBase * (Math.max(0, Number(taxPercent) || 0) / 100));
  const lineTotal = roundMoney(taxableBase + taxAmt);

  return {
    listGross,
    afterOffer,
    offerDiscount,
    manualDiscAmt,
    totalDiscount: offerDiscount + manualDiscAmt,
    taxableBase,
    taxAmt,
    lineTotal,
    physicalQuantity,
  };
}

export function getEffectiveUnitPrice(product, offer, quantity = 1) {
  const unitPrice = Number(product?.unitPrice ?? product?.price ?? 0);
  const { subtotal, physicalQuantity } = computeOfferAmount(unitPrice, quantity, offer);
  return physicalQuantity > 0 ? subtotal / physicalQuantity : unitPrice;
}

/** Flat discount when bill total exceeds the offer threshold. */
export function computeOrderUnderDiscount(billTotal, offer) {
  if (!offer || offer.type !== OFFER_TYPES.ORDER_UNDER) return 0;
  const total = Number(billTotal) || 0;
  const threshold = Number(offer.threshold ?? 1000);
  if (total <= threshold) return 0;
  return Math.min(Number(offer.value) || 0, total);
}
