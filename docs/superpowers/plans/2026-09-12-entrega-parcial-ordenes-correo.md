# Plan: Entregas parciales + Cotización precio>0 + Link pago→factura + Correo Resend

**Fecha:** 2026-09-12 · **Spec:** `docs/superpowers/specs/2026-09-12-entrega-parcial-ordenes-correo.md`
**Repos:** `D:\copiFactus\backend` y `D:\copiFactus\frontend` (ambos en `main`, deploy = push a `origin/main`).
**Estado actual:** 40 tests backend verdes, build frontend OK, fix adjuntos+PDF desplegados.

## Resumen

Cuatro features aprobadas:

1. **Órdenes de entrega con entregas parciales** → estado `PARCIALMENTE_ENTREGADA` ("Pendiente completar entrega"), tabla `DeliveryOrderDelivery` (cada despacho con items/nota/fecha/creado por), adjuntos por despacho (`entityType = delivery_order_delivery`), "Marcar entrega total" (remanente → ENTREGADA) y facturación **creciente**: `syncInvoiceFromDeliveries` crea BORRADOR en el primer despacho y **actualiza** ese BORRADOR en despachos siguientes (por descripción agregada). Facturas EMITIDA+ **no se modifican**.
2. **Cotización**: `unitPrice` nunca 0 (backend dto+guard, frontend zod `min(0.01)`).
3. **Pagos**: columna "Factura" → `Link` a `/facturas/:id`.
4. **Correo por Resend** (BRANDING): `resend` npm, `EmailService` con Resend por defecto (fallback SMTP existente / simulado), plantilla HTML corporativa `branded-email.template.ts`, correo de **factura** con la plantilla + PDF existente, correo de **cotización** nuevo (PDF generado en backend `quote-pdf.util.ts`, `Quote.emailSentAt`).

## Convenciones (ya verificadas en el código real)

- Backend: NestJS + Prisma; se usa `toDecimal` (decimal.js) para dinero; JSON de items tipado como `Prisma.InputJsonValue as Array<{...}>`; los specs son de **integración con DB real** (patrón `invoice-uploads.service.spec.ts`): `Test.createTestingModule` con `PrismaModule` + `AuditModule` + `ConfigModule`, create+cleanup de registros reales.
- `delivery-orders.service` constructor: `(prisma, audit)`. `delivery-orders.controller` usa `@Roles` + decorador de usuario actual (mirar el controlador existente y reutilizar el mismo decorador).
- `AttachmentZone` en frontend recibe `entityType: string` → **no** hay que tocar su tipado; basta pasar `delivery_order_delivery`.
- `CompanyPdfModel` ya exportado en `invoice-pdf.util.ts` (línea 76); `generateInvoicePdf(model, company)` exportado.
- Ticket de build: `npm run build` (backend), frontend `npm run build` + `npm run lint` (oxlint, solo warnings). PowerShell 5.1: sin `&&`.
- Cada tarea termina con commit conmensurado; los push a `main` se hacen **al final** tras avisar al usuario.

## Checklists de reviews

- **Review 1 (fin de T6):** entregas backend completas.
- **Review 2 (fin de T10):** UI entregas completa.
- **Review 3 (fin de T17):** correo completo.
- **Review final:** integración + env + push.

---

## T1 — Esquema: estado, modelo de entregas, emailSentAt, entityType

**Archivo:** `backend/prisma/schema.prisma` + `backend/src/document-attachments/dto/create-attachment.dto.ts`

1. Enum `DeliveryOrderStatus` (aprox. línea 83) → añadir `PARCIALMENTE_ENTREGADA`.
2. Añadir modelo (patrón del resto del esquema):

```prisma
model DeliveryOrderDelivery {
  id              String   @id @default(uuid())
  deliveryOrderId String   @map("delivery_order_id")
  deliveredAt     DateTime @map("delivered_at")
  items           Json
  notes           String?
  createdById     String?  @map("created_by")
  createdAt       DateTime @default(now()) @map("created_at")

  deliveryOrder DeliveryOrder               @relation(fields: [deliveryOrderId], references: [id], onDelete: Cascade)
  createdBy     Profile?                   @relation("DeliveryOrderDeliveryCreator", fields: [createdById], references: [id])

  @@index([deliveryOrderId])
  @@map("delivery_order_deliveries")
}
```

3. En `DeliveryOrder`: añadir `deliveries DeliveryOrderDelivery[]`.
4. En `Profile`: añadir back-relation `deliveryOrderDeliveries DeliveryOrderDelivery[] @relation("DeliveryOrderDeliveryCreator")` (revisar si ya existe; el nombre de relación debe ser único).
5. En `Quote`: `emailSentAt DateTime? @map("email_sent_at")`.
6. En `AttachmentEntityType` (enum de Prisma): `DELIVERY_ORDER_DELIVERY = 'delivery_order_delivery'`.
7. `npx prisma db push` + `npx prisma generate` (backend).
8. Build backend. Commit: `chore(prisma): estado PARCIALMENTE_ENTREGADA, DeliveryOrderDelivery, Quote.emailSentAt, entityType delivery_order_delivery`.

**Review:** enum + campos presentes en `schema.prisma`, build OK.

---

## T2 — DTO y endpoints de entregas

**Archivos:** `backend/src/delivery-orders/dto/delivery-order.dto.ts`, `backend/src/delivery-orders/delivery-orders.controller.ts`

1. Nuevos DTO:

```ts
export class RegisterDeliveryItemDto {
  @IsString()
  @IsNotEmpty({ message: 'La descripción del ítem es obligatoria.' })
  description!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  quantity!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRate?: number;
}

export class RegisterDeliveryDto {
  @IsOptional()
  @IsDateString()
  deliveredAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RegisterDeliveryItemDto)
  items!: RegisterDeliveryItemDto[];
}
```

