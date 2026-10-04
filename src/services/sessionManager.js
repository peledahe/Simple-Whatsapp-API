const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { LoadUtils } = require('whatsapp-web.js/src/util/Injected/Utils');
const { ExposeStore } = require('whatsapp-web.js/src/util/Injected/Store');
const qrcode = require('qrcode');
const fs = require('fs');

// Path to the sessions directory
const SESSIONS_DIR = './sessions';

// Ensure the sessions directory exists
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// In-memory store for WhatsApp clients and their statuses
const sessions = new Map();

const WebhookService = require('./webhookService');
const { getClientWebhook, checkClientMessageLimit, incrementClientMessageUsage, getAppNameForSession } = require('./dbService');

/**
 * Initializes or retrieves a WhatsApp client for a given session ID.
 * @param {string} sessionId - The unique identifier for the session.
 * @returns {Client} The WhatsApp client instance.
 */
const initializeClient = (sessionId) => {
    if (sessions.has(sessionId) && sessions.get(sessionId).client) {
        return sessions.get(sessionId);
    }

    const appName = getAppNameForSession(sessionId);
    console.log(`Initializing WhatsApp client for session: ${sessionId} (App: ${appName})`);
    const sessionDataPath = `${SESSIONS_DIR}/session-${sessionId}`;

    const defaultUserAgent = process.env.WHATSAPP_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
    const browserName = process.env.WHATSAPP_BROWSER_NAME || 'Google Chrome';

    const client = new Client({
        authStrategy: new LocalAuth({ dataPath: sessionDataPath }),
        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html'
        },
        userAgent: defaultUserAgent,
        deviceName: appName,
        browserName: browserName,
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                `--user-agent=${defaultUserAgent}`
            ]
        }
    });

    const session = {
        id: sessionId,
        client: client,
        appName: appName,
        qrCode: null,
        status: 'Initializing',
        isReady: false
    };
    sessions.set(sessionId, session);

    client.on('qr', (qr) => {
        console.log(`QR code received for session: ${sessionId} (Device: ${appName})`);
        session.qrCode = qr;
        session.status = 'QR Code Generated';
        session.isReady = false;

        // Inyectar nombre de dispositivo personalizado antes de que el celular procese el emparejamiento
        if (client.pupPage && !client.pupPage.isClosed()) {
            client.pupPage.evaluate((name) => {
                try {
                    if (window.AuthStore && window.AuthStore.RegistrationUtils) {
                        window.AuthStore.RegistrationUtils.DEVICE_PLATFORM = name;
                    }
                    if (typeof window.require !== 'undefined') {
                        try {
                            const reg = window.require('WAWebCompanionRegClientUtils');
                            if (reg) reg.DEVICE_PLATFORM = name;
                        } catch (e) {}
                        try {
                            const b = window.require('WAWebMiscBrowserUtils');
                            if (b && b.info) {
                                const orig = b.info;
                                b.info = () => ({ ...orig(), os: name, name: 'Google Chrome' });
                            }
                        } catch (e) {}
                    }
                } catch (e) {}
            }, appName).catch(() => {});
        }

        // Disparar evento de webhook si está configurado
        const webhook = getClientWebhook(sessionId);
        if (webhook && webhook.url) {
            WebhookService.dispatch({
                url: webhook.url,
                secret: webhook.secret,
                event: 'session.qr',
                sessionId,
                data: { status: 'QR Code Generated', qr, timestamp: new Date().toISOString() }
            }).catch(() => {});
        }
    });

    client.on('ready', () => {
        console.log(`WhatsApp client is ready for session: ${sessionId}`);
        session.qrCode = null;
        session.status = 'Connected';
        session.isReady = true;

        // Disparar evento de webhook si está configurado
        const webhook = getClientWebhook(sessionId);
        if (webhook && webhook.url) {
            WebhookService.dispatch({
                url: webhook.url,
                secret: webhook.secret,
                event: 'session.ready',
                sessionId,
                data: { status: 'Connected', timestamp: new Date().toISOString() }
            }).catch(() => {});
        }
    });

    client.on('authenticated', () => {
        console.log(`Authentication successful for session: ${sessionId}, syncing WhatsApp chats...`);
        session.status = 'Authenticated';
        session.isReady = false;

        // Detector proactivo: no esperar indefinidamente si el evento 'ready' de puppeteer se retrasa
        let syncAttempts = 0;
        const syncInterval = setInterval(async () => {
            syncAttempts++;
            if (session.isReady || session.status === 'Connected' || syncAttempts > 45) {
                clearInterval(syncInterval);
                return;
            }
            try {
                if (client.pupPage && !client.pupPage.isClosed()) {
                    const isFullyInjected = await client.pupPage.evaluate(() => {
                        const hasStore = typeof window.Store !== 'undefined' && typeof window.Store.Chat !== 'undefined';
                        const hasWWebJS = typeof window.WWebJS !== 'undefined' && typeof window.WWebJS.getChat === 'function';
                        return hasStore && hasWWebJS;
                    }).catch(() => false);

                    if (isFullyInjected) {
                        console.log(`[Proactive Ready] WhatsApp session ${sessionId} is connected and modules (WWebJS/Store) are ready.`);
                        session.status = 'Connected';
                        session.isReady = true;
                        session.qrCode = null;
                        clearInterval(syncInterval);

                        const webhook = getClientWebhook(sessionId);
                        if (webhook && webhook.url) {
                            WebhookService.dispatch({
                                url: webhook.url,
                                secret: webhook.secret,
                                event: 'session.ready',
                                sessionId,
                                data: { status: 'Connected', timestamp: new Date().toISOString() }
                            }).catch(() => {});
                        }
                    }
                }
            } catch (err) {
                // Ignore transient evaluation errors during sync
            }
        }, 1200);
    });

    // Escuchar mensajes entrantes y despacharlos vía Webhook
    client.on('message', async (msg) => {
        // Ignorar estados efímeros
        if (msg.isStatus || (msg.from && msg.from.includes('status@broadcast'))) return;

        try {
            const webhook = getClientWebhook(sessionId);
            if (webhook && webhook.url) {
                let mediaPayload = null;
                if (msg.hasMedia) {
                    try {
                        const downloaded = await msg.downloadMedia();
                        if (downloaded) {
                            mediaPayload = {
                                mimetype: downloaded.mimetype,
                                filename: downloaded.filename || 'attachment',
                                filesize: downloaded.filesize || (downloaded.data ? downloaded.data.length : 0),
                                data: (downloaded.data && downloaded.data.length < 300000) ? downloaded.data : undefined
                            };
                        }
                    } catch (mediaErr) {
                        console.warn(`[Webhook] No se pudo descargar adjunto del mensaje:`, mediaErr.message);
                    }
                }

                await WebhookService.dispatch({
                    url: webhook.url,
                    secret: webhook.secret,
                    event: 'message.received',
                    sessionId,
                    data: {
                        messageId: msg.id ? (msg.id._serialized || msg.id.id) : undefined,
                        from: msg.from,
                        to: msg.to,
                        fromMe: msg.fromMe,
                        body: msg.body || '',
                        type: msg.type,
                        hasMedia: msg.hasMedia,
                        media: mediaPayload,
                        timestamp: msg.timestamp,
                        author: msg.author || null,
                        isGroup: msg.from ? msg.from.endsWith('@g.us') : false
                    }
                });
            }
        } catch (err) {
            console.error(`[Webhook Error] Fallo al procesar mensaje entrante [${sessionId}]:`, err.message);
        }
    });

    client.on('auth_failure', (msg) => {
        console.error(`Authentication failure for session ${sessionId}:`, msg);
        session.status = 'Authentication Failure';
        sessions.delete(sessionId);
        
        const webhook = getClientWebhook(sessionId);
        if (webhook && webhook.url) {
            WebhookService.dispatch({
                url: webhook.url,
                secret: webhook.secret,
                event: 'session.auth_failure',
                sessionId,
                data: { status: 'Authentication Failure', message: msg, timestamp: new Date().toISOString() }
            }).catch(() => {});
        }

        try {
            if (fs.existsSync(sessionDataPath)) {
                fs.rmSync(sessionDataPath, { recursive: true, force: true });
            }
        } catch (err) {
            console.error(`Error deleting session dir for ${sessionId}:`, err);
        }
    });

    client.on('disconnected', async (reason) => {
        console.log(`Client for session ${sessionId} was logged out:`, reason);
        session.status = 'Disconnected';
        sessions.delete(sessionId);

        const webhook = getClientWebhook(sessionId);
        if (webhook && webhook.url) {
            WebhookService.dispatch({
                url: webhook.url,
                secret: webhook.secret,
                event: 'session.disconnected',
                sessionId,
                data: { status: 'Disconnected', reason, timestamp: new Date().toISOString() }
            }).catch(() => {});
        }

        try {
            await client.destroy();
        } catch (err) {
            // Silently ignore target closed errors during destroy
        }
        try {
            if (fs.existsSync(sessionDataPath)) {
                fs.rmSync(sessionDataPath, { recursive: true, force: true });
            }
        } catch (err) {
            console.error(`Error deleting session dir for ${sessionId}:`, err);
        }
    });

    client.initialize().catch(err => {
        console.error(`Failed to initialize client for session ${sessionId}:`, err);
        sessions.delete(sessionId);
    });

    return session;
};

