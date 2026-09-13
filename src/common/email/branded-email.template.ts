export interface BrandedEmailRow {
  label: string;
  value: string;
}

export interface BrandedEmailContact {
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
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

const BRAND_BLUE = '#2f7ec8';
const BRAND_DARK = '#356ea8';
const BRAND_RED = '#ec1c24';
const BRAND_BEIGE = '#f7e2c2';
const TEXT_COLOR = '#1f2937';

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
  } = params;

  const rowsHtml = rows
    .map(
      (row) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:${TEXT_COLOR};width:40%;vertical-align:top;">${escapeHtml(row.label)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:${TEXT_COLOR};vertical-align:top;font-weight:600;">${escapeHtml(row.value)}</td>
        </tr>`,
    )
    .join('');

  const totalHtml =
    totalValue !== undefined
      ? `
      <tr>
        <td style="padding:12px;background:${BRAND_BEIGE};border-radius:0 0 8px 8px;font-weight:700;color:${BRAND_DARK};">${escapeHtml(totalLabel ?? 'Total')}</td>
        <td style="padding:12px;background:${BRAND_BEIGE};border-radius:0 0 8px 8px;font-weight:700;color:${BRAND_DARK};text-align:right;">${escapeHtml(totalValue)}</td>
      </tr>`
      : '';

  const statusHtml = statusLabel
    ? `<div style="margin-top:12px;display:inline-block;background:${BRAND_BEIGE};color:${BRAND_DARK};border-radius:9999px;padding:4px 14px;font-size:12px;font-weight:600;">${escapeHtml(statusLabel)}</div>`
    : '';

  const dianHtml = dianBlock?.length
    ? `
      <div style="margin-top:16px;background:#f6f7f9;border-left:3px solid ${BRAND_RED};border-radius:6px;padding:10px 14px;">
        ${dianBlock
          .map(
            (row) =>
              `<div style="font-size:12px;color:${TEXT_COLOR};"><span style="color:#6b7280;">${escapeHtml(row.label)}:</span> <span style="font-weight:600;word-break:break-all;">${escapeHtml(row.value)}</span></div>`,
          )
          .join('')}
      </div>`
    : '';

  const MAX_LOGO_CHARS = 200_000;

  const logoHtml =
    logoBase64 && logoBase64.length < MAX_LOGO_CHARS
      ? `
      <tr>
        <td style="background:#ffffff;padding:20px 28px 14px;text-align:center;border-bottom:4px solid ${BRAND_RED};">
          <img src="${escapeHtml(logoBase64)}" alt="Logo" style="display:block;margin:0 auto;max-height:64px;max-width:220px;width:auto;height:64px;object-fit:contain;">
        </td>
      </tr>`
      : '';

  const contactLines: string[] = [];
  if (contact?.address) contactLines.push(escapeHtml(contact.address));
  if (contact?.phone) contactLines.push(escapeHtml(contact.phone));
  const webEmail: string[] = [];
  if (contact?.email) webEmail.push(escapeHtml(contact.email));
  if (contact?.website) webEmail.push(escapeHtml(contact.website));

  return `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background-color:#eceff3;font-family:Arial,Helvetica,sans-serif;color:${TEXT_COLOR};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eceff3;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,0.08);">
            ${logoHtml}
            <tr>
              <td style="background:linear-gradient(90deg, ${BRAND_BLUE}, ${BRAND_DARK});padding:20px 28px;border-bottom:4px solid ${BRAND_RED};">
                <div style="color:#ffffff;font-size:18px;font-weight:700;">${escapeHtml(companyName)}</div>
                <div style="color:rgba(255,255,255,0.85);font-size:13px;margin-top:2px;">${escapeHtml(title)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;">
                ${subtitle ? `<p style="margin:0 0 16px;font-size:14px;color:${TEXT_COLOR};">${escapeHtml(subtitle)}</p>` : ''}
                ${statusHtml}
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border:1px solid #e5e7eb;border-radius:8px;">
                  ${rowsHtml}
                  ${totalHtml}
                </table>
                ${dianHtml}
              </td>
            </tr>
            <tr>
              <td style="background:#f6f7f9;padding:18px 28px;border-top:4px solid ${BRAND_BLUE};">
                <div style="text-align:center;font-size:12px;color:${TEXT_COLOR};">
                  ${contactLines.length ? `${contactLines.join('<br/>')}<br/>` : ''}
                  ${webEmail.length ? `<span style="font-weight:600;color:${BRAND_BLUE};">${webEmail.join(' · ')}</span><br/>` : ''}
                </div>
                <div style="text-align:center;font-size:11px;color:#8a94a6;margin-top:10px;border-top:1px solid #e5e7eb;padding-top:10px;">
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
