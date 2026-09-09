import { roundMoney } from './money.js';

/** Intra-state GST: split tax equally into CGST + SGST. */
export function splitGst(taxAmount) {
  const tax = roundMoney(taxAmount);
  const cgst = roundMoney(tax / 2);
  const sgst = roundMoney(tax - cgst);
  return { cgst, sgst, igst: 0, totalGst: tax };
}

export function gstHalfRate(taxPercent) {
  return roundMoney((Number(taxPercent) || 0) / 2);
}
