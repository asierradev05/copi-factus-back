# Checklist E2E — Facturación electrónica FACTUS (DIAN)

> Verificación manual contra el sandbox de FACTUS antes de declarar la integración lista.
> Nunca commitear credenciales. Las `FACTUS_*` van solo en `.env` local / secrets de Vercel.

## Requisitos previos (ambiente)

- [ ] `FACTUS_URL`, `FACTUS_CLIENT_ID`, `FACTUS_CLIENT_SECRET`, `FACTUS_USERNAME`, `FACTUS_PASSWORD` en `.env` local.
- [ ] `FACTUS_AMBIENT=sandbox`.
- [ ] `FACTUS_SEND_EMAIL=false` (no enviar correos desde el sandbox durante pruebas).
- [ ] Backend corriendo y base de datos con el schema de la rama `feat/factus-integration`.

## Pasos

1. **Estado de integración**
   ```bash
   GET /api/factus/status
   ```
   Esperado: `{ "configured": true, "ambient": "sandbox", "emisorSynced": false, "url": "<factus_url>" }`.

2. **Configurar datos del emisor (DIAN)** vía `PATCH /api/settings` (roles ADMIN):
   - `legalName` (razón social real), `name` (comercial), `taxId` (NIT sin DV).
   - `legalOrganizationCode` = 1 (persona jurídica).
   - `registrationCode` (matrícula mercantil), `economicActivity` = `1811` (CIIU).
   - `municipalityCode` = `11001`, `countryCode` = `CO`, `tributeCode` = `01`, `responsibilities` = `[{ "code": "O-13" }]`.
   - `invoicePrefix` y `invoiceNextNumber` correctos.

3. **Sincronizar emisor con Factus**
   ```bash
   POST /api/factus/companies/sync
   ```
   Esperado: 200 y luego `GET /api/factus/status` con `emisorSynced: true`.

4. **Sincronizar el rango de numeración de la resolución**
   ```bash
   POST /api/factus/resolutions/:id/sync-range
   ```
   Esperado: la `Resolution` queda con `numberingRangeId != null`. Si hay más de una resolución FACTURA, sincronizar acorde al orden `created_at asc` (la primera activa gana).

5. **Crear factura borrador** con un cliente NIT:
   ```bash
   POST /api/invoices
   ```
   - Cliente con `documentType=NIT`, `documentNumber` real, `dv` correcto.
   - Verificar DV del cliente: usar `GET /v2/dian/acquirer` (o la lógica `calculateDianDv`) y confirmar contra el sandbox.
   - La dirección, ciudad y `municipalityCode` del cliente deberían estar poblados.

6. **Emitir la factura**
   ```bash
   PATCH /api/invoices/:id/emit
   ```
   Esperado (respuesta típica validada):
   - `status: EMITIDA`
   - `dianStatus: VALIDADA`
   - `factusNumber` presente (número oficial DIAN).
   - `cufe` presente (los valores típicos rondan ~123 caracteres).
   - `qrUrl` y `publicUrl` (o `graphicRepresentationUrl`) poblados.
   - `xmlPath` y `pdfPath` poblados (archivos en Supabase bucket `invoice-pdfs`).
   - Error esperado en malos datos: 400 con el mensaje de Factus (p. ej. `422 dv inválido` → revisar el DV del cliente; `impuesto no permitido` → revisar `taxRate`).

7. **Descargar documentos oficiales**
   ```bash
   GET /api/invoices/:id/dian-pdf   # PDF oficial de Factus
   GET /api/invoices/:id/dian-xml   # XML oficial de DIAN
   ```
   Esperado: descargan el archivo (headers `Content-Type` correctos).

8. **Verificación en la UI**
   - Detalle de la factura: el bloque DIAN muestra número oficial, estado derivado, código QR, enlace público y botones de descarga ("PDF oficial", "XML oficial").
   - Settings: sección DIAN con los campos del emisor y el botón "Sincronizar con Factus".
   - Formulario de cliente: campos DIAN visibles (tipo de documento, DV, organización, municipio, país, tributo, responsabilidades).

## Notas

- El DV calculado por `calculateDianDv` se valida contra el sandbox; si el sandbox devuelve `dv inválido`, revisar el número/documento del cliente y la lógica de cálculo.
- Si la factura ya fue enviada previamente, el flujo responde 400 con "La factura ya fue enviada a DIAN previamente" (el adapter detecta `already exists`).
- Todo el flujo es bloqueante: una sola factura por `POST /v2/bills/validate`.