/**
 * Retrieves the status of a specific session.
 * @param {string} sessionId - The session ID.
 * @returns {{status: string, qrCode?: string, id: string}}
 */
const getStatus = (sessionId) => {
    const session = sessions.get(sessionId);
    if (!session) {
        return {
            id: sessionId,
            status: 'Disconnected',
            qrCode: null
        };
    }
    return {
        id: session.id,
        status: session.status,
        qrCode: session.qrCode
    };
};

/**
 * Helper to get the correct WhatsApp serialized chat ID.
 */
const getFormattedChatId = async (client, to) => {
    let cleanNumber = to.replace(/[^0-9]/g, '');
    let formatted = `${cleanNumber}@c.us`;
    try {
        const numberDetails = await client.getNumberId(cleanNumber);
        if (numberDetails && numberDetails._serialized) {
            formatted = numberDetails._serialized;
        }
    } catch (err) {
        console.warn(`getNumberId check failed for ${to}, using ${formatted}`);
    }
    return formatted;
};

const { validateAntiSpam } = require('../utils/spamProtector');

/**
 * Injects WWebJS and Store helper functions into pupPage if missing.
 */
const injectWWebJSIfNeeded = async (client) => {
    if (!client || !client.pupPage || client.pupPage.isClosed()) return false;
    try {
        const needsInjection = await client.pupPage.evaluate(() => {
            return typeof window.WWebJS === 'undefined' || typeof window.WWebJS.getChat !== 'function';
        }).catch(() => true);

        if (needsInjection) {
            console.log('[WWebJS Injector] Inyectando módulos Store y WWebJS...');
            const hasStore = await client.pupPage.evaluate(() => typeof window.Store !== 'undefined').catch(() => false);
            if (!hasStore) {
                await client.pupPage.evaluate(ExposeStore).catch(() => {});
            }
            await client.pupPage.evaluate(LoadUtils).catch(() => {});
        }

        const isReady = await client.pupPage.evaluate(() => {
            return typeof window.WWebJS !== 'undefined' && typeof window.WWebJS.getChat === 'function';
        }).catch(() => false);

        return isReady;
    } catch (err) {
        console.warn('[WWebJS Injector] Aviso:', err.message);
        return false;
    }
};