2. En el controlador, junto a los endpoints existentes (mismo guard `@Roles`/decorador de usuario):

```ts
@Post(':id/deliveries')
async registerDelivery(
  @Param('id') id: string,
  @Body() dto: RegisterDeliveryDto,
  ...user
) { return this.deliveryOrders.registerDelivery(id, dto, user.id); }

@Post(':id/mark-delivered')
async markDelivered(@Param('id') id: string, ...user) {
  return this.deliveryOrders.markFullyDelivered(id, user.id);
}
```

3. Build. Commit: `feat(delivery-orders): DTOs y endpoints de entregas parciales`.

**Review:** build OK, endpoints visibles en el controlador.

---

## T3 — `registerDelivery` (TDD)

**Archivos:** `backend/src/delivery-orders/delivery-orders.service.ts`, **nuevo** `backend/src/delivery-orders/delivery-orders.spec.ts`

### 1. Test primero (espec de integración con DB real, patrón `invoice-uploads.service.spec.ts`)

Helper en el spec: crear cliente + orden de entrega vía Prisma directo (sin PO):

```ts
const customer = await prisma.customer.create({ data: { name: `Cliente Entrega ${testSuffix}`, documentType: DocumentType.NIT, documentNumber: `DO-TEST-${testSuffix}`, phone: `3-DO-${testSuffix}` } });
const doo = await prisma.deliveryOrder.create({
  data: {
    doNumber: `ENT-TEST-${testSuffix}`,
    customerId: customer.id,
    scheduledAt: new Date(),
    status: DeliveryOrderStatus.PENDIENTE,
    items: [
      { description: 'Láminas', quantity: 10, unitPrice: 2000, taxRate: 19 },
      { description: 'Afiches', quantity: 5, unitPrice: 1500, taxRate: 19 },
    ],
  },
});
```

Caso 1 — **parcial → PARCIALMENTE_ENTREGADA**:
`registerDelivery(doo.id, { items: [{ description: 'Láminas', quantity: 4 }], notes: 'Primer lote' }, actor.id)`
→ crea fila en `prisma.deliveryOrderDelivery` (items = [{description:'Láminas', quantity:4, ...}], notes, deliveredAt set), `deliveryOrder.status === PARCIALMENTE_ENTREGADA`.

Caso 2 — **completa → ENTREGADA**:
segunda entrega `{ items: [{ description:'Láminas', quantity:6 }, { description:'Afiches', quantity:5 }] }`
→ status `ENTREGADA`, `deliveredAt` set.

Caso 3 — **sobre-entrega → BadRequest**: entregar más de lo planeado por descripción → `BadRequestException` y **no** crea fila.

Caso 4 — **cancelada → BadRequest**.

### 2. Implementación en `delivery-orders.service.ts`

Helpers privados:

```ts
private normalizeDeliveryItem(item: { description: string; quantity: number; unitPrice?: number; taxRate?: number }) {
  return {
    description: item.description.trim(),
    quantity: Number(Number(item.quantity).toFixed(2)),
    unitPrice: item.unitPrice ? Number(Number(item.unitPrice).toFixed(2)) : 0,
    taxRate: item.taxRate ? Number(Number(item.taxRate).toFixed(2)) : 0,
  };
}

private sumQuantities(items: Array<{ description: string; quantity: number }>) {
  const map = new Map<string, number>();
  for (const it of items) {
    const key = it.description.trim().toLowerCase();
    map.set(key, (map.get(key) ?? 0) + Number(it.quantity));
  }
  return map;
}

private aggregateDeliveries(deliveries: Array<{ items: Prisma.JsonValue }>) {
  const lines: Array<{ description: string; quantity: number; unitPrice?: number; taxRate?: number }> = [];
  for (const d of deliveries) {
    lines.push(...(d.items as Prisma.InputJsonValue as Array<{ description: string; quantity: number; unitPrice?: number; taxRate?: number }>));
  }
  return lines;
}
```

```ts
async registerDelivery(id: string, dto: RegisterDeliveryDto, userId: string) {
  const doo = await this.findOne(id);
  if (doo.status === DeliveryOrderStatus.CANCELADA) {
    throw new BadRequestException('No se pueden registrar entregas de una orden cancelada.');
  }
  if (doo.status === DeliveryOrderStatus.ENTREGADA) {
    throw new BadRequestException('La orden de entrega ya está totalmente entregada.');
  }

  const plannedItems = doo.items as Prisma.InputJsonValue as Array<{ description: string; quantity: number }>;
  const planned = this.sumQuantities(plannedItems);
  const deliveredRows = await this.prisma.deliveryOrderDelivery.findMany({
    where: { deliveryOrderId: id },
  });
  const delivered = this.sumQuantities(this.aggregateDeliveries(deliveredRows));

  const items = dto.items.map((it) => this.normalizeDeliveryItem(it));
  const normalized = this.sumQuantities(items);
  for (const [desc, qty] of normalized) {
    const remaining = (planned.get(desc) ?? 0) - (delivered.get(desc) ?? 0);
    if (qty > remaining) {
      throw new BadRequestException(
        `La cantidad entregada de "${desc}" supera lo planeado.`,
      );
    }
  }
  const noPlanned = items.find((i) => !planned.has(i.description.trim().toLowerCase()));
  if (noPlanned) {
    throw new BadRequestException(
      `"${noPlanned.description}" no está en los ítems de la orden.`,
    );
  }

  const delivery = await this.prisma.deliveryOrderDelivery.create({
    data: {
      deliveryOrderId: id,
      deliveredAt: dto.deliveredAt ? new Date(dto.deliveredAt) : new Date(),
      items: items as unknown as Prisma.InputJsonValue,
      notes: dto.notes?.trim() || null,
      createdById: userId,
    },
  });

  const nowDelivered = this.sumQuantities(this.aggregateDeliveries([...deliveredRows, delivery]));
  const isTotal = [...planned.keys()].every((desc) =>
    (nowDelivered.get(desc) ?? 0) >= (planned.get(desc) ?? 0),
  );

  const status = isTotal ? DeliveryOrderStatus.ENTREGADA : DeliveryOrderStatus.PARCIALMENTE_ENTREGADA;
  const deliveredAt = isTotal ? delivery.deliveredAt : doo.deliveredAt;

  const updated = await this.prisma.deliveryOrder.update({
    where: { id },
    data: { status, deliveredAt },
    include: { customer: true, invoice: true, purchaseOrder: true },
  });

  await this.audit
    .log({
      userId,
      action: AuditAction.CREATE,
      entityType: 'DeliveryOrderDelivery',
      entityId: delivery.id,
      newValue: { deliveryOrderId: id, status },
    })
    .catch(() => {});

  return updated;
}
```

