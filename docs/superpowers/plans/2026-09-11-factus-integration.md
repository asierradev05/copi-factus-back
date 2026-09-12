# Integración FACTUS (Facturación electrónica DIAN — Fase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar FACTUS como proveedor tecnológico de facturación electrónica DIAN (sandbox vía `POST /v2/bills/validate`) para que al pulsar EMITIR la factura quede remitida a la DIAN: número oficial, CUFE real, QR, enlaces, XML/PDF oficiales archivados, y la UI muestre el estado DIAN.

**Architecture:** Módulo backend `src/factus/` aislado como adapter (auth OAuth2 con cache+refresh+retry 401, adapter HTTP tipado, sync de emisor/rangos, payload builder puro). `InvoicesService.emit` orquesta: si `FACTUS_*` están configuradas y hay una resolución sincronizada, emite bloqueante ante Factus; si no, cae al flujo local actual (preview pdfmake, CUFE placeholder). El modelo de datos se extiende con campos neutro-DIAN via migración `dian_factus_fase1`.

**Tech Stack:** NestJS 11 + Prisma (adapter-pg) + PostgreSQL (Supabase) + `@nestjs/config` + Supabase Storage + Jest (unit, `*.spec.ts` bajo `src/`). Frontend: React 19 + Vite + TanStack Query + react-hook-form + zod + Tailwind v4 + shadcn/ui. Sin axios: se usa `globalThis.fetch` (Node ≥ 20). Sin cliente HTTP propio en frontend: `src/lib/api.ts`.

**Spec:**
- `D:\copiFactus\copigraficas\proyectos\factus\autenticacion.md` (OAuth2 password + refresh, headers, vigencia ~1h, regla 401-retry)
- `D:\copiFactus\copigraficas\proyectos\factus\catalogo-endpoints.md` (orden de integración; convenciones de error/paginación)
- `D:\copiFactus\copigraficas\proyectos\factus\factura-estandar.md` (payload `POST /v2/bills/validate`, item `tax_amount`, `payment_details`, respuesta 201)
- `D:\copiFactus\copigraficas\proyectos\factus\numbering-ranges.md` (`numberingRangeId`, `document` 21/22/23, `current`)
- `D:\copiFactus\copigraficas\dian\integracion-factus.md` (brechas)
- `D:\copiFactus\copigraficas\dian\modelo-datos-dian.md` (campos Prisma exactos de la migración)

## Global Constraints

- Entorno Windows PowerShell 5.1: **no usar `&&`**; encadenar con `cmd1; if ($?) { cmd2 }`. Usar `workdir` para cambiar de carpeta.
- Backend: no hay carpeta `prisma/migrations` (la BD nació via push/SQL). Usar `npx prisma db push` como migración (solo `add column` nullable/default → sin pérdida de datos) y `npx prisma generate`. Alternativa si hay shadow DB: `npx prisma migrate dev --name dian_factus_fase1`.
- Env vars FACTUS: `FACTUS_URL`, `FACTUS_CLIENT_ID`, `FACTUS_CLIENT_SECRET`, `FACTUS_USERNAME`, `FACTUS_PASSWORD`, `FACTUS_AMBIENT=sandbox`, `FACTUS_SEND_EMAIL=false`. Las credenciales **no se escriben en el repo** (solo `.env` local/vercel). El logout de credenciales reales NO existe aún → los tests marcan la verificación E2E como pendiente.
- Sin credenciales reales: el flujo de emisión Factus queda **verificable por unit tests** (payload, mapeos, auth con fetch mockeado); la validación final contra sandbox se documenta en el checklist final.
- Los códigos DIAN (13/31/22/41/42, 10/47/48/49/ZZZ, 21/22/24, 11001, R-99-PN, O-13) se mapean en el adapter, no se duplican como enums nuevos.
- `referenceCode` (≤20 chars) se genera **una vez** por factura, estable entre reintentos (derivado del UUID), y se persiste **antes** del primer request a Factus.
- El CUFE local (`cufe.util.ts`) NO es legal; en la emisión DIAN el `cufe` se reemplaza por `data.cufe` de Factus.
- Backend: `npm test` (Jest, `*.spec.ts` en `src/`), `npm run lint`, `npm run build` (nest build). Frontend: `npm run lint` (oxlint) y `npm run build` (`tsc -b && vite build`).
- Ramas feature: `feat/factus-integration` en `D:\copiFactus\backend` y `D:\copiFactus\frontend`. Nada de commits a `main` en esta feature.

---

### Task 1: Rama feature + schema DIAN (backend)

**Files:**
- Modify: `D:\copiFactus\backend\prisma\schema.prisma`
- Test: (ninguno — verificación por `npx prisma validate`)

**Interfaces:**
- Consumes: nada.
- Produces: campos `legalOrganizationCode/tradeName/registrationCode/economicActivity/municipalityCode/countryCode/tributeCode/responsibilities/isSyncedToFactus` en `CompanySettings`; `dv/legalOrganizationCode/municipalityCode/countryCode/tributeCode/responsibilities` en `Customer`; `numberingRangeId/documentCode/factusRangeData` en `Resolution`; `referenceCode/factusNumber/validatedAt/qrUrl/publicUrl/graphicRepresentationUrl/xmlPath/pdfPath/cashRoundingAmount/paymentForm/factusPayload` en `Invoice`; `unitMeasureCode/standardCode/discountType` en `InvoiceItem`; `unitMeasureCode/standardCode` en `Product`.

- [ ] **Step 1: Crear rama feature**

```bash
git checkout -b feat/factus-integration
```

- [ ] **Step 2: Añadir campos a `CompanySettings`**

En `prisma/schema.prisma`, dentro de `model CompanySettings`, antes de `createdAt`:

```prisma
  legalOrganizationCode Int      @default(1)       @map("legal_organization_code")
  tradeName             String?                     @map("trade_name")
  registrationCode      String?                     @map("registration_code")
  economicActivity      String?                     @map("economic_activity")
  municipalityCode      String?  @default("11001") @map("municipality_code")
  countryCode           String   @default("CO")    @map("country_code")
  tributeCode           String   @default("01")    @map("tribute_code")
  responsibilities      Json?                       @map("responsibilities")
  isSyncedToFactus      Boolean  @default(false)   @map("is_synced_to_factus")
```

- [ ] **Step 3: Añadir campos a `Customer`**

```prisma
  dv                    String?    @map("dv")
  legalOrganizationCode Int?       @map("legal_organization_code")
  municipalityCode      String?    @map("municipality_code")
  countryCode           String?    @default("CO") @map("country_code")
  tributeCode           String?    @map("tribute_code")
  responsibilities      Json?      @map("responsibilities")
```

- [ ] **Step 4: Añadir campos a `Resolution`**

```prisma
  numberingRangeId Int?   @unique @map("numbering_range_id")
  documentCode     String? @map("document_code")
  factusRangeData  Json?  @map("factus_range_data")
```

- [ ] **Step 5: Añadir campos a `Invoice`**

```prisma
  referenceCode            String?   @unique @map("reference_code")
  factusNumber             String?   @map("factus_number")
  validatedAt              DateTime? @map("validated_at")
  qrUrl                    String?   @map("qr_url")
  publicUrl                String?   @map("public_url")
  graphicRepresentationUrl String?   @map("graphic_representation_url")
  xmlPath                  String?   @map("xml_path")
  pdfPath                  String?   @map("pdf_path")
  cashRoundingAmount       Decimal?  @default(0) @db.Decimal(12,2) @map("cash_rounding_amount")
  paymentForm              String?   @map("payment_form")
  factusPayload            Json?     @map("factus_payload")
```

- [ ] **Step 6: Añadir campos a `InvoiceItem` y `Product`**

En `InvoiceItem`:

```prisma
  unitMeasureCode String? @default("94")  @map("unit_measure_code")
  standardCode    String? @default("999") @map("standard_code")
  discountType    String? @map("discount_type")
```

En `Product`:

```prisma
  unitMeasureCode String? @default("94")  @map("unit_measure_code")
  standardCode    String? @default("999") @map("standard_code")
```

- [ ] **Step 7: Validar schema**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid`.

- [ ] **Step 8: Aplicar migración + regenerar cliente**

Run: `npx prisma db push`
Expected: OK (additive). Luego `npx prisma generate`.
(Si `db push` falla por permisos de Supabase, pedir a CI/local el `DATABASE_URL`; es la misma BD dev usada hoy.)

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(dian): add FACTUS/DIAN fields to prisma schema"
```

---

### Task 2: DTOs y servicios de Customer/Settings con campos DIAN (backend)

**Files:**
- Modify: `D:\copiFactus\backend\src\customers\dto\create-customer.dto.ts`
- Modify: `D:\copiFactus\backend\src\customers\dto\update-customer.dto.ts`
- Modify: `D:\copiFactus\backend\src\customers\customers.service.ts`
- Modify: `D:\copiFactus\backend\src\settings\dto\update-company-settings.dto.ts`

**Interfaces:**
- Consumes: campos del schema (Task 1); patrones DTO existentes (`@IsOptional`, `@IsString`, `@IsNumber`, `@IsArray`, `@Type`).
- Produces: `CreateCustomerDto.dv/legalOrganizationCode/municipalityCode/countryCode/tributeCode/responsibilities` opcionales; `CustomersService.create/update` persisten esos campos; `UpdateCompanySettingsDto` acepta los campos DIAN del emisor.

- [ ] **Step 1: Escribir test de DTO de customer**

Crear `D:\copiFactus\backend\src\customers\customers.dto.spec.ts`:

```ts
import { validate } from 'class-validator';
import { CreateCustomerDto } from './dto/create-customer.dto';

describe('CreateCustomerDto (DIAN)', () => {
  it('acepta campos DIAN opcionales y responsabilidades', async () => {
    const dto = new CreateCustomerDto();
    dto.name = 'Comercial Andina SAS';
    dto.phone = '6014557060';
    dto.documentType = 'NIT' as any;
    dto.documentNumber = '900123456';
    dto.dv = '7';
    dto.legalOrganizationCode = 1;
    dto.municipalityCode = '11001';
    dto.tributeCode = '01';
    dto.responsibilities = [{ code: 'O-13' }];
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });
});
```

- [ ] **Step 2: Correr test — debe fallar (campos desconocidos)**

Run: `npx jest src/customers/customers.dto.spec.ts`
Expected: FAIL — `responsibilities`/`dv` no son propiedades de la clase.

- [ ] **Step 3: Ampliar `CreateCustomerDto`**

En `create-customer.dto.ts`, tras `notes`:

```ts
  @IsOptional()
  @IsString()
  dv?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  legalOrganizationCode?: number;

  @IsOptional()
  @IsString()
  municipalityCode?: string;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @IsString()
  tributeCode?: string;

  @IsOptional()
  @IsArray()
  responsibilities?: Array<{ code: string }>;
```

- [ ] **Step 4: Correr test — debe pasar**

Run: `npx jest src/customers/customers.dto.spec.ts`
Expected: PASS.

- [ ] **Step 5: Persistir campos en `CustomersService.create/update`**

En `customers.service.ts`, en el objeto `data:` de `create` añadir (usando el patrón `trim`/`undefined` que ya usa el archivo):

```ts
        ...(dto.dv !== undefined ? { dv: dto.dv?.trim() } : {}),
        ...(dto.legalOrganizationCode !== undefined ? { legalOrganizationCode: dto.legalOrganizationCode } : {}),
        ...(dto.municipalityCode !== undefined ? { municipalityCode: dto.municipalityCode?.trim() } : {}),
        ...(dto.countryCode !== undefined ? { countryCode: dto.countryCode?.trim() } : {}),
        ...(dto.tributeCode !== undefined ? { tributeCode: dto.tributeCode?.trim() } : {}),
        ...(dto.responsibilities !== undefined ? { responsibilities: dto.responsibilities } : {}),
```

Repetir el mismo bloque en `update` (mismo patrón de spreads condicionales).

- [ ] **Step 6: Correr suite de customers**

Run: `npx jest src/customers`
Expected: PASS (incluye el nuevo spec y el spec del controller).

- [ ] **Step 7: Ampliar `UpdateCompanySettingsDto`**

En `update-company-settings.dto.ts`, tras `invoiceNextNumber`:

```ts
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(2)
  legalOrganizationCode?: number;

  @IsOptional()
  @IsString()
  tradeName?: string;

  @IsOptional()
  @IsString()
  registrationCode?: string;

  @IsOptional()
  @IsString()
  economicActivity?: string;

  @IsOptional()
  @IsString()
  municipalityCode?: string;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @IsString()
  tributeCode?: string;

  @IsOptional()
  @IsArray()
  responsibilities?: Array<{ code: string }>;
```

(El `settings.service.ts` actual ya propaga con `...(dto.x !== undefined ? { x: ... } : {})`; añadir el mismo patrón para los 8 campos nuevos.)

- [ ] **Step 8: Commit**

```bash
git add src/customers src/settings
git commit -m "feat(dian): extend customer and company settings DTOs/services with DIAN fields"
```

---

### Task 3: Tipos shared + utils de mapeo DIAN (backend)

**Files:**
- Create: `D:\copiFactus\backend\src\factus\factus-types.ts`
- Create: `D:\copiFactus\backend\src\factus\factus-utils.ts`
- Create: `D:\copiFactus\backend\src\factus\factus-utils.spec.ts`

**Interfaces:**
- Consumes: enums de `@prisma/client` (`DocumentType`, `ResolutionType`, `PaymentMethod`).
- Produces:
  - `generateReferenceCode(invoiceId: string): string`
  - `calculateDianDv(nit: string): string`
  - `mapDocumentTypeToDian(type: DocumentType): string`
  - `mapResolutionTypeToDian(type: ResolutionType): string`
  - `mapPaymentMethodToDian(method: PaymentMethod): string`
  - `round2(n: number): number`
  - Tipos `FactusError`, `FactusBillData`, `FactusBillResponse`, `FactusBuildItem`, `FactusBuildInput`, `FactusStatus`.

- [ ] **Step 1: Escribir test**

`D:\copiFactus\backend\src\factus\factus-utils.spec.ts`:

```ts
import {
  generateReferenceCode,
  calculateDianDv,
  mapDocumentTypeToDian,
  mapResolutionTypeToDian,
  mapPaymentMethodToDian,
  round2,
} from './factus-utils';

describe('factus-utils', () => {
  it('genera reference code estable y <= 20 chars', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000';
    const a = generateReferenceCode(id);
    const b = generateReferenceCode(id);
    expect(a).toBe(b);
    expect(a.length).toBeLessThanOrEqual(20);
    expect(a).toMatch(/^REF[0-9A-F]+$/);
  });

  it('calcula DV NIT como un solo dígito determinístico', () => {
    const dv = calculateDianDv('900123456');
    expect(String(dv)).toMatch(/^\d$/);
    expect(calculateDianDv('900123456')).toBe(dv);
  });

  it('mapea enums a códigos DIAN', () => {
    expect(mapDocumentTypeToDian('CC' as any)).toBe('13');
    expect(mapDocumentTypeToDian('NIT' as any)).toBe('31');
    expect(mapResolutionTypeToDian('FACTURA' as any)).toBe('21');
    expect(mapResolutionTypeToDian('NOTA_CREDITO' as any)).toBe('22');
    expect(mapPaymentMethodToDian('EFECTIVO' as any)).toBe('10');
    expect(mapPaymentMethodToDian('TRANSFERENCIA' as any)).toBe('47');
  });

  it('redondea a 2 decimales', () => {
    expect(round2(1.999)).toBe(2);
    expect(round2(10.005)).toBe(10.01);
  });
});
```

- [ ] **Step 2: Correr test — debe fallar (módulo no existe)**

Run: `npx jest src/factus/factus-utils.spec.ts`
Expected: FAIL (Cannot find module).

- [ ] **Step 3: Escribir `factus-types.ts`**

```ts
export interface FactusError {
  status_code: number;
  error?: Array<{ context?: string; error_type?: string; message?: string }>;
  message?: string;
}

export interface FactusBillData {
  number: string;
  document: string;
  cufe: string;
  is_validated: boolean;
  errors?: Array<{ context?: string; error_type?: string; message?: string }>;
  validated_at?: string | null;
  type_document?: string;
  totals?: {
    gross_total?: number;
    tax_total?: number;
    taxable_total?: number;
    total?: number;
  };
  currency_code?: string;
  links?: {
    url_qr_code?: string;
    url_public?: string;
    url_graphic_representation?: string;
  };
}

export interface FactusBillResponse {
  data: FactusBillData;
}

export interface FactusRangeResponse {
  id?: number;
  data?: { id?: number };
}

export interface FactusBuildItem {
  code: string;
  name: string;
  description?: string;
  quantity: number;
  price: number;
  taxRate: number;
  discount?: number;
  unitMeasureCode?: string;
  standardCode?: string;
}

export interface FactusBuildCustomer {
  documentTypeDian: string;
  dv?: string;
  identificationNumber: string;
  name: string;
  legalOrganizationCode: number;
  tributeCode: string;
  responsibilities: Array<{ code: string }>;
  email?: string;
  phone?: string;
  address?: string;
  municipalityCode?: string;
  countryCode?: string;
}

export interface FactusBuildCompany {
  legalOrganizationCode: number;
  name: string;
  legalName: string;
  tradeName?: string;
  email?: string;
  address?: string;
  registrationCode?: string;
  phone?: string;
  municipalityCode?: string;
  economicActivity?: string;
  tributeCode?: string;
  responsibilities: Array<{ code: string }>;
}

export interface FactusBuildInput {
  referenceCode: string;
  numberingRangeId: number;
  customer: FactusBuildCustomer;
  company: FactusBuildCompany;
  items: FactusBuildItem[];
  total: number;
  paidAmount: number;
  dueDate?: Date;
  cashRoundingAmount?: number;
  paymentMethodDian: string;
  paymentForm: '1' | '2';
}

export interface FactusStatus {
  configured: boolean;
  ambient: string;
  emisorSynced: boolean;
  url: string | null;
}
```

- [ ] **Step 4: Escribir `factus-utils.ts`**

```ts
import {
  DocumentType,
  PaymentMethod,
  ResolutionType,
} from '@prisma/client';

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function generateReferenceCode(invoiceId: string): string {
  const hex = invoiceId.replace(/-/g, '').toUpperCase();
  return `REF${hex.slice(0, 12)}`;
}

const PRIMES = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 61, 67, 71];

export function calculateDianDv(nit: string): string {
  const clean = String(nit).replace(/\D/g, '');
  if (!clean) return '0';
  const digits = clean.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    sum += digits[digits.length - 1 - i] * PRIMES[i % PRIMES.length];
  }
  const mod = sum % 11;
  let dv = 11 - mod;
  if (dv === 11) dv = 0;
  if (dv === 10) dv = 1;
  return String(dv);
}

export function mapDocumentTypeToDian(type: DocumentType): string {
  switch (type) {
    case 'CC':
      return '13';
    case 'NIT':
      return '31';
    case 'CE':
      return '22';
    case 'PASAPORTE':
      return '41';
    default:
      return '42';
  }
}

export function mapResolutionTypeToDian(type: ResolutionType): string {
  switch (type) {
    case 'FACTURA':
      return '21';
    case 'NOTA_CREDITO':
      return '22';
    default:
      return '24';
  }
}

export function mapPaymentMethodToDian(method: PaymentMethod): string {
  switch (method) {
    case 'EFECTIVO':
      return '10';
    case 'TRANSFERENCIA':
      return '47';
    case 'TARJETA':
      return '48';
    default:
      return 'ZZZ';
  }
}

export function extractRangeId(result: unknown): number | null {
  const r = result as { id?: number; data?: { id?: number } };
  const id = r?.id ?? r?.data?.id;
  return typeof id === 'number' ? id : null;
}
```

- [ ] **Step 5: Correr test — debe pasar**

Run: `npx jest src/factus/factus-utils.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/factus
git commit -m "feat(dian): add factus types and DIAN code mapping utils"
```

---

### Task 4: Payload builder puro (`buildBillPayload`)

**Files:**
- Create: `D:\copiFactus\backend\src\factus\factus-payload.ts`
- Create: `D:\copiFactus\backend\src\factus\factus.payload.spec.ts`

**Interfaces:**
- Consumes: `FactusBuildInput`, `round2` (Task 3).
- Produces: `buildBillPayload(input: FactusBuildInput): Record<string, unknown>` — objeto listo para `POST /v2/bills/validate`. Detalles según `factura-estandar.md`: bloques `reference_code`, `numbering_range_id`, `document "01"`, `operation_type "10"`, `cash_rounding_amount`, `company`, `customer`, `items[]` con `tax.tax_amount = qty×price×rate/100` (2 decimales), `payment_details[]` con `payment_form` 1/2 y `amount`.

- [ ] **Step 1: Escribir test**

`factus.payload.spec.ts`:

```ts
import { buildBillPayload } from './factus-payload';
import type { FactusBuildInput } from './factus-types';

const makeInput = (): FactusBuildInput => ({
  referenceCode: 'REF1234567890',
  numberingRangeId: 15,
  customer: {
    documentTypeDian: '13',
    identificationNumber: '800123456',
    dv: '0',
    name: 'Camila Reyes',
    legalOrganizationCode: 2,
    tributeCode: 'ZZ',
    responsibilities: [{ code: 'R-99-PN' }],
    email: 'camila@mail.com',
    municipalityCode: '11001',
    countryCode: 'CO',
  },
  company: {
    legalOrganizationCode: 1,
    name: 'Copigráficas Sierra',
    legalName: 'COPIAGRAFIAS SIERRA S.A.S.',
    tradeName: 'Copigráficas Sierra',
    email: 'copigraficassierra@gmail.com',
    address: 'Carrera 28 # 10 - 70 Local 215',
    registrationCode: 'RC-123',
    phone: '6014557060',
    municipalityCode: '11001',
    economicActivity: '1811',
    tributeCode: '01',
    responsibilities: [{ code: 'O-13' }],
  },
  items: [
    {
      code: 'P001',
      name: 'Fotocopias A4',
      quantity: 10,
      price: 100,
      taxRate: 19,
    },
  ],
  total: 1190,
  paidAmount: 0,
  dueDate: new Date('2026-10-11T00:00:00Z'),
  cashRoundingAmount: 0,
  paymentMethodDian: '10',
  paymentForm: '2',
});

describe('buildBillPayload', () => {
  it('arma el bloque de ítems con tax_amount calculado a 2 decimales', () => {
    const payload = buildBillPayload(makeInput()) as any;
    expect(payload.document).toBe('01');
    expect(payload.operation_type).toBe('10');
    expect(payload.numbering_range_id).toBe(15);
    expect(payload.reference_code).toBe('REF1234567890');
    const item = payload.items[0];
    expect(item.quantity).toBe(10);
    expect(item.price).toBe(100);
    expect(item.tax).toEqual({ type: 'IVA', percentage: 19, tax_amount: 190 });
  });

  it('mapea legal org a persona juridica/natural', () => {
    const payload = buildBillPayload(makeInput()) as any;
    expect(payload.customer.type).toBe('persona natural');
  });

  it('arma payment_details con forma y monto', () => {
    const payload = buildBillPayload(makeInput()) as any;
    expect(payload.payment_details).toEqual([
      {
        payment_method: '10',
        payment_form: '2',
        amount: 0,
        payment_due_date: '2026-10-11',
      },
    ]);
  });

  it('payment_form 1 usa el total como monto', () => {
    const input = makeInput();
    input.paymentForm = '1';
    input.paidAmount = 1190;
    const payload = buildBillPayload(input) as any;
    expect(payload.payment_details[0].amount).toBe(1190);
  });
});
```

- [ ] **Step 2: Correr test — debe fallar (módulo no existe)**

Run: `npx jest src/factus/factus.payload.spec.ts`
Expected: FAIL (Cannot find module).

- [ ] **Step 3: Escribir `factus-payload.ts`**

```ts
import type { FactusBuildInput } from './factus-types';
import { round2 } from './factus-utils';

export function buildBillPayload(input: FactusBuildInput): Record<string, unknown> {
  const { customer, company } = input;

  const items = input.items.map((item) => {
    const taxAmount = round2(
      item.quantity * item.price * (item.taxRate / 100),
    );
    return {
      code: item.code,
      name: item.name,
      ...(item.description ? { description: item.description } : {}),
      quantity: item.quantity,
      price: item.price,
      unit_measure_code: item.unitMeasureCode ?? '94',
      standard_code: item.standardCode ?? '999',
      tax: { type: 'IVA', percentage: item.taxRate, tax_amount: taxAmount },
      ...(item.discount && item.discount > 0
        ? { discount: { type: '02', value: round2(item.discount) } }
        : {}),
    };
  });

  const payment_details = [
    {
      payment_method: input.paymentMethodDian,
      payment_form: input.paymentForm,
      amount:
        input.paymentForm === '1'
          ? round2(input.total)
          : round2(input.paidAmount),
      ...(input.dueDate
        ? { payment_due_date: input.dueDate.toISOString().slice(0, 10) }
        : {}),
    },
  ];

  return {
    reference_code: input.referenceCode,
    numbering_range_id: input.numberingRangeId,
    document: '01',
    operation_type: '10',
    cash_rounding_amount: round2(input.cashRoundingAmount ?? 0),
    company: {
      legal_organization_code: company.legalOrganizationCode,
      company: company.legalName,
      trade_name: company.tradeName ?? company.name,
      email: company.email ?? '',
      address: company.address ?? '',
      registration_code: company.registrationCode ?? '',
      phone: company.phone ?? '',
      municipality_code: company.municipalityCode ?? '11001',
      economic_activity: company.economicActivity ?? '',
      tribute_code: company.tributeCode ?? '01',
      responsibilities: company.responsibilities,
    },
    customer: {
      type:
        customer.legalOrganizationCode === 1
          ? 'persona juridica'
          : 'persona natural',
      identification_document_code: customer.documentTypeDian,
      identification_number: customer.identificationNumber,
      ...(customer.dv ? { dv: customer.dv } : {}),
      name: customer.name,
      ...(customer.address ? { address: customer.address } : {}),
      ...(customer.email ? { email: customer.email } : {}),
      ...(customer.phone ? { phone: customer.phone } : {}),
      country_code: customer.countryCode ?? 'CO',
      municipality_code: customer.municipalityCode ?? '11001',
      legal_organization_code: customer.legalOrganizationCode,
      tribute_code: customer.tributeCode,
      responsibilities: customer.responsibilities,
    },
    items,
    payment_details,
  };
}
```

- [ ] **Step 4: Correr test — debe pasar**

Run: `npx jest src/factus/factus.payload.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/factus
git commit -m "feat(dian): add pure bill payload builder for Factus validate"
```

---

### Task 5: FactusAuthService (token OAuth2 con cache + refresh + retry)

**Files:**
- Create: `D:\copiFactus\backend\src\factus\factus-auth.service.ts`
- Create: `D:\copiFactus\backend\src\factus\factus-auth.service.spec.ts`

**Interfaces:**
- Consumes: `ConfigService` de `@nestjs/config` (global).
- Produces: `isConfigured(): boolean`, `getBaseUrl(): string`, `getAccessToken(): Promise<string>` (cache + refresh anticipado 10 min + single-flight), `forceRefresh(): Promise<string>` (para retry 401 del adapter).
- **Env:** `FACTUS_URL`, `FACTUS_CLIENT_ID`, `FACTUS_CLIENT_SECRET`, `FACTUS_USERNAME`, `FACTUS_PASSWORD`.

- [ ] **Step 1: Escribir test**

`factus-auth.service.spec.ts` (mockea `globalThis.fetch`):

```ts
import { ConfigService } from '@nestjs/config';
import { FactusAuthService } from './factus-auth.service';

const makeEnv = (token: string) => ({
  FACTUS_URL: 'https://api-sandbox.factus.com.co',
  FACTUS_CLIENT_ID: 'cid',
  FACTUS_CLIENT_SECRET: 'csec',
  FACTUS_USERNAME: 'u@mail.com',
  FACTUS_PASSWORD: 'pass',
});

describe('FactusAuthService', () => {
  let service: FactusAuthService;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const build = (fetchImpl: typeof globalThis.fetch) => {
    globalThis.fetch = fetchImpl;
    const cfg = new ConfigService(makeEnv('x'));
    service = new FactusAuthService(cfg as any);
  };

  it('obtiene token con grant_type=password', async () => {
    const calls: string[] = [];
    build((async (url: any, init: any) => {
      calls.push(String(url));
      expect(String(init.body)).toContain('grant_type=password');
      return new Response(
        JSON.stringify({
          access_token: 'ACCESS',
          refresh_token: 'REFRESH',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof globalThis.fetch);

    const token = await service.getAccessToken();
    expect(token).toBe('ACCESS');
    expect(calls.length).toBe(1);
  });

  it('usa cache cuando el token no está por vencer', async () => {
    let hit = 0;
    build((async (url: any, init: any) => {
      hit += 1;
      return new Response(
        JSON.stringify({
          access_token: 'ACCESS',
          refresh_token: 'REFRESH',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof globalThis.fetch);

    await service.getAccessToken();
    const second = await service.getAccessToken();
    expect(second).toBe('ACCESS');
    expect(hit).toBe(1);
  });

  it('forceRefresh usa refresh_token cuando hay token previo', async () => {
    build((async (url: any, init: any) => {
      const body = String(init.body ?? '');
      const grant = /grant_type=password/.test(body) ? 'password' : 'refresh_token';
      return new Response(
        JSON.stringify({
          access_token: `ACCESS_${grant}`,
          refresh_token: 'REFRESH2',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof globalThis.fetch);

    await service.getAccessToken(); // password
    const refreshed = await service.forceRefresh(); // refresh_token
    expect(refreshed).toBe('ACCESS_refresh_token');
  });

  it('isConfigured es false sin credenciales', () => {
    const cfg = new ConfigService({});
    service = new FactusAuthService(cfg as any);
    expect(service.isConfigured()).toBe(false);
  });
});
```

- [ ] **Step 2: Correr test — debe fallar (no existe el servicio)**

