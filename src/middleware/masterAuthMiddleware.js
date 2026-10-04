require('dotenv').config();
const { logAccess } = require('../utils/logger');
const { validateRegisteredApiKey } = require('../services/dbService');

/**
 * Parses configured master API keys from environment variables.
 * Returns a Map of key -> appName.
 */
const getRegisteredKeysMap = () => {
    const keyMap = new Map();

    const rawKeys = process.env.MASTER_API_KEYS;
    if (rawKeys) {
        let parsed = false;
        // Try JSON parsing
        if (rawKeys.trim().startsWith('{')) {
            try {
                const jsonObj = JSON.parse(rawKeys);
                for (const [k, v] of Object.entries(jsonObj)) {
                    keyMap.set(k.trim(), String(v).trim());
                }
                parsed = true;
            } catch (e) {}
        }
        // If not JSON, parse key:appName pairs or comma-separated list
        if (!parsed) {
            const pairs = rawKeys.split(',');
            for (const item of pairs) {
                const trimmed = item.trim();
                if (!trimmed) continue;
                if (trimmed.includes(':')) {
                    const parts = trimmed.split(':');
                    const k = parts[0].trim();
                    const app = parts.slice(1).join(':').trim();
                    if (k) keyMap.set(k, app || 'RegisteredApp');
                } else {
                    keyMap.set(trimmed, 'RegisteredApp');
                }
            }
        }
    }

    // Fallback or legacy MASTER_API_KEY support
    if (process.env.MASTER_API_KEY) {
        const legacyKey = process.env.MASTER_API_KEY.trim();
        if (!keyMap.has(legacyKey)) {
            keyMap.set(legacyKey, 'DefaultMasterApp');
        }
    }

    return keyMap;
};

/**
 * Middleware to protect all API routes with Master API keys.
 * Supports:
 * 1. Clientes registrados en el Ambiente de Administración con vigencia activa.
 * 2. Claves maestras por default en variables de entorno (.env) para aplicaciones no registradas o legacy.
 */
const masterApiKeyAuth = (req, res, next) => {
    const masterKey = req.get('X-MASTER-KEY') 
        || req.get('x-master-key')
        || (req.body ? (req.body['X-MASTER-KEY'] || req.body['x-master-key'] || req.body['master_key'] || req.body['masterKey']) : undefined)
        || (req.query ? (req.query['X-MASTER-KEY'] || req.query['x-master-key'] || req.query['master_key'] || req.query['masterKey']) : undefined);
    const ip = req.ip || req.connection.remoteAddress || 'unknown';

    if (!masterKey) {
        logAccess({
            appName: 'UNAUTHORIZED',
            keyMasked: 'NONE',
            endpoint: req.originalUrl || req.url,
            method: req.method,
            ip,
            status: 401,
            details: 'Missing Master API key'
        });
        return res.status(401).json({ error: 'Unauthorized: Missing Master API key (X-MASTER-KEY).' });
    }

    const keyMasked = `${masterKey.substring(0, Math.min(3, masterKey.length))}***`;

    // 1. Verificar si pertenece a un cliente registrado en la base de datos
    const clientValidation = validateRegisteredApiKey(masterKey);

    if (clientValidation.client) {
        // La clave existe en la base de clientes registrados
        if (!clientValidation.isValid) {
            logAccess({
                appName: clientValidation.client.name || 'CLIENT_BLOCKED',
                keyMasked,
                endpoint: req.originalUrl || req.url,
                method: req.method,
                ip,
                status: 403,
                details: clientValidation.reason
            });
            return res.status(403).json({
                error: 'Forbidden: Acceso no autorizado para esta aplicación',
                details: clientValidation.reason,
                client: clientValidation.client.name,
                status: clientValidation.client.computedStatus
            });
        }

        // Cliente registrado, activo y vigente
        req.appName = clientValidation.appName;
        req.client = clientValidation.client;
        req.isRegisteredClient = true;

        logAccess({
            appName: req.appName,
            keyMasked,
            endpoint: req.originalUrl || req.url,
            method: req.method,
            ip,
            status: 200
        });

        return next();
    }

    // 2. Fallback: Verificar si es una clave maestra por default en .env
    const envRegisteredKeys = getRegisteredKeysMap();

    if (envRegisteredKeys.has(masterKey)) {
        const appName = envRegisteredKeys.get(masterKey);
        req.appName = appName;
        req.isRegisteredClient = false;

        logAccess({
            appName,
            keyMasked,
            endpoint: req.originalUrl || req.url,
            method: req.method,
            ip,
            status: 200
        });

        return next();
    }

    // 3. Ni cliente registrado ni en .env
    logAccess({
        appName: 'UNAUTHORIZED',
        keyMasked,
        endpoint: req.originalUrl || req.url,
        method: req.method,
        ip,
        status: 401,
        details: 'Invalid Master API key'
    });

    return res.status(401).json({ error: 'Unauthorized: Invalid Master API key.' });
};

module.exports = masterApiKeyAuth;