export interface BrandedEmailRow {
  label: string;
  value: string;
}

export interface BrandedEmailContact {
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  whatsapp?: string;
}

export interface BrandedEmailParams {
  companyName: string;
  title: string;
  subtitle?: string;
  rows?: BrandedEmailRow[];
  totalLabel?: string;
  totalValue?: string;
  statusLabel?: string;
  dianBlock?: BrandedEmailRow[];
  logoBase64?: string | null;
  contact?: BrandedEmailContact;
  cta?: { label: string; url: string };
  services?: { name: string; description: string }[];
}

export function escapeHtml(
  value: string | number | boolean | null | undefined,
): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const BRAND_BLUE = '#0098da';
export const BRAND_DARK = '#0071a3';
export const BRAND_GREEN = '#3add4b';
export const BRAND_GREEN_DARK = '#1f9d30';
export const BRAND_ORANGE = '#ff9518';
export const TEXT_COLOR = '#414141';
export const MUTED_COLOR = '#6b7280';

export const DEFAULT_SERVICES: { name: string; description: string }[] = [
  {
    name: 'Impresión personalizada',
    description: 'Cuadernos, libros, banners y material gráfico a tu medida.',
  },
  {
    name: 'Promocionales personalizados',
    description: 'Soluciones de diseño que dan vida a tu marca.',
  },
  {
    name: 'Marketing digital',
    description:
      'Llevando tu marca al siguiente nivel con las últimas tecnologías.',
  },
  {
    name: 'Portafolio online',
    description: 'Conoce todos nuestros productos y servicios.',
  },
];

