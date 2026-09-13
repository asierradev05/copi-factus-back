import {
  BRAND_BLUE,
  escapeHtml,
  renderBrandedEmail,
} from './branded-email.template';

describe('renderBrandedEmail', () => {
  const base = {
    companyName: 'Copigráficas Sierra',
    title: 'Factura FAC-001',
  };

  it('incluye la marca, el título y el total', () => {
    const html = renderBrandedEmail({
      ...base,
      rows: [{ label: 'Número', value: 'FAC-001' }],
      totalLabel: 'Total',
      totalValue: '9520,00',
    });

    expect(html).toContain('Copigráficas Sierra');
    expect(html).toContain(BRAND_BLUE);
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
    expect(html).not.toContain('Información DIAN');
  });

  it('muestra el bloque DIAN cuando se pasa', () => {
    const html = renderBrandedEmail({
      ...base,
      dianBlock: [
        { label: 'CUFE', value: 'abc123' },
        { label: 'Estado DIAN', value: 'VALIDADA' },
      ],
    });

    expect(html).toContain('Información DIAN');
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

  it('muestra la sección de servicios de Copigráficas', () => {
    const html = renderBrandedEmail(base);

    expect(html).toContain('Conoce Nuestros Principales Servicios');
    expect(html).toContain('Impresión personalizada');
    expect(html).toContain('Marketing digital');
  });

  it('no genera botón CTA cuando no se pasa url', () => {
    const html = renderBrandedEmail(base);
    expect(html).not.toContain('Ver factura pública');
    expect(html).not.toContain('Ver factura</a>');
  });

  it('genera botón CTA cuando se pasa', () => {
    const html = renderBrandedEmail({
      ...base,
      cta: {
        label: 'Ver factura pública',
        url: 'https://test.factus.lat/v1/123',
      },
    });

    expect(html).toContain('Ver factura pública');
    expect(html).toContain('https://test.factus.lat/v1/123');
    expect(html).toContain('<a href="https://test.factus.lat/v1/123"');
  });

  it('incluye enlace de WhatsApp de la marca en el pie cuando hay contacto', () => {
    const html = renderBrandedEmail({
      ...base,
      contact: { whatsapp: '+57 310 258 6169' },
    });

    expect(html).toContain('Hablemos por WhatsApp');
    expect(html).toContain('https://api.whatsapp.com/send?phone=573102586169');
  });

  it('escapa la URL del CTA', () => {
    const html = renderBrandedEmail({
      ...base,
      cta: { label: 'Ver', url: 'https://x.com/?q="><script>' },
    });

    expect(html).not.toContain('"><script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
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