/**
 * Ensures a session is fully initialized, ready, and WWebJS is injected.
 * Waits seamlessly up to 45 seconds while syncing so messages are delivered without premature error.
 * @param {string} sessionId
 * @param {number} timeoutMs
 * @returns {Promise<Object>} The ready session object
 */
const ensureClientReady = async (sessionId, timeoutMs = 45000) => {
    let session = sessions.get(sessionId);
    const sessionDataPath = `${SESSIONS_DIR}/session-${sessionId}`;

    if (!session && !fs.existsSync(sessionDataPath)) {
        throw new Error(`La sesión "${sessionId}" no está vinculada. Por favor escanea el código QR primero.`);
    }

    if (!session) {
        initializeClient(sessionId);
        session = sessions.get(sessionId);
    }

    const startTime = Date.now();
    while ((Date.now() - startTime) < timeoutMs) {
        session = sessions.get(sessionId);
        if (session && session.client && session.client.pupPage && !session.client.pupPage.isClosed()) {
            const isReady = await injectWWebJSIfNeeded(session.client);
            if (isReady) {
                session.isReady = true;
                session.status = 'Connected';
                session.qrCode = null;
                return session;
            }
        }
        await new Promise(r => setTimeout(r, 600));
    }

    session = sessions.get(sessionId);
    if (!session || !session.isReady) {
        if (session && (session.status === 'Authenticated' || session.status === 'Initializing' || session.status === 'Connected')) {
            throw new Error(`La sesión "${sessionId}" aún está sincronizando los módulos de WhatsApp en segundo plano. Por favor espera unos segundos más e intenta nuevamente.`);
        }
        throw new Error(`La sesión "${sessionId}" no está lista (${session ? session.status : 'Desconectada'}). Por favor verifica o escanea el código QR.`);
    }

    return session;
};

