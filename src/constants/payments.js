export const PAYMENT_METHODS = ['cash', 'upi', 'card', 'due', 'other'];

export const PAYMENT_STATUS = {
  PAID: 'paid',
  DUE: 'due',
};

export const ORDER_SUB_TYPES = {
  SALE: 'sale',
  KOT: 'kot',
};

export const BILLING_ACTIONS = ['save', 'save_print', 'ebill', 'kot', 'kot_print'];

export function normalizePaymentMethod(method) {
  const value = String(method || 'upi').toLowerCase();
  return PAYMENT_METHODS.includes(value) ? value : 'other';
}

export function paymentMethodLabel(method) {
  const labels = {
    cash: 'Cash',
    upi: 'UPI',
    card: 'Card',
    due: 'Due',
    other: 'Other',
  };
  return labels[normalizePaymentMethod(method)] || 'Other';
}