Run: `npx jest src/factus/factus-auth.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Escribir `factus-auth.service.ts`**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

@Injectable()
export class FactusAuthService {
  private readonly logger = new Logger(FactusAuthService.name);
  private token: TokenPair | null = null;
  private inFlight: Promise<string> | null = null;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return [
      'FACTUS_URL',
      'FACTUS_CLIENT_ID',
      'FACTUS_CLIENT_SECRET',
      'FACTUS_USERNAME',
      'FACTUS_PASSWORD',
    ].every((key) => Boolean(this.config.get<string>(key)));
  }

  getBaseUrl(): string {
    return (this.config.get<string>('FACTUS_URL') ?? 'https://api-sandbox.factus.com.co').replace(/\/$/, '');
  }

  async getAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt.getTime() - 10 * 60 * 1000 > Date.now()) {
      return this.token.accessToken;
    }
    if (!this.inFlight) {
      this.inFlight = this.refreshTokenInternal().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  forceRefresh(): Promise<string> {
    return this.refreshTokenInternal();
  }

  private async refreshTokenInternal(): Promise<string> {
    const grant = this.token ? 'refresh_token' : 'password';
    const params: Record<string, string> = {
      grant_type: grant,
      client_id: this.config.get<string>('FACTUS_CLIENT_ID') ?? '',
      client_secret: this.config.get<string>('FACTUS_CLIENT_SECRET') ?? '',
    };
    if (grant === 'refresh_token' && this.token) {
      params.refresh_token = this.token.refreshToken;
    } else {
      params.username = this.config.get<string>('FACTUS_USERNAME') ?? '';
      params.password = this.config.get<string>('FACTUS_PASSWORD') ?? '';
    }

    const res = await globalThis.fetch(`${this.getBaseUrl()}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!res.ok || !json.access_token) {
      throw new Error(
        `Factus: error de autenticación (${res.status}) ${JSON.stringify(json)}`,
      );
    }
    this.token = {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? this.token?.refreshToken ?? '',
      expiresAt: new Date(Date.now() + Number(json.expires_in ?? 3600) * 1000),
    };
    return this.token.accessToken;
  }
}
```

- [ ] **Step 4: Correr test — debe pasar**

Run: `npx jest src/factus/factus-auth.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/factus/factus-auth.service.ts src/factus/factus-auth.service.spec.ts
git commit -m "feat(dian): add Factus OAuth2 auth service with cache, refresh and single-flight"
```

---

### Task 6: FactusAdapterService (HTTP tipado + retry 401)

**Files:**
- Create: `D:\copiFactus\backend\src\factus\factus-adapter.service.ts`
- Create: `D:\copiFactus\backend\src\factus\factus-adapter.service.spec.ts`
- Create: `D:\copiFactus\backend\src\factus\factus-api.exception.ts`

**Interfaces:**
- Consumes: `FactusAuthService`, `FactusStatus`, `FactusBillResponse`, `FactusRangeResponse`, `FactusError` (Task 3/5).
- Produces:
  - `class FactusApiException extends Error { readonly statusCode: number; readonly isAlreadyExists(): boolean }`
  - `getCompanies()`, `updateCompany(payload)`, `getSubscriptions()`,
  - `createNumberingRange(payload)`, `listNumberingRanges(params?)`, `getDianRanges()`, `toggleNumberingRange(id, active)`,
  - `getAcquirer(query)`, `validateBills(payloads: unknown[])`, `listBills(params?)`,
  - `downloadBillPdf(number): Promise<Buffer>`, `downloadBillXml(number): Promise<string>`.

- [ ] **Step 1: Escribir test**

`factus-adapter.service.spec.ts`:

```ts
import { FactusAuthService } from './factus-auth.service';
import { FactusAdapterService } from './factus-adapter.service';
import { FactusApiException } from './factus-api.exception';