### 3. Test pasa, build OK. Commit: `feat(delivery-orders): registrar entregas parciales (TDD)`.

**Review:** spec con 4 casos pasa; corrida completa `npm test`.

---

## T4 — `markFullyDelivered` (TDD)

**Test primero** (mismo spec):
- Caso 1 — PENDIENTE sin entregas: crea entrega con **remanente completo** + ítems de toda la ordern, status → ENTREGADA.
- Caso 2 — parcial previo: entrega 4 de 10 → `markFullyDelivered` → nueva fila con el remanente (6) → ENTREGADA.
- Caso 3 — idempotente sobre ENTREGADA → devuelve la orden sin crear fila nueva (count sin cambio).
- Caso 4 — cancelada → BadRequest.

**Implementación:**

```ts
async markFullyDelivered(id: string, userId: string) {
  const doo = await this.findOne(id);
  if (doo.status === DeliveryOrderStatus.CANCELADA) {
    throw new BadRequestException('No se puede completar una orden cancelada.');
  }
  if (doo.status === DeliveryOrderStatus.ENTREGADA) {
    return doo;
  }

  const plannedItems = doo.items as Prisma.InputJsonValue as Array<{
    description: string; quantity: number; unitPrice?: number; taxRate?: number;
  }>;
  const planned = this.sumQuantities(plannedItems);
  const deliveredRows = await this.prisma.deliveryOrderDelivery.findMany({
    where: { deliveryOrderId: id },
  });
  const delivered = this.sumQuantities(this.aggregateDeliveries(deliveredRows));

  const remaining = plannedItems
    .map((it) => {
      const left =
        Number(it.quantity) - (delivered.get(it.description.trim().toLowerCase()) ?? 0);
      return left > 0 ? { description: it.description, quantity: left, unitPrice: it.unitPrice, taxRate: it.taxRate } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const deliveredAt = new Date();
  if (remaining.length > 0) {
    await this.prisma.deliveryOrderDelivery.create({
      data: {
        deliveryOrderId: id,
        deliveredAt,
        items: remaining.map((r) => this.normalizeDeliveryItem(r)) as unknown as Prisma.InputJsonValue,
        notes: 'Marcada como totalmente entregada',
        createdById: userId,
      },
    });
  }

  const updated = await this.prisma.deliveryOrder.update({
    where: { id },
    data: { status: DeliveryOrderStatus.ENTREGADA, deliveredAt },
    include: { customer: true, invoice: true, purchaseOrder: true },
  });

  await this.audit
    .log({ userId, action: AuditAction.UPDATE, entityType: 'DeliveryOrder', entityId: id, oldValue: { status: doo.status }, newValue: { status: updated.status, deliveredAt } })
    .catch(() => {});

  return updated;
}
```

Test pasa, build OK. Commit: `feat(delivery-orders): marcar entrega total con remanente (TDD)`.

**Review:** casos 1-4 verdes.

---

## T5 — `syncInvoiceFromDeliveries`: factura que crece (TDD)

**Test primero:**
- Caso 1 — **crear**: con una entrega parcial (4 de 10, solo "Láminas") → crea factura BORRADOR con items = entregado junto, `deliveryOrder.invoiceId` = factura.
- Caso 2 — **crecer**: segunda entrega parcial → mismo `doo.invoiceId`, factura del BORRADOR ahora con las cantidades agregadas (Láminas=10, Afiches=5), `total` recalculado.
- Caso 3 — **no crece si EMITIDA**: marcar factura como EMITIDA → tercer delivery → no cambia items de la factura (cantidades intactas).
- Caso 4 — **sin entregas → BadRequest**.
- Caso 5 — cancelada → BadRequest.

**Implementación** — sustituir `convertToInventory` (reemplazo de `convertToInvoice`):