// Auto-restaurar sesiones guardadas en disco en segundo plano al arrancar el servidor
const restoreSavedSessions = () => {
    try {
        if (fs.existsSync(SESSIONS_DIR)) {
            const entries = fs.readdirSync(SESSIONS_DIR);
            for (const entry of entries) {
                if (entry.startsWith('session-')) {
                    const sessionId = entry.replace('session-', '');
                    if (sessionId && !sessions.has(sessionId)) {
                        console.log(`[Auto-Restore] Pre-cargando sesión de WhatsApp guardada: ${sessionId}...`);
                        initializeClient(sessionId);
                    }
                }
            }
        }
    } catch (err) {
        console.warn('[Auto-Restore] Error al escanear sesiones guardadas:', err.message);
    }
};

// Iniciar precarga de sesiones guardadas a los 2 segundos de iniciar
setTimeout(restoreSavedSessions, 2000);

/**
 * Sends a text message from a specific session.
 * @param {string} sessionId - The session ID.
 * @param {string} to - The recipient's phone number.
 * @param {string} message - The message to send.
 * @param {string} [clientId] - Optional client ID for monthly quota tracking.
 */
const sendMessage = async (sessionId, to, message, clientId = null) => {
    // Validar límite mensual de mensajes si hay un cliente vinculado
    if (clientId) {
        const limitCheck = checkClientMessageLimit(clientId);
        if (!limitCheck.allowed) {
            throw new Error(limitCheck.reason);
        }
    }

    const session = await ensureClientReady(sessionId);
    await injectWWebJSIfNeeded(session.client);

    // Validate anti-spam restrictions (rate limits, delays, daily quotas)
    await validateAntiSpam(sessionId);

    touchSessionActivity(sessionId);
    const chatId = await getFormattedChatId(session.client, to);
    
    try {
        await session.client.sendMessage(chatId, message, { sendSeen: false });
    } catch (sendErr) {
        if (sendErr.message && sendErr.message.includes('getChat')) {
            console.warn(`[Auto-Retry] getChat sync pending, reinyectando WWebJS y reintentando envío a ${to}...`);
            await injectWWebJSIfNeeded(session.client);
            await new Promise(r => setTimeout(r, 1500));
            await session.client.sendMessage(chatId, message, { sendSeen: false });
        } else {
            throw sendErr;
        }
    }

    if (clientId) {
        incrementClientMessageUsage(clientId);
    }

    console.log(`Message sent to ${to} (${chatId}) from session ${sessionId}`);
};

