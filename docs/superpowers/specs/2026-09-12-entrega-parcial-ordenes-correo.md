# Spec: Entregas parciales en órdenes de entrega + correcciones acotadas

**Fecha:** 2026-09-12
**Estado:** aprobado por el usuario (diseño validado en brainstorming)

## Objetivo

1. **Órdenes de entrega con entregas parciales** (subsistema nuevo): estado "pendiente
   completar entrega" (`PARCIALMENTE_ENTREGADA`), registro de despachos/entregas parciales
   con notas y adjuntos, opción de "Marcar entrega total", y **una factura que crece** con lo
   entregado hasta emitirla.
2. **Cotización**: el `unitPrice` de un ítem nunca puede ser 0.
3. **Pagos**: hyperlink de la fila de pago hacia su factura.
4. **Correo con Resend**: envío de facturas y cotizaciones con plantilla HTML corporativa y
   PDF adjunto.

## Contexto (estado actual)

- `DeliveryOrder` es de entrega única y cantidad completa: `items Json` sin seguimiento de
  entregado, estados `PENDIENTE/ENTREGADA/CANCELADA`, y un único `invoiceId`; `convertToInvoice`
  exige `ENTREGADA` y ausencia de `invoiceId`.
- El frontend ya tiene listado + detalle + `AttachmentZone` (`delivery_order`) + conversión
  a factura; no hay página de creación (las órdenes nacen de la PO).
- Facturas: items reales (`InvoiceItem` con `quantity`/`unitPrice`), `paidAmount`/`balance`,
  estados `BORRADOR/…/PARCIALMENTE_PAGADA/PAGADA…`; `recalculateBalance`/`resolveInvoiceStatus`
  centralizan pagos → no se tocan.
- Cotización: `CreateQuoteItemDto.unitPrice @Min(0)`; frontend `z.min(0)` acepta 0.
- Pagos: la columna "Factura" en `PaymentsPage` es texto plano (sin link).
- Correo: `EmailService` (nodemailer) está en modo simulado (sin `SMTP_*`); solo
  `sendInvoiceEmail` lo consume. No hay email de cotización ni plantilla corporativa.

## Decisiones de arquitectura

### 3.1 Órdenes de entrega — modelo de datos

- **Estado nuevo** en `DeliveryOrderStatus`: `PARCIALMENTE_ENTREGADA` (etiqueta
  "Pendiente completar entrega", badge ámbar). El resto se mantiene.
- **Nueva tabla `DeliveryOrderDelivery`** (cada entrega/despacho):
  - `id uuid`, `deliveryOrderId → DeliveryOrder` (cascade), `deliveredAt DateTime`,
    `items Json` (arreglo `{description, quantity, unitPrice, taxRate?}`), `notes? String`,
    `createdById? → Profile`.
  - La orden conserva `items` con la **cantidad planeada**; la suma de entregas
    (`Σ cantidad por descripción`) es la cantidad entregada.
- **Adjuntos por entrega**: nuevo valor de `AttachmentEntityType`:
  `delivery_order_delivery` → cada entrega tiene su propia `AttachmentZone`. El enum live en
  `document-attachments/dto/create-attachment.dto.ts`.

### 3.2 Reglas de transición de estado

- `PENDIENTE` + primera entrega registrada → `PARCIALMENTE_ENTREGADA`.
- Suma entregada total ≥ cantidad planeada (por descripción) → `ENTREGADA` automática al
  registrar la entrega.
- `markFullyDelivered` ("Marcar entrega total"): registra el **remanente** (`planeado −
  entregado`) como entrega final (fecha actual, nota opcional) y deja la orden `ENTREGADA`.
  Si ya está `ENTREGADA`, es no-op.
- `CANCELADA` no acepta entregas.
- `ENTREGADA` no acepta más entregas (a menos que falten cantidades → regla automática lo
  impide; la suma ya cubre el planeado).

### 3.3 Facturación: una factura que crece

