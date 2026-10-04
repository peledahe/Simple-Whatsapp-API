/**
 * Extracts the session ID (API key) from the request.
 * It checks the 'X-API-KEY' header first, then falls back to the request body.
 *
 * @param {import('express').Request} req - The Express request object.
 * @returns {string|null} The session ID or null if not found.
 */
const getSessionId = (req) => {
    const fromHeader = req.get('X-API-KEY') || req.get('x-api-key') || req.get('API-KEY') || req.get('api-key');
    if (fromHeader) {
        return fromHeader;
    }

    if (req.body) {
        const bodyKey = req.body['X-API-KEY'] || req.body['x-api-key'] || req.body['apiKey'] || req.body['key'] || req.body['session'] || req.body['sessionId'];
        if (bodyKey) return bodyKey;
    }

    if (req.query) {
        const queryKey = req.query['X-API-KEY'] || req.query['x-api-key'] || req.query['apiKey'] || req.query['key'] || req.query['session'] || req.query['sessionId'];
        if (queryKey) return queryKey;
    }

    return null;
};

module.exports = {
    getSessionId,
};