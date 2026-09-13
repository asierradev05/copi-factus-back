import { escapeHtml, renderBrandedEmail } from './branded-email.template';

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

  it('incluye el logo y la información de contacto cuando se pasan', () => {
    const html = renderBrandedEmail({
      ...base,
      logoBase64: 'data:image/png;base64,LOGO',
      contact: {
        address: 'Cra 28 # 10-70',
        phone: '310 248 6169',
        email: 'copigraficassierra@gmail.com',
        website: 'www.copigraficassierra.com',
      },
    });

    expect(html).toContain('data:image/png;base64,LOGO');
    expect(html).toContain('Cra 28 # 10-70');
    expect(html).toContain('310 248 6169');
    expect(html).toContain('copigraficassierra@gmail.com');
    expect(html).toContain('www.copigraficassierra.com');
  });

  it('no incrusta un logo demasiado grande (evita que el cliente recorte el cuerpo)', () => {
    const html = renderBrandedEmail({
      ...base,
      logoBase64: 'data:image/png;base64,' + 'A'.repeat(300000),
    });

    expect(html).not.toContain('data:image/');
  });

  it('no genera enlaces de acceso (uso interno de la aplicación)', () => {
    const html = renderBrandedEmail(base);
    expect(html).not.toContain('<a href');
    expect(html).not.toContain('Ver factura');
    expect(html).not.toContain('http://');
  });

  it('incluye el disclaimer informativo en el pie', () => {
    const html = renderBrandedEmail(base);

    expect(html).toContain(
      'Este correo electrónico únicamente es usado como medio informativo',
    );
    expect(html).toContain('no responder a este mensaje');
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