describe('FactusAdapterService', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const authOf = (token: string) =>
    ({
      getAccessToken: async () => token,
      forceRefresh: async () => token,
      getBaseUrl: () => 'https://api-sandbox.factus.com.co',
    }) as unknown as FactusAuthService;

  it('GET companies envía Authorization y devuelve data', async () => {
    globalThis.fetch = (async (url: any, init: any) => {
      expect(String(init.headers.Authorization)).toContain('Bearer ACCESS');
      return new Response(JSON.stringify({ data: [{ id: 1 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    const svc = new FactusAdapterService(authOf('ACCESS'));
    const result = await svc.getCompanies();
    expect(result.data).toEqual([{ id: 1 }]);
  });

  it('reintenta una vez tras 401 con forceRefresh', async () => {
    let calls = 0;
    globalThis.fetch = (async (url: any, init: any) => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ status_code: 401 }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    const svc = new FactusAdapterService(authOf('ACCESS'));
    const result = await svc.listBills();
    expect(result.data).toEqual([]);
    expect(calls).toBe(2);
  });

  it('lanza FactusApiException con mensajes concatenados ante 422', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          status_code: 422,
          error: [
            { context: 'customer', message: 'dv inválido' },
            { context: 'items', message: 'impuesto no permitido' },
          ],
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      )) as typeof globalThis.fetch;

    const svc = new FactusAdapterService(authOf('ACCESS'));
    await expect(svc.validateBills([{}])).rejects.toThrow(FactusApiException);
    await expect(svc.validateBills([{}])).rejects.toThrow(
      /dv inválido; impuesto no permitido/,
    );
  });

  it('marca already exists', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          status_code: 422,
          error: [
            { message: 'bill with reference_code: REF123 already exists' },
          ],
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      )) as typeof globalThis.fetch;

    const svc = new FactusAdapterService(authOf('ACCESS'));
    await expect(svc.validateBills([{}])).rejects.toMatchObject({
      statusCode: 422,
    });
    await expect(
      svc.validateBills([{}]).catch((e: FactusApiException) => {
        expect(e.isAlreadyExists()).toBe(true);
      }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Correr test — debe fallar**

Run: `npx jest src/factus/factus-adapter.service.spec.ts`
Expected: FAIL (Cannot find module).

- [ ] **Step 3: Escribir `factus-api.exception.ts`**

```ts
export class FactusApiException extends Error {
  constructor(
    readonly statusCode: number,
    readonly messages: string[],
    readonly raw: unknown,
  ) {
    super(messages.join('; '));
    this.name = 'FactusApiException';
  }

  isAlreadyExists(): boolean {
    return this.messages.some((m) => /already exists|ya existe/i.test(m));
  }
}
```

- [ ] **Step 4: Escribir `factus-adapter.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { FactusAuthService } from './factus-auth.service';
import { FactusApiException } from './factus-api.exception';

type Method = 'GET' | 'POST' | 'PUT';
type Params = Record<string, string | number | boolean | undefined>;

@Injectable()
export class FactusAdapterService {
  constructor(private readonly auth: FactusAuthService) {}

  getCompanies(): Promise<any> {
    return this.request('GET', '/v2/companies');
  }
  updateCompany(payload: unknown): Promise<any> {
    return this.request('PUT', '/v2/companies', payload);
  }
  getSubscriptions(): Promise<any> {
    return this.request('GET', '/v2/subscriptions');
  }
  createNumberingRange(payload: unknown): Promise<any> {
    return this.request('POST', '/v2/numbering-ranges', payload);
  }
  listNumberingRanges(params?: Params): Promise<any> {
    return this.request('GET', '/v2/numbering-ranges', undefined, params);
  }
  getDianRanges(): Promise<any> {
    return this.request('GET', '/v2/numbering-ranges/dian');
  }
  toggleNumberingRange(id: number, active: boolean): Promise<any> {
    return this.request('POST', '/v2/numbering-ranges/toggle', { id, active });
  }
  updateNumberingRange(id: number, payload: unknown): Promise<any> {
    return this.request('PUT', `/v2/numbering-ranges/${id}`, payload);
  }
  getAcquirer(query: Params): Promise<any> {
    return this.request('GET', '/v2/dian/acquirer', undefined, query);
  }
  validateBills(payloads: unknown[]): Promise<any> {
    return this.request('POST', '/v2/bills/validate', payloads);
  }
  listBills(params?: Params): Promise<any> {
    return this.request('GET', '/v2/bills', undefined, params);
  }
  async downloadBillPdf(number: string): Promise<Buffer> {
    const token = await this.auth.getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };
    const res = await globalThis.fetch(
      `${this.auth.getBaseUrl()}/v2/bills/${encodeURIComponent(number)}/download-pdf`,
      { method: 'GET', headers },
    );
    if (!res.ok) {
      throw await this.buildError(res, await res.text());
    }
    return Buffer.from(await res.arrayBuffer());
  }
  async downloadBillXml(number: string): Promise<string> {
    const token = await this.auth.getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };
    const res = await globalThis.fetch(
      `${this.auth.getBaseUrl()}/v2/bills/${encodeURIComponent(number)}/download-xml`,
      { method: 'GET', headers },
    );
    if (!res.ok) {
      throw await this.buildError(res, await res.text());
    }
    return res.text();
  }

  private async request(
    method: Method,
    path: string,
    body?: unknown,
    params?: Params,
    retried = false,
  ): Promise<any> {
    const token = await this.auth.getAccessToken();
    const url = this.buildUrl(path, params);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await globalThis.fetch(url, init);
    const text = await res.text();
    if (res.status === 401 && !retried) {
      await this.auth.forceRefresh();
      return this.request(method, path, body, params, true);
    }
    if (!res.ok) {
      throw await this.buildError(res, text);
    }
    return text ? JSON.parse(text) : null;
  }

  private buildUrl(path: string, params?: Params): string {
    const url = new URL(`${this.auth.getBaseUrl()}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async buildError(res: Response, text: string): Promise<FactusApiException> {
    let raw: any = null;
    let messages: string[] = [];
    try {
      raw = JSON.parse(text);
      messages = Array.isArray(raw?.error)
        ? raw.error
            .map((e: { message?: string }) => e?.message ?? '')
            .filter(Boolean)
        : raw?.message
          ? [raw.message]
          : [];
    } catch {
      messages = [text || `HTTP ${res.status}`];
    }
    return new FactusApiException(res.status, messages, raw);
  }
}
```

- [ ] **Step 5: Correr test — debe pasar**

Run: `npx jest src/factus/factus-adapter.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/factus
git commit -m "feat(dian): add Factus HTTP adapter with 401 retry and error translation"
```

---

### Task 7: Sync de emisor y rangos + módulo + controller

**Files:**
- Create: `D:\copiFactus\backend\src\factus\factus-sync.service.ts`
- Create: `D:\copiFactus\backend\src\factus\factus.controller.ts`
- Create: `D:\copiFactus\backend\src\factus\factus.module.ts`
- Modify: `D:\copiFactus\backend\src\app.module.ts`

**Interfaces:**
- Consumes: `FactusAuthService`, `FactusAdapterService`, `extractRangeId`, `mapResolutionTypeToDian` (Task 3/5/6), enums `UserRole`.
- Produces: `FactusSyncService.getStatus(): Promise<FactusStatus>`, `FactusSyncService.syncCompany(actorId): Promise<any>`, `FactusSyncService.syncResolutionRange(id, actorId): Promise<any>`. Endpoints:

| Método | Ruta | Roles |
|---|---|---|
| GET | `/api/factus/status` | ADMIN, FACTURADOR, CONSULTA |
| POST | `/api/factus/companies/sync` | ADMIN |
| POST | `/api/factus/resolutions/:id/sync-range` | ADMIN |

- [ ] **Step 1: Escribir `factus.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { FactusAuthService } from './factus-auth.service';
import { FactusAdapterService } from './factus-adapter.service';
import { FactusSyncService } from './factus-sync.service';
import { FactusEmissionService } from './factus-emission.service';
import { FactusController } from './factus.controller';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [FactusController],
  providers: [
    FactusAuthService,
    FactusAdapterService,
    FactusSyncService,
    FactusEmissionService,
  ],
  exports: [FactusAuthService, FactusAdapterService, FactusEmissionService],
})
export class FactusModule {}
```

> Nota: `FactusEmissionService` se crea en la Task 8. Crear un stub ejecutable ahora (métodos `buildPayload` y `archiveDocuments` devolviendo `null`) para que el módulo compile, o posponer el registro del provider a la Task 8; lo más simple: definir el provider ya y crear la clase en Task 8 antes de compilar.

- [ ] **Step 2: Escribir `factus-sync.service.ts`**

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@prisma/client';
import { FactusAuthService } from './factus-auth.service';
import { FactusAdapterService } from './factus-adapter.service';
import { extractRangeId, mapResolutionTypeToDian } from './factus-utils';
import type { FactusStatus } from './factus-types';

@Injectable()
export class FactusSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: FactusAuthService,
    private readonly adapter: FactusAdapterService,
  ) {}

  async getStatus(): Promise<FactusStatus> {
    let emisorSynced = false;
    try {
      const settings = await this.prisma.companySettings.findUnique({
        where: { id: 'default' },
      });
      emisorSynced = settings?.isSyncedToFactus ?? false;
    } catch {
      emisorSynced = false;
    }
    const configured = this.auth.isConfigured();
    return {
      configured,
      ambient: process.env.FACTUS_AMBIENT ?? 'sandbox',
      emisorSynced,
      url: configured ? this.auth.getBaseUrl() : null,
    };
  }

  async syncCompany(actorId: string): Promise<any> {
    const settings = await this.prisma.companySettings.findUnique({
      where: { id: 'default' },
    });
    if (!settings) {
      throw new NotFoundException('Configuración de empresa no encontrada.');
    }
    const responsibilities =
      (settings.responsibilities as Array<{ code: string }> | null) ?? [];
    const payload = {
      legal_organization_code: settings.legalOrganizationCode ?? 1,
      company: settings.legalName,
      trade_name: settings.tradeName ?? settings.name,
      email: settings.email ?? '',
      address: settings.address ?? '',
      registration_code: settings.registrationCode ?? '',
      phone: settings.phone ?? '',
      municipality_code: settings.municipalityCode ?? '11001',
      economic_activity: settings.economicActivity ?? '',
      tribute_code: settings.tributeCode ?? '01',
      responsibilities:
        responsibilities.length > 0
          ? responsibilities
          : [{ code: 'O-13' }],
    };
    const result = await this.adapter.updateCompany(payload);
    await this.prisma.companySettings.update({
      where: { id: 'default' },
      data: { isSyncedToFactus: true },
    });
    await this.audit
      .log({
        userId: actorId,
        action: AuditAction.UPDATE,
        entityType: 'FactusCompany',
        entityId: 'default',
        newValue: result as Prisma.InputJsonValue,
      })
      .catch(() => {});
    return result;
  }

  async syncResolutionRange(id: string, actorId: string): Promise<any> {
    const resolution = await this.prisma.resolution.findUnique({
      where: { id },
    });
    if (!resolution) {
      throw new NotFoundException('La resolución no fue encontrada.');
    }
    const documentCode = mapResolutionTypeToDian(resolution.type);
    const payload = {
      document: documentCode,
      prefix: resolution.prefix.replace(/-$/, ''),
      resolution_number:
        resolution.resolutionNumber && !Number.isNaN(Number(resolution.resolutionNumber))
          ? Number(resolution.resolutionNumber)
          : undefined,
      current: Math.max((resolution.next ?? 0) - 1, 0),
      start_number: resolution.from,
      end_number: resolution.to,
      ...(resolution.dateFrom
        ? { start_date: resolution.dateFrom.toISOString().slice(0, 10) }
        : {}),
      ...(resolution.dateTo
        ? { end_date: resolution.dateTo.toISOString().slice(0, 10) }
        : {}),
    };

    let result: unknown;
    if (resolution.numberingRangeId) {
      result = await this.adapter.updateNumberingRange(
        resolution.numberingRangeId,
        { current: resolution.next ?? 0 },
      );
    } else {
      result = await this.adapter.createNumberingRange(payload);
    }

    const rangeId = resolution.numberingRangeId ?? extractRangeId(result);
    if (!rangeId) {
      throw new Error('Factus: no se pudo obtener el id del rango creado.');
    }

    await this.prisma.resolution.update({
      where: { id },
      data: {
        numberingRangeId: rangeId,
        documentCode,
        factusRangeData: result as Prisma.InputJsonValue,
      },
    });

    await this.audit
      .log({
        userId: actorId,
        action: AuditAction.UPDATE,
        entityType: 'Resolution',
        entityId: resolution.id,
        newValue: { numberingRangeId: rangeId },
      })
      .catch(() => {});
    return result;
  }
}
```

- [ ] **Step 3: Escribir `factus.controller.ts`**

```ts
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/types/auth-user.type';
import { FactusSyncService } from './factus-sync.service';

@Controller('factus')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FactusController {
  constructor(private readonly sync: FactusSyncService) {}

  @Get('status')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  status() {
    return this.sync.getStatus();
  }

  @Post('companies/sync')
  @Roles(UserRole.ADMIN)
  syncCompany(@CurrentUser() user: AuthUser) {
    return this.sync.syncCompany(user.id);
  }

  @Post('resolutions/:id/sync-range')
  @Roles(UserRole.ADMIN)
  syncRange(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.sync.syncResolutionRange(id, user.id);
  }
}
```

- [ ] **Step 4: Registrar `FactusModule` en `app.module.ts`**

Añadir `FactusModule` al array `imports` de `@Module` (junto a los demás feature modules).

- [ ] **Step 5: Compilar y correr tests**

Run: `npm run build`
Expected: no errors. (Si `FactusEmissionService` no existe aún: crear clase vacía en Task 8; mientras tanto compilar con un stub `@Injectable()` con `export class FactusEmissionService {}` — o ejecutar la Task 8 primero.)

- [ ] **Step 6: Commit**

```bash
git add src/factus src/app.module.ts
git commit -m "feat(dian): add factus sync service, controller and module"
```

---

### Task 8: FactusEmissionService (payload desde BD + archivo PDF/XML)

**Files:**
- Create: `D:\copiFactus\backend\src\factus\factus-emission.service.ts`
- Create: `D:\copiFactus\backend\src\factus\factus-emission.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `SupabaseService`, `buildBillPayload`, `generateReferenceCode`, `calculateDianDv`, mappers, `FactusBuildInput` (Tasks 1,3,4).
- Produces:
  - `buildPayload(invoice: any, resolution: any, company: any, payments: any[]): Record<string, unknown>`
  - `arricarDocumentos(factusNumber: string, xml?: string | null, pdf?: Buffer | null): Promise<{ xmlPath: string | null; pdfPath: string | null }>`
  - `determineDianStatus(data: FactusBillData): DianStatus` (VALIDADA si is_validated y sin errors; ENVIADA si is_validated con errors; RECHAZADA si no).

- [ ] **Step 1: Escribir test del `determineDianStatus` y construcción mínima**

`factus-emission.service.spec.ts`:

```ts
import { DianStatus } from '@prisma/client';
import { FactusEmissionService } from './factus-emission.service';
import type { FactusBillData } from './factus-types';

describe('FactusEmissionService.determineDianStatus', () => {
  it('VALIDADA cuando is_validated sin errors', () => {
    const data = { is_validated: true, errors: [], number: 'FAC-1', cufe: 'X' } as FactusBillData;
    expect(new FactusEmissionService(null as any, null as any).determineDianStatus(data)).toBe(
      DianStatus.VALIDADA,
    );
  });

  it('ENVIADA cuando hay errors de DIAN no bloqueantes', () => {
    const data = {
      is_validated: true,
      errors: [{ message: 'notificación DIAN' }],
      number: 'FAC-1',
      cufe: 'X',
    } as FactusBillData;
    expect(new FactusEmissionService(null as any, null as any).determineDianStatus(data)).toBe(
      DianStatus.ENVIADA,
    );
  });

  it('RECHAZADA cuando no se validó', () => {
    const data = { is_validated: false, errors: [], number: 'FAC-1', cufe: 'X' } as FactusBillData;
    expect(new FactusEmissionService(null as any, null as any).determineDianStatus(data)).toBe(
      DianStatus.RECHAZADA,
    );
  });
});
```

- [ ] **Step 2: Correr test — debe fallar**

Run: `npx jest src/factus/factus-emission.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Escribir `factus-emission.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { DianStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { SupabaseService } from '../common/supabase/supabase.service';
import { buildBillPayload } from './factus-payload';
import {
  calculateDianDv,
  generateReferenceCode,
  mapDocumentTypeToDian,
  mapPaymentMethodToDian,
} from './factus-utils';
import type { FactusBillData, FactusBuildInput } from './factus-types';

const BUCKET = 'invoice-pdfs';

@Injectable()
export class FactusEmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
  ) {}

  determineDianStatus(data: FactusBillData): DianStatus {
    if (!data.is_validated) return DianStatus.RECHAZADA;
    const hasErrors = Array.isArray(data.errors) && data.errors.length > 0;
    return hasErrors ? DianStatus.ENVIADA : DianStatus.VALIDADA;
  }

  buildPayload(
    invoice: {
      id: string;
      referenceCode?: string | null;
      total: unknown;
      paidAmount: unknown;
      cashRoundingAmount?: unknown;
      dueDate?: Date | null;
      customer?: any;
      items?: any[];
      payments?: any[];
    },
    resolution: { numberingRangeId?: number | null },
    company: {
      legalOrganizationCode?: number | null;
      name: string;
      legalName: string;
      tradeName?: string | null;
      email?: string | null;
      address?: string | null;
      registrationCode?: string | null;
      phone?: string | null;
      municipalityCode?: string | null;
      economicActivity?: string | null;
      tributeCode?: string | null;
      responsibilities?: unknown;
    },
  ): Record<string, unknown> {
    const customer = invoice.customer;
    const countryCode = customer?.countryCode ?? 'CO';
    const legalOrg = customer?.legalOrganizationCode ?? 2;
    const dv =
      customer?.documentType === 'NIT'
        ? (customer?.dv ?? calculateDianDv(customer?.documentNumber ?? ''))
        : (customer?.dv ?? '0');

    const responsibilities: Array<{ code: string }> =
      customer?.responsibilities?.length > 0
        ? customer.responsibilities
        : legalOrg === 2
          ? [{ code: 'R-99-PN' }]
          : [{ code: 'O-13' }];

    const fullyPaid =
      Number(invoice.paidAmount) > 0 && Number(invoice.total) - Number(invoice.paidAmount) <= 0;
    const lastPayment = invoice.payments?.[invoice.payments.length - 1];

    const input: FactusBuildInput = {
      referenceCode: invoice.referenceCode ?? generateReferenceCode(invoice.id),
      numberingRangeId: resolution.numberingRangeId ?? 0,
      customer: {
        documentTypeDian: mapDocumentTypeToDian(customer?.documentType ?? 'CC'),
        dv,
        identificationNumber: String(customer?.documentNumber ?? '').replace(
          /[^0-9]/g,
          '',
        ),
        name: customer?.name ?? 'Cliente',
        legalOrganizationCode: legalOrg,
        tributeCode: customer?.tributeCode ?? (legalOrg === 2 ? 'ZZ' : '01'),
        responsibilities,
        email: customer?.email ?? undefined,
        phone: customer?.phone ?? undefined,
        address: customer?.address ?? undefined,
        municipalityCode: customer?.municipalityCode ?? '11001',
        countryCode,
      },
      company: {
        legalOrganizationCode: company.legalOrganizationCode ?? 1,
        name: company.name,
        legalName: company.legalName,
        tradeName: company.tradeName ?? undefined,
        email: company.email ?? undefined,
        address: company.address ?? undefined,
        registrationCode: company.registrationCode ?? undefined,
        phone: company.phone ?? undefined,
        municipalityCode: company.municipalityCode ?? '11001',
        economicActivity: company.economicActivity ?? undefined,
        tributeCode: company.tributeCode ?? '01',
        responsibilities:
          (company.responsibilities as Array<{ code: string }> | null)?.length > 0
            ? (company.responsibilities as Array<{ code: string }>)
            : [{ code: 'O-13' }],
      },
      items: (invoice.items ?? []).map((it: any, index: number) => ({
        code: it.product?.code ?? `IT${index + 1}`,
        name: String(it.description ?? '').slice(0, 50),
        quantity: Number(it.quantity ?? 0),
        price: Number(it.unitPrice ?? 0),
        taxRate: Number(it.taxRate ?? 0),
        ...(Number(it.discount ?? 0) > 0
          ? { discount: Number(it.discount) }
          : {}),
        unitMeasureCode: it.unitMeasureCode ?? '94',
        standardCode: it.standardCode ?? '999',
      })),
      total: Number(invoice.total ?? 0),
      paidAmount: Number(invoice.paidAmount ?? 0),
      dueDate: invoice.dueDate ?? undefined,
      cashRoundingAmount: Number(invoice.cashRoundingAmount ?? 0),
      paymentMethodDian: mapPaymentMethodToDian(
        lastPayment?.paymentMethod ?? 'EFECTIVO',
      ),
      paymentForm: fullyPaid ? '1' : '2',
    };

    return buildBillPayload(input);
  }

  async archiveDocuments(
    factusNumber: string,
    xml?: string | null,
    pdf?: Buffer | null,
  ): Promise<{ xmlPath: string | null; pdfPath: string | null }> {
    let xmlPath: string | null = null;
    let pdfPath: string | null = null;
    if (xml) {
      const path = `dian/${factusNumber}/factura.xml`;
      await this.supabase.uploadBuffer(BUCKET, path, Buffer.from(xml, 'utf-8'), 'application/xml');
      xmlPath = path;
    }
    if (pdf) {
      const path = `dian/${factusNumber}/factura.pdf`;
      await this.supabase.uploadBuffer(BUCKET, path, pdf, 'application/pdf');
      pdfPath = path;
    }
    return { xmlPath, pdfPath };
  }
}
```

- [ ] **Step 4: Añadir `uploadBuffer` a `SupabaseService`**

En `src/common/supabase/supabase.service.ts`, tras `downloadAsBuffer`:

```ts
  async uploadBuffer(
    bucket: string,
    path: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    const { error } = await this.getClient()
      .storage.from(bucket)
      .upload(path, buffer, { contentType, upsert: true });
    if (error) throw error;
    return path;
  }
```

- [ ] **Step 5: Correr test — debe pasar**

Run: `npx jest src/factus`
Expected: PASS.

- [ ] **Step 6: Compilar**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/factus src/common/supabase/supabase.service.ts
git commit -m "feat(dian): add Factus emission payload builder and document archival"
```

---

### Task 9: Wiring de `InvoicesService.emit` → Factus + endpoints DIAN

**Files:**
- Modify: `D:\copiFactus\backend\src\invoices\invoices.service.ts`
- Modify: `D:\copiFactus\backend\src\invoices\invoices.controller.ts`
- Modify: `D:\copiFactus\backend\src\invoices\invoices.module.ts`

**Interfaces:**
- Consumes: `FactusAuthService`, `FactusAdapterService`, `FactusEmissionService`, `generateReferenceCode` (Tasks 3,5,6,8). `SupabaseService` para servir documentos.
- Produces: `emit(id, actorId)` con doble camino (Factus si `isConfigured()` y resolución con `numberingRangeId`; si no, flujo local). `getDianDocument(id, kind: 'xml'|'pdf'): Promise<Buffer>`. Endpoints nuevos `GET /invoices/:id/dian-xml` y `GET /invoices/:id/dian-pdf`.

- [ ] **Step 1: Inyectar servicios en `InvoicesService`**

```ts
import { FactusAuthService } from '../factus/factus-auth.service';
import { FactusAdapterService } from '../factus/factus-adapter.service';
import { FactusEmissionService } from '../factus/factus-emission.service';
import { FactusApiException } from '../factus/factus-api.exception';
import { generateReferenceCode } from '../factus/factus-utils';

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly email: EmailService,
    private readonly factusAuth: FactusAuthService,
    private readonly factusAdapter: FactusAdapterService,
    private readonly factusEmission: FactusEmissionService,
    private readonly supabase: SupabaseService,
  ) {}
```

(Importar `SupabaseService` desde `../common/supabase/supabase.service`.)

- [ ] **Step 2: Refactorizar `emit` con bifurcación**

Sustituir el inicio de `emit` por:

```ts
  async emit(id: string, actorId: string) {
    const existing = await this.findOne(id);

    if (existing.status !== InvoiceStatus.BORRADOR) {
      throw new BadRequestException(
        'Solo se pueden emitir facturas en estado borrador.',
      );
    }

    if (this.factusAuth.isConfigured()) {
      return this.emitViaFactus(existing, actorId);
    }
    return this.emitLocal(existing, actorId);
  }
```

Renombrar el cuerpo actual de `emit` a `private async emitLocal(existing: any, actorId: string)` sin cambios de lógica (mantiene `FOR UPDATE`, CUFE local y fallback en memoria).

- [ ] **Step 3: Escribir `emitViaFactus`**

```ts
  private async emitViaFactus(existing: any, actorId: string) {
    try {
      const full = await this.prisma.invoice.findUnique({
        where: { id: existing.id },
        include: { customer: true, items: { include: { product: true } }, payments: true },
      });
      if (!full) throw new NotFoundException('Factura no encontrada.');

      const resolution = await this.prisma.resolution.findFirst({
        where: { type: 'FACTURA', isActive: true, numberingRangeId: { not: null } },
        orderBy: { createdAt: 'asc' },
      });
      if (!resolution) {
        throw new BadRequestException(
          'No hay una resolución sincronizada con Factus para facturar. Sincroniza el rango de la resolución primero.',
        );
      }

      let invoice = full;
      if (!full.referenceCode) {
        invoice = await this.prisma.invoice.update({
          where: { id: full.id },
          data: { referenceCode: generateReferenceCode(full.id) },
          include: { customer: true, items: { include: { product: true } }, payments: true },
        });
      }

      const company = await this.prisma.companySettings.findUnique({
        where: { id: 'default' },
      });
      if (!company) {
        throw new BadRequestException(
          'Configuración de empresa no encontrada. Completa los datos del emisor.',
        );
      }

      const payload = this.factusEmission.buildPayload(
        invoice,
        resolution,
        company,
      );

      let response: any;
      try {
        response = await this.factusAdapter.validateBills([payload]);
      } catch (err) {
        if (err instanceof FactusApiException && err.isAlreadyExists()) {
          throw new BadRequestException(
            'La factura ya fue enviada a DIAN previamente. Verifica su estado en Factus.',
          );
        }
        throw new BadRequestException(
          err instanceof Error ? err.message : 'Error al enviar la factura a la DIAN.',
        );
      }

      const data = response?.data;
      if (!data?.number) {
        throw new BadRequestException('Factus no devolvió el número oficial de la factura.');
      }

      const links = data.links ?? {};
      const { xmlPath, pdfPath } = await this.factusEmission
        .archiveDocuments(
          data.number,
          await this.safeDownloadXml(data.number),
          await this.safeDownloadPdf(data.number),
        )
        .catch(async (err) => {
          this.logger?.error?.(`Factus: no se pudo archivar documentos: ${(err as Error).message}`);
          return { xmlPath: null, pdfPath: null };
        });

      const dianStatus = this.factusEmission.determineDianStatus(data);

      const updated = await this.prisma.invoice.update({
        where: { id: existing.id },
        data: {
          invoiceNumber: data.number,
          factusNumber: data.number,
          issueDate: new Date(),
          status: InvoiceStatus.EMITIDA,
          resolutionId: resolution.id,
          resolutionNumber: resolution.resolutionNumber,
          resolutionDate: resolution.dateFrom ?? new Date(),
          ambient: resolution.ambient,
          cufe: data.cufe,
          dianStatus,
          validatedAt: data.validated_at ? new Date(data.validated_at) : new Date(),
          qrUrl: links.url_qr_code ?? null,
          publicUrl: links.url_public ?? null,
          graphicRepresentationUrl: links.url_graphic_representation ?? null,
          xmlPath,
          pdfPath,
          factusPayload: data as Prisma.InputJsonValue,
        },
        include: { items: true, customer: true },
      });

      await this.prisma.resolution.update({
        where: { id: resolution.id },
        data: { next: { increment: 1 } },
      });

      await this.auditService
        .log({
          userId: actorId,
          action: AuditAction.EMIT,
          entityType: 'Invoice',
          entityId: existing.id,
          oldValue: { status: existing.status },
          newValue: data as Prisma.InputJsonValue,
        })
        .catch(() => {});

      return updated;
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      if (!useInMemoryFallback()) throw err;
      // Sin BD real: degradar a emisión local
      return this.emitLocal(existing, actorId);
    }
  }

  private async safeDownloadXml(number: string): Promise<string | null> {
    try {
      return await this.factusAdapter.downloadBillXml(number);
    } catch {
      return null;
    }
  }

  private async safeDownloadPdf(number: string): Promise<Buffer | null> {
    try {
      return await this.factusAdapter.downloadBillPdf(number);
    } catch {
      return null;
    }
  }
```

- [ ] **Step 4: Escribir `getDianDocument` en el servicio**

```ts
  async getDianDocument(id: string, kind: 'xml' | 'pdf'): Promise<Buffer> {
    const invoice = await this.findOne(id);
    const path = kind === 'xml' ? invoice.xmlPath : invoice.pdfPath;
    if (!path) {
      throw new NotFoundException(
        kind === 'xml'
          ? 'El XML oficial aún no está disponible para esta factura.'
          : 'El PDF oficial aún no está disponible para esta factura.',
      );
    }
    try {
      return await this.supabase.downloadAsBuffer('invoice-pdfs', path);
    } catch (err) {
      if (!useInMemoryFallback()) throw err;
      throw new NotFoundException('El documento oficial no está disponible.');
    }
  }
```

- [ ] **Step 5: Añadir endpoints al controller**

En `invoices.controller.ts`, tras la ruta `pdf`:

```ts
  @Get(':id/dian-xml')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  async getDianXml(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const buffer = await this.invoicesService.getDianDocument(id, 'xml');
    res.set({
      'Content-Type': 'application/xml',
      'Content-Disposition': 'attachment; filename="factura.xml"',
      'Content-Length': String(buffer.length),
    });
    return new StreamableFile(buffer);
  }

  @Get(':id/dian-pdf')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  async getDianPdf(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const buffer = await this.invoicesService.getDianDocument(id, 'pdf');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="factura-oficial.pdf"',
      'Content-Length': String(buffer.length),
    });
    return new StreamableFile(buffer);
  }
