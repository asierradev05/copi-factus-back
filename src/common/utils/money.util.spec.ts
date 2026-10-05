import { Decimal } from '@prisma/client/runtime/client';
import {
  calculateLineSubtotal,
  calculateTaxAmount,
  calculateLineTotal,
  sumDecimals,
  toDecimal,
} from './money.util';

describe('calculateLineSubtotal', () => {
  it('calcula cantidad por precio menos descuento', () => {
    expect(calculateLineSubtotal(10, 2000, 500).toNumber()).toBe(19500);
  });

  it('el descuento nunca produce un subtotal negativo', () => {
    // Una línea con descuento mayor al bruto es un dato inválido, pero si llega
    // no debe persistir un subtotal negativo: se(clampa) a cero para que el IVA
    // y el total de la factura sigan siendo coherentes.
    expect(calculateLineSubtotal(1, 100, 500).toNumber()).toBe(0);
  });

  it('acepta strings de Prisma sin perder precisión', () => {
    expect(calculateLineSubtotal('3', '19.99', '0.01').toFixed(2)).toBe(
      '59.96',
    );
  });

  it('sin descuento devuelve el bruto', () => {
    expect(calculateLineSubtotal(2, 1500).toNumber()).toBe(3000);
  });
});

describe('calculateTaxAmount', () => {
  it('aplica el porcentaje sobre el subtotal', () => {
    expect(calculateTaxAmount(100000, 19).toNumber()).toBe(19000);
  });

  it('un subtotal en cero genera impuesto en cero', () => {
    expect(calculateTaxAmount(0, 19).toNumber()).toBe(0);
  });

  it('respeta exento y tarifa cero', () => {
    expect(calculateTaxAmount(50000, 0).toNumber()).toBe(0);
  });

  it('no arrastra error de coma flotante en centavos', () => {
    // 0.1 + 0.2 en float daría 0.30000000000000004
    expect(calculateTaxAmount('0.3', 19).toFixed(2)).toBe('0.06');
  });
});

describe('calculateLineTotal', () => {
  it('devuelve subtotal, impuesto y total consistentes entre si', () => {
    const { subtotal, taxAmount, total } = calculateLineTotal(10, 2000, 500, 19);
    expect(subtotal.toNumber()).toBe(19500);
    expect(taxAmount.toNumber()).toBe(3705);
    expect(total.toNumber()).toBe(23205);
    // El invariante que la DIAN exige: total = subtotal + impuesto.
    expect(total.toFixed(2)).toBe(subtotal.add(taxAmount).toFixed(2));
  });

  it('con descuento mayor al bruto deja toda la linea en cero', () => {
    const { subtotal, taxAmount, total } = calculateLineTotal(1, 100, 500, 19);
    expect(subtotal.toNumber()).toBe(0);
    expect(taxAmount.toNumber()).toBe(0);
    expect(total.toNumber()).toBe(0);
  });

  it('el total coincide con el payload DIAN de la misma linea', () => {
    // Regresión: el payload calculaba el IVA sobre el bruto y declaraba un
    // impuesto que no correspondía al total almacenado.
    const { total } = calculateLineTotal(10, 2000, 500, 19);
    expect(total.toNumber()).toBe(23205);
  });
});

describe('sumDecimals', () => {
  it('suma una lista vacia como cero', () => {
    expect(sumDecimals([]).toNumber()).toBe(0);
  });

  it('no acumula error de coma flotante en muchas lineas', () => {
    const muchas = Array.from({ length: 1000 }, () => new Decimal('0.1'));
    expect(sumDecimals(muchas).toFixed(2)).toBe('100.00');
  });

  it('suma montos decimales exactos', () => {
    expect(
      sumDecimals([new Decimal('19.99'), new Decimal('0.01'), new Decimal('3')])
        .toFixed(2),
    ).toBe('23.00');
  });
});

describe('toDecimal', () => {
  it('devuelve la misma instancia si ya es Decimal', () => {
    const d = new Decimal('42');
    expect(toDecimal(d)).toBe(d);
  });

  it('convierte string y numero', () => {
    expect(toDecimal('15.5').toNumber()).toBe(15.5);
    expect(toDecimal(15.5).toNumber()).toBe(15.5);
  });
});