export function renderBrandedEmail(params: BrandedEmailParams): string {
  const {
    companyName,
    title,
    subtitle,
    rows = [],
    totalLabel,
    totalValue,
    statusLabel,
    dianBlock,
    logoBase64,
    contact,
    cta,
    services = DEFAULT_SERVICES,
  } = params;

  const rowsHtml = rows
    .map(
      (row) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eeece6;color:${MUTED_COLOR};width:40%;vertical-align:top;font-size:13px;">${escapeHtml(row.label)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eeece6;color:${TEXT_COLOR};vertical-align:top;font-weight:600;font-size:13px;">${escapeHtml(row.value)}</td>
        </tr>`,
    )
    .join('');

  const totalHtml =
    totalValue !== undefined
      ? `
      <tr>
        <td style="padding:12px;background:${BRAND_BLUE};border-radius:0 0 8px 8px;font-weight:700;color:#ffffff;font-size:14px;">${escapeHtml(totalLabel ?? 'Total')}</td>
        <td style="padding:12px;background:${BRAND_BLUE};border-radius:0 0 8px 8px;font-weight:700;color:#ffffff;text-align:right;font-size:14px;">${escapeHtml(totalValue)}</td>
      </tr>`
      : '';

  const statusHtml = statusLabel
    ? `<div style="margin-top:0;display:inline-block;background:#e6f9e8;color:${BRAND_GREEN_DARK};border-radius:9999px;padding:4px 14px;font-size:12px;font-weight:700;">${escapeHtml(statusLabel)}</div>`
    : '';

  const dianHtml = dianBlock?.length
    ? `
      <div style="margin-top:16px;background:#ffffff;border:1px solid #dbe9f1;border-left:4px solid ${BRAND_BLUE};border-radius:6px;padding:10px 14px;">
        <div style="font-size:11px;font-weight:700;color:${BRAND_BLUE};text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px;">Información DIAN</div>
        ${dianBlock
          .map(
            (row) =>
              `<div style="font-size:12px;color:${TEXT_COLOR};line-height:1.5;"><span style="color:${MUTED_COLOR};">${escapeHtml(row.label)}:</span> <span style="font-weight:600;word-break:break-all;">${escapeHtml(row.value)}</span></div>`,
          )
          .join('')}
      </div>`
    : '';

  const ctaHtml = cta?.url
    ? `
      <div style="text-align:center;margin-top:20px;">
        <a href="${escapeHtml(cta.url)}" target="_blank" style="display:inline-block;background:${BRAND_GREEN};border-radius:8px;padding:12px 28px;font-size:14px;font-weight:700;color:#083c0f;text-decoration:none;border-bottom:4px solid ${BRAND_GREEN_DARK};">${escapeHtml(cta.label ?? 'Ver factura')}</a>
      </div>`
    : '';

  const MAX_LOGO_CHARS = 200_000;

  const logoHtml =
    logoBase64 && logoBase64.length < MAX_LOGO_CHARS
      ? `
      <tr>
        <td style="background:#ffffff;padding:20px 28px 14px;text-align:center;border-bottom:3px solid ${BRAND_BLUE};">
          <img src="${escapeHtml(logoBase64)}" alt="Logo" style="display:block;margin:0 auto;max-height:64px;max-width:220px;width:auto;height:64px;object-fit:contain;">
        </td>
      </tr>`
      : '';

  const serviceCell = (s: { name: string; description: string }) => `
        <td width="50%" style="width:50%;vertical-align:top;padding:8px;">
          <div style="background:#f4fafd;border-radius:8px;padding:14px;border-top:3px solid ${BRAND_BLUE};">
            <div style="font-size:13px;font-weight:700;color:${TEXT_COLOR};margin-bottom:4px;">${escapeHtml(s.name)}</div>
            <div style="font-size:12px;color:${MUTED_COLOR};line-height:1.5;">${escapeHtml(s.description)}</div>
          </div>
        </td>`;

  const servicesRows: string[] = [];
  for (let i = 0; i < services.length; i += 2) {
    servicesRows.push(
      `          <tr>${serviceCell(services[i])}${services[i + 1] ? serviceCell(services[i + 1]) : '<td width="50%" style="width:50%"></td>'}</tr>`,
    );
  }
  const servicesHtml = servicesRows.join('\n');

  const contactLines: string[] = [];
  if (contact?.address) contactLines.push(escapeHtml(contact.address));
  const phoneLines: string[] = [];
  if (contact?.phone) phoneLines.push(escapeHtml(contact.phone));
  const webEmail: string[] = [];
  if (contact?.email) webEmail.push(escapeHtml(contact.email));
  if (contact?.website) webEmail.push(escapeHtml(contact.website));

  const whatsappNumber = (contact?.whatsapp ?? '').replace(/[^0-9]/g, '');
  const whatsappHtml = whatsappNumber
    ? `<a href="https://api.whatsapp.com/send?phone=${whatsappNumber}" target="_blank" style="color:${BRAND_GREEN_DARK};font-weight:700;text-decoration:none;">Hablemos por WhatsApp</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="margin:0;padding:0;background-color:#eef3f6;font-family:Verdana,Arial,Helvetica,sans-serif;color:${TEXT_COLOR};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef3f6;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,0.08);">
            ${logoHtml}
            <tr>
              <td style="background:linear-gradient(90deg, ${BRAND_BLUE}, ${BRAND_DARK});padding:22px 28px;">
                <div style="color:#ffffff;font-size:16px;font-weight:700;letter-spacing:0.3px;">${escapeHtml(title)}</div>
                <div style="color:rgba(255,255,255,0.9);font-size:12px;margin-top:2px;letter-spacing:1px;text-transform:uppercase;">${escapeHtml(companyName)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;">
                ${subtitle ? `<p style="margin:0 0 14px;font-size:14px;color:${TEXT_COLOR};line-height:1.5;">${escapeHtml(subtitle)}</p>` : ''}
                ${statusHtml}
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border:1px solid #eeece6;border-radius:8px;">
                  ${rowsHtml}
                  ${totalHtml}
                </table>
                ${dianHtml}
                ${ctaHtml}
              </td>
            </tr>
            <tr>
              <td style="background:#fbfcff;padding:22px 28px;border-top:4px solid ${BRAND_BLUE};">
                <div style="text-align:center;font-size:15px;font-weight:700;color:${BRAND_DARK};margin-bottom:10px;">Conoce Nuestros Principales Servicios</div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${servicesHtml}
                </table>
                ${whatsappHtml ? `<div style="text-align:center;margin-top:12px;font-size:13px;">${whatsappHtml}${contact?.website ? ` · <a href="${escapeHtml(contact.website)}" target="_blank" style="color:${BRAND_BLUE};font-weight:700;text-decoration:none;">Portafolio Online</a>` : ''}</div>` : ''}
              </td>
            </tr>
            <tr>
              <td style="background:#f4f7f9;padding:18px 28px;">
                <div style="text-align:center;font-size:12px;color:${TEXT_COLOR};line-height:1.6;">
                  ${contactLines.length ? `${contactLines.join('<br/>')}<br/>` : ''}
                  ${webEmail.length ? `<span style="font-weight:700;color:${BRAND_BLUE};">${webEmail.join(' · ')}</span><br/>` : ''}
                  ${phoneLines.length ? `<span style="font-weight:700;color:${TEXT_COLOR};">${phoneLines.join(' · ')}</span>` : ''}
                </div>
                <div style="text-align:center;font-size:11px;color:${MUTED_COLOR};margin-top:10px;border-top:1px solid #e2e8ec;padding-top:10px;">
                  Este correo electrónico únicamente es usado como medio informativo por lo que le pedimos por favor no responder a este mensaje.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