```ts
async syncInvoiceFromDeliveries(id: string, userId: string) {
  const doo = await this.findOne(id);
  if (doo.status === DeliveryOrderStatus.CANCELADA) {
    throw new BadRequestException('No se puede facturar una orden de entrega cancelada.');
  }

  const deliveredRows = await this.prisma.deliveryOrderDelivery.findMany({
    where: { deliveryOrderId: id },
    orderBy: { deliveredAt: 'asc' },
  });
  if (deliveredRows.length === 0) {
    throw new BadRequestException('Debe registrar al menos una entrega antes de facturar.');
  }

  const deliveredItems = this.aggregateDeliveries(deliveredRows);
  const byDesc = new Map<string, typeof deliveredItems[number]>();
  for (const it of deliveredItems) {
    const key = it.description.trim().toLowerCase();
    const cur = byDesc.get(key);
    byDesc.set(key, {
      description: it.description.trim(),
      quantity: (cur?.quantity ?? 0) + it.quantity,
      unitPrice: cur?.unitPrice ?? it.unitPrice ?? 0,
      taxRate: cur?.taxRate ?? it.taxRate ?? 0,
    });
  }

  const computed = [...byDesc.values()].map((item) => {
    const quantity = toDecimal(item.quantity);
    const unitPrice = toDecimal(item.unitPrice ?? 0);
    const discount = toDecimal(0);
    const taxRate = toDecimal(item.taxRate ?? 0);
    const subtotal = quantity.mul(unitPrice).sub(discount);
    const taxAmount = subtotal.mul(taxRate).div(100);
    return { description: item.description, quantity, unitPrice, discount, taxRate, subtotal, taxAmount, total: subtotal.add(taxAmount) };
  });

  const subtotal = computed.reduce((s, i) => s.add(i.subtotal), toDecimal(0));
  const discountTotal = computed.reduce((s, i) => s.add(i.discount), toDecimal(0));
  const taxTotal = computed.reduce((s, i) => s.add(i.taxAmount), toDecimal(0));
  const total = computed.reduce((s, i) => s.add(i.total), toDecimal(0));

  const hasPending =
    this.sumQuantities(doo.items as Prisma.InputJsonValue as Array<{ description: string; quantity: number }>)
      .size !== computed.length || Object.keys(...).length > 0; // si todas las entregas cubrieron el plan

  // (ver nota abajo: hasPending se calcula comparando entregado contra planeado)

  if (!doo.invoiceId) {
    const invoice = await this.prisma.invoice.create({
      data: {
        customerId: doo.customerId,
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        subtotal, discountTotal, taxTotal, total,
        paidAmount: toDecimal(0), balance: total,
        status: InvoiceStatus.BORRADOR,
        notes: [
          doo.notes ?? '',
          `Generada desde la orden de entrega ${doo.doNumber}`,
          hasPending ? 'Entrega parcial' : null,
        ].filter(Boolean).join('\n').trim() || null,
        createdById: userId,
        items: { create: computed.map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, discount: i.discount, taxRate: i.taxRate, subtotal: i.subtotal, taxAmount: i.taxAmount, total: i.total })) },
      },
      include: { items: true },
    });

    await this.prisma.deliveryOrder.update({ where: { id }, data: { invoiceId: invoice.id } });
    await this.audit.log({ userId, action: AuditAction.CREATE, entityType: 'Invoice', entityId: invoice.id, newValue: { source: 'DeliveryOrder', doNumber: doo.doNumber } }).catch(() => {});
    return invoice;
  }

  const existing = await this.prisma.invoice.findUnique({
    where: { id: doo.invoiceId },
    include: { items: true },
  });
  if (!existing) throw new NotFoundException('La factura vinculada no existe.');
  if (existing.status !== InvoiceStatus.BORRADOR) {
    return existing; // factura emitida: NO se modifica
  }

  const invoice = await this.prisma.$transaction(async (tx) => {
    const rows = existing.items;
    for (const line of computed) {
      const match = rows.find(
        (r) => r.description.trim().toLowerCase() === line.description.toLowerCase(),
      );
      if (match) {
        await tx.invoiceItem.update({
          where: { id: match.id },
          data: { quantity: line.quantity, unitPrice: line.unitPrice, taxRate: line.taxRate, subtotal: line.subtotal, taxAmount: line.taxAmount, total: line.total },
        });
      } else {
        await tx.invoiceItem.create({
          data: { invoiceId: existing.id, description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, discount: line.discount, taxRate: line.taxRate, subtotal: line.subtotal, taxAmount: line.taxAmount, total: line.total },
        });
      }
    }
    const all = await tx.invoiceItem.findMany({ where: { invoiceId: existing.id } });
    const newSubtotal = all.reduce((s, i) => s.add(toDecimal(i.subtotal)), toDecimal(0));
    const newTax = all.reduce((s, i) => s.add(toDecimal(i.taxAmount)), toDecimal(0));
    const newTotal = all.reduce((s, i) => s.add(toDecimal(i.total)), toDecimal(0));
    return await tx.invoice.update({
      where: { id: existing.id },
      data: { subtotal: newSubtotal, discountTotal: toDecimal(0), taxTotal: newTax, total: newTotal, balance: newTotal.sub(toDecimal(existing.paidAmount ?? 0)).lessThan(0) ? toDecimal(0) : newTotal.sub(toDecimal(existing.paidAmount ?? 0)) },
      include: { items: true },
    });
  });

  await this.audit.log({ userId, action: AuditAction.UPDATE, entityType: 'Invoice', entityId: invoice.id, newValue: { source: 'DeliveryOrder', doNumber: doo.doNumber, total } }).catch(() => {});
  return invoice;
}
```

> **Nota `hasPending`:** calcular correctamente = ¿alguna línea planeada tiene remanente? Comparar mapas `planned` vs `entregado` (misma técnica de T3/T4). Si `hasPending` es falso y `doo.status === 'ENTREGADA'`, la nota no dice "Entrega parcial".

### 3. Compatibilidad: mantener `convertToInvoice` como alias

El frontend ya conoce `POST /delivery-orders/:id/invoice` (`convertToInvoice`). Cambiar el controlador para que `POST :id/invoice` + `POST :id/invoice/sync` (si se quiere distinción) llamen a `syncInvoiceFromDeliveries`. Simplificar: **un solo endpoint** `POST :id/invoice` → `syncInvoiceFromDeliveries` (el frontend lo re-rata como "Facturar / Actualizar factura").

Eliminar el método `convertToInvoice` anterior (su lógica queda absorbida). Ajustar imports (`PurchaseOrderStatus` se sigue usando en `create`; quitar sobrantes).