/**
 * Sends an attachment from a specific session.
 * @param {string} sessionId - The session ID.
 * @param {string} to - The recipient's phone number.
 * @param {string} file - URL to the file, local file path, or Base64 string.
 * @param {string} caption - The caption for the attachment.
 * @param {string} [type] - The MIME type, required for Base64 encoded files.
 * @param {string} [clientId] - Optional client ID for monthly quota tracking.
 */
const sendAttachment = async (sessionId, to, file, caption, type, clientId = null) => {
    // Validar límite mensual de mensajes si hay un cliente vinculado
    if (clientId) {
        const limitCheck = checkClientMessageLimit(clientId);
        if (!limitCheck.allowed) {
            throw new Error(limitCheck.reason);
        }
    }

    const session = await ensureClientReady(sessionId);
    await injectWWebJSIfNeeded(session.client);

    // Validate anti-spam restrictions (rate limits, delays, daily quotas)
    await validateAntiSpam(sessionId);

    touchSessionActivity(sessionId);

    let media;
    if (fs.existsSync(file)) {
        // Send from a local file path
        media = MessageMedia.fromFilePath(file);
    } else if (file.startsWith('http')) {
        // Send from a URL
        media = await MessageMedia.fromUrl(file, { unsafeMime: true });
    } else {
        // Send from a Base64 string
        if (!type) {
            throw new Error('The "type" parameter is required for Base64 attachments.');
        }
        const base64Data = file.includes(',') ? file.split(',')[1] : file;
        media = new MessageMedia(type, base64Data, 'file');
    }

    const chatId = await getFormattedChatId(session.client, to);
    
    try {
        await session.client.sendMessage(chatId, media, { caption, sendSeen: false });
    } catch (sendErr) {
        if (sendErr.message && sendErr.message.includes('getChat')) {
            console.warn(`[Auto-Retry] getChat sync pending, reinyectando WWebJS y reintentando adjunto a ${to}...`);
            await injectWWebJSIfNeeded(session.client);
            await new Promise(r => setTimeout(r, 1500));
            await session.client.sendMessage(chatId, media, { caption, sendSeen: false });
        } else {
            throw sendErr;
        }
    }

    if (clientId) {
        incrementClientMessageUsage(clientId);
    }

    console.log(`Attachment sent to ${to} (${chatId}) from session ${sessionId}`);
};

/**
 * Waits for a session to finish initializing (e.g. until QR code is generated or session connects).
 * @param {string} sessionId - The session ID.
 * @param {number} [timeoutMs=6000] - Max wait time in ms.
 * @returns {Promise<{status: string, qrCode?: string, id: string}>}
 */
const waitForSession = async (sessionId, timeoutMs = 6000) => {
    initializeClient(sessionId);
    const session = sessions.get(sessionId);
    if (!session) {
        return { id: sessionId, status: 'Disconnected', qrCode: null };
    }

    if (session.isReady || session.status === 'Connected') {
        return { id: sessionId, status: 'Connected', qrCode: null };
    }

    if (session.status === 'Authenticated' && session.client && session.client.pupPage && !session.client.pupPage.isClosed()) {
        try {
            const state = await session.client.getState().catch(() => null);
            const isReady = await session.client.pupPage.evaluate(() => {
                const hasStore = typeof window.Store !== 'undefined' && typeof window.Store.Chat !== 'undefined';
                const hasWWebJS = typeof window.WWebJS !== 'undefined';
                const hasChatList = document.querySelector('#side') !== null || document.querySelector('[data-testid="chat-list"]') !== null;
                return hasStore || hasWWebJS || hasChatList;
            }).catch(() => false);

            if (state === 'CONNECTED' || isReady) {
                session.status = 'Connected';
                session.isReady = true;
                session.qrCode = null;
                return { id: sessionId, status: 'Connected', qrCode: null };
            }
        } catch (e) {}
    }

    const current = getStatus(sessionId);
    if (current.status !== 'Initializing') {
        return current;
    }

    const startTime = Date.now();
    while ((Date.now() - startTime) < timeoutMs) {
        const s = getStatus(sessionId);
        if (s.status !== 'Initializing') {
            return s;
        }
        await new Promise(r => setTimeout(r, 300));
    }

    return getStatus(sessionId);
};