- Nuevo comportamiento de `POST /delivery-orders/:id/invoice` (`convertToInvoice`):
  - Requiere al menos **una entrega registrada** (o `markFullyDelivered`).
  - Si **no existe** `invoiceId`: crea factura `BORRADOR` con ítems = cantidades **entregadas**
    hasta hoy (agrupadas por descripción `InvoiceItem.quantity = Σ entregado`, mismos
    unitPrice/taxRate del partial), y enlaza `deliveryOrder.invoiceId`.
  - Si **existe** factura y está `BORRADOR`: **crece** — actualiza los `InvoiceItem` (une por
    descripción) y recalcula subtotales/total del invoice (misma lógica `computeItems` interna).
  - Si la factura existente está `EMITIDA`+: no modifica (la electrónica ya fue a DIAN);
    registra en respuesta `{ grown: false, reason: 'emitida' }`; la entrega queda consignada y
    el usuario decide factura complementaria manual.
  - La factura `BORRADOR` creada desde la orden lleva nota opcional
    "Factura parcial de la orden de entrega ENT-xxxx" para indicar el parcial.
- Pagos: **sin cambios** — un pago parcial contra esa factura la pone
  `PARCIALMENTE_PAGADA` (flujo existente).

### 3.4 Endpoints nuevos/cambiados (backend)

- `POST /delivery-orders/:id/deliveries` → `registerDelivery(id, dto)`
  (`items[] {description, quantity >0, unitPrice ≥0}`, `deliveredAt?`, `notes?`) = registrar un parcial.
- `POST /delivery-orders/:id/mark-delivered` → `markFullyDelivered(id)`.
- `POST /delivery-orders/:id/invoice` → `syncInvoiceFromDeliveries(id)` (crea/crece el borrador).
- `GET /delivery-orders/:id` incluye `deliveries` (con `attachments` opcional) e `invoice`.
- `PATCH /delivery-orders/:id/status` se mantiene pero `ENTREGADA` manual ahora está **bloqueada**
  si quedan cantidades sin entregar registradas (debe usarse `mark-delivered`); si no hay
  entregas sigue permitido (migración de flujo anterior).

### 3.5 Cotización — valor unitario > 0

- `quote.dto.ts`: `unitPrice` `@Min(0.01)`.
- `quotes.service.ts`: guard en `create` (ítem con `unitPrice` ≤ 0 → `BadRequestException`).
- Frontend `QuoteFormPage`: `z.coerce.number().min(0.01, 'Precio debe ser mayor a 0')`.

### 3.6 Pagos → link a factura

- `PaymentsPage.tsx`: columna "Factura" → `Link` a `/facturas/${r.invoice?.id}` mostrando
  `r.invoice?.invoiceNumber` (patrón de `AccountsReceivablePage`); si no hay factura, "—".

### 3.7 Correo con Resend

- **Dependencia**: `npm i resend` (SDK oficial).
- **`EmailService`** (`src/common/email/email.service.ts`):
  - Si `RESEND_API_KEY` presente → envía vía `resend.emails.send` (from = `EMAIL_FROM` o
    `onboarding@resend.dev`).
  - Sin key → mantiene nodemailer/SMTP o modo simulado actual (dev).
  - API: `sendBrandedEmail({to, subject, title/bodyHtml, attachments?})`; attachments con
    `filename`/`content` (Buffer).
- **Plantilla HTML corporativa** (`src/common/email/branded-email.template.ts`): función pura que
  recibe `{title, subtitle, rows, headerColor, totalAmount, statusLabel, dianBlock?}` y devuelve
  HTML con la paleta: banda superior azul `#2f7ec8`, acentos `#356ea8`, línea roja `#ec1c24`,
  fondo crema `#f7e2c2`, tipografía sans-serif, bloque footer. Sin dependencias externas (una
  función); testeable (snapshot de nombre + strings clave).
- **Factura** (`sendInvoiceEmail`): reutiliza el PDF generado (ya existe) + cuerpo HTML con
  filas (número, cliente, RFC/NIT, fechas, total, abonado, saldo, estado) y bloque DIAN
  (número oficial, CUFE, link público) cuando `dianStatus != NO_APLICA`.
- **Cotización**:
  - Backend: `POST /quotes/:id/send-email` (DTO `{to?}`) → genera **PDF de cotización en el
    backend** (`src/common/pdf/quote-pdf.util.ts`, pdfmake, mismo estilo que la factura con la
    paleta) y envía plantilla corporativa con ítems/total. `emailSentAt`/`quote.emailSentAt?`
    (se reutiliza campo nuevo en schema `Quote.emailSentAt`).
  - Frontend: botón "Enviar por correo" en `QuoteDetailPage` + `SendEmailDialog` (patrón de
    `InvoiceDetailPage`), hook `useSendQuoteEmail`, service `quotes.ts`.