Test verde, build OK. Commit: `feat(delivery-orders): factura creciente desde entregas parciales (TDD)`.

**Review:** casos 1–5 verdes; no queda referencia a `convertToInvoice` en el servicio.

---

## T6 — Guardar manual: PATCH ENTREGADA bloqueado si hay remanente

**Test primero:**
- Parcial (4 de 10) → `updateStatus(ENTREGADA)` → `BadRequestException`.
- PENDIENTE sin entregas → `updateStatus(ENTREGADA)` → OK (compatibilidad anterior).
- Entregado total vía entregas → `updateStatus(ENTREGADA)` → OK.

**Implementación** en `updateStatus` (antes del update):

```ts
if (dto.status === DeliveryOrderStatus.ENTREGADA) {
  const rows = await this.prisma.deliveryOrderDelivery.findMany({
    where: { deliveryOrderId: id },
  });
  if (rows.length > 0) {
    const planned = this.sumQuantities(current.items as Prisma.InputJsonValue as Array<{ description: string; quantity: number }>);
    const delivered = this.sumQuantities(this.aggregateDeliveries(rows));
    const hasRemaining = [...planned.entries()].some(([desc, qty]) =>
      (delivered.get(desc) ?? 0) < qty,
    );
    if (hasRemaining) {
      throw new BadRequestException(
        'Hay entregas pendientes. Use "Marcar entrega total" para completar la orden.',
      );
    }
  }
}
```

Test verde, build OK. Commit: `feat(delivery-orders): bloquear ENTREGADA manual con remanente (TDD)`.

---

## T7 — `findOne` incluye entregas

```ts
async findOne(id: string) {
  const doo = await this.prisma.deliveryOrder.findUnique({
    where: { id },
    include: {
      customer: true, invoice: true, purchaseOrder: true,
      deliveries: { orderBy: { deliveredAt: 'asc' } },
    },
  });
  ...
}
```

Build backend. Commit: `feat(delivery-orders): incluir entregas en get de detalle`.

**Review** (punto oficial de review 1): corrida completa `npm test` backend + build.

---

## T8 — Frontend: tipos, labels y badge

**Archivos:** `frontend/src/types/index.ts`, `frontend/src/lib/labels.ts`, `frontend/src/components/shared/StatusBadge.tsx`

1. `types/index.ts`: añadir `'PARCIALMENTE_ENTREGADA'` al union `DeliveryOrderStatus` (línea ~509) + interfaces:

```ts
export interface DeliveryOrderDeliveryItem {
  description: string
  quantity: number
  unitPrice?: number
  taxRate?: number
}

export interface DeliveryOrderDelivery {
  id: string
  deliveryOrderId: string
  deliveredAt: string
  items: DeliveryOrderDeliveryItem[]
  notes?: string | null
  createdAt: string
}
```

Añadir `deliveries?: DeliveryOrderDelivery[]` a `DeliveryOrder`.

2. `labels.ts` línea 67: `PARCIALMENTE_ENTREGADA: 'Pendiente completar entrega',`
3. `StatusBadge.tsx`: mapear `PARCIALMENTE_ENTREGADA` → `'warning'` (junto a `PARCIALMENTE_PAGADA`).

Build frontend. Commit: `feat(frontend): estados y tipos de entrega parcial`.

**Review:** build OK.

---

## T9 — Frontend: servicios y hooks de entregas

**Archivos:** `frontend/src/services/delivery-orders.ts`, `frontend/src/hooks/use-delivery-orders.ts`

```ts
// services/delivery-orders.ts
registerDelivery: (id: string, data: { items: Array<{ description: string; quantity: number; unitPrice?: number; taxRate?: number }>; notes?: string; deliveredAt?: string }) =>
  api<DeliveryOrder>(`/delivery-orders/${id}/deliveries`, { method: 'POST', body: data }),
markDelivered: (id: string) =>
  api<DeliveryOrder>(`/delivery-orders/${id}/mark-delivered`, { method: 'POST' }),
```

`use-delivery-orders.ts`: `useRegisterDelivery` y `useMarkDelivered` (patrón de los existentes: invalidate `['delivery-orders']`, `['delivery-orders', id]`, `['dashboard-kanban']`, toast). En `useConvertDeliveryToInvoice` cambiar la frase del toast a condición: si fue na factura existente → número del invoice.

Build. Commit: `feat(frontend): servicios y hooks para entregas parciales`.

**Review:** build OK.

---

## T10 — Frontend: detalle de orden con entregas parciales

**Archivo (mayoría de cambios):** `frontend/src/pages/delivery-orders/DeliveryOrderDetailPage.tsx` · posible componente extra `frontend/src/pages/delivery-orders/DeliveryFormDialog.tsx`

1. **Cálculos:** agregar mapas `planned`, `delivered`, `remaining` por descripción (misma lógica que backend, en JS). Usar `doo.items` y `doo.deliveries ?? []`.
2. **Tabla de ítems:** añadir columna "Entregado" (suma por descripción) y "Pendiente" (= planeado − entregado).
3. **Botones de acción** (reemplazar lógica):
   - `canRecordDelivery = canWrite && (PENDIENTE || PARCIALMENTE_ENTREGADA)` → botón "Registrar entrega parcial" → abre `DeliveryFormDialog`.
   - `canDeliverTotal = canWrite && (PENDIENTE || PARCIALMENTE_ENTREGADA)` → botón "Marcar entrega total" → `ConfirmDialog` → `markDelivered`.
   - `canInvoice = canWrite && doo.deliveries?.length > 0` → botón `doo.invoiceId ? 'Actualizar factura' : 'Facturar'` → `convert.mutateAsync(id)` (navega a `/facturas/:id`).
   - Mantener "Marcar como entregada" (PATCH) **solo cuando `deliveries.length === 0`**.
