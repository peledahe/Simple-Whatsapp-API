require('dotenv').config();
const crypto = require('crypto');
const dbService = require('../services/dbService');

// Secret para firma de tokens de administración
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'mk_admin_secret_key_2026_supersecure';
const ADMIN_USER = (process.env.ADMIN_USER || 'merke').trim();
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || process.env.DOCS_PASSWORD || 'Chimpanzee24.gt').trim();

/**
 * Genera un token firmado con tiempo de expiración (24 horas)
 */
const generateAdminToken = (username) => {
    const expiresAt = Date.now() + (24 * 60 * 60 * 1000);
    const payload = `${username}:${expiresAt}`;
    const signature = crypto.createHmac('sha256', ADMIN_SECRET).update(payload).digest('hex');
    return Buffer.from(`${payload}:${signature}`).toString('base64');
};

/**
 * Valida un token firmado
 */
const verifyAdminToken = (token) => {
    try {
        if (!token) return false;
        const decoded = Buffer.from(token, 'base64').toString('utf-8');
        const parts = decoded.split(':');
        if (parts.length !== 3) return false;

        const [username, expiresAtStr, signature] = parts;
        const expiresAt = parseInt(expiresAtStr, 10);

        if (username !== ADMIN_USER) return false;
        if (Date.now() > expiresAt) return false;

        const expectedSig = crypto.createHmac('sha256', ADMIN_SECRET).update(`${username}:${expiresAtStr}`).digest('hex');
        return signature === expectedSig;
    } catch (err) {
        return false;
    }
};

/**
 * Middleware para proteger rutas de administración
 */
const requireAdminAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    } else if (req.headers['x-admin-token']) {
        token = req.headers['x-admin-token'];
    }

    if (!token || !verifyAdminToken(token)) {
        return res.status(401).json({ success: false, error: 'Sesión de administración no válida o expirada' });
    }

    req.adminUser = ADMIN_USER;
    next();
};

// --- HANDLERS ---

const login = (req, res) => {
    const { username, password } = req.body || {};

    if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Usuario y contraseña requeridos' });
    }

    if (username.trim() === ADMIN_USER && password.trim() === ADMIN_PASSWORD) {
        const token = generateAdminToken(username.trim());
        return res.json({
            success: true,
            token,
            user: { username: ADMIN_USER }
        });
    }

    return res.status(401).json({ success: false, error: 'Credenciales de administración incorrectas' });
};

const checkSession = (req, res) => {
    res.json({ success: true, user: { username: ADMIN_USER } });
};

const getPlans = (req, res) => {
    res.json({ success: true, plans: dbService.getPlans() });
};

const updatePlan = (req, res) => {
    const { id } = req.params;
    const { priceMonthly, monthlyMsgLimit, maxSessions, name, badge, features } = req.body || {};

    const updated = dbService.updatePlan(id, {
        priceMonthly,
        monthlyMsgLimit,
        maxSessions,
        name,
        badge,
        features
    });

    if (!updated) {
        return res.status(404).json({ success: false, error: 'Perfil de plan no encontrado' });
    }

    res.json({
        success: true,
        message: `Plan "${updated.name}" actualizado exitosamente`,
        plan: updated,
        plans: dbService.getPlans()
    });
};

const getDashboardStats = (req, res) => {
    const clients = dbService.getAllClients();
    const payments = dbService.getAllPayments();

    const now = new Date();
    const next7Days = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    let activeCount = 0;
    let expiringSoonCount = 0;
    let expiredCount = 0;
    let suspendedCount = 0;
    let totalKeysCount = 0;

    clients.forEach(c => {
        const status = c.computedStatus;
        if (status === 'active') activeCount++;
        else if (status === 'expired') expiredCount++;
        else if (status === 'suspended') suspendedCount++;

        // Próximos a vencer en 7 días
        const validUntil = new Date(c.validUntil);
        if (status === 'active' && validUntil <= next7Days) {
            expiringSoonCount++;
        }

        if (c.apiKeys && Array.isArray(c.apiKeys)) {
            totalKeysCount += c.apiKeys.length;
        }
    });

    // Ingresos del mes actual
    const monthlyIncome = payments.reduce((sum, p) => {
        const pDate = new Date(p.paymentDate);
        if (pDate.getMonth() === currentMonth && pDate.getFullYear() === currentYear) {
            return sum + (Number(p.amount) || 0);
        }
        return sum;
    }, 0);

    const totalIncome = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    res.json({
        success: true,
        stats: {
            totalClients: clients.length,
            activeCount,
            expiringSoonCount,
            expiredCount,
            suspendedCount,
            totalKeysCount,
            monthlyIncome,
            totalIncome
        }
    });
};

