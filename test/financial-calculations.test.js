import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OFFER_TYPES,
  computeLinePricing,
  computeOfferAmount,
  computeOrderUnderDiscount,
} from '../src/utils/offer.js';
import { roundMoney } from '../src/utils/money.js';

test('roundMoney handles currency precision and invalid values', () => {
  assert.equal(roundMoney(12.345), 12.35);
  assert.equal(roundMoney('invalid'), 0);
  assert.equal(roundMoney(null), 0);
});

test('BOGO charges odd quantities correctly while consuming every physical unit', () => {
  const pricing = computeOfferAmount(100, 3, { type: OFFER_TYPES.BOGO });

  assert.equal(pricing.physicalQuantity, 3);
  assert.equal(pricing.paidQuantity, 2);
  assert.equal(pricing.subtotal, 200);
  assert.equal(pricing.offerDiscount, 100);
});

test('line pricing applies offer, manual discount, and tax in order', () => {
  const pricing = computeLinePricing({
    unitPrice: 100,
    quantity: 2,
    offer: { type: OFFER_TYPES.PERCENT_OFF, value: 10 },
    discPct: 20,
    taxPercent: 18,
  });

  assert.equal(pricing.listGross, 200);
  assert.equal(pricing.afterOffer, 180);
  assert.equal(pricing.manualDiscAmt, 36);
  assert.equal(pricing.taxableBase, 144);
  assert.equal(pricing.taxAmt, 25.92);
  assert.equal(pricing.lineTotal, 169.92);
});

test('order threshold discount is exclusive at the threshold and capped by total', () => {
  const offer = { type: OFFER_TYPES.ORDER_UNDER, threshold: 1000, value: 1500 };

  assert.equal(computeOrderUnderDiscount(1000, offer), 0);
  assert.equal(computeOrderUnderDiscount(1000.01, offer), 1000.01);
  assert.equal(computeOrderUnderDiscount(2000, offer), 1500);
});