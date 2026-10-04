const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '../../data');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const PAYMENTS_FILE = path.join(DATA_DIR, 'payments.json');
const PLANS_FILE = path.join(DATA_DIR, 'plans.json');

// Definición oficial de perfiles y capacidades por defecto
const DEFAULT_PLANS = {
    developer: {
        id: 'developer',
        name: 'Developer',
        badge: 'Desarrolladores & Pruebas',
        priceMonthly: 19,
        maxSessions: 1,
        monthlyMsgLimit: 2000,
        features: [
            '1 Sesión activa / Hasta 2,000 msgs/mes',
            'Envío de texto, imágenes y documentos',
            'Webhooks para recepción en tiempo real',
            'Documentación Swagger interactiva',
            'Soporte por correo electrónico'
        ]
    },
    business: {
        id: 'business',
        name: 'Business',
        badge: 'PyMEs y Sistemas Comerciales',
        priceMonthly: 29,
        maxSessions: 3,
        monthlyMsgLimit: 4000,
        features: [
            'Todo lo incluido en Developer',
            'Hasta 4,000 msgs/mes incluidos',
            'Hasta 3 sesiones / números conectados',
            'Envío masivo programado y encolado',
            'Soporte prioritario por WhatsApp'
        ]
    },
    enterprise: {
        id: 'enterprise',
        name: 'Enterprise',
        badge: 'Grandes Empresas & SaaS',
        priceMonthly: 59,
        maxSessions: 0, // 0 representa ilimitado
        monthlyMsgLimit: 0, // 0 representa ilimitado
        features: [
            'Sesiones y números conectados ilimitados',
            'Mensajería ilimitada mensual',
            'Alta concurrencia con balanceo de carga',
            'SLA del 99.9% de disponibilidad',
            'Despliegue On-Premise / Servidor dedicado opcional',
            'Soporte técnico y arquitectura 24/7'
        ]
    }
};

/**
 * Obtiene los planes almacenados o inicializa con los defaults
 */
const getPlans = () => {
    initDb();
    if (!fs.existsSync(PLANS_FILE)) {
        writeJson(PLANS_FILE, DEFAULT_PLANS);
        return DEFAULT_PLANS;
    }
    const plans = readJson(PLANS_FILE);
    if (!plans || typeof plans !== 'object' || Array.isArray(plans) || Object.keys(plans).length === 0) {
        writeJson(PLANS_FILE, DEFAULT_PLANS);
        return DEFAULT_PLANS;
    }
    return {
        ...DEFAULT_PLANS,
        ...plans
    };
};

/**
 * Modifica dinámicamente las tarifas y límites de un plan
 */
const updatePlan = (planId, updates = {}) => {
    const plans = getPlans();
    const id = (planId || '').toLowerCase().trim();
    if (!plans[id]) return null;

    const current = plans[id];
    const updated = {
        ...current,
        priceMonthly: updates.priceMonthly !== undefined && !isNaN(Number(updates.priceMonthly)) ? Number(updates.priceMonthly) : current.priceMonthly,
        monthlyMsgLimit: updates.monthlyMsgLimit !== undefined && !isNaN(Number(updates.monthlyMsgLimit)) ? Number(updates.monthlyMsgLimit) : current.monthlyMsgLimit,
        maxSessions: updates.maxSessions !== undefined && !isNaN(Number(updates.maxSessions)) ? Number(updates.maxSessions) : current.maxSessions,
        name: updates.name ? updates.name.trim() : current.name,
        badge: updates.badge ? updates.badge.trim() : current.badge,
        features: Array.isArray(updates.features) ? updates.features : current.features
    };

    plans[id] = updated;
    writeJson(PLANS_FILE, plans);
    return updated;
};

/**
 * Asegura que el directorio y archivos de datos existan.
 */
