import QRCode from 'qrcode';

export async function buildQrDataUrl(
  value: string | null | undefined,
): Promise<string | null> {
  if (!value) return null;
  try {
    return await QRCode.toDataURL(value, {
      margin: 1,
      width: 160,
      errorCorrectionLevel: 'M',
    });
  } catch {
    return null;
  }
}
