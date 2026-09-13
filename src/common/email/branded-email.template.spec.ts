import {
  BRAND_BLUE,
  BRAND_GREEN,
  DEFAULT_EMAIL_ASSETS,
  escapeHtml,
  RED_COLOR,
  renderBrandedEmail,
} from './branded-email.template';

describe('renderBrandedEmail', () => {
  const assets = {
    banner: 'https://cdn.test/banner.jpeg',
    hero: 'https://cdn.test/hero.png',
    bgCta: 'https://cdn.test/bg-conocerte.png',
    footerArt: 'https://cdn.test/arte-pie.png',
    logo: 'https://cdn.test/logo.png',
    icons: [
      'https://cdn.test/icon-impresion.png',
      'https://cdn.test/icon-promocionales.png',
      'https://cdn.test/icon-marketing.png',
    ],
    social: {
      facebook: 'https://cdn.test/social-facebook.png',
      whatsapp: 'https://cdn.test/social-whatsapp.png',
      website: 'https://cdn.test/social-website.png',
    },
  };

  const base = {
    companyName: 'Copigráficas Sierra',
    title: 'Factura FAC-001',
    assets,
  };

  it('incluye cabecera Brevo con banner, logo y controles sociales', () => {
    const html = renderBrandedEmail({
      ...base,
      logoBase64: 'data:image/png;base64,LOGO',
    });

    expect(html).toContain(assets.banner);
    expect(html).toContain('data:image/png;base64,LOGO');
    expect(html).toContain(assets.social.facebook);
    expect(html).toContain(assets.social.whatsapp);
    expect(html).toContain(assets.social.website);
    expect(html).toContain('www.facebook.com/profile.php?id=61566315975069');
  });

  it('usa el logo Copigráficas Sierra (base64) también en el pie', () => {
    const html = renderBrandedEmail({
      ...base,
      logoBase64: 'data:image/png;base64,LOGO',
    });

    expect(html.split('data:image/png;base64,LOGO').length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain(assets.logo);
  });

  it('incluye imagen héroe, el título y el total', () => {
    const html = renderBrandedEmail({
      ...base,
      rows: [{ label: 'Número', value: 'FAC-001' }],
      totalLabel: 'Total',
      totalValue: '9520,00',
    });

    expect(html).toContain(assets.hero);
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

  it('usa assets por defecto cuando no se pasan', () => {
    const html = renderBrandedEmail({
      companyName: 'Copigráficas Sierra',
      title: 'Factura FAC-001',
    });

    expect(html).toContain(DEFAULT_EMAIL_ASSETS.banner);
    expect(html).toContain(DEFAULT_EMAIL_ASSETS.hero);
    expect(html).toContain(DEFAULT_EMAIL_ASSETS.logo);
  });

  it('no incrusta un logo demasiado grande (evita que el cliente recorte el cuerpo)', () => {
    const html = renderBrandedEmail({
      ...base,
      logoBase64: 'data:image/png;base64,' + 'A'.repeat(300000),
    });

    expect(html.split('data:image/').length).toBe(1);
    expect(html).toContain(assets.logo);
  });

  it('muestra la sección de servicios al estilo Brevo', () => {
    const html = renderBrandedEmail(base);

    expect(html).toContain('¡Conoce Nuestros Principales Servicios!');
    expect(html).toContain('Impresión personalizada');
    expect(html).toContain('Promocionales Personalizados');
    expect(html).toContain('Marketing Digital');
    expect(html).toContain(assets.icons[0]);
    expect(html).toContain(assets.icons[1]);
    expect(html).toContain(assets.icons[2]);
  });

  it('muestra los dos botones al estilo Brevo (Portafolio y WhatsApp)', () => {
    const html = renderBrandedEmail(base);

    expect(html).toContain('Nuestro Portafolio Online');
    expect(html).toContain('Hablemos sobre tu idea por WhatsApp');
    expect(html).toContain(BRAND_BLUE);
    expect(html).toContain(BRAND_GREEN);
    expect(html).toContain(
      'https://api.whatsapp.com/send?phone=573102586169',
    );
    expect(html).toContain('www.copigraficassierra.com');
  });

  it('no genera botón CTA cuando no se pasa url', () => {
    const html = renderBrandedEmail(base);
    expect(html).not.toContain('Ver factura pública');
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

  it('incluye el pie al estilo Brevo con dirección, emails y teléfono', () => {
    const html = renderBrandedEmail(base);

    expect(html).toContain('Carrera 28 10 - 70');
    expect(html).toContain('Centro Nacional De Las Artes Graficas');
    expect(html).toContain('copigraficassierra@gmail.com');
    expect(html).toContain('servicios@copigraficassierra.com');
    expect(html).toContain('+57 310 258 6169');
    expect(html).toContain(assets.footerArt);
    expect(html).toContain(RED_COLOR);
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