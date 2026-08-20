/** Round to 2 decimal places for currency amounts. */
export function roundMoney(value) {
  const n = Number(value) || 0;
  return Math.round(n * 100) / 100;
}
