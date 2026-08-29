import { Decimal } from '@prisma/client/runtime/client';

export function toDecimal(value: string | number | Decimal): Decimal {
  if (value instanceof Decimal) {
    return value;
  }
  return new Decimal(value);
}

export function calculateLineSubtotal(
  quantity: Decimal | string | number,
  unitPrice: Decimal | string | number,
  discount: Decimal | string | number = 0,
): Decimal {
  const qty = toDecimal(quantity);
  const price = toDecimal(unitPrice);
  const disc = toDecimal(discount);
  const gross = qty.mul(price);
  const subtotal = gross.sub(disc);
  return subtotal.lessThan(0) ? new Decimal(0) : subtotal;
}

export function calculateTaxAmount(
  subtotal: Decimal | string | number,
  taxRate: Decimal | string | number,
): Decimal {
  const base = toDecimal(subtotal);
  const rate = toDecimal(taxRate);
  return base.mul(rate).div(100);
}

export function calculateLineTotal(
  quantity: Decimal | string | number,
  unitPrice: Decimal | string | number,
  discount: Decimal | string | number = 0,
  taxRate: Decimal | string | number = 0,
): { subtotal: Decimal; taxAmount: Decimal; total: Decimal } {
  const subtotal = calculateLineSubtotal(quantity, unitPrice, discount);
  const taxAmount = calculateTaxAmount(subtotal, taxRate);
  const total = subtotal.add(taxAmount);
  return { subtotal, taxAmount, total };
}

export function sumDecimals(values: Decimal[]): Decimal {
  return values.reduce((acc, val) => acc.add(val), new Decimal(0));
}

export function decimalToNumber(value: Decimal): number {
  return value.toNumber();
}

export function decimalToString(value: Decimal): string {
  return value.toFixed(2);
}