4. **Sección "Entregas":** tarjeta por entrega: fecha (`formatDate(deliveredAt)`), notas, mini-tabla de items entregados + `AttachmentZone entityType="delivery_order_delivery" entityId={delivery.id}` (así el usuario adjunta evidencias por despacho).
5. **`DeliveryFormDialog`** (nuevo, patrón de los demás diálogos Con dialog + react-hook-form/zod o estado local):
   - Al abrir, prellenar un campo por línea planeada con remanente > 0 (valor = remanente, min 0.01; el usuario edita cant; unitPrice/taxRate solo lectura desde el planeado).
   - Campo "Fecha de entrega" (default hoy) y "Nota" (textarea opcional).
   - Submit → `registerDelivery` → cerrar.
   - Enviar solo líneas con quantity > 0.
6. Actualizar `ConfirmDialog` de "Crear factura" para reflejar que crece (texto: "Facturar lo entregado hasta ahora. Si ya existe, se actualiza.").

Build frontend + lint. Commit: `feat(frontend): entregas parciales en detalle de orden`.

**Review** (punto oficial de review 2): flujo UX completo en local (crear orden → parcial → marcar total → facturar).

---

## T11 — Cotización: unitPrice > 0

**Archivos:** `backend/src/quotes/dto/quote.dto.ts`, `backend/src/quotes/quotes.service.ts`, **nuevo** `frontend/src/pages/quotes/QuoteFormPage.tsx` (línea ~35) + spec backend `backend/src/quotes/quotes.spec.ts` (o `dto.spec`)

1. **Test primero** (registro `quote.dto.spec.ts`): `CreateQuoteItemDto` con `unitPrice: 0` → `validate()` falla en propiedad `unitPrice`.
2. `quote.dto.ts`: `@Min(0)` → `@Min(0.01, { message: 'El valor unitario debe ser mayor a 0.' })`.
3. Guard extra en `quotes.service.create` (antes de crear):

```ts
if (dto.items.some((i) => Number(i.unitPrice) <= 0)) {
  throw new BadRequestException('El valor unitario de cada ítem debe ser mayor a 0.');
}
```

4. Frontend `QuoteFormPage.tsx`: schema zod → `.min(0.01, 'El valor unitario debe ser mayor a 0')` para `unitPrice`.

Build backend + frontend, spec verde. Commit: `feat(quotes): el valor unitario debe ser mayor a 0`.

**Review:** spec verde; build OK ambos.

---

## T12 — Pagos: hyperlink a factura

**Archivo:** `frontend/src/pages/payments/PaymentsPage.tsx` (línea 27)

```tsx
import { Link } from 'react-router-dom'
...
{ key: 'invoice', header: 'Factura', cell: (r) =>
  r.invoice ? (
    <Link to={`/facturas/${r.invoice.id}`} className="text-primary underline-offset-2 hover:underline">
      {r.invoice.invoiceNumber ?? 'Borrador'}
    </Link>
  ) : (
    '—'
  ) },
```

Build. Commit: `feat(payments): enlace a la factura desde el pago`.

**Review:** build OK.

---

## T13 — Resend: instalar y extender EmailService

**Archivo:** `backend/src/common/email/email.service.ts` (+ modulo sin cambios; `local` package)

1. (backend) `npm i resend`.
2. `EmailService`:
   - `import { Resend } from 'resend';`
   - Constructor: leer `RESEND_API_KEY` y `EMAIL_FROM` (`?? 'facturacion@copigraficassierra.com'`); si hay key → `this.resend = new Resend(key)`.
   - En `sendMail` (mantener firma actual `{ to, subject, html, attachments? }`), si `this.resend`:
   ```ts
   const result = await this.resend.emails.send({
     from: this.from,
     to,
     subject,
     html,
     attachments: attachments?.map((a) => ({ filename: a.filename, content: a.content })),
   });
   if (result.error) throw new Error(result.error.message);
   return { messageId: result.data?.id, to, simulated: false };
   ```
   - Timeout 30s. Fallback: SMTP actual si hay `SMTP_HOST` y no hay Resend; si nada → simulada (comportamiento actual).
   - NUNCA loguear la key.
3. **Spec** `backend/src/common/email/email.service.spec.ts`: con ConfigService mock (sin Resend key) → `sendMail` devuelve `simulated: true`. Con `RESEND_API_KEY` falsa no probar (no lanzar red).

Build + spec. Commit: `feat(email): soporte resend con fallback SMTP/simulado`.

**Review:** spec verde; `EmailService` sin secrets en logs.

---

## T14 — Plantilla corporativa de correo

**Nuevo:** `backend/src/common/email/branded-email.template.ts` + spec `branded-email.template.spec.ts`

```ts
export interface BrandedEmailRow { label: string; value: string }
export interface BrandedEmailParams {
  companyName: string
  title: string
  subtitle?: string
  rows?: BrandedEmailRow[]
  totalLabel?: string
  totalValue?: string
  statusLabel?: string
  dianBlock?: BrandedEmailRow[]
  linkUrl?: string
  linkLabel?: string
}
export function escapeHtml(value: string | number | null | undefined): string
export function renderBrandedEmail(p: BrandedEmailParams): string
```

- HTML inline con estilos de marca: encabezado banda `#2f7ec8`, acento `#ec1c24`, fondo `#f7e2c2`, texto `#1f2937`; contenedor centrado, filas de la tabla, fila total resaltada, bloque DIAN (CUFE/estado) solo si se pasa, link con esquema `href=""`.
- `escapeHtml` escapa `<>&"'` y aplica `String(value ?? '')`.