const initDb = () => {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(CLIENTS_FILE)) {
        fs.writeFileSync(CLIENTS_FILE, JSON.stringify([], null, 2), 'utf-8');
    }

    if (!fs.existsSync(PAYMENTS_FILE)) {
        fs.writeFileSync(PAYMENTS_FILE, JSON.stringify([], null, 2), 'utf-8');
    }
};

/**
 * Lectura segura de archivo JSON
 */
const readJson = (filePath) => {
    try {
        initDb();
        if (!fs.existsSync(filePath)) return [];
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content || '[]');
    } catch (err) {
        console.error(`Error al leer archivo JSON (${filePath}):`, err.message);
        return [];
    }
};

/**
 * Escritura atómica de archivo JSON
 */
const writeJson = (filePath, data) => {
    initDb();
    const tempPath = `${filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempPath, filePath);
};

// Generador de IDs únicos
const generateId = (prefix = 'id') => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;

// Generador seguro de API Keys
const generateApiKey = (prefix = 'mk') => `${prefix}_${crypto.randomBytes(16).toString('hex')}`;

/**
 * Normaliza y evalúa la vigencia de un cliente
 */
const computeClientStatus = (client) => {
    if (!client) return null;
    if (client.status === 'suspended') return 'suspended';

    const now = new Date();
    const validUntil = new Date(client.validUntil);

    if (isNaN(validUntil.getTime()) || now > validUntil) {
        return 'expired';
    }

    return 'active';
};

// --- MÉTODOS DE CLIENTES ---

const getAllClients = () => {
    const clients = readJson(CLIENTS_FILE);
    const plans = getPlans();
    const currentMonth = new Date().toISOString().slice(0, 7);
    // Recalcular estado de vigencia y normalizar uso mensual dinámicamente
    return clients.map(client => {
        const computedStatus = computeClientStatus(client);
        const planDetails = plans[client.plan] || plans.developer || DEFAULT_PLANS.developer;
        
        // Normalizar contador de uso del mes actual
        const clientUsage = client.usage && client.usage.month === currentMonth 
            ? client.usage 
            : { month: currentMonth, messageCount: 0 };

        return {
            ...client,
            computedStatus,
            planDetails,
            usage: clientUsage,
            webhookUrl: client.webhookUrl || '',
            webhookSecret: client.webhookSecret || ''
        };
    });
};

const getClientById = (id) => {
    const clients = getAllClients();
    return clients.find(c => c.id === id) || null;
};

const createClient = ({ name, email, phone, plan, initialDays = 30, initialApiKey, initialAppName, webhookUrl = '', webhookSecret = '' }) => {
    const clients = readJson(CLIENTS_FILE);
    const plans = getPlans();
    const planKey = (plan && plans[plan.toLowerCase()]) ? plan.toLowerCase() : 'developer';
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7);
    const validUntil = new Date(now.getTime() + (initialDays * 24 * 60 * 60 * 1000));

    const clientId = generateId('cli');
    const apiKeys = [];

    const keyString = initialApiKey && initialApiKey.trim() ? initialApiKey.trim() : generateApiKey(`mk_${planKey}`);
    const appNameString = initialAppName && initialAppName.trim() ? initialAppName.trim() : `${name} App`;

    apiKeys.push({
        id: generateId('key'),
        key: keyString,
        appName: appNameString,
        createdAt: now.toISOString(),
        isActive: true
    });

    const newClient = {
        id: clientId,
        name: name.trim(),
        email: email ? email.trim() : '',
        phone: phone ? phone.trim() : '',
        plan: planKey,
        status: 'active',
        validFrom: now.toISOString(),
        validUntil: validUntil.toISOString(),
        webhookUrl: webhookUrl ? webhookUrl.trim() : '',
        webhookSecret: webhookSecret ? webhookSecret.trim() : '',
        usage: {
            month: currentMonth,
            messageCount: 0
        },
        apiKeys,
        notes: '',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
    };

    clients.unshift(newClient);
    writeJson(CLIENTS_FILE, clients);

    return getClientById(clientId);
};

const updateClient = (id, updates) => {
    const clients = readJson(CLIENTS_FILE);
    const plans = getPlans();
    const index = clients.findIndex(c => c.id === id);
    if (index === -1) return null;

    const current = clients[index];
    const updated = {
        ...current,
        name: updates.name !== undefined ? updates.name.trim() : current.name,
        email: updates.email !== undefined ? updates.email.trim() : current.email,
        phone: updates.phone !== undefined ? updates.phone.trim() : current.phone,
        plan: (updates.plan && plans[updates.plan.toLowerCase()]) ? updates.plan.toLowerCase() : current.plan,
        status: updates.status !== undefined ? updates.status : current.status,
        validUntil: updates.validUntil !== undefined ? updates.validUntil : current.validUntil,
        webhookUrl: updates.webhookUrl !== undefined ? updates.webhookUrl.trim() : (current.webhookUrl || ''),
        webhookSecret: updates.webhookSecret !== undefined ? updates.webhookSecret.trim() : (current.webhookSecret || ''),
        notes: updates.notes !== undefined ? updates.notes : current.notes,
        updatedAt: new Date().toISOString()
    };

    clients[index] = updated;
    writeJson(CLIENTS_FILE, clients);

    return getClientById(id);
};

// Incrementa el contador de mensajes enviados para el mes actual
const incrementClientMessageUsage = (clientId) => {
    if (!clientId) return;
    const clients = readJson(CLIENTS_FILE);
    const client = clients.find(c => c.id === clientId);
    if (!client) return;

    const currentMonth = new Date().toISOString().slice(0, 7);
    if (!client.usage || client.usage.month !== currentMonth) {
        client.usage = { month: currentMonth, messageCount: 1 };
    } else {
        client.usage.messageCount = (client.usage.messageCount || 0) + 1;
    }

    writeJson(CLIENTS_FILE, clients);
};

// Valida si un cliente puede enviar mensajes según la cuota de su plan
const checkClientMessageLimit = (clientId) => {
    const client = getClientById(clientId);
    if (!client) return { allowed: true, limit: 0, currentCount: 0 };

    const plans = getPlans();
    const planDetails = client.planDetails || plans[client.plan] || plans.developer;
    const limit = planDetails.monthlyMsgLimit; // 0 representa ilimitado (Enterprise)
    const currentMonth = new Date().toISOString().slice(0, 7);
    const currentCount = (client.usage && client.usage.month === currentMonth) ? (client.usage.messageCount || 0) : 0;

    if (limit > 0 && currentCount >= limit) {
        return {
            allowed: false,
            limit,
            currentCount,
            reason: `Has alcanzado el límite mensual de tu plan ${planDetails.name} (${limit.toLocaleString()} mensajes). Contacta a tu administrador para ampliar tu plan o cuota.`
        };
    }

    return { allowed: true, limit, currentCount };
};

// Encuentra el webhook configurado para un cliente o sesión
const getClientWebhook = (clientIdOrSession) => {
    if (!clientIdOrSession) {
        return { url: process.env.GLOBAL_WEBHOOK_URL || '', secret: process.env.GLOBAL_WEBHOOK_SECRET || '' };
    }

    const clients = getAllClients();
    // 1. Buscar por ID de cliente directo
    let found = clients.find(c => c.id === clientIdOrSession);
    
    // 2. Si no, buscar por API Key o Session ID asociada
    if (!found) {
        found = clients.find(c => c.apiKeys && c.apiKeys.some(k => k.key === clientIdOrSession || k.id === clientIdOrSession));
    }

    if (found && found.webhookUrl) {
        return {
            url: found.webhookUrl,
            secret: found.webhookSecret || '',
            client: found
        };
    }

    // Fallback al webhook global si existe
    if (process.env.GLOBAL_WEBHOOK_URL) {
        return {
            url: process.env.GLOBAL_WEBHOOK_URL,
            secret: process.env.GLOBAL_WEBHOOK_SECRET || '',
            client: found || null
        };
    }

    return { url: '', secret: '', client: found || null };
};

const deleteClient = (id) => {
    let clients = readJson(CLIENTS_FILE);
    const initialLen = clients.length;
    clients = clients.filter(c => c.id !== id);
    if (clients.length === initialLen) return false;

    writeJson(CLIENTS_FILE, clients);
    return true;
};

// --- GESTIÓN DE API KEYS POR CLIENTE ---

const addApiKeyToClient = (clientId, { key, appName }) => {
    const clients = readJson(CLIENTS_FILE);
    const client = clients.find(c => c.id === clientId);
    if (!client) return null;

    const keyString = key && key.trim() ? key.trim() : generateApiKey(`mk_${client.plan}`);
    const appNameString = appName && appName.trim() ? appName.trim() : `${client.name} App`;

    const newKeyObj = {
        id: generateId('key'),
        key: keyString,
        appName: appNameString,
        createdAt: new Date().toISOString(),
        isActive: true
    };

    client.apiKeys = client.apiKeys || [];
    client.apiKeys.push(newKeyObj);
    client.updatedAt = new Date().toISOString();

    writeJson(CLIENTS_FILE, clients);
    return newKeyObj;
};

const removeApiKeyFromClient = (clientId, keyId) => {
    const clients = readJson(CLIENTS_FILE);
    const client = clients.find(c => c.id === clientId);
    if (!client || !client.apiKeys) return false;

    const initialLen = client.apiKeys.length;
    client.apiKeys = client.apiKeys.filter(k => k.id !== keyId && k.key !== keyId);
    if (client.apiKeys.length === initialLen) return false;

    client.updatedAt = new Date().toISOString();
    writeJson(CLIENTS_FILE, clients);
    return true;
};

const toggleApiKeyStatus = (clientId, keyId) => {
    const clients = readJson(CLIENTS_FILE);
    const client = clients.find(c => c.id === clientId);
    if (!client || !client.apiKeys) return null;

    const targetKey = client.apiKeys.find(k => k.id === keyId || k.key === keyId);
    if (!targetKey) return null;

    targetKey.isActive = !targetKey.isActive;
    client.updatedAt = new Date().toISOString();
    writeJson(CLIENTS_FILE, clients);
    return targetKey;
};

// --- GESTIÓN DE PAGOS Y EXTENSIÓN DE VIGENCIA ---

const getAllPayments = () => {
    return readJson(PAYMENTS_FILE);
};

const getPaymentsByClient = (clientId) => {
    const payments = getAllPayments();
    return payments.filter(p => p.clientId === clientId);
};

const recordPayment = ({ clientId, amount, periodMonths = 1, reference = '', notes = '' }) => {
    const clients = readJson(CLIENTS_FILE);
    const client = clients.find(c => c.id === clientId);
    if (!client) throw new Error('Cliente no encontrado');

    const plans = getPlans();
    const planDetails = plans[client.plan] || plans.developer;
    const defaultMonthlyPrice = planDetails ? planDetails.priceMonthly : 19;

    const now = new Date();
    const currentValidUntil = new Date(client.validUntil);
    // Si la vigencia actual ya expiró, extendemos a partir de hoy. Si sigue vigente, sumamos sobre la fecha existente.
    const baseDate = (!isNaN(currentValidUntil.getTime()) && currentValidUntil > now) ? currentValidUntil : now;

    const addedDays = Math.round(Number(periodMonths) * 30);
    const newValidUntil = new Date(baseDate.getTime() + (addedDays * 24 * 60 * 60 * 1000));

    // Actualizar vigencia y estado en el cliente
    client.validUntil = newValidUntil.toISOString();
    if (client.status === 'expired' || client.status === 'suspended') {
        client.status = 'active';
    }
    client.updatedAt = now.toISOString();
    writeJson(CLIENTS_FILE, clients);

    // Registrar comprobante de pago
    const payments = readJson(PAYMENTS_FILE);
    const paymentRecord = {
        id: generateId('pay'),
        clientId: client.id,
        clientName: client.name,
        plan: client.plan,
        amount: Number(amount) || defaultMonthlyPrice,
        currency: 'USD',
        periodMonths: Number(periodMonths),
        paymentDate: now.toISOString(),
        validUntilResult: newValidUntil.toISOString(),
        reference: reference.trim(),
        notes: notes.trim()
    };

    payments.unshift(paymentRecord);
    writeJson(PAYMENTS_FILE, payments);

    return {
        payment: paymentRecord,
        updatedClient: getClientById(clientId)
    };
};

// --- VALIDACIÓN RÁPIDA DE API KEYS PARA EL GATEWAY ---

/**
 * Busca si una clave pertenece a un cliente registrado y valida su vigencia.
 * Devuelve { isValid, client, keyObj, reason }
 */
const validateRegisteredApiKey = (searchKey) => {
    if (!searchKey) return { isValid: false, reason: 'Key no proporcionada' };

    const clients = getAllClients();
    for (const client of clients) {
        if (!client.apiKeys || !Array.isArray(client.apiKeys)) continue;
        const matchingKey = client.apiKeys.find(k => k.key === searchKey);
        if (matchingKey) {
            if (!matchingKey.isActive) {
                return {
                    isValid: false,
                    client,
                    keyObj: matchingKey,
                    reason: 'La clave de API ha sido deshabilitada'
                };
            }

            if (client.status === 'suspended') {
                return {
                    isValid: false,
                    client,
                    keyObj: matchingKey,
                    reason: 'La cuenta del cliente se encuentra suspendida'
                };
            }

            const computedStatus = computeClientStatus(client);
            if (computedStatus === 'expired') {
                return {
                    isValid: false,
                    client,
                    keyObj: matchingKey,
                    reason: `La cuenta de ${client.name} ha expirado. Por favor renueva la suscripción.`
                };
            }

            return {
                isValid: true,
                client,
                keyObj: matchingKey,
                appName: matchingKey.appName || client.name
            };
        }
    }

    return { isValid: false, reason: 'Clave no encontrada en base de clientes registrados' };
};

/**
 * Resolves the application name for a given sessionId (API Key).
 * @param {string} sessionId
 * @returns {string} The application name or default device name.
 */
const getAppNameForSession = (sessionId) => {
    if (!sessionId) return process.env.WHATSAPP_DEVICE_NAME || 'Mk-WAapi';

    // 1. Check registered clients in DB
    const clients = getAllClients();
    for (const client of clients) {
        if (client.apiKeys && Array.isArray(client.apiKeys)) {
            const keyObj = client.apiKeys.find(k => k.key === sessionId);
            if (keyObj && keyObj.appName) {
                return keyObj.appName.trim();
            }
        }
    }

    // 2. Check MASTER_API_KEYS from .env format: key1:AppName1,key2:AppName2
    const masterKeysEnv = process.env.MASTER_API_KEYS || '';
    if (masterKeysEnv) {
        const pairs = masterKeysEnv.split(',').map(p => p.trim()).filter(Boolean);
        for (const pair of pairs) {
            const [key, app] = pair.split(':').map(s => s ? s.trim() : '');
            if (key === sessionId && app) {
                return app.trim();
            }
        }
    }

    return process.env.WHATSAPP_DEVICE_NAME || 'Mk-WAapi';
};

module.exports = {
    DEFAULT_PLANS,
    getPlans,
    updatePlan,
    get PLAN_DEFINITIONS() { return getPlans(); },
    generateApiKey,
    getAllClients,
    getClientById,
    createClient,
    updateClient,
    deleteClient,
    addApiKeyToClient,
    removeApiKeyFromClient,
    toggleApiKeyStatus,
    getAllPayments,
    getPaymentsByClient,
    recordPayment,
    validateRegisteredApiKey,
    incrementClientMessageUsage,
    checkClientMessageLimit,
    getClientWebhook,
    getAppNameForSession
};
