# Análisis de RUT para auto-completar cliente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que al crear/editar un cliente el usuario suba un PDF del RUT colombiano (DIAN) y que la app extraiga automáticamente los datos (nombre, tipo/número de documento, teléfono, correo, dirección, ciudad, notas) y los rellene en el formulario sin guardar hasta que el usuario lo revise y confirme.

**Architecture:** Backend NestJS expone un endpoint `POST /customers/extract-rut` que recibe el PDF (Multipart/Multer, en memoria — sin persistir), extrae el texto con `pdf-parse` (ya instalado) y lo parsea con regex específicos del formato RUT DIAN. Frontend React agrega un botón "Subir RUT" en `CustomerFormPage` que sube el archivo y usa `setValue` de react-hook-form para rellenar los campos.

**Tech Stack:** NestJS 11, Multer (`@nestjs/platform-express`), pdf-parse 2.4, React 19, react-hook-form, Zod, sonner (toasts), Tailwind/shadcn.

**Spec:** (diseño aprobado en conversación de brainstorming — bounded/arquitectural pequeño). Este plan implementa la funcionalidad directamente.

## Global Constraints

- El modelo `Customer` NO se modifica: `notes` ya existe, todos los campos destino ya existen en schema y DTO. No hay migración de base de datos.
- No se persiste el PDF del RUT (solo extracción temporal en memoria, máx ~5MB).
- Sigue el patrón de extracción de `invoice-uploads` (regex + `pdf-parse`), reutilizando ideas de `matchNit`.
- Roles: solo `ADMIN` y `FACTURADOR` pueden usar el endpoint (mismo guard que crear/editar cliente).
- Frontend: `api` client en `src/lib/api.ts` fuerza `Content-Type: application/json`; para multipart se usa `fetch` directo con `FormData` (patrón de `services/invoice-uploads.ts`).
- DocumentType destino: al detectar NIT → `NIT`; si es Cédula (CC) → `CC`. Los campos no detectados quedan `undefined` (no se sobreescriben campos que el usuario ya tenga).
- TDD obligatorio en backend (Jest, `*.spec.ts` bajo `src`).

---

### Task 1: Util de extracción de RUT con regex (backend)

**Files:**
- Create: `src/common/rut/rut-extractor.util.ts`
- Test: `src/common/rut/rut-extractor.util.spec.ts`

**Interfaces:**
- Produces: `interface ExtractedRutData { name?: string; documentType?: 'NIT' | 'CC'; documentNumber?: string; phone?: string; email?: string; address?: string; city?: string; notes?: string }`
- Produces: `export async function extractRutFromPdf(buffer: Buffer): Promise<ExtractedRutData>`
- Produces: `export function parseRutText(text: string): ExtractedRutData` (función pura, testeable sin PDF)

- [ ] **Step 1: Write the failing test**

Create `src/common/rut/rut-extractor.util.spec.ts`:

```typescript
import { parseRutText } from './rut-extractor.util';

const RUT_SAMPLE = `
RUT
REGISTRO ÚNICO TRIBUTARIO
Número de Identificación Tributaria (NIT): 900123456-7
Razón Social: COPIGRAFICA SIERRA S.A.S.
Dirección: Carrera 28 # 10-70 Local 215
Municipio: BOGOTÁ D.C.
Teléfono: 601 742 1122
Correo Electrónico: contacto@copigraficassierra.com
Actividad Económica: 1811 - Actividades de impresión
Estado: ACTIVO
Fecha de Actualización: 12/03/2026
`;

const RUT_CC_SAMPLE = `
RUT
REGISTRO ÚNICO TRIBUTARIO
Cédula de Ciudadanía: 1023456789
Apellidos y Nombres: JUAN PEREZ GOMEZ
Dirección: Calle 5 # 12-34
Centro Poblado: MEDELLÍN
Teléfono Celular: 320 123 4567
Correo Electrónico: juan.perez@example.com
`;

describe('parseRutText', () => {
  it('extrae campos de un RUT de persona jurídica (empresa)', () => {
    const result = parseRutText(RUT_SAMPLE);
    expect(result.name).toBe('COPIGRAFICA SIERRA S.A.S.');
    expect(result.documentType).toBe('NIT');
    expect(result.documentNumber).toBe('900123456-7');
    expect(result.address).toBe('Carrera 28 # 10-70 Local 215');
    expect(result.city).toBe('BOGOTÁ D.C.');
    expect(result.phone).toBe('601 742 1122');
    expect(result.email).toBe('contacto@copigraficassierra.com');
    expect(result.notes).toContain('Actividad Económica');
    expect(result.notes).toContain('1811');
  });

  it('extrae campos de un RUT de persona natural (cédula)', () => {
    const result = parseRutText(RUT_CC_SAMPLE);
    expect(result.name).toBe('JUAN PEREZ GOMEZ');
    expect(result.documentType).toBe('CC');
    expect(result.documentNumber).toBe('1023456789');
    expect(result.email).toBe('juan.perez@example.com');
  });

  it('devuelve objeto vacío si no encuentra nada', () => {
    const result = parseRutText('texto sin datos útiles');
    expect(result.name).toBeUndefined();
    expect(result.documentNumber).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:\copiFactus\backend && npx jest src/common/rut/rut-extractor.util.spec.ts -v`
Expected: FAIL — "Cannot find module './rut-extractor.util'"

- [ ] **Step 3: Write the implementation**

Create `src/common/rut/rut-extractor.util.ts`:

```typescript
import { PDFParse } from 'pdf-parse';

export interface ExtractedRutData {
  name?: string;
  documentType?: 'NIT' | 'CC';
  documentNumber?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  notes?: string;
}

const hasDigitVerifier = (n: string) => /^\d{8,10}-\d$/.test(n);

function cleanLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function valueAfterLabel(text: string, pattern: RegExp, stopLabels: RegExp): string | undefined {
  const match = text.match(pattern);
  if (!match || match.index === undefined) return undefined;
  const rest = text.slice(match.index + match[0].length);
  const stop = stopLabels.exec(rest);
  const raw = stop ? rest.slice(0, stop.index) : rest.split('\n')[0];
  const cleaned = cleanLine(raw).replace(/^[:\s.\-]+/, '');
  if (!cleaned) return undefined;
  return cleaned.split(/\s{2,}/)[0].trim();
}

export function parseRutText(text: string): ExtractedRutData {
  const normalized = text.replace(/\r/g, '\n');
  const upper = normalized.toUpperCase();

  const result: ExtractedRutData = {};

  // NIT con dígito verificador (persona jurídica)
  const nitMatch = upper.match(
    /(?:NIT|N\.I\.T\.?|NÚMERO\s+DE\s+IDENTIFICACIÓN\s+TRIBUTARIA\s*\(NIT\))\s*[:\-]?\s*(\d{8,10}-\d)\b/i,
  ) ?? upper.match(/\b(\d{8,10}-\d)\b/);
  if (nitMatch?.[1]) {
    result.documentType = 'NIT';
    result.documentNumber = nitMatch[1];
  }

  // Cédula de ciudadanía (persona natural)
  const ccMatch = upper.match(
    /(?:C\.?C\.?|CÉDULA\s+DE\s+CIUDADANÍA|NÚMERO\s+DE\s+IDENTIFICACIÓN)\s*[:\-]?\s*(\d{6,10})\b/i,
  );
  if (!result.documentNumber && ccMatch?.[1]) {
    result.documentType = 'CC';
    result.documentNumber = ccMatch[1];
  }

  // Razón social / nombre comercial / apellidos y nombres
  const nameMatch = upper.match(
    /(?:RAZÓN\s+SOCIAL|RAZON\s+SOCIAL|NOMBRE\s+COMERCIAL|APELLIDOS\s+Y\s+NOMBRES|NOMBRE\s+COMPLETO)\s*[:\-]?\s*([^\n]{3,120})/i,
  );
  if (nameMatch?.[1]) {
    result.name = cleanLine(nameMatch[1]);
  }

  // Dirección
  const addressMatch = upper.match(
    /(?:DIRECCIÓN|DIRECCION|DIRECCIÓN\s+COMERCIAL|DIRECCION\s+COMERCIAL|DOMICILIO)\s*[:\-]?\s*([^\n]{4,120})/i,
  );
  if (addressMatch?.[1]) {
    result.address = cleanLine(addressMatch[1]);
  }

  // Municipio / ciudad / centro poblado
  const cityMatch = upper.match(
    /(?:MUNICIPIO|CIUDAD|CENTRO\s+POBLADO|DEPARTAMENTO)\s*[:\-]?\s*([^\n]{2,80})/i,
  );
  if (cityMatch?.[1]) {
    result.city = cleanLine(cityMatch[1]).split(/\s{2,}/)[0];
  }

  // Teléfono
  const phoneMatch = normalized.match(
    /(?:TELÉFONO|TELEFONO|TELÉFONO\s+CELULAR|TELEFONO\s+CELULAR)\s*[:\-]?\s*([+\d][\d\s.\-]{6,})/i,
  );
  if (phoneMatch?.[1]) {
    result.phone = cleanLine(phoneMatch[1]);
  }

  // Correo electrónico
  const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/i);
  if (emailMatch?.[0] && emailMatch[0].toLowerCase().includes('@')) {
    result.email = emailMatch[0].toLowerCase();
  }

  // Notas: actividad económica, estado y fecha de actualización
  const notesParts: string[] = [];
  const activityMatch = upper.match(
    /ACTIVIDAD\s+ECON[ÓO]MICA[^:]*\s*[:\-]?\s*([^\n]{4,120})/i,
  );
  if (activityMatch?.[1]) {
    notesParts.push(`Actividad económica: ${cleanLine(activityMatch[1])}`);
  }
  const stateMatch = upper.match(/ESTADO\s*[:\-]?\s*([^\n]{2,40})/i);
  if (stateMatch?.[1]) {
    notesParts.push(`Estado: ${cleanLine(stateMatch[1])}`);
  }
  const dateMatch = upper.match(
    /FECHA\s+DE\s+ACTUALIZACI[ÓO]N\s*[:\-]?\s*([\d]{1,2}[\/\-][\d]{1,2}[\/\-][\d]{2,4})/i,
  );
  if (dateMatch?.[1]) {
    notesParts.push(`Fecha de actualización: ${cleanLine(dateMatch[1])}`);
  }
  if (notesParts.length > 0) {
    result.notes = notesParts.join('\n');
  }

  return result;
}

export async function extractRutFromPdf(buffer: Buffer): Promise<ExtractedRutData> {
  let text = '';
  try {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const parsed = await parser.getText();
      text = parsed.text ?? '';
    } finally {
      await parser.destroy();
    }
  } catch {
    return {};
  }
  return parseRutText(text);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd D:\copiFactus\backend && npx jest src/common/rut/rut-extractor.util.spec.ts -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd D:\copiFactus\backend
git add src/common/rut/rut-extractor.util.ts src/common/rut/rut-extractor.util.spec.ts
git commit -m "feat(rut): util para extraer datos del RUT DIAN desde PDF"
```

---

### Task 2: Endpoint POST /customers/extract-rut (backend)

**Files:**
- Modify: `src/customers/customers.controller.ts`
- Modify: `src/customers/customers.module.ts`
- Test: `src/customers/customers.controller.spec.ts` (nuevo)

**Interfaces:**
- Consumes: `extractRutFromPdf(buffer)` y `ExtractedRutData` de `src/common/rut/rut-extractor.util`
- Produces: `POST /customers/extract-rut` → `Promise<{ extracted: ExtractedRutData }>`, protegido por `JwtAuthGuard` + `RolesGuard` + `@Roles(ADMIN, FACTURADOR)`
- Produces: `CustomFile` type `{ buffer: Buffer; mimetype: string; size: number }`