**Spec:** render → contiene `CopiGráfica`, `#2f7ec8`, el título, el total, `escapeHtml` escapa `<script>`; sin `dianBlock` no aparece "CUFE"; con `dianBlock` sí.

Commit: `feat(email): plantilla corporativa renderizable (TDD)`.

**Review:** spec verde.

---

## T15 — Factura: usar plantilla corporativa

**Archivo:** `backend/src/invoices/invoices.service.ts` (`sendInvoiceEmail`, línea ~634). Sustituir la construcción del HTML inline por `renderBrandedEmail`:

```ts
const html = renderBrandedEmail({
  companyName: company.name,
  title: `Factura ${invoice.invoiceNumber}`,
  subtitle: `Hola ${customer.name}, adjuntamos su factura.`,
  rows: [
    { label: 'Número', value: invoice.invoiceNumber },
    { label: 'Cliente', value: customer.name },
    { label: 'Fecha', value: formatDateForEmail(invoice.issueDate) },
    { label: 'Vencimiento', value: formatDateForEmail(invoice.dueDate) },
  ],
  totalLabel: 'Total',
  totalValue: formatMoney(invoice.total),
  statusLabel: invoice.dianStatus !== 'NO_APLICA' ? (invoice.dianStatus ?? invoice.status) : undefined,
  dianBlock: invoice.dianStatus !== 'NO_APLICA' && invoice.cufe
    ? [{ label: 'CUFE', value: invoice.cufe }, { label: 'Estado DIAN', value: invoice.dianStatus }]
    : undefined,
  linkUrl: `${process.env.FRONTEND_URL ?? 'http://localhost:5175'}/invoices/${invoice.id}`,
  linkLabel: 'Ver factura',
});
```

Helpers locales `formatMoney`/`formatDateForEmail` (locale `es-CO`, no dependen de librerías). Mantener el resto del flujo (PDF adjunto, validaciones) intacto.

**Spec** (integración, patrón de invoice): crear factura real BORRADOR con customer email → `sendInvoiceEmail` con env simulado → devuelve `{ simulated: true, to: email }` sin lanzar. (Cover indirecto de que la plantilla no rompe.)

Build + spec. Commit: `feat(email): factura con plantilla corporativa`.

**Review:** spec verde; el correo saliente conserva adjunto PDF.

---

## T16 — Cotización por correo: PDF backend + endpoint

**Nuevos:** `backend/src/common/pdf/quote-pdf.util.ts` (+ spec), cambios en `backend/src/quotes/quotes.service.ts`, `backend/src/quotes/quotes.controller.ts`, `backend/src/quotes/quotes.module.ts`, `backend/src/quotes/dto/quote.dto.ts`

1. **`quote-pdf.util.ts`** — espejo de `invoice-pdf.util` (pdfmake, `LETTER`, bandas, encabezado de empresa, cliente, tabla de ítems, totales bajo la tabla):

```ts
export interface QuotePdfModel {
  quoteNumber: string
  issuedAt?: Date | string | null
  validUntil?: Date | string | null
  customerName?: string | null
  lines: Array<{ description: string; quantity: number; unitPrice: number; taxRate?: number }>
  subtotal: number | string
  taxTotal: number | string
  total: number | string
  notes?: string | null
}
export function generateQuotePdf(model: QuotePdfModel, company: CompanyPdfModel): Buffer
```

Reutilizar formato de moneda `es-CO` y estilo de banda del PDF de factura.

**Spec** `quote-pdf.util.spec.ts`: `generateQuotePdf` devuelve Buffer > 1000 bytes, comienza con `%PDF-`, contiene el nombre comercial en valores `content` (opcional, revisar espacios).

2. **`quotes.service.ts`**:
   - `private async getCompanyPdfModel(): Promise<CompanyPdfModel>` (misma lógica que `invoices.service` línea 781: CompanySettings→fallback memoria→defaults).
   - `private toPdfModel(quote): QuotePdfModel` (mapear items JSON, subtotal/taxTotal/total).
   - `async sendEmail(id, dto, actorId)`:

```ts
async sendEmail(id: string, dto: SendQuoteEmailDto, userId: string) {
  const quote = await this.findOne(id);
  const to = (dto.to ?? '').trim() || quote.customer?.email || null;
  if (!to) throw new BadRequestException('Debe indicar un destinatario o registrar un correo en el cliente.');
  const company = await this.getCompanyPdfModel();
  const pdfBuffer = generateQuotePdf(this.toPdfModel(quote), company);
  const html = renderBrandedEmail({
    companyName: company.name,
    title: `Cotización ${quote.quoteNumber}`,
    subtitle: `Hola ${quote.customer?.name}, adjuntamos su cotización.`,
    rows: [
      { label: 'Número', value: quote.quoteNumber },
      { label: 'Cliente', value: quote.customer?.name ?? '-' },
      { label: 'Fecha', value: formatDateForEmail(quote.issuedAt) },
      ...(quote.validUntil ? [{ label: 'Vigencia', value: formatDateForEmail(quote.validUntil) }] : []),
    ],
    totalLabel: 'Total',
    totalValue: formatMoney(quote.total),
    linkUrl: `${process.env.FRONTEND_URL ?? 'http://localhost:5175'}/quotes/${quote.id}`,
    linkLabel: 'Ver cotización',
  });
  const result = await this.email.sendMail({ to, subject: `Cotización ${quote.quoteNumber} — ${company.name}`, html, attachments: [{ filename: `${quote.quoteNumber}.pdf`, content: pdfBuffer }] });
  await this.prisma.quote.update({ where: { id }, data: { emailSentAt: new Date() } });
  await this.audit.log({ userId, action: AuditAction.UPDATE, entityType: 'Quote', entityId: id, newValue: { emailSentAt: true } }).catch(() => {});
  return { success: true, messageId: result.messageId, to, simulated: result.simulated };
}
```

   - Injectar `EmailService` en el constructor (la orden actual: `prisma, audit, email`).
   - Nota: `quote.total` puede no existir como columna (revisar en implementación; si no existe, calcular con `toDecimal` igual que `computeItems`). `issuedAt`: usar el campo que tenga el modelo (en impl. leer modelo; si no existe, usar `createdAt`).