const getClients = (req, res) => {
    const clients = dbService.getAllClients();
    res.json({ success: true, clients });
};

const getClient = (req, res) => {
    const { id } = req.params;
    const client = dbService.getClientById(id);
    if (!client) {
        return res.status(404).json({ success: false, error: 'Cliente no encontrado' });
    }
    const payments = dbService.getPaymentsByClient(id);
    res.json({ success: true, client, payments });
};

const WebhookService = require('../services/webhookService');

const createClient = (req, res) => {
    const { name, email, phone, plan, initialDays, initialApiKey, initialAppName, webhookUrl, webhookSecret } = req.body || {};

    if (!name || !name.trim()) {
        return res.status(400).json({ success: false, error: 'El nombre del cliente es obligatorio' });
    }

    try {
        const client = dbService.createClient({
            name,
            email,
            phone,
            plan,
            initialDays: Number(initialDays) || 30,
            initialApiKey,
            initialAppName,
            webhookUrl,
            webhookSecret
        });

        // Registrar pago inicial correspondiente al mes si se desea
        const planDef = dbService.PLAN_DEFINITIONS[client.plan] || dbService.PLAN_DEFINITIONS.developer;
        dbService.recordPayment({
            clientId: client.id,
            amount: planDef.priceMonthly,
            periodMonths: 1,
            reference: 'PAGO-INICIAL',
            notes: `Activación inicial plan ${planDef.name}`
        });

        const refreshedClient = dbService.getClientById(client.id);
        res.status(201).json({ success: true, client: refreshedClient, message: 'Cliente registrado exitosamente' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

const updateClient = (req, res) => {
    const { id } = req.params;
    const updates = req.body || {};

    const updated = dbService.updateClient(id, updates);
    if (!updated) {
        return res.status(404).json({ success: false, error: 'Cliente no encontrado' });
    }

    res.json({ success: true, client: updated, message: 'Cliente actualizado correctamente' });
};

const testWebhook = async (req, res) => {
    const { id } = req.params;
    const client = dbService.getClientById(id);
    if (!client) {
        return res.status(404).json({ success: false, error: 'Cliente no encontrado' });
    }

    const webhookUrl = (req.body && req.body.webhookUrl) ? req.body.webhookUrl : client.webhookUrl;
    const webhookSecret = (req.body && req.body.webhookSecret !== undefined) ? req.body.webhookSecret : client.webhookSecret;

    if (!webhookUrl) {
        return res.status(400).json({ success: false, error: 'El cliente no tiene una URL de webhook configurada' });
    }

    const result = await WebhookService.testWebhook(webhookUrl, webhookSecret);
    if (result.success) {
        return res.json({
            success: true,
            status: result.status,
            message: `¡Webhook probado con éxito! (HTTP ${result.status})`
        });
    } else {
        return res.status(400).json({
            success: false,
            error: `Fallo al contactar webhook: ${result.error || 'Respuesta no exitosa'}`
        });
    }
};

const deleteClient = (req, res) => {
    const { id } = req.params;
    const deleted = dbService.deleteClient(id);
    if (!deleted) {
        return res.status(404).json({ success: false, error: 'Cliente no encontrado' });
    }
    res.json({ success: true, message: 'Cliente eliminado correctamente' });
};

const addApiKey = (req, res) => {
    const { id } = req.params;
    const { key, appName } = req.body || {};

    const newKey = dbService.addApiKeyToClient(id, { key, appName });
    if (!newKey) {
        return res.status(404).json({ success: false, error: 'Cliente no encontrado' });
    }

    res.status(201).json({ success: true, apiKey: newKey, message: 'Clave de API vinculada correctamente' });
};

const removeApiKey = (req, res) => {
    const { id, keyId } = req.params;
    const removed = dbService.removeApiKeyFromClient(id, keyId);
    if (!removed) {
        return res.status(404).json({ success: false, error: 'Clave no encontrada o cliente inexistente' });
    }
    res.json({ success: true, message: 'Clave de API eliminada' });
};

const toggleApiKey = (req, res) => {
    const { id, keyId } = req.params;
    const toggled = dbService.toggleApiKeyStatus(id, keyId);
    if (!toggled) {
        return res.status(404).json({ success: false, error: 'Clave no encontrada o cliente inexistente' });
    }
    res.json({ success: true, apiKey: toggled, message: `Clave ${toggled.isActive ? 'activada' : 'desactivada'}` });
};

const generateRandomKey = (req, res) => {
    const { prefix } = req.query;
    const key = dbService.generateApiKey(prefix || 'mk');
    res.json({ success: true, key });
};

const recordPayment = (req, res) => {
    const { clientId, amount, periodMonths, reference, notes } = req.body || {};

    if (!clientId) {
        return res.status(400).json({ success: false, error: 'El ID del cliente es requerido' });
    }

    try {
        const result = dbService.recordPayment({
            clientId,
            amount,
            periodMonths: Number(periodMonths) || 1,
            reference: reference || '',
            notes: notes || ''
        });

        res.json({
            success: true,
            payment: result.payment,
            client: result.updatedClient,
            message: `Pago registrado y vigencia extendida exitosamente hasta el ${new Date(result.updatedClient.validUntil).toLocaleDateString()}`
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

const getPayments = (req, res) => {
    const payments = dbService.getAllPayments();
    res.json({ success: true, payments });
};

const sessionManager = require('../services/sessionManager');
const qrcode = require('qrcode');

const getSessions = (req, res) => {
    try {
        const data = sessionManager.listSessions();
        const clients = dbService.getAllClients();
        
        // Mapear cada sesión con el cliente y aplicación correspondiente
        const enrichedSessions = (data.sessions || []).map(s => {
            let matchedClient = null;
            let matchedAppName = null;

            for (const client of clients) {
                if (client.apiKeys && Array.isArray(client.apiKeys)) {
                    const foundKey = client.apiKeys.find(k => k.key === s.sessionId);
                    if (foundKey) {
                        matchedClient = {
                            id: client.id,
                            name: client.name,
                            plan: client.plan,
                            status: client.computedStatus
                        };
                        matchedAppName = foundKey.appName || 'App';
                        break;
                    }
                }
            }

            return {
                ...s,
                client: matchedClient,
                appName: matchedAppName
            };
        });

        res.json({
            success: true,
            totalCount: data.totalCount,
            activeMemoryCount: data.activeMemoryCount,
            sessions: enrichedSessions
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

const cleanupSessions = async (req, res) => {
    try {
        const days = parseFloat(req.body ? req.body.days : 7) || 7;
        const result = await sessionManager.cleanInactiveSessions(days);
        res.json({
            success: true,
            message: `Se limpiaron ${result.cleanedCount} sesión(es) inactivas con más de ${result.thresholdDays} días sin uso.`,
            cleanedCount: result.cleanedCount,
            cleanedSessions: result.cleanedSessions,
            thresholdDays: result.thresholdDays
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

const disconnectSession = async (req, res) => {
    try {
        const { sessionId } = req.params;
        if (!sessionId) {
            return res.status(400).json({ success: false, error: 'Identificador de sesión requerido' });
        }
        await sessionManager.destroySession(sessionId);
        res.json({
            success: true,
            message: `Sesión ${sessionId} desconectada y liberada exitosamente.`
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

const getSessionQr = async (req, res) => {
    try {
        const { sessionId } = req.params;
        if (!sessionId) {
            return res.status(400).json({ success: false, error: 'Identificador de sesión requerido' });
        }
        const sessionState = await sessionManager.waitForSession(sessionId, 12000);
        
        let qrDataUrl = null;
        if (sessionState.qrCode) {
            qrDataUrl = await qrcode.toDataURL(sessionState.qrCode);
        }

        res.json({
            success: true,
            status: sessionState.status,
            qrCode: sessionState.qrCode,
            qrDataUrl
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

const testSendMessage = async (req, res) => {
    try {
        const { sessionId, to, message } = req.body || {};
        if (!sessionId || !to || !message) {
            return res.status(400).json({ success: false, error: 'La sesión (clave), el número destino y el mensaje son requeridos.' });
        }

        await sessionManager.sendMessage(sessionId, to, message);
        res.json({
            success: true,
            message: `¡Mensaje enviado exitosamente a ${to}!`
        });
    } catch (err) {
        res.status(400).json({
            success: false,
            error: err.message || 'Error al enviar el mensaje de prueba'
        });
    }
};

const fs = require('fs');
const path = require('path');

const getAuthStats = (req, res) => {
    try {
        const clients = dbService.getAllClients();
        const sessionData = sessionManager.listSessions();

        // 1. Métricas de Claves de API registradas
        let totalApiKeys = 0;
        let activeApiKeys = 0;
        let inactiveApiKeys = 0;
        const appKeysBreakdown = [];

        clients.forEach(c => {
            if (c.apiKeys && Array.isArray(c.apiKeys)) {
                c.apiKeys.forEach(k => {
                    totalApiKeys++;
                    if (k.isActive && c.computedStatus === 'active') {
                        activeApiKeys++;
                    } else {
                        inactiveApiKeys++;
                    }
                    appKeysBreakdown.push({
                        clientName: c.name,
                        appName: k.appName || 'App',
                        keyMasked: `${k.key.substring(0, 4)}...${k.key.substring(k.key.length - 3)}`,
                        isActive: k.isActive && c.computedStatus === 'active',
                        plan: c.plan
                    });
                });
            }
        });

        // 2. Métricas de Estado de Autenticación de Sesiones WhatsApp
        const sessions = sessionData.sessions || [];
        const authenticatedCount = sessions.filter(s => s.status === 'Connected' || s.status === 'Ready').length;
        const waitingQrCount = sessions.filter(s => s.status === 'QR Code Generated' || s.status === 'Initializing').length;
        const storedOfflineCount = sessions.filter(s => !s.inMemory || s.status.includes('Stored') || s.status === 'Disconnected').length;

        // 3. Métricas de Registros de Acceso / Intentos de Autenticación
        let totalLoggedRequests = 0;
        let authorizedRequests = 0;
        let unauthorizedRequests = 0;
        const recentAuthEvents = [];

        const logsDir = './logs';
        if (fs.existsSync(logsDir)) {
            const logFiles = fs.readdirSync(logsDir).filter(f => f.startsWith('access-')).sort().reverse();
            // Analizar el archivo más reciente o los 2 más recientes
            const filesToRead = logFiles.slice(0, 2);
            for (const file of filesToRead) {
                try {
                    const content = fs.readFileSync(path.join(logsDir, file), 'utf8');
                    const lines = content.split('\n').filter(l => l.trim().length > 0);
                    for (const line of lines) {
                        totalLoggedRequests++;
                        if (line.includes('Status: 200')) {
                            authorizedRequests++;
                        } else if (line.includes('Status: 401') || line.includes('Status: 403')) {
                            unauthorizedRequests++;
                        }
                    }
                    // Obtener los últimos 10 eventos
                    const lastLines = lines.slice(-10).reverse();
                    for (const l of lastLines) {
                        recentAuthEvents.push(l);
                    }
                } catch (readErr) {}
            }
        }

        res.json({
            success: true,
            authStats: {
                apiKeys: {
                    total: totalApiKeys,
                    active: activeApiKeys,
                    inactive: inactiveApiKeys,
                    keys: appKeysBreakdown
                },
                whatsappSessions: {
                    total: sessionData.totalCount || sessions.length,
                    authenticated: authenticatedCount,
                    waitingQr: waitingQrCount,
                    storedOffline: storedOfflineCount
                },
                trafficAudit: {
                    totalLogged: totalLoggedRequests,
                    authorized: authorizedRequests,
                    unauthorized: unauthorizedRequests,
                    successRatePercent: totalLoggedRequests > 0 ? Math.round((authorizedRequests / totalLoggedRequests) * 100) : 100,
                    recentEvents: recentAuthEvents.slice(0, 8)
                }
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

module.exports = {
    requireAdminAuth,
    login,
    checkSession,
    getPlans,
    getDashboardStats,
    getClients,
    getClient,
    createClient,
    updateClient,
    deleteClient,
    addApiKey,
    removeApiKey,
    toggleApiKey,
    generateRandomKey,
    recordPayment,
    getPayments,
    testWebhook,
    updatePlan,
    getSessions,
    cleanupSessions,
    disconnectSession,
    getSessionQr,
    testSendMessage,
    getAuthStats
};