- **Seguridad/claves**: la API key real **no se commitea**. Va en `.env` local (gitignored) y
  como variable `RESEND_API_KEY` del proyecto Vercel `copifactushb-back`. `.env.example` gana
  `RESEND_API_KEY=` / `EMAIL_FROM=` (vacíos, documentación). Emisor `onboarding@resend.dev`
  mientras no se verifique dominio propio.

## Flujo de usuario resultante (orden de entrega)

1. La orden nace de la PO (`PENDIENTE`, cantidad planeada).
2. Cliente pide un **adelanto** → "Registrar entrega parcial": cantidades enviadas + nota +
   adjuntos → orden pasa a **Pendiente completar entrega**.
3. "Facturar entregado" → **borrador** de factura con el parcial.
4. Nuevos envíos → la orden sigue parcial; "Facturar entregado" hace crecer el borrador.
5. "Marcar entrega total" (o entregas que suman el total) → orden **Entregada**.
6. Emitir la factura (Factus/local, flujo existente) → pagos parciales (`PARCIALMENTE_PAGADA`).

## Archivos a modificar

Backend:
- `prisma/schema.prisma` (enum + `DeliveryOrderDelivery` + `Quote.emailSentAt` + DocAttachment sin cambio de tabla)
- db push (CI lo aplica a prod)
- `src/delivery-orders/delivery-orders.service.ts`, `.controller.ts`, `dto/delivery-order.dto.ts`
- `src/delivery-orders/delivery-orders.module.ts` (exportar para tests)
- `src/document-attachments/dto/create-attachment.dto.ts` (entityType nuevo)
- `src/quotes/quotes.service.ts`, `dto/quote.dto.ts`, `quotes.controller.ts` (unitPrice + email)
- `src/invoices/invoices.service.ts` (sendInvoiceEmail → plantilla; reuso PDF)
- `src/common/email/email.service.ts`, `email.module.ts`, nuevo `branded-email.template.ts`
- nuevo `src/common/pdf/quote-pdf.util.ts`
- `.env.example`
- tests: `delivery-orders.service.spec.ts`, `branded-email.template.spec.ts`, `quote-pdf.util.spec.ts`, ajustes DTO quotes

Frontend:
- `src/types/index.ts` (status + `DeliveryDelivery` + DeliveryOrder.deliveries), `src/lib/labels.ts`, `src/components/shared/StatusBadge.tsx`
- `src/pages/delivery-orders/DeliveryOrderDetailPage.tsx` (diálogo parcial, lista de entregas con notas+adjuntos, botones), `DeliveryOrdersPage.tsx` (filtro estado nuevo)
- `src/hooks/use-delivery-orders.ts`, `src/services/delivery-orders.ts`
- `src/pages/quotes/QuoteFormPage.tsx` (min 0.01), `QuoteDetailPage.tsx` (enviar por correo), `src/hooks/use-quotes.ts`, `src/services/quotes.ts`
- `src/pages/payments/PaymentsPage.tsx` (link)

## Testing

- Backend (Jest, TDD):
  - `registerDelivery`: transición PENDIENTE→PARCIALMENTE_ENTREGADA→ENTREGADA (suma ≥ planeado),
    negación en CANCELADA/ENTREGADA, remanente en `markFullyDelivered`.
  - `syncInvoiceFromDeliveries`: crea borrador con cantidades entregadas; **crece** el borrador
    (`InvoiceItem.quantity` actualizado); rechaza/evita modificar factura emitida.
  - `quote.dto/service`: unitPrice 0 → 400.
  - `branded-email.template`: HTML contiene paleta + filas + bloque DIAN.
  - `quote-pdf.util`: genera buffer PDF válido (headless).
- Frontend: build (`tsc -b && vite build`) + oxlint; ninguno nuevo de tests separados (vitest no presente).

## Fuera de alcance (explicito)

- NO se crea página de creación manual de órdenes de entrega (nacen de PO).
- NO se soportan múltiples facturas por orden (decisión: "una factura que crece").
- NO se verifica dominio propio en Resend (pendiente del usuario; `onboarding@resend.dev` ya envía al destinatario del owner).
- NO se cambia `resolveInvoiceStatus` ni el flujo de pagos.