- [ ] **Step 1: Write the failing test**

Create `src/customers/customers.controller.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { extractRutFromPdf } from '../common/rut/rut-extractor.util';

jest.mock('../common/rut/rut-extractor.util', () => ({
  extractRutFromPdf: jest.fn(),
}));

describe('CustomersController (extract-rut)', () => {
  let controller: CustomersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CustomersController],
      providers: [
        {
          provide: CustomersService,
          useValue: {
            findAll: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
          },
        },
      ],
    }).compile();
    controller = module.get(CustomersController);
  });

  it('extrae datos del RUT y los retorna', async () => {
    const mockExtracted = {
      name: 'COPIGRAFICA SIERRA S.A.S.',
      documentType: 'NIT',
      documentNumber: '900123456-7',
    };
    (extractRutFromPdf as jest.Mock).mockResolvedValue(mockExtracted);

    const result = await controller.extractRut({
      buffer: Buffer.from('%PDF-1.4 fake'),
      mimetype: 'application/pdf',
      size: 100,
    } as Express.Multer.File);

    expect(result.extracted).toEqual(mockExtracted);
    expect(extractRutFromPdf).toHaveBeenCalledTimes(1);
  });

  it('rechaza un archivo que no sea PDF', async () => {
    await expect(
      controller.extractRut({
        buffer: Buffer.from('not a pdf'),
        mimetype: 'text/plain',
        size: 9,
      } as Express.Multer.File),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza un archivo mayor a 5MB', async () => {
    await expect(
      controller.extractRut({
        buffer: Buffer.alloc(6 * 1024 * 1024),
        mimetype: 'application/pdf',
        size: 6 * 1024 * 1024,
      } as Express.Multer.File),
    ).rejects.toThrow(PayloadTooLargeException);
  });

  it('rechaza si no hay archivo', async () => {
    await expect(
      controller.extractRut(undefined as unknown as Express.Multer.File),
    ).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:\copiFactus\backend && npx jest src/customers/customers.controller.spec.ts -v`
Expected: FAIL — "extractRut is not a function"

- [ ] **Step 3: Write the implementation**

Modify `src/customers/customers.controller.ts`. Add imports at the top (after existing imports):

```typescript
import {
  BadRequestException,
  FileTypeValidator,
  MaxFileSizeValidator,
  ParseFilePipe,
  PayloadTooLargeException,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { extractRutFromPdf } from '../common/rut/rut-extractor.util';
```

Note: `Post` and `UseInterceptors` are already imported in the controller (check imports — `Post` and `UseGuards` are there; add the rest if missing).

Add the new handler method (inside the class, before the closing brace):

```typescript
@Post('extract-rut')
@Roles(UserRole.ADMIN, UserRole.FACTURADOR)
@UseInterceptors(FileInterceptor('file'))
async extractRut(@UploadedFile() file?: Express.Multer.File) {
  if (!file) {
    throw new BadRequestException('No se recibió ningún archivo.');
  }
  if (file.mimetype !== 'application/pdf') {
    throw new BadRequestException('Solo se permiten archivos PDF.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new PayloadTooLargeException('El archivo supera los 5MB.');
  }
  const required = ['name', 'documentNumber'];
  const extracted = await extractRutFromPdf(file.buffer);
  const missing = required.filter((f) => !extracted[f as keyof typeof extracted]);
  if (missing.length > 0) {
    throw new BadRequestException(
      'No se pudieron reconocer los datos del RUT. Verifica que sea un PDF del RUT generado digitalmente (no escaneado).',
    );
  }
  return { extracted };
}
```

Note: `Express.Multer.File` requires `@types/express` (present in devDeps). If the type namespace isn't available, use a structural type `{ buffer: Buffer; mimetype: string; size: number }` via inline `&` with an interface — do NOT import Multer types globally. If `Express.Multer.File` does not resolve, define:

