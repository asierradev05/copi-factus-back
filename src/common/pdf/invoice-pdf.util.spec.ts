import { chunkCufe } from './invoice-pdf.util';

describe('chunkCufe', () => {
  it('divide el CUFE en grupos de tamaño fijo separados por espacio', () => {
    const cufe = 'A'.repeat(123);
    const result = chunkCufe(cufe, 24);

    expect(result).toBe(
      `${'A'.repeat(24)} ${'A'.repeat(24)} ${'A'.repeat(24)} ${'A'.repeat(24)} ${'A'.repeat(24)} ${'A'.repeat(3)}`,
    );
  });

  it('maneja grupos largos sin que la cadena quede sin separadores', () => {
    const result = chunkCufe('abcdefghijklmnopqrstuvwxyz', 8);
    expect(result).toBe('abcdefgh ijklmnop qrstuvwx yz');
  });

  it('devuelve string vacío para nulos o vacíos', () => {
    expect(chunkCufe(null)).toBe('');
    expect(chunkCufe('')).toBe('');
  });
});
