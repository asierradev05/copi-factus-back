# Checklist E2E — Facturación electrónica FACTUS (DIAN)

> Verificación manual contra el sandbox de FACTUS antes de declarar la integración lista.
> Nunca commitear credenciales. Las `FACTUS_*` van solo en `.env` local / secrets de Vercel.

## Requisitos previos (ambiente)

- [x] `FACTUS_URL`, `FACTUS_CLIENT_ID`, `FACTUS_CLIENT_SECRET`, `FACTUS_USERNAME`, `FACTUS_PASSWORD` en `.env` local.
- [x] `FACTUS_AMBIENT=sandbox`.
- [x] `FACTUS_SEND_EMAIL=false` (no enviar correos desde el sandbox durante pruebas).
- [x] Vars `FACTUS_*` en secrets de Vercel (proyecto `copifactushb-back`) y backend desplegado (redeploy automático por push a `main`).

## Pasos

1. **Estado de integración**
   ```bash
   GET /api/factus/status
   ```
   Esperado: `{ "configured": true, "ambient": "sandbox", "emisorSynced": false, "url": "<factus_url>" }`. ✅ Hecho (2026-09-12): `{configured:true, ambient:"sandbox", emisorSynced:false, url:"https://api-sandbox.factus.com.co"}`.

2. **Configurar datos del emisor (DIAN)** vía `PATCH /api/settings` (roles ADMIN):
   - `legalName` (razón social real), `name` (comercial), `taxId` (NIT sin DV).
   - `legalOrganizationCode` = 1 (persona jurídica).
   - `registrationCode` (matrícula mercantil), `economicActivity` = `1811` (CIIU).
   - `municipalityCode` = `11001`, `countryCode` = `CO`, `tributeCode` = `01`, `responsibilities` = `[{ "code": "O-13" }]`.
   - `invoicePrefix` y `invoiceNextNumber` correctos.
   - ✅ Hecho: name "Copigráficas Sierra", address/phone reales de la empresa, `economicActivity=1811`, `municipalityCode=11001`, `tribute=01`, `responsibilities=[{code:O-13}]`. ⚠️ `legalName`, `taxId` y `registrationCode` siguen con valores de prueba hasta confirmar la razón social/NIT reales con el usuario.

3. **Sincronizar emisor con Factus**
   ```bash
   POST /api/factus/companies/sync
   ```
   Esperado: 200 y luego `GET /api/factus/status` con `emisorSynced: true`.
   ⚠️ **BLOQUEADO por el sandbox**: `PUT /v2/companies` devuelve 422 genérico ("todos los campos obligatorios") con CUALQUIER body — incluso el ejemplo oficial de los docs y los propios datos que devuelve el `GET /v2/companies`. Bug/limitación del ambiente de pruebas (los GET y POST /v2/bills/validate funcionan). No es defecto de nuestro código.

4. **Sincronizar el rango de numeración de la resolución**
   ```bash
   POST /api/factus/resolutions/:id/sync-range
   ```
   Esperado: la `Resolution` queda con `numberingRangeId != null`. Si hay más de una resolución FACTURA, sincronizar acorde al orden `created_at asc` (la primera activa gana).
   ⚠️ **BLOQUEADO por el sandbox**: `POST /v2/numbering-ranges` devuelve 500 "Ha ocurrido un error inesperado" con cualquier payload (mínimo, con resolución, NC…). Workaround usado para la prueba: asignar por BD el rango existente del sandbox (`numberingRangeId=389`, prefix SETP) a la resolución `FAC` (HABILITACION). En producción POST/PUT de rangos debe funcionar.

5. **Crear factura borrador** con un cliente:
   ```bash
   POST /api/invoices
   ```
   - Cliente con `documentType`, `documentNumber`, `dv` correcto, `legalOrganizationCode`, `municipalityCode`, `tributeCode`, `responsibilities`, email/phone/address.
   - ⚠️ La DIAN valida el documento en RUT: con una cédula ficticia la factura se valida igual pero con notificaciones `FAJ43b`/`FAJ44b` (nombre/documento no coincide) y `RUT01` (aviso); `is_validated` sigue siendo `true` y nuestro estado es `VALIDADA`. Con datos RUT reales no aparecen.
   - ✅ Hecho: cliente persona natural CC con campos DIAN completos.