```typescript
interface RutUploadFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}
```

and use `@UploadedFile() file?: RutUploadFile`.

Modify `src/customers/customers.module.ts` to register the Multer/file interceptor is automatic — no change needed for Multer (provided by platform-express, imported in AppModule already). Verify `FileInterceptor` resolves by importing from `@nestjs/platform-express`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd D:\copiFactus\backend && npx jest src/customers/customers.controller.spec.ts -v && npm run build`
Expected: PASS + build succeeds

- [ ] **Step 5: Commit**

```bash
cd D:\copiFactus\backend
git add src/customers/customers.controller.ts src/customers/customers.controller.spec.ts
git commit -m "feat(customers): endpoint para extraer datos de RUT desde PDF"
```

---

### Task 3: Servicio frontend para subir y analizar el RUT

**Files:**
- Modify: `src/services/customers.ts` (existe ya — añadir función junto al `customersService`)
- Test: verificar con lint/build

**Interfaces:**
- Consumes: `getAuthToken` de `@/lib/api` (ya importado)
- Produces: `export interface ExtractedRutData { name?: string; documentType?: 'NIT'|'CC'; documentNumber?: string; phone?: string; email?: string; address?: string; city?: string; notes?: string }`
- Produces: `export async function extractCustomerRut(file: File): Promise<ExtractedRutData>`

- [ ] **Step 1: Append the extract function to the existing service**

The file `src/services/customers.ts` already exists and exports `customersService`. Add the `extractCustomerRut` function and its types below the existing object (keeping the existing `api` import; add `getAuthToken`):

```typescript
import { api, getAuthToken } from '@/lib/api'

// ... archivo actual con customersService ...

export interface ExtractedRutData {
  name?: string
  documentType?: 'NIT' | 'CC'
  documentNumber?: string
  phone?: string
  email?: string
  address?: string
  city?: string
  notes?: string
}

