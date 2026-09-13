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
  facebook?: string;
}

export interface BrandedEmailAssets {
  banner?: string;
  hero?: string;
  bgCta?: string;
  roundedImg?: string;
  footerArt?: string;
  logo?: string;
  icons?: [string, string, string];
  social?: { facebook: string; whatsapp: string; website: string };
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
  assets?: BrandedEmailAssets;
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
export const BRAND_GREEN_DARK = '#35d339';
export const BRAND_ORANGE = '#ff9518';
export const TEXT_COLOR = '#414141';
export const MUTED_COLOR = '#6b7280';
export const RED_COLOR = '#920303';

const ASSET_PREFIX = (() => {
  const base = (
    process.env.SUPABASE_URL ?? 'https://pfkbarcmxxzkfkoplwka.supabase.co'
  ).replace(/\/$/, '');
  return `${base}/storage/v1/object/public/email-assets/`;
})();

export const DEFAULT_EMAIL_ASSETS: Required<BrandedEmailAssets> = {
  banner: `${ASSET_PREFIX}banner-cabecera.jpeg`,
  hero: `${ASSET_PREFIX}hero.png`,
  bgCta: `${ASSET_PREFIX}bg-conocerte.png`,
  roundedImg: `${ASSET_PREFIX}img-redondeada.png`,
  footerArt: `${ASSET_PREFIX}arte-pie.png`,
  logo: `${ASSET_PREFIX}logo-copigraficas.png`,
  icons: [
    `${ASSET_PREFIX}icon-impresion.png`,
    `${ASSET_PREFIX}icon-promocionales.png`,
    `${ASSET_PREFIX}icon-marketing.png`,
  ],
  social: {
    facebook: `${ASSET_PREFIX}social-facebook.png`,
    whatsapp: `${ASSET_PREFIX}social-whatsapp.png`,
    website: `${ASSET_PREFIX}social-website.png`,
  },
};

export const DEFAULT_SERVICES: { name: string; description: string }[] = [
  {
    name: 'Impresión personalizada',
    description: 'Cuadernos, libros, banners y material gráfico a tu medida.',
  },
  {
    name: 'Promocionales Personalizados',
    description: 'Soluciones de diseño que dan vida a tu marca.',
  },
  {
    name: 'Marketing Digital',
    description:
      'Llevando tu marca al siguiente nivel con las últimas tecnologías.',
  },
];

const FOOTER_ADDRESS_LINES = [
  'Carrera 28 10 - 70',
  'Local 213 - 214 - 215',
  'Centro Nacional De Las Artes Graficas',
  '110441, Bogota',
] as const;

const FOOTER_EMAILS = [
  'copigraficassierra@gmail.com',
  'servicios@copigraficassierra.com',
] as const;

const FOOTER_PHONE = '+57 310 258 6169';
const DEFAULT_FACEBOOK = 'https://www.facebook.com/profile.php?id=61566315975069';

function withScheme(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

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
    assets,
  } = params;

  const a = { ...DEFAULT_EMAIL_ASSETS, ...assets };

  const MAX_LOGO_CHARS = 200_000;
  const useBase64Logo =
    logoBase64 && logoBase64.length < MAX_LOGO_CHARS ? logoBase64 : null;
  const footerLogo = useBase64Logo ?? a.logo;