```

- [ ] **Step 6: Importar `FactusModule` en `invoices.module.ts`**

Añadir `FactusModule` a `imports` de `InvoicesModule`.

- [ ] **Step 7: Compilar + suite completa**

Run: `npm run build`
Run: `npm test`
Expected: build OK, tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/invoices
git commit -m "feat(dian): emit invoices through Factus validate with DIAN response persistence"
```

---

### Task 10: Verificación backend + checklist E2E

**Files:**
- Create: `D:\copiFactus\backend\docs\superpowers\plans\2026-09-11-factus-e2e-checklist.md`

- [ ] **Step 1: Correr lint + build + tests completos**

Run: `npm run lint`
Run: `npm run build`
Run: `npm test`
Expected: lint sin errores nuevos, build OK, tests PASS.

- [ ] **Step 2: Commit restante**

```bash
git add -A
git commit -m "chore(dian): verify factus backend build, lint and tests"
```

> No hacer push a `main`. La rama `feat/factus-integration` se revisa con el usuario al final.

- [ ] **Step 3: Escribir checklist E2E (documento)**

Crear `docs/superpowers/plans/2026-09-11-factus-e2e-checklist.md` con:

1. `FACTUS_*` en `.env` local (nunca en repo), `FACTUS_AMBIENT=sandbox`.
2. `GET /api/factus/status` → `configured: true`.
3. Poblar Settings DIAN (razón social real, NIT, `registration_code`, CIIU `1811`, `11001`, `01`, `O-13`) vía PATCH `/api/settings`.
4. `POST /api/factus/companies/sync` → `isSyncedToFactus` true.
5. Tener una `Resolution` FACTURA activa → `POST /api/factus/resolutions/:id/sync-range` → `numberingRangeId` != null.
6. Crear factura borrador con cliente NIT (con `dv` correcto; verificar DV con perfil real vía `GET /v2/dian/acquirer`) → `POST /api/invoices` → `PATCH /api/invoices/:id/emit` → esperar 201-eff típico: `dianStatus=VALIDADA`, `factusNumber`, `cufe` (123 chars), `qrUrl`, `xmlPath/pdfPath` poblados.
7. `GET /api/invoices/:id/dian-pdf` y `dian-xml` descargan archivos.
8. Comprobar en la UI: bloque DIAN del detalle muestra número oficial, estado, QR, enlace público y botones de descarga.
9. Nota: el DV calculado se valida contra el sandbox (422 `dv inválido` → revisar `calculateDianDv`).