/**
 * Destroys a single session and removes its stored data.
 * @param {string} sessionId
 */
const destroySession = async (sessionId) => {
    let session = sessions.get(sessionId);
    const sessionDataPath = `${SESSIONS_DIR}/session-${sessionId}`;

    // If session exists on disk but not in memory, initialize it briefly to perform logout
    if (!session && fs.existsSync(sessionDataPath)) {
        session = initializeClient(sessionId);
        await waitForSession(sessionId, 10000);
    }

    if (session) {
        sessions.delete(sessionId);
        if (session.client) {
            try {
                console.log(`Unlinking WhatsApp device session: ${sessionId}...`);
                await session.client.logout();
                console.log(`WhatsApp device session ${sessionId} unlinked successfully.`);
            } catch (err) {
                console.error(`Error unlinking WhatsApp session ${sessionId}:`, err.message);
            }
            try {
                await session.client.destroy();
            } catch (err) {
                // Ignore destroy errors
            }
        }
    }

    // Wait for Puppeteer process to fully release file locks
    await new Promise((resolve) => setTimeout(resolve, 1500));

    try {
        if (fs.existsSync(sessionDataPath)) {
            fs.rmSync(sessionDataPath, { recursive: true, force: true });
        }
    } catch (err) {
        console.error(`Error removing session folder ${sessionId}:`, err);
    }
};

/**
 * Destroys all active WhatsApp sessions and clears the sessions directory.
 */
const destroyAllSessions = async () => {
    // Scan disk for offline sessions so we can unlink them as well
    if (fs.existsSync(SESSIONS_DIR)) {
        const entries = fs.readdirSync(SESSIONS_DIR);
        for (const entry of entries) {
            if (entry.startsWith('session-')) {
                const sessionId = entry.replace('session-', '');
                if (!sessions.has(sessionId)) {
                    initializeClient(sessionId);
                }
            }
        }
    }

    const activeSessions = Array.from(sessions.values());
    sessions.clear();

    for (const session of activeSessions) {
        if (session.client) {
            try {
                console.log(`Unlinking WhatsApp device session: ${session.id}...`);
                await session.client.logout();
                console.log(`WhatsApp device session ${session.id} unlinked successfully.`);
            } catch (err) {
                console.error(`Error unlinking WhatsApp session ${session.id}:`, err.message);
            }
            try {
                await session.client.destroy();
            } catch (err) {
                // Ignore destroy errors
            }
        }
    }

    // Wait for Chromium processes to shut down and release file handles
    await new Promise((resolve) => setTimeout(resolve, 1500));

    try {
        if (fs.existsSync(SESSIONS_DIR)) {
            fs.rmSync(SESSIONS_DIR, { recursive: true, force: true });
            fs.mkdirSync(SESSIONS_DIR, { recursive: true });
        }
    } catch (err) {
        console.error('Error cleaning up sessions directory:', err);
    }
};

/**
 * Updates last activity timestamp for a session.
 * @param {string} sessionId
 */
const touchSessionActivity = (sessionId) => {
    const now = Date.now();
    const session = sessions.get(sessionId);
    if (session) {
        session.lastActivity = now;
    }
    const sessionDataPath = `${SESSIONS_DIR}/session-${sessionId}`;
    if (fs.existsSync(sessionDataPath)) {
        try {
            fs.writeFileSync(`${sessionDataPath}/meta.json`, JSON.stringify({ lastActivity: now }), 'utf8');
        } catch (err) {}
    }
};

/**
 * Gets last activity timestamp for a session.
 * @param {string} sessionId
 * @returns {number}
 */