6. **Emitir la factura**
   ```bash
   PATCH /api/invoices/:id/emit
   ```
   ✅ Hecho MÚLTIPLES veces (2026-09-12): `status: EMITIDA`, `dianStatus: VALIDADA`, números `SETP990018835…842`, `cufe` (~123 chars), `qrUrl`, `publicUrl`, `validatedAt` (fecha correcta, ver nota parser), `xmlPath` y `pdfPath` poblados.
   - Contrato real descubierto (`POST /v2/bills/validate` → objeto ÚNICO, NO array):
     - `items[].code_reference` (no `code`), `items[].taxes[]` = `[{code:"01",rate:"19.00",tax_amount:"28500.00"}]` (no `tax`).
     - `customer.identification` (no `identification_number`), `customer.names` (no `name`), `responsibilities` como `["O-13"]`/`["R-99-PN"]` (array de strings, no `[{code}]`).
     - `payment_details[].payment_method_code` (no `payment_method`); `amount` = total de la factura (la suma de pagos debe ser == total); en crédito `due_date` obligatoria (no `payment_due_date`).
     - `legal_organization_code` como string `"1"`/`"2"`.
   - `validated_at` llega con formato `DD-MM-YYYY hh:mm:ss AM/PM` (hora Colombia). `parseFactusDate` lo convierte correctamente a ISO (UTC-5).
   - El QR del catálogo DIAN (`/document/searchqr?...`) NO es una imagen (devuelve 302→HTML); ahora generamos un QR real localmente con la lib `qrcode` para el PDF.

7. **Descargar documentos oficiales**
   ```bash
   GET /api/invoices/:id/dian-pdf   # PDF oficial de Factus
   GET /api/invoices/:id/dian-xml   # XML oficial de DIAN
   ```
   ✅ Hecho: PDF ~70 KB (`application/pdf`) y XML UBL real (base64 decodificado). El XML se archiva decodificado desde `data.xml_base_64_encoded`.

8. **Enviar correo con la factura** (adicional)
   ```bash
   POST /api/invoices/:id/send-email
   ```
   ✅ Hecho: 201 con `messageId` de Resend real, adjunta el PDF (con QR). Asunto/HTML con bloque CUFE + estado DIAN.

9. **Verificación en la UI** (pendiente en el navegador, plan Fase 0b)
   - Detalle de la factura: el bloque DIAN muestra número oficial, estado derivado, código QR, enlace público y botones de descarga.
   - Settings: sección DIAN con los campos del emisor y el botón "Sincronizar con Factus".
   - Formulario de cliente: campos DIAN visibles.

## Notas

- Contrato REAL de Factus V2 → ver `proyectos/factus/factura-estandar.md` (actualizado 2026-09-12 con los nombres de campo reales; el payload antiguo del vault estaba mal).
- `POST /v2/bills/validate` recibe un objeto, NO `[{...}]` (el doc del vault decía que aceptaba array; es incorrecto).
- Fixes del código aplicados y desplegados (commits `2d352cf`, `b6d6032`, `5e5a1a7`, `c07c93f`, `d51c27b`, `515bb47`, `07e1c59`).
- Pendiente en sandbox: `PUT /v2/companies` y `POST /v2/numbering-ranges` están rotos en el ambiente de pruebas (no es nuestro código). Reportar a AINOVA/Factus o usar producción habilitada.
- El DV calculado por `calculateDianDv` se valida contra el sandbox.
- Si la factura ya fue enviada previamente, el flujo responde 400 con "La factura ya fue enviada a DIAN previamente".
- Todo el flujo es bloqueante: una sola factura por `POST /v2/bills/validate`.
- Importante: `admin@copigrafica.dev` fue restaurada a `TempAdmin2026!` en BD de producción para poder ejecutar el E2E (había cambiado la password).