---

### Task 11: Frontend — tipos, servicios y hooks FACTUS

**Files:**
- Modify: `D:\copiFactus\frontend\src\types\index.ts`
- Create: `D:\copiFactus\frontend\src\services\factus.ts`
- Modify: `D:\copiFactus\frontend\src\services\invoices.ts`
- Modify: `D:\copiFactus\frontend\src\services\settings.ts`
- Create: `D:\copiFactus\frontend\src\hooks\use-factus.ts`

**Interfaces:**
- Consumes: `api<T>` / `apiDownload` de `src/lib/api.ts`, `useQuery`/`useMutation` de TanStack Query.
- Produces:
  - Tipos: campos DIAN en `Customer`, `CompanySettings`, `Invoice`; nuevos `FactusStatus`, `FactusBillData`.
  - `factusService.status()/syncCompany()/syncResolutionRange(id)` en `src/services/factus.ts`.
  - `invoicesService.dianPdf(id)` / `dianXml(id)` (devuelven `Blob`).
  - `settingsService.syncFactusCompany()`.
  - `useFactusStatus()`, `useSyncFactusCompany()` en `src/hooks/use-factus.ts`.

- [ ] **Step 1: Crear rama feature (frontend)**

```bash
git checkout -b feat/factus-integration
```

- [ ] **Step 2: Ampliar tipos**

En `src/types/index.ts`:
- En `Customer` añadir: `dv?: string | null; legalOrganizationCode?: number | null; municipalityCode?: string | null; countryCode?: string | null; tributeCode?: string | null; responsibilities?: Array<{ code: string }> | null;`
- En `CreateCustomerInput` los mismos como opcionales.
- En `CompanySettings` añadir: `legalOrganizationCode?: number; tradeName?: string | null; registrationCode?: string | null; economicActivity?: string | null; municipalityCode?: string | null; countryCode?: string; tributeCode?: string; responsibilities?: Array<{ code: string }> | null; isSyncedToFactus?: boolean;`
- En `Invoice` añadir: `referenceCode?: string | null; factusNumber?: string | null; validatedAt?: string | null; qrUrl?: string | null; publicUrl?: string | null; graphicRepresentationUrl?: string | null; xmlPath?: string | null; pdfPath?: string | null; cashRoundingAmount?: number | null; paymentForm?: string | null; factusPayload?: FactusBillPayload | null;`
- Nuevo tipo:

```ts
export interface FactusBillError {
  context?: string;
  error_type?: string;
  message?: string;
}

export interface FactusBillPayload {
  number?: string;
  cufe?: string;
  is_validated?: boolean;
  errors?: FactusBillError[];
  validated_at?: string | null;
  links?: {
    url_qr_code?: string;
    url_public?: string;
    url_graphic_representation?: string;
  };
}

export interface FactusStatus {
  configured: boolean;
  ambient: string;
  emisorSynced: boolean;
  url: string | null;
}
```

- [ ] **Step 3: Crear `src/services/factus.ts`**

```ts
import { api } from '@/lib/api';
import type { FactusStatus } from '@/types';

export const factusService = {
  status: () => api<FactusStatus>('/factus/status'),
  syncCompany: () => api<unknown>('/factus/companies/sync', { method: 'POST' }),
  syncResolutionRange: (id: string) =>
    api<unknown>(`/factus/resolutions/${id}/sync-range`, { method: 'POST' }),
};
```

- [ ] **Step 4: Ampliar `src/services/invoices.ts` y `src/services/settings.ts`**

En `invoices.ts`, junto a `pdf`:

```ts
  dianPdf: (id: string) => apiDownload(`/invoices/${id}/dian-pdf`),
  dianXml: (id: string) => apiDownload(`/invoices/${id}/dian-xml`),
```

En `settings.ts`:

```ts
  syncFactusCompany: () =>
    api<unknown>('/factus/companies/sync', { method: 'POST' }),
```

- [ ] **Step 5: Crear `src/hooks/use-factus.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { factusService } from '@/services/factus';
import type { FactusStatus } from '@/types';

export function useFactusStatus() {
  return useQuery<FactusStatus>({
    queryKey: ['factus-status'],
    queryFn: factusService.status,
    staleTime: 60_000,
    retry: 1,
  });
}

export function useSyncFactusCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: factusService.syncCompany,
    onSuccess: () => {
      toast.success('Emisor sincronizado con Factus');
      queryClient.invalidateQueries({ queryKey: ['factus-status'] });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err: Error) => toast.error(err.message ?? 'Error al sincronizar'),
  });
}
```

- [ ] **Step 6: Verificar tipos y build**

Run: `npm run build`
Expected: PASS (`tsc -b && vite build`).

- [ ] **Step 7: Commit**

```bash
git add src/types src/services src/hooks/use-factus.ts
git commit -m "feat(dian): add factus types, services and hooks to frontend"
```

---

### Task 12: Frontend — Settings: sección DIAN + sincronizar emisor

**Files:**
- Modify: `D:\copiFactus\frontend\src\pages\settings\SettingsPage.tsx`

**Interfaces:**
- Consumes: `useSettings`, `useUpdateSettings`, `useFactusStatus`, `useSyncFactusCompany` (Task 11). Patrón existente: `useForm({ resolver: zodSchema, values })`, `Label` + `Input`, `Select` shadcn, `Card`, `Badge`, `Button`, permiso `canManageSettings`.

- [ ] **Step 1: Ampliar el schema y `useForm` con los campos DIAN**

- Añadir al `zod` schema local: `legalOrganizationCode` (número opcional), `tradeName`, `registrationCode`, `economicActivity`, `municipalityCode`, `countryCode`, `tributeCode` (strings opcionales), `responsibilities` (opcional).
- Añadir campos al objeto `values` inicial con defaults: `legalOrganizationCode: settings?.legalOrganizationCode ?? 1`, `municipalityCode: settings?.municipalityCode ?? '11001'`, `countryCode: settings?.countryCode ?? 'CO'`, `tributeCode: settings?.tributeCode ?? '01'`.

- [ ] **Step 2: Añadir el bloque "Facturación electrónica DIAN"**