const getSessionLastActivity = (sessionId) => {
    const session = sessions.get(sessionId);
    if (session && session.lastActivity) {
        return session.lastActivity;
    }
    const metaPath = `${SESSIONS_DIR}/session-${sessionId}/meta.json`;
    if (fs.existsSync(metaPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            if (data && data.lastActivity) return data.lastActivity;
        } catch (err) {}
    }
    const sessionDataPath = `${SESSIONS_DIR}/session-${sessionId}`;
    if (fs.existsSync(sessionDataPath)) {
        try {
            const stats = fs.statSync(sessionDataPath);
            return stats.mtimeMs;
        } catch (err) {}
    }
    return Date.now();
};

/**
 * Cleans up sessions that have been inactive for more than maxInactiveDays.
 * @param {number} maxInactiveDays - Number of inactive days threshold.
 * @returns {Promise<{cleanedCount: number, cleanedSessions: string[], thresholdDays: number}>}
 */
const cleanInactiveSessions = async (maxInactiveDays) => {
    const days = parseFloat(maxInactiveDays) || 7;
    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    const allSessionIds = new Set();

    // Collect active sessions in memory
    for (const id of sessions.keys()) {
        allSessionIds.add(id);
    }

    // Collect session folders from disk
    if (fs.existsSync(SESSIONS_DIR)) {
        const entries = fs.readdirSync(SESSIONS_DIR);
        for (const entry of entries) {
            if (entry.startsWith('session-')) {
                allSessionIds.add(entry.replace('session-', ''));
            }
        }
    }

    const cleanedSessions = [];
    for (const sessionId of allSessionIds) {
        const lastActivity = getSessionLastActivity(sessionId);
        if (lastActivity < cutoffTime) {
            console.log(`Cleaning inactive session ${sessionId} (last active: ${new Date(lastActivity).toISOString()})`);
            await destroySession(sessionId);
            cleanedSessions.push(sessionId);
        }
    }

    return {
        cleanedCount: cleanedSessions.length,
        cleanedSessions,
        thresholdDays: days
    };
};

/**
 * Lists all active and stored sessions with details and counts.
 * @returns {{ totalCount: number, activeMemoryCount: number, sessions: Array<{ sessionId: string, status: string, isReady: boolean, lastActivity: string }> }}
 */
const listSessions = () => {
    const sessionMap = new Map();

    // Collect active memory sessions
    for (const [id, session] of sessions.entries()) {
        const lastActivityMs = getSessionLastActivity(id);
        const isReady = Boolean(session.isReady || session.status === 'Connected' || session.status === 'Ready');
        sessionMap.set(id, {
            sessionId: id,
            status: isReady ? 'Connected' : (session.status || 'Unknown'),
            isReady,
            inMemory: true,
            lastActivity: new Date(lastActivityMs).toISOString()
        });
    }

    // Collect sessions stored on disk that might not be loaded in memory
    if (fs.existsSync(SESSIONS_DIR)) {
        const entries = fs.readdirSync(SESSIONS_DIR);
        for (const entry of entries) {
            if (entry.startsWith('session-')) {
                const id = entry.replace('session-', '');
                if (!sessionMap.has(id)) {
                    const lastActivityMs = getSessionLastActivity(id);
                    sessionMap.set(id, {
                        sessionId: id,
                        status: 'Stored (Inactive in memory)',
                        isReady: false,
                        inMemory: false,
                        lastActivity: new Date(lastActivityMs).toISOString()
                    });
                }
            }
        }
    }

    const sessionList = Array.from(sessionMap.values());
    const activeMemoryCount = sessionList.filter(s => s.inMemory && s.isReady).length;

    return {
        totalCount: sessionList.length,
        activeMemoryCount,
        sessions: sessionList
    };
};

module.exports = {
    initializeClient,
    getStatus,
    waitForSession,
    destroySession,
    destroyAllSessions,
    cleanInactiveSessions,
    listSessions,
    touchSessionActivity,
    sendMessage,
    sendAttachment
};