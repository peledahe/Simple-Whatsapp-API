require('dotenv').config();
const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
const apiRoutes = require('./routes/api');

const app = express();
const port = process.env.PORT || 3000;

// Confiar en proxy inverso (Nginx / SSL) para evitar loops de redirección
app.set('trust proxy', 1);

// Enable CORS for local requests
app.use(cors());

// Middleware to parse JSON bodies
app.use(express.json({ limit: '50mb' })); // Increase limit for Base64 files
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const path = require('path');

// Serve static files from the 'uploads' and 'public' directory
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use(express.static(path.join(__dirname, '../public')));

// UI Docs setup (Swagger interactivo para desarrolladores)
const swaggerUiOptions = {
  customSiteTitle: process.env.APP_TITLE || 'WhatsApp API Documentation',
  swaggerOptions: {
    validatorUrl: null,
    defaultModelsExpandDepth: -1,
    persistAuthorization: true,
  },
};
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerUiOptions));

// Rutas del Ambiente de Administración
const adminRoutes = require('./routes/admin');
app.use('/api/admin', adminRoutes);

// Servir panel web de administración
app.use('/admin', express.static(path.join(__dirname, '../public/admin')));
app.get(/^\/admin(\/.*)?$/, (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin/index.html'));
});

const masterApiKeyAuth = require('./middleware/masterAuthMiddleware');

// Use API routes
app.use('/api', masterApiKeyAuth);
app.use('/api', apiRoutes);

// Welcome route - Landing Page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Process error handlers to prevent crashes on browser disconnects
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection (caught):', reason && reason.message ? reason.message : reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception (caught):', err && err.message ? err.message : err);
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
    console.log(`API docs available at http://localhost:${port}/api-docs (Protected)`);
});