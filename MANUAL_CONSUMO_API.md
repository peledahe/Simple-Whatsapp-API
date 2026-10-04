# Manual de Consumo de la API de WhatsApp

Guía para la integración y consumo del servicio **Simple-Whatsapp-API** manteniendo la coexistencia segura de múltiples números y sesiones independientes.

---

## 1. Arquitectura de Autenticación y Sesiones

El sistema opera bajo un esquema **Multi-Tenant** donde cada instancia de WhatsApp funciona de forma aislada:

- **`X-MASTER-KEY` (Autenticación Global)**: Valida la autorización para consumir la API. Puede provenir de las claves configuradas en el archivo `.env` o generadas para clientes en el panel `/admin`.
- **`X-API-KEY` (Identificador de Sesión)**: Identifica de forma exclusiva la sesión y el número de WhatsApp conectado. Cada sesión almacena sus credenciales en `sessions/session-<X-API-KEY>`.

---

## 2. Reglas de Oro para Proteger Conexiones Existentes

> [!CAUTION]
> **Endpoints destructivos**:
> - **NUNCA** invoques `POST /api/logout-all`: Esto destruye y borra todas las sesiones guardadas en el servidor.
> - **NO** invoques `POST /api/logout` a menos que desees desconectar y eliminar deliberadamente la sesión indicada en `X-API-KEY`.
> - **NO** reutilices un `X-API-KEY` ya asignado a una línea activa si deseas conectar un nuevo número.

---

## 3. Procedimientos de Consumo

### Escenario A: Enviar mensajes desde una sesión ya existente
*(Por ejemplo, sesiones existentes como `6524` o `1`)*

No es necesario escanear código QR ni volver a autenticar. El servidor carga automáticamente la sesión desde el disco si no se encuentra activa en memoria.

1. Realiza la petición directa a los endpoints de mensajería usando el `X-API-KEY` de dicha sesión.

---

### Escenario B: Conectar una nueva línea telefónica
*(Sin alterar ni interrumpir las sesiones previas)*

1. **Definir un identificador único**:
   Asigna un nuevo identificador descriptivo para `X-API-KEY` (ejemplo: `notificaciones_crm`, `soporte_linea2`).

2. **Obtener el código QR**:
   - **Método**: `GET`
   - **URL**: `http://<HOST>:<PORT>/api/connect/image`
   - **Cabeceras**:
     - `X-MASTER-KEY`: `<TU_MASTER_KEY>`
     - `X-API-KEY`: `<NUEVO_SESSION_ID>`
   - **Respuesta**: Imagen PNG con el código QR.

3. **Vincular en WhatsApp**:
   Escanea el QR desde WhatsApp en el teléfono (Dispositivos vinculados > Vincular un dispositivo). La sesión quedará guardada de forma persistente e independiente.

---

## 4. Endpoints Principales de Consumo

### 4.1 Enviar Mensaje de Texto
- **Método**: `POST`
- **Ruta**: `/api/send-message`
- **Headers**:
  ```http
  Content-Type: application/json
  X-MASTER-KEY: TU_MASTER_KEY
  X-API-KEY: mi_sesion_whatsapp
  ```
- **Body**:
  ```json
  {
    "to": "50212345678",
    "message": "Hola, este es un mensaje enviado vía API."
  }
  ```
- **Respuesta Exitosa (200)**:
  ```json
  {
    "success": true,
    "message": "Message sent successfully."
  }
  ```

---

### 4.2 Enviar Archivos Adjuntos (Imágenes, PDF, Documentos)
- **Método**: `POST`
- **Ruta**: `/api/send-attachment`
- **Headers**:
  ```http
  Content-Type: application/json
  X-MASTER-KEY: TU_MASTER_KEY
  X-API-KEY: mi_sesion_whatsapp
  ```
- **Body (mediante URL pública)**:
  ```json
  {
    "to": "50212345678",
    "file": "https://ejemplo.com/factura.pdf",
    "caption": "Factura adjunta de tu compra."
  }
  ```
- **Body (mediante Base64)**:
  ```json
  {
    "to": "50212345678",
    "file": "data:image/png;base64,iVBORw0KGgo...",
    "type": "image/png",
    "caption": "Comprobante de pago"
  }
  ```

---

### 4.3 Consultar Sesiones Activas
Permite auditar qué sesiones están registradas y cuáles están actualmente en memoria:
- **Método**: `GET`
- **Ruta**: `/api/active-sessions`
- **Headers**:
  ```http
  X-MASTER-KEY: TU_MASTER_KEY
  ```
- **Respuesta Exitosa (200)**:
  ```json
  {
    "success": true,
    "totalCount": 2,
    "activeMemoryCount": 2,
    "sessions": [
      { "id": "sesion_ventas", "status": "Connected" },
      { "id": "sesion_soporte", "status": "Connected" }
    ]
  }
  ```

---

## 5. Políticas de Protección Anti-Spam y Límites

El sistema cuenta con un protector automático por sesión (`spamProtector.js`) con los siguientes límites por defecto configurados en `.env`:
- **Retardo automático**: 2 segundos (`MESSAGE_DELAY_MS=2000`) entre envíos consecutivos para simular interacción humana.
- **Cadencia máxima**: 15 mensajes por minuto por sesión (`RATE_LIMIT_PER_MINUTE=15`).
- **Cuota diaria**: 500 mensajes al día por sesión (`DAILY_MESSAGE_LIMIT=500`).
- **Cuota mensual por Plan**: 2,000 msgs/mes en **Developer**, 4,000 msgs/mes en **Business**, ilimitado en **Enterprise** (o los valores configurados en Admin).

---

## 6. Recepción de Webhooks (Mensajes Entrantes)

Cuando configuras tu **Webhook URL** en el panel de administración, la API reenvía automáticamente todos los mensajes entrantes y eventos de sesión vía `POST`:

### 6.1 Payload de Mensaje Entrante (`message.received`)
```json
{
  "event": "message.received",
  "sessionId": "mi_sesion_whatsapp",
  "timestamp": "2026-10-04T18:45:00.000Z",
  "data": {
    "id": "false_50212345678@c.us_3EB0...",
    "from": "50212345678",
    "senderName": "Juan Pérez",
    "body": "Hola, solicito información",
    "type": "chat",
    "hasMedia": false,
    "isGroup": false
  }
}
```

### 6.2 Verificación de Firma HMAC (Seguridad)
Si configuraste un `webhookSecret`, cada petición HTTP POST incluirá la cabecera `X-Hub-Signature-256: sha256=<hash>`. Puedes verificar la autenticidad calculando el HMAC-SHA256 del cuerpo JSON crudo.