  const rowsHtml = rows
    .map(
      (row) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #eeece6;color:${MUTED_COLOR};width:40%;vertical-align:top;font-size:13px;">${escapeHtml(row.label)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #eeece6;color:${TEXT_COLOR};vertical-align:top;font-weight:600;font-size:13px;">${escapeHtml(row.value)}</td>
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
    ? `<div style="margin-bottom:14px;display:inline-block;background:#e6f9e8;color:#1f9d30;border-radius:9999px;padding:4px 14px;font-size:12px;font-weight:700;">${escapeHtml(statusLabel)}</div>`
    : '';

  const dianHtml = dianBlock?.length
    ? `
      <div style="margin-top:16px;text-align:left;background:#ffffff;border:1px solid #dbe9f1;border-left:4px solid ${BRAND_BLUE};border-radius:6px;padding:10px 14px;">
        <div style="font-size:11px;font-weight:700;color:${BRAND_BLUE};text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px;">Información DIAN</div>
        ${dianBlock
          .map(
            (row) =>
              `<div style="font-size:12px;color:${TEXT_COLOR};line-height:1.5;"><span style="color:${MUTED_COLOR};">${escapeHtml(row.label)}:</span> <span style="font-weight:600;word-break:break-all;">${escapeHtml(row.value)}</span></div>`,
          )
          .join('')}
      </div>`
    : '';

  const invoiceCardHtml =
    rows.length === 0 && totalValue === undefined
      ? ''
      : `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border:1px solid #eeece6;border-radius:8px;border-collapse:separate;">
        ${rowsHtml}
        ${totalHtml}
      </table>`;

  const ctaHtml = cta?.url
    ? `
      <tr>
        <td style="background-image:url('${escapeHtml(a.bgCta)}');background-position:center;background-repeat:repeat-x;background-color:#f3f8fc;padding:38px 24px;text-align:center;">
          <a href="${escapeHtml(cta.url)}" target="_blank" style="display:inline-block;background:${BRAND_BLUE};border-radius:8px;padding:13px 32px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-bottom:4px solid ${BRAND_DARK};">${escapeHtml(cta.label ?? 'Ver factura pública')}</a>
        </td>
      </tr>`
    : '';

  const whatsappDigits = (contact?.whatsapp ?? '+57 310 258 6169').replace(
    /[^0-9]/g,
    '',
  );
  const whatsappLink = `https://api.whatsapp.com/send?phone=${whatsappDigits}`;
  const websiteLink = withScheme(contact?.website ?? 'www.copigraficassierra.com');
  const facebookLink = contact?.facebook ?? DEFAULT_FACEBOOK;

  const socialIconsHtml = `
    <a href="${escapeHtml(facebookLink)}" target="_blank"><img src="${escapeHtml(a.social.facebook)}" alt="Facebook" width="32" height="32" style="display:inline-block;border:0;margin:0 5px;"></a>
    <a href="${escapeHtml(whatsappLink)}" target="_blank"><img src="${escapeHtml(a.social.whatsapp)}" alt="WhatsApp" width="32" height="32" style="display:inline-block;border:0;margin:0 5px;"></a>
    <a href="${escapeHtml(websiteLink)}" target="_blank"><img src="${escapeHtml(a.social.website)}" alt="Sitio web" width="32" height="32" style="display:inline-block;border:0;margin:0 5px;"></a>`;

  const serviceCell = (
    s: { name: string; description: string },
    icon: string,
  ) => `
        <td width="200" style="width:200px;vertical-align:top;text-align:center;padding:8px 12px;">
          <img src="${escapeHtml(icon)}" width="72" height="72" alt="${escapeHtml(s.name)}" style="display:block;margin:0 auto 10px;border:0;">
          <div style="font-size:20px;font-weight:700;color:${TEXT_COLOR};margin-bottom:6px;">${escapeHtml(s.name)}</div>
          <div style="font-size:16px;color:${TEXT_COLOR};line-height:1.5;">${escapeHtml(s.description)}</div>
        </td>`;

  const servicesHtml =
    '<tr>' +
    services
      .slice(0, 3)
      .map((s, i) => serviceCell(s, a.icons[i] ?? a.icons[0]))
      .join('') +
    '</tr>';

  const footerAddressHtml = FOOTER_ADDRESS_LINES.map((line, i) =>
    i === 1 ? `<span style="color:${RED_COLOR};">${escapeHtml(line)}</span>` : escapeHtml(line),
  ).join('<br/>');

  const footerEmailsHtml = FOOTER_EMAILS.map(
    (email) =>
      `<a href="mailto:${escapeHtml(email)}" style="color:${BRAND_BLUE};text-decoration:none;">${escapeHtml(email)}</a>`,
  ).join('<br/>');

  return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="x-apple-disable-message-reformatting">
  </head>
  <body style="margin:0;padding:0;background-color:#ffffff;font-family:Verdana,'Helvetica Neue',Helvetica,Arial,sans-serif;color:${TEXT_COLOR};font-size:16px;line-height:1.5;word-break:normal;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;">

            <tr>
              <td style="background-image:url('${escapeHtml(a.banner)}');background-position:center top;background-repeat:repeat-x;background-size:100% 100%;padding:34px 24px 20px;text-align:center;">
                ${useBase64Logo
                  ? `<img src="${escapeHtml(useBase64Logo)}" alt="${escapeHtml(companyName)}" style="display:inline-block;max-width:300px;max-height:90px;width:auto;height:auto;margin-bottom:14px;border:0;">`
                  : `<img src="${escapeHtml(a.logo)}" alt="${escapeHtml(companyName)}" width="300" style="display:inline-block;width:300px;margin-bottom:14px;border:0;">`}
                <div style="margin-top:2px;">${socialIconsHtml}</div>
              </td>
            </tr>

            <tr>
              <td style="padding:0;">
                <img src="${escapeHtml(a.hero)}" alt="Copigráficas Sierra" width="600" style="display:block;width:600px;max-width:100%;height:auto;border:0;">
              </td>
            </tr>

            <tr>
              <td style="padding:30px 28px 6px;text-align:center;">
                <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:${TEXT_COLOR};line-height:1.3;">${escapeHtml(title)}</div>
                ${subtitle ? `<div style="margin-top:8px;font-size:16px;color:${TEXT_COLOR};line-height:1.5;">${escapeHtml(subtitle)}</div>` : ''}
              </td>
            </tr>

            <tr>
              <td style="padding:10px 28px 18px;text-align:center;">
                ${statusHtml}
                ${invoiceCardHtml}
                ${dianHtml}
              </td>
            </tr>

            ${ctaHtml}

            <tr>
              <td style="padding:34px 28px 6px;text-align:center;">
                <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:${TEXT_COLOR};">¡Conoce Nuestros Principales Servicios!</div>
                <div style="width:62px;height:3px;background:${BRAND_BLUE};margin:14px auto 0;border-radius:2px;"></div>
              </td>
            </tr>

            <tr>
              <td style="padding:14px 12px 6px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${servicesHtml}
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:18px 28px 34px;text-align:center;">
                <a href="${escapeHtml(websiteLink)}" target="_blank" style="display:inline-block;background:${BRAND_BLUE};border-radius:8px;padding:12px 30px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-bottom:4px solid ${BRAND_DARK};">Nuestro Portafolio Online</a>
                <div style="height:12px;line-height:12px;font-size:1px;">&nbsp;</div>
                <a href="${escapeHtml(whatsappLink)}" target="_blank" style="display:inline-block;background:${BRAND_GREEN};border:5px solid ${BRAND_GREEN_DARK};border-width:5px;border-radius:8px;padding:10px 26px;font-size:16px;font-weight:700;color:${TEXT_COLOR};text-decoration:none;">Hablemos sobre tu idea por WhatsApp</a>
              </td>
            </tr>

            <tr>
              <td style="background:#f7f9fb;padding:26px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:55%;vertical-align:top;padding-right:16px;">
                      <img src="${escapeHtml(footerLogo)}" alt="${escapeHtml(companyName)}" width="162" style="display:inline-block;width:162px;max-width:100%;margin-bottom:12px;border:0;">
                      <div style="font-size:12px;color:${TEXT_COLOR};line-height:1.6;margin-bottom:8px;">${footerAddressHtml}</div>
                      <div style="font-size:12px;line-height:1.7;margin-bottom:8px;">${footerEmailsHtml}</div>
                      <div style="font-size:12px;color:${TEXT_COLOR};font-weight:700;">${escapeHtml(FOOTER_PHONE)}</div>
                    </td>
                    <td style="width:45%;vertical-align:top;text-align:right;">
                      <img src="${escapeHtml(a.footerArt)}" alt="" width="240" style="display:inline-block;width:240px;max-width:100%;margin-bottom:10px;border:0;">
                      <div style="font-size:11px;color:${MUTED_COLOR};line-height:1.5;text-align:right;border-top:1px solid #e4e9ee;padding-top:10px;">Este correo electrónico únicamente es usado como medio informativo por lo que le pedimos por favor no responder a este mensaje.</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}