3. **`quotes.module.ts`**: importar `EmailModule`.
4. **`dto/quote.dto.ts`**: `SendQuoteEmailDto { @IsOptional() @IsEmail() to?: string }`.
5. **`quotes.controller.ts`**:

```ts
@Post(':id/send-email')
@Roles(ADMIN, FACTURADOR)
async sendEmail(@Param('id') id: string, @Body() dto: SendQuoteEmailDto, ...user) {
  return this.quotesService.sendEmail(id, dto, user.id);
}
```

6. **Spec `quotes.service.spec.ts`**: crear cotización + customer email; en ambiente sin Resend key → `sendEmail` devuelve `{ simulated: true, to }` y setea `Quote.emailSentAt`.

Build backend + specs. Commit: `feat(quotes): enviar cotización por correo con PDF (TDD)`.

**Review** (punto oficial de review 3): spec verde; PDF citación generado.

---

## T17 — Frontend: enviar cotización por correo

**Archivos:** `frontend/src/services/quotes.ts`, `frontend/src/hooks/use-quotes.ts`, `frontend/src/pages/quotes/QuoteDetailPage.tsx`

1. `services/quotes.ts`:
```ts
sendEmail: (id: string, to?: string) =>
  api<SendEmailResult>(`/quotes/${id}/send-email`, { method: 'POST', body: to ? { to } : {} }),
```
2. `hooks/use-quotes.ts`: `useSendQuoteEmail` (patrón de `useSendInvoiceEmail`: toast `.simulated ? 'Correo simulado...' : 'Cotización enviada'`, invalidar `['quotes']`, `['quotes', id]`).
3. `QuoteDetailPage.tsx`: botón "Enviar por correo" (icono `Mail`) + `SendQuoteEmailDialog` **copiado del patrón de factura** (`InvoiceDetailPage` línea 454: Dialog + Input email + función `useSendQuoteEmail`); `defaultTo = quote.customer?.email`.

Build frontend. Commit: `feat(frontend): enviar cotización desde el detalle`.

**Review:** build OK.

---

## T18 — Integración, env y despliegue

1. **Env local (NO commitear):** en `backend/.env` añadir:
   ```
   RESEND_API_KEY="[RESEND_API_KEY]"
   EMAIL_FROM="facturacion@copigraficassierra.com"
   ```
   → `.env.example` añadir con placeholders/vacíos: `RESEND_API_KEY=""`, `EMAIL_FROM="facturacion@copigraficassierra.com"` (dominio `copigraficassierra.com` ya verificado en Resend).
   > ⚠️ Cualquier remitente nuevo (`EMAIL_FROM`) debe usar `copigraficassierra.com` verificado. Si se usa otro dominio en un futuro, verificar SPF/DKIM en Resend antes de enviar.
2. **Verificación completa:**
   - Backend: `npm test` (todos, 40+ nuevos) + `npm run build`.
   - Frontend: `npm run build` + `npm run lint`.
3. **Vault:** actualizar `D:\copiFactus\copigraficas\notas-principales\estado-actual.md` y `dian\integracion-factus.md` con estado; evento en memoria persiste hasta push.
4. **Vercel (requiere al usuario):** añadir env `RESEND_API_KEY` y `EMAIL_FROM` al proyecto `copifactushb-back` (Dashboard → Project → Settings → Environment Variables).
5. **Commits finales ordenados** y push a `origin/main` de ambos repos (avisar al usuario antes del push; el push dispatche depleoys). Verificar runs y prod: abrir una cotización → "Enviar por correo"; factura existente → reenviar correo; orden de entrega → registrar parcial → adjunto por despacho → "Actualizar factura".
6. **Pendientes legacy:** solicitar al usuario credenciales sandbox FACTUS (para E2E de emisión) y confirmar subida de PDFs (fix ya desplegado) en prod.

**Review final (antes de reportar hecho):** evidencia — runs de deploy verdes, suites verdes, builds verdes.

---

## Riesgos y mitigaciones

- **Resend remitente:** dominio `copigraficassierra.com` verificado; confirmar que `EMAIL_FROM` (ej. `facturacion@copigraficassierra.com`) es una dirección válida de la cuenta Resend antes del push.
- **`prisma db push`:** puede pedir reset si hay cambio destructivo (no lo hay; backups en memoria de `globalStore`). Ejecutar y verificar migración limpia.
- **Factura BORRADOR con pagos:** `syncInvoiceFromDeliveries` recalcula `balance` preservando `paidAmount` (si la factura BORRADOR ya recibió pagos). Confirmar columnas `paidAmount`/`balance` existen (sí, ver `recalculateBalance`).
- **Múltiples entregas concurrentes:** no hay locks; aceptable por uso single-user (anotar).
- **Item de entrega con descripción distinta:** bloqueado (BadRequest) para evitar "ruido" en la factura creciente.

## Definición de hecho

- 4 features implementadas y probadas (suites verdes) en ambos repos.
- `PARCIALMENTE_ENTREGADA` funcional de punta a punta (order→despachos→adjuntos→factura creciente→emisión).
- Envío de factura y cotización por Resend con plantilla corporativa (o simulado sin key).
- Deploy en Vercel verificado; vault actualizado.