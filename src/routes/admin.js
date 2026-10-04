const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

// Rutas públicas de admin (login y utilidades iniciales)
router.post('/login', adminController.login);
router.get('/plans', adminController.getPlans);

// Middleware de protección para todas las rutas subsecuentes
router.use(adminController.requireAdminAuth);

// Rutas protegidas de sesión y dashboard
router.get('/check-session', adminController.checkSession);
router.get('/dashboard', adminController.getDashboardStats);

// Rutas de clientes
router.get('/clients', adminController.getClients);
router.get('/clients/:id', adminController.getClient);
router.post('/clients', adminController.createClient);
router.put('/clients/:id', adminController.updateClient);
router.delete('/clients/:id', adminController.deleteClient);
router.post('/clients/:id/test-webhook', adminController.testWebhook);

// Rutas de gestión de claves por cliente
router.post('/clients/:id/keys', adminController.addApiKey);
router.delete('/clients/:id/keys/:keyId', adminController.removeApiKey);
router.patch('/clients/:id/keys/:keyId/toggle', adminController.toggleApiKey);
router.get('/generate-key', adminController.generateRandomKey);

// Rutas de pagos y vigencia
router.get('/payments', adminController.getPayments);
router.post('/payments', adminController.recordPayment);

// Rutas de configuración de planes
router.put('/plans/:id', adminController.updatePlan);

// Rutas de Sesiones y Mantenimiento de API
router.get('/sessions', adminController.getSessions);
router.post('/sessions/clean', adminController.cleanupSessions);
router.delete('/sessions/:sessionId', adminController.disconnectSession);
router.get('/sessions/:sessionId/qr', adminController.getSessionQr);
router.get('/auth-stats', adminController.getAuthStats);

// Rutas de Pruebas Rápidas de Funcionamiento
router.post('/test/send-message', adminController.testSendMessage);

module.exports = router;