export async function extractCustomerRut(file: File): Promise<ExtractedRutData> {
  const base = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '')
  const token = getAuthToken()
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(`${base}/customers/extract-rut`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload
        ? String((payload as { message: unknown }).message)
        : `Error ${response.status}`
    throw new Error(message)
  }
  return (payload as { extracted: ExtractedRutData }).extracted
}
```

- [ ] **Step 3: Verify build & lint**

Run: `cd D:\copiFactus\frontend && npx oxlint src/services/customers.ts && npm run build`
Expected: no lint errors, build succeeds

- [ ] **Step 4: Commit**

```bash
cd D:\copiFactus\frontend
git add src/services/customers.ts
git commit -m "feat(customers): servicio para analizar RUT desde PDF"
```

---

### Task 4: Botón "Subir RUT" en el formulario de cliente (frontend)

**Files:**
- Modify: `src/pages/customers/CustomerFormPage.tsx`
- (opcional) Create: `src/components/customers/RutUploadButton.tsx`

**Interfaces:**
- Consumes: `extractCustomerRut` y `ExtractedRutData` de `src/services/customers`
- Consumes: `useForm` `setValue` del formulario existente
- Uses: `toast` de sonner

- [ ] **Step 1: Add the RUT upload button to the form**

Modify `src/pages/customers/CustomerFormPage.tsx`:
1. Add imports to the top of `CustomerFormPage.tsx`:

```typescript
import { useRef, useState } from 'react'
// ... (conserva imports existentes de react-router-dom, lucide, etc.)
import { FileUp } from 'lucide-react'
import { toast } from 'sonner'
import { extractCustomerRut } from '@/services/customers'
```

(Add `FileUp` to the existing lucide-react import line if preferred.)

2. Pull `setValue` and `getValues` from `useForm` hook (add to the destructure at line ~39):
```typescript
const {
  register,
  handleSubmit,
  setValue,
  getValues,
  formState: { errors, isSubmitting },
} = useForm<FormData>({ ... })
```

3. Add hidden file input ref + state. Inside the component, after the mutations:
```typescript
const fileInputRef = useRef<HTMLInputElement>(null)
const [rutLoading, setRutLoading] = useState(false)
```

(`Loader2` y `Button` ya están importados en el archivo; `getValues` se destrutta de `useForm` — ver paso 2.)

4. Add the handler:
```typescript
const handleRutFile = async (file?: File) => {
  if (!file) return
  if (file.type !== 'application/pdf') {
    toast.error('El RUT debe ser un archivo PDF.')
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    toast.error('El archivo supera los 5MB.')
    return
  }
  setRutLoading(true)
  try {
    const data = await extractCustomerRut(file)
    if (data.name) setValue('name', data.name)
    if (data.documentType) setValue('documentType', data.documentType)
    if (data.documentNumber) setValue('documentNumber', data.documentNumber)
    if (data.phone) setValue('phone', data.phone)
    if (data.email) setValue('email', data.email)
    if (data.address) setValue('address', data.address)
    if (data.city) setValue('city', data.city)
    if (data.notes) {
      const current = getValues('notes') ?? ''
      setValue('notes', current ? `${current}\n\n${data.notes}` : data.notes)
    }
    toast.success('Datos del RUT cargados. Revísalos antes de guardar.')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'No se pudo analizar el RUT.')
  } finally {
    setRutLoading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }
}
```

Also destructure `getValues` from `useForm` (add it to the same destructure as `setValue` in step 2).

5. Add the file input + button in the JSX. Inside `<CardContent>`, before the `<form>` (so it's above the fields), add a header row. Replace the `<CardContent className="pt-6">` opening block to include a button row:

```tsx
<CardContent className="pt-6">
  <div className="mb-4 flex items-center gap-2">
    <input
      ref={fileInputRef}
      type="file"
      accept="application/pdf,.pdf"
      className="hidden"
      onChange={(e) => handleRutFile(e.target.files?.[0])}
    />
    <Button
      type="button"
      variant="outline"
      onClick={() => fileInputRef.current?.click()}
      disabled={rutLoading}
    >
      {rutLoading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Analizando RUT...
        </>
      ) : (
        <>
          <FileUp className="h-4 w-4" />
          Subir RUT
        </>
      )}
    </Button>
    <p className="text-xs text-muted-foreground">
      Sube el PDF del RUT para llenar los campos automáticamente.
    </p>
  </div>
  <form ...>...</form>
</CardContent>
```

Verify the `getValues` is available in the destructure; add it. Also confirm `Button` handles `type="button"` (shadcn Button defaults to `type="button"` only when specified; ensure it doesn't submit).

- [ ] **Step 2: Verify build & lint**

Run: `cd D:\copiFactus\frontend && npx oxlint src/pages/customers/CustomerFormPage.tsx && npm run build`
Expected: no lint errors, build succeeds

- [ ] **Step 3: Manual smoke test (dev)**

Run: `cd D:\copiFactus\frontend && npm run dev`
Expected: In `Nuevo cliente`, "Subir RUT", seleccionar un PDF de RUT digital → spinner → campos rellenados → toast de éxito.

- [ ] **Step 4: Commit**

```bash
cd D:\copiFactus\frontend
git add src/pages/customers/CustomerFormPage.tsx
git commit -m "feat(customers): boton subir RUT para autocompletar formulario"
```

---

### Task 5: Verificación final (backend + frontend)

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Backend build + tests completos**

Run: `cd D:\copiFactus\backend && npm run build && npx jest --silent`
Expected: build passes, all tests pass (no regressions)

- [ ] **Step 2: Frontend build**

Run: `cd D:\copiFactus\frontend && npm run build`
Expected: build succeeds

- [ ] **Step 3: Commit any stragglers**

```bash
cd D:\copiFactus\backend && git status --short
cd D:\copiFactus\frontend && git status --short
```
Expected: clean (no uncommitted changes) — or commit leftovers.
