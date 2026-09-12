import {
  escapeHtml,
  renderBrandedEmail,
} from './branded-email.template';

describe('renderBrandedEmail', () => {
  const base = {
    companyName: 'CopiGráfica Sierra',
    title: 'Factura FAC-001',
  };

  it('incluye la marca, el título y el total', () => {
    const html = renderBrandedEmail({
      ...base,
      rows: [{ label: 'Número', value: 'FAC-001' }],
      totalLabel: 'Total',
      totalValue: '9520,00',
    });

    expect(html).toContain('CopiGráfica Sierra');
    expect(html).toContain('#2f7ec8');
    expect(html).toContain('Factura FAC-001');
    expect(html).toContain('Total');
    expect(html).toContain('9520,00');
  });

  it('escapa contenido HTML en los valores', () => {
    const html = renderBrandedEmail({
      ...base,
      rows: [{ label: 'Cliente', value: '<script>alert(1)</script>' }],
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('omite el bloque DIAN cuando no se pasa', () => {
    const html = renderBrandedEmail(base);
    expect(html).not.toContain('CUFE');
  });

  it('muestra el bloque DIAN cuando se pasa', () => {
    const html = renderBrandedEmail({
      ...base,
      dianBlock: [
        { label: 'CUFE', value: 'abc123' },
        { label: 'Estado DIAN', value: 'VALIDADA' },
      ],
    });

    expect(html).toContain('CUFE');
    expect(html).toContain('VALIDADA');
  });
});

describe('escapeHtml', () => {
  it('escapa caracteres especiales', () => {
    expect(escapeHtml(`<a b="c" d='e'>&`)).toBe(
      '&lt;a b=&quot;c&quot; d=&#39;e&#39;&gt;&amp;',
    );
  });

  it('convierte nulos a string vacío', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});