- Obtener `const { data: factus } = useFactusStatus();` y `const sync = useSyncFactusCompany();`.
- En la tab "Empresa", tras la card principal y ANTES del `Alert` de permisos, renderizar:

```tsx
<Card>
  <CardHeader className="flex flex-row items-center justify-between space-y-0">
    <div>
      <CardTitle>Facturación electrónica DIAN</CardTitle>
      <CardDescription>Emisor y sincronización con el proveedor Factus (sandbox).</CardDescription>
    </div>
    {factus && (
      <Badge variant={factus.configured ? 'default' : 'secondary'}>
        {factus.configured ? `Conectado · ${factus.ambient}` : 'Sin credenciales'}
      </Badge>
    )}
  </CardHeader>
  <CardContent className="space-y-4">
    <Alert>
      <AlertTitle>Estado del proveedor</AlertTitle>
      <AlertDescription>
        Emisor sincronizado: {factus?.emisorSynced ? 'Sí' : 'No'} · {factus?.url ?? 'URL no disponible'}
      </AlertDescription>
    </Alert>
    <div>
      <Label>Responsabilidades tributarias (código DIAN)</Label>
      <Input placeholder="O-13" {...register('responsibilitiesInput')} disabled={!canManageSettings} />
    </div>
    <Button
      onClick={() => sync.mutate()}
      disabled={!canManageSettings || sync.isPending || !factus?.configured}
    >
      {sync.isPending ? 'Sincronizando…' : 'Sincronizar emisor con Factus'}
    </Button>
  </CardContent>
</Card>
```

> Gestión simplificada de `responsibilities`: campo de texto separado `responsibilitiesInput` que se convierte a `[{ code }]` en el `onSubmit` (split por coma) y se inicializa desde `settings?.responsibilities?.map(r => r.code).join(', ')`. Solo se añade al payload si no está vacío.

- [ ] **Step 3: Añadir los inputs DIAN del emisor**

Dentro de la card principal "Empresa", junto a los campos existentes:
- `legalOrganizationCode` → `Select` con opciones `1` "Persona jurídica" y `2` "Persona natural".
- `tradeName`, `registrationCode`, `economicActivity` (CIIU), `municipalityCode` (default `11001`), `countryCode`, `tributeCode` → `Input`.
- Todos `disabled={!canManageSettings}` y con `Label`.

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Run: `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/settings/SettingsPage.tsx
git commit -m "feat(dian): add DANTIS emitter section and Factus sync button to settings"
```

---

### Task 13: Frontend — formulario de cliente con campos DIAN

**Files:**
- Modify: `D:\copiFactus\frontend\src\pages\customers\CustomerFormPage.tsx`

**Interfaces:**
- Consumes: patrón existente del form (zod schema + RHF + Label/Input/Select + `DOCUMENT_TYPE_LABELS`).
- Produces: crea/actualiza cliente con `dv`, `legalOrganizationCode`, `municipalityCode`, `countryCode`, `tributeCode`, `responsibilities`.

- [ ] **Step 1: Ampliar schema, valores y onSubmit**

- Añadir al zod schema: `dv` (opcional, string, `regex(/^\d{0,2}$/)`), `legalOrganizationCode` (opcional numeral), `municipalityCode`, `countryCode`, `tributeCode` (opcionales), `responsibilitiesInput` (string opcional).
- `defaultValues`: `documentType: 'CC'`, `legalOrganizationCode: 2`, `municipalityCode: '11001'`, `countryCode: 'CO'`, `tributeCode: 'ZZ'`.
- En el edit, inicializar desde el cliente: `dv: customer?.dv ?? ''`, etc., y `responsibilitiesInput: customer?.responsibilities?.map(r => r.code).join(', ') ?? ''`.
- En `onSubmit`, convertir `responsibilitiesInput` a `{ code }[]` (split por coma) solo si tiene contenido; incluir los campos en el objeto enviado.

- [ ] **Step 2: Añadir los campos al formulario**

- Junto a `documentType`: campo `dv` (solo visible/relevante cuando `documentType === 'NIT'`, render condicional `watch('documentType')`) con hint "Dígito de verificación del NIT; si no lo sabes déjalo vacío".
- Sección "Datos tributarios": `legalOrganizationCode` (`Select` 1/2), `municipalityCode`, `countryCode`, `tributeCode`, `responsibilitiesInput`.
- Todos `disabled` según el patrón existente del form.

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pages/customers/CustomerFormPage.tsx
git commit -m "feat(dian): add DIAN fiscal fields to customer form"
```

---

### Task 14: Frontend — detalle de factura con bloque DIAN

**Files:**
- Modify: `D:\copiFactus\frontend\src\pages\invoices\InvoiceDetailPage.tsx`

**Interfaces:**
- Consumes: `useInvoice(id)` devuelve `Invoice` con los campos DIAN nuevos; `invoicesService.dianPdf/dianXml` (`apiDownload` → Blob); util de descarga estilo `useDownloadInvoicePdf` existente.
- Produces: bloque "Facturación electrónica DIAN" que muestra `factusNumber`, `dianStatus` (badge existente), `validatedAt`, QR (imagen `qrUrl`), enlace público (`publicUrl`), descarga de PDF/XML oficiales, y errores DIAN desde `factusPayload.errors`.

- [ ] **Step 1: Reutilizar el flujo de descarga existente**

Usar el mismo helper que el botón "Ver PDF" (`useDownloadInvoicePdf`): para `dianPdf`/`dianXml`, crear dos hooks locales o una función inline que hace `const blob = await invoicesService.dianPdf(id); const url = URL.createObjectURL(blob); window.open(url, '_blank');`. Añadirlo como métodos a los mutations si se prefiere (`useQuery` no; usar `useMutation`/función directa con `toast.error` en error).

- [ ] **Step 2: Enriquecer el card existente "Facturación electrónica DIAN"**

Dentro del card que ya muestra CUFE/resolución (buscar por ese título o `cufe`; está en `InvoiceDetailPage.tsx`), añadir:

```tsx
{invoice.factusNumber && (
  <div className="grid gap-2">
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">Número oficial DIAN</span>
      <span className="text-sm font-medium">{invoice.factusNumber}</span>
    </div>
    {invoice.validatedAt && (
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Validada</span>
        <span className="text-sm font-medium">
          {format(parseISO(invoice.validatedAt), 'PPpp')}
        </span>
      </div>
    )}
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">CUFE</span>
      <span className="text-sm font-mono">{invoice.cufe}</span>
    </div>
    {invoice.qrUrl && (
      <div className="flex items-center gap-4 rounded-md border p-3">
        <img
          src={invoice.qrUrl}
          alt="QR DIAN"
          className="h-20 w-20"
        />
        <div className="space-y-1 text-sm">
          {invoice.publicUrl && (
            <a href={invoice.publicUrl} target="_blank" rel="noreferrer" className="text-primary underline">
              Ver factura pública
            </a>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={downloadPdf}>
              PDF oficial
            </Button>
            <Button size="sm" variant="outline" onClick={downloadXml}>
              XML oficial
            </Button>
          </div>
        </div>
      </div>
    )}
    {invoice.dianStatus === 'RECHAZADA' && invoice.factusPayload?.errors?.length
      ? invoice.factusPayload.errors.map((e, i) => (
          <p key={i} className="text-sm text-destructive">
            {e.message}
          </p>
        ))
      : null}
  </div>
)}
```

> Usar las propuestas de fetch devueltas por `useInvoice`; si `factusNumber` es null (factura local antigua), el bloque no se renderiza extra. `parseISO` y `format` vienen de `date-fns` (ya en deps).

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pages/invoices/InvoiceDetailPage.tsx
git commit -m "feat(dian): show Factus/DIAN block with QR, links and official document downloads in invoice detail"
```

---

### Task 15: Verificación final frontend + cierre

**Files:**
- (ninguno nuevo)

- [ ] **Step 1: Lint + build completos**

Run: `npm run lint`
Run: `npm run build`
Expected: PASS.

- [ ] **Step 2: Commit de cierre**

```bash
git add -A
git commit -m "chore(dian): verify frontend build and lint for factus integration"
```

> No push a `main`. Revisar la rama `feat/factus-integration` con el usuario (demo local: `npm run dev` en frontend + `npm run start:dev` en backend).

- [ ] **Step 3: Resumen para el usuario**

Mostrar al usuario: estado de ambas ramas, qué está verificado (unit tests/payload/build), qué falta (credenciales para E2E sandbox), y el checklist `2026-09-11-factus-e2e-checklist.md`.

---

## Self-Review

**Spec coverage:**
- Autenticación (OAuth2, cache, refresh anticipado, single-flight, retry 401) → Task 5, 6.
- Catálogo endpoints (companies, numbering-ranges, bills/validate, dian-pdf/xml, status) → Task 6, 7, 9.
- Factura estándar (reference_code idempotencia, customer con dv/municipio/tributos, items tax_amount, payment_details) → Tasks 3–4, 8.
- Rangos de numeración (numberingRangeId, documentCode, extRangeId) → Tasks 1, 7.
- Brechas modelo de datos OBLIGATORIO → Tasks 1–2 (schema + DTOs).
- CUFE real desde data.cufe → Task 9.
- Archive XML+PDF en Supabase Storage → Tasks 8–9.
- Qué NO hacer (payment_form, no marcar VALIDADA con errors, no CUFE local) → Tasks 8–9.
- UI completa (Settings emisor + sync, customer fiscal, detalle DIAN con QR/descargas) → Tasks 12–14.

**Placeholder scan:** Ningún paso "TBD". El único aviso es Task 7/8 (orden de creación de `FactusEmissionService` — Task 8 define la clase; Task 7 compila con la clase ya presente o registra el provider en la Task 8; no hay código inventado).

**Type consistency:** `generateReferenceCode`, `calculateDianDv`, `map*ToDian`, `round2`, `extractRangeId`, `FactusBuildInput`, `FactusBillData`, `FactusStatus`, `buildBillPayload`, `determineDianStatus`, `buildPayload`, `archiveDocuments`, `getDianDocument` — nombres firmados una sola vez y reutilizados de forma idéntica en Tasks 3–10. Tipos de frontend (Task 11) alineados con tipos backend (Task 3).

---

Plan completado y guardado en `docs/superpowers/plans/2026-09-11-factus-integration.md`. Dos opciones de ejecución:

1. **Subagent-Driven (recomendado)** — despacho un sub-agente fresco por tarea, revisión entre tareas, iteración rápida.
2. **Inline Execution** — ejecuto las tareas en esta sesión con `executing-plans`, lotes con checkpoints de revisión.

¿Cuál prefieres?