export const BRAND = {
  name: 'Copigráficas Sierra',
  address: 'Carrera 28 # 10 - 70 Local 215 B. Ricaurte - Bogotá D.C.',
  phone: 'Cel. 310 248 6169 - Tel. 601 455 7060',
  email: 'copigraficassierra@gmail.com',
  website: 'www.copigraficassierra.com',
  slogan: 'SOMOS UNA EMPRESA DIRECTA (SIN INTERMEDIARIOS)',
  bank:
    'Transferencia Bancolombia Cuenta de Ahorros # 17407613040 A nombre de Angel Mesías Sierra',
} as const;

let cachedLogo: string | null = null;
let logoPromise: Promise<string | null> | null = null;

export function getBrandLogoBase64(): Promise<string | null> {
  if (cachedLogo) return Promise.resolve(cachedLogo);
  if (!logoPromise) {
    logoPromise = loadBrandLogo()
      .then((logo) => {
        cachedLogo = logo;
        return logo;
      })
      .catch(() => null);
  }
  return logoPromise;
}

async function loadBrandLogo(): Promise<string | null> {
  const baseUrl = process.env.FRONTEND_URL ?? 'http://localhost:5175';
  const url = `${baseUrl}/images/LogoCOPI.png`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}