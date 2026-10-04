const crypto = require('crypto');

/**
 * Servicio de Despacho de Webhooks para eventos de WhatsApp
 */
class WebhookService {
    /**
     * Envía un evento a un webhook específico de forma asíncrona.
     * @param {Object} params
     * @param {string} params.url - URL del webhook de destino
     * @param {string} [params.secret] - Secreto para firma HMAC
     * @param {string} params.event - Nombre del evento (ej. 'message.received')
     * @param {string} params.sessionId - Identificador de sesión (X-API-KEY)
     * @param {Object} params.data - Datos del evento
     * @returns {Promise<{success: boolean, status?: number, error?: string}>}
     */
    static async dispatch({ url, secret = '', event, sessionId, data }) {
        if (!url || typeof url !== 'string' || !url.startsWith('http')) {
            return { success: false, error: 'URL de webhook inválida' };
        }

        const timestamp = new Date().toISOString();
        const payload = {
            event,
            sessionId,
            timestamp,
            data
        };

        const payloadString = JSON.stringify(payload);
        const headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'Mk-WhatsApp-API-Webhook/1.0',
            'X-Webhook-Event': event,
            'X-Session-ID': sessionId || '',
            'X-Timestamp': timestamp
        };

        if (secret) {
            const signature = crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
            headers['X-Hub-Signature-256'] = `sha256=${signature}`;
            headers['X-Signature'] = signature;
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000);

            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: payloadString,
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            const isOk = response.ok;
            console.log(`[Webhook] Evento '${event}' [${sessionId}] enviado a ${url} -> HTTP ${response.status}`);
            return { success: isOk, status: response.status };
        } catch (error) {
            console.warn(`[Webhook Error] Fallo al enviar '${event}' [${sessionId}] a ${url}:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Prueba un endpoint de webhook enviando un payload de ping
     */
    static async testWebhook(url, secret = '') {
        return this.dispatch({
            url,
            secret,
            event: 'webhook.test',
            sessionId: 'test_session',
            data: {
                message: '¡Prueba de conexión de webhook de Mk WhatsApp API exitosa! 🚀',
                serverTime: new Date().toISOString()
            }
        });
    }
}

module.exports = WebhookService;
