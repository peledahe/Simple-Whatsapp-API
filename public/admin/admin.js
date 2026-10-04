/**
 * Mk WhatsApp API - Admin Dashboard Logic
 * Cumple con las directrices de:
 * - Notificaciones sticky para guardado / actualización
 * - Modales de confirmación interactivos para acciones de borrado / suspensión
 */

const API_BASE = '/api/admin';
let currentToken = localStorage.getItem('mk_admin_token') || '';
let currentUser = null;
let allClients = [];
let allPayments = [];
let allPlans = {};
let activeSection = 'dashboard';

// --- UTILIDADES: NOTIFICACIONES STICKY ---

function showStickyNotification(title, message, type = 'success', duration = 5500) {
    const container = document.getElementById('stickyNotificationContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `sticky-toast ${type === 'error' ? 'toast-error' : type === 'warning' ? 'toast-warning' : ''}`;

    let icon = '✓';
    if (type === 'error') icon = '✕';
    if (type === 'warning') icon = '⚠️';

    toast.innerHTML = `
        <div class="toast-icon">${icon}</div>
        <div class="toast-content">
            <div class="toast-title">${escapeHtml(title)}</div>
            <div class="toast-message">${escapeHtml(message)}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
    `;

    container.appendChild(toast);

    // Animación de entrada
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    // Auto-cierre con temporizador
    if (duration > 0) {
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 350);
        }, duration);
    }
}

// --- UTILIDADES: MODAL DE CONFIRMACIÓN INTERACTIVO ---

let pendingConfirmAction = null;

function showConfirmModal({ title, message, confirmText = 'Sí, Continuar', danger = true, onConfirm }) {
    const modal = document.getElementById('modalConfirm');
    const titleEl = document.getElementById('confirmTitle');
    const messageEl = document.getElementById('confirmMessage');
    const btnAction = document.getElementById('btnConfirmAction');

    titleEl.textContent = title || '¿Confirmar Acción?';
    messageEl.textContent = message || '¿Deseas continuar con esta acción?';
    btnAction.textContent = confirmText;

    if (danger) {
        btnAction.className = 'btn btn-danger';
    } else {
        btnAction.className = 'btn btn-primary';
    }

    pendingConfirmAction = onConfirm;

    btnAction.onclick = () => {
        closeModal('modalConfirm');
        if (typeof pendingConfirmAction === 'function') {
            pendingConfirmAction();
        }
    };

    openModal('modalConfirm');
}

// Control general de modales
function openModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) {
        m.classList.add('show');
    }
}

function closeModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) {
        m.classList.remove('show');
    }
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function copyToClipboard(text, label = 'Elemento') {
    navigator.clipboard.writeText(text).then(() => {
        showStickyNotification('Copiado al portapapeles', `${label} copiado con éxito`, 'success', 2500);
    }).catch(() => {
        showStickyNotification('Error', 'No se pudo copiar automáticamente', 'error');
    });
}

// --- PETICIONES HTTP AUTENTICADAS ---

async function fetchAdmin(endpoint, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };

    if (currentToken) {
        headers['Authorization'] = `Bearer ${currentToken}`;
    }

    const res = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers
    });

    if (res.status === 401 && endpoint !== '/login') {
        handleLogout('Tu sesión ha expirado. Por favor ingresa de nuevo.');
        throw new Error('Sesión expirada');
    }

    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
}

// --- AUTENTICACIÓN Y SESIÓN ---

async function checkAuth() {
    if (!currentToken) {
        showLoginScreen();
        return;
    }

    try {
        const { ok, data } = await fetchAdmin('/check-session');
        if (ok && data.success) {
            currentUser = data.user;
            document.getElementById('sidebarUserName').textContent = currentUser.username || 'merke';
            showAppScreen();
            await loadInitialData();
        } else {
            showLoginScreen();
        }
    } catch (err) {
        showLoginScreen();
    }
}

function showLoginScreen() {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('adminApp').style.display = 'none';
}

function showAppScreen() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('adminApp').style.display = 'flex';
}

async function handleLogin(e) {
    e.preventDefault();
    const btn = document.getElementById('btnLoginSubmit');
    btn.disabled = true;
    btn.textContent = 'Verificando...';

    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value.trim();

    try {
        const { ok, data } = await fetchAdmin('/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });

        if (ok && data.success) {
            currentToken = data.token;
            localStorage.setItem('mk_admin_token', currentToken);
            currentUser = data.user;
            document.getElementById('sidebarUserName').textContent = currentUser.username || 'merke';
            
            showStickyNotification('Bienvenido al Panel', `Sesión iniciada correctamente como ${currentUser.username}`, 'success');
            showAppScreen();
            await loadInitialData();
        } else {
            showStickyNotification('Error de Autenticación', data.error || 'Credenciales no válidas', 'error');
        }
    } catch (err) {
        showStickyNotification('Error de Conexión', 'No se pudo conectar con el servidor de administración', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Ingresar al Panel';
    }
}

function handleLogout(msg = 'Sesión cerrada exitosamente') {
    currentToken = '';
    localStorage.removeItem('mk_admin_token');
    showLoginScreen();
    showStickyNotification('Sesión finalizada', msg, 'warning');
}

// --- NAVEGACIÓN ENTRE SECCIONES ---

function navigateSection(sectionId) {
    activeSection = sectionId;

    // Actualizar menú activo
    document.querySelectorAll('.sidebar-menu .nav-item').forEach(item => {
        if (item.getAttribute('data-section') === sectionId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // Mostrar sección correspondiente
    document.querySelectorAll('.panel-section').forEach(sec => {
        sec.classList.remove('active');
    });

    const target = document.getElementById(`section-${sectionId}`);
    if (target) target.classList.add('active');

    // Título en la barra superior
    const titles = {
        dashboard: 'Dashboard General',
        clients: 'Directorio de Clientes & Claves Maestras',
        payments: 'Control de Pagos & Vigencias',
        plans: 'Perfiles y Tarifas del Servicio',
        operations: 'Sesiones WhatsApp & Pruebas de Funcionamiento'
    };
    document.getElementById('pageHeadingTitle').textContent = titles[sectionId] || 'Panel de Administración';

    if (sectionId === 'clients') renderClientsTable(allClients);
    if (sectionId === 'payments') renderPaymentsTable(allPayments);
    if (sectionId === 'operations') loadSessionsData();
}

// --- CARGA DE DATOS ---

async function loadInitialData() {
    try {
        await Promise.all([
            loadPlans(),
            loadDashboardStats(),
            loadClients(),
            loadPayments(),
            loadSessionsData(),
            loadAuthStats()
        ]);
    } catch (err) {
        console.error('Error al cargar datos iniciales:', err);
    }
}

async function reloadCurrentData() {
    showStickyNotification('Actualizando...', 'Consultando últimos registros del sistema', 'warning', 1500);
    await loadInitialData();
    showStickyNotification('Actualizado', 'Datos sincronizados correctamente', 'success', 2000);
}

async function loadPlans() {
    const { ok, data } = await fetchAdmin('/plans');
    if (ok && data.success) {
        allPlans = data.plans || {};
        renderPlansView(allPlans);
    }
}

async function loadDashboardStats() {
    const { ok, data } = await fetchAdmin('/dashboard');
    if (ok && data.success) {
        const stats = data.stats;
        document.getElementById('statTotalClients').textContent = stats.totalClients || 0;
        document.getElementById('statActiveClients').textContent = stats.activeCount || 0;
        document.getElementById('statExpiringSoon').textContent = stats.expiringSoonCount || 0;
        document.getElementById('statExpired').textContent = stats.expiredCount || 0;
        document.getElementById('statMonthlyIncome').textContent = `$${(stats.monthlyIncome || 0).toLocaleString()} USD`;
    }
}

async function loadAuthStats() {
    try {
        const { ok, data } = await fetchAdmin('/auth-stats');
        if (ok && data.success && data.authStats) {
            const ast = data.authStats;
            
            // Claves API
            const totalKeysEl = document.getElementById('authTotalKeysVal');
            const activeKeysBadge = document.getElementById('authActiveKeysBadge');
            const inactiveKeysEl = document.getElementById('authInactiveKeysVal');
            if (totalKeysEl) totalKeysEl.textContent = ast.apiKeys.total || 0;
            if (activeKeysBadge) activeKeysBadge.textContent = `${ast.apiKeys.active || 0} Activas`;
            if (inactiveKeysEl) inactiveKeysEl.textContent = `${ast.apiKeys.inactive || 0} inactivas / pausadas`;

            // Sesiones WhatsApp
            const waConnEl = document.getElementById('authWaConnectedVal');
            const waConnBadge = document.getElementById('authWaConnectedBadge');
            const waPendEl = document.getElementById('authWaPendingVal');
            if (waConnEl) waConnEl.textContent = ast.whatsappSessions.authenticated || 0;
            if (waConnBadge) waConnBadge.textContent = `${ast.whatsappSessions.authenticated || 0} Conectadas`;
            if (waPendEl) waPendEl.textContent = `${ast.whatsappSessions.waitingQr || 0} esperando QR`;

            // Tráfico & Éxito
            const authValEl = document.getElementById('authAuthorizedVal');
            const authRateBadge = document.getElementById('authRateBadge');
            const authBlockedEl = document.getElementById('authBlockedVal');
            if (authValEl) authValEl.textContent = ast.trafficAudit.authorized || 0;
            if (authRateBadge) authRateBadge.textContent = `${ast.trafficAudit.successRatePercent}% OK`;
            if (authBlockedEl) authBlockedEl.textContent = `${ast.trafficAudit.unauthorized || 0} bloqueadas`;
        }
    } catch (err) {
        console.error('Error al cargar estadísticas de autenticación:', err);
    }
}

async function loadClients() {
    const { ok, data } = await fetchAdmin('/clients');
    if (ok && data.success) {
        allClients = data.clients || [];
        renderClientsTable(allClients);
        renderDashboardClientsTable(allClients);
        populatePaymentClientSelect();
    }
}

async function loadPayments() {
    const { ok, data } = await fetchAdmin('/payments');
    if (ok && data.success) {
        allPayments = data.payments || [];
        renderPaymentsTable(allPayments);
    }
}

// --- RENDERIZADO: DASHBOARD RESUMEN DE CLIENTES ---

function renderDashboardClientsTable(clients) {
    const tbody = document.getElementById('dashboardClientsTbody');
    if (!tbody) return;

    if (!clients || clients.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">No hay clientes registrados aún. ¡Registra el primero!</td></tr>`;
        return;
    }

    // Ordenar: primero los expirados o próximos a vencer
    const sorted = [...clients].sort((a, b) => new Date(a.validUntil) - new Date(b.validUntil)).slice(0, 6);

    tbody.innerHTML = sorted.map(c => {
        const { statusBadge, daysText } = getVigenciaBadge(c);
        const planName = c.planDetails ? c.planDetails.name : c.plan;

        return `
            <tr>
                <td>
                    <strong style="color: var(--text-primary);">${escapeHtml(c.name)}</strong>
                    <div style="font-size: 0.78rem; color: var(--text-muted);">${escapeHtml(c.email || c.phone || 'Sin contacto')}</div>
                </td>
                <td><span class="badge badge-plan badge-plan-${c.plan}">${planName}</span></td>
                <td>${statusBadge}</td>
                <td>${new Date(c.validUntil).toLocaleDateString()}</td>
                <td>${daysText}</td>
                <td>
                    <button class="btn btn-primary btn-sm" onclick="openPaymentModalDirect('${c.id}')" title="Extender Vigencia con Pago">
                        + Renovar
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// --- RENDERIZADO: TABLA DE CLIENTES ---

function getVigenciaBadge(client) {
    const status = client.computedStatus;
    const validDate = new Date(client.validUntil);
    const now = new Date();
    const diffDays = Math.ceil((validDate - now) / (1000 * 60 * 60 * 24));

    let statusBadge = '';
    let daysText = '';

    if (status === 'suspended') {
        statusBadge = '<span class="badge badge-suspended">Suspendido</span>';
        daysText = '<span style="color: var(--text-muted);">Pausado</span>';
    } else if (status === 'expired') {
        statusBadge = '<span class="badge badge-expired">Expirado</span>';
        daysText = `<span style="color: var(--accent-rose); font-weight: 600;">Venció hace ${Math.abs(diffDays)}d</span>`;
    } else if (diffDays <= 7) {
        statusBadge = '<span class="badge badge-warning">Por Vencer</span>';
        daysText = `<span style="color: var(--accent-amber); font-weight: 600;">Quedan ${diffDays} días</span>`;
    } else {
        statusBadge = '<span class="badge badge-active">Activo</span>';
        daysText = `<span style="color: var(--brand-wa);">${diffDays} días restantes</span>`;
    }

    return { statusBadge, daysText };
}

function renderClientsTable(clients) {
    const tbody = document.getElementById('clientsTableBody');
    if (!tbody) return;

    if (!clients || clients.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 32px;">No se encontraron clientes registrados.</td></tr>`;
        return;
    }

    tbody.innerHTML = clients.map(c => {
        const { statusBadge, daysText } = getVigenciaBadge(c);
        const planName = c.planDetails ? c.planDetails.name : c.plan;
        const keysCount = c.apiKeys ? c.apiKeys.length : 0;
        const activeKeysCount = c.apiKeys ? c.apiKeys.filter(k => k.isActive).length : 0;

        // Contador de límite mensual
        const usage = c.usage || { messageCount: 0 };
        const msgCount = usage.messageCount || 0;
        const maxMsgs = (c.planDetails && c.planDetails.monthlyMsgLimit) ? c.planDetails.monthlyMsgLimit : (c.plan === 'developer' ? 5000 : null);
        const usagePct = maxMsgs ? Math.min(100, Math.round((msgCount / maxMsgs) * 100)) : 0;
        const usageColor = usagePct > 90 ? 'var(--accent-rose)' : usagePct > 70 ? 'var(--accent-amber)' : 'var(--brand-wa)';

        // Webhook status
        const hasWebhook = Boolean(c.webhookUrl);

        return `
            <tr>
                <td>
                    <strong style="color: var(--text-primary); font-size: 0.95rem;">${escapeHtml(c.name)}</strong>
                    <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
                        ${c.email ? `✉ ${escapeHtml(c.email)}` : ''} 
                        ${c.phone ? `&nbsp;•&nbsp; 📞 ${escapeHtml(c.phone)}` : ''}
                    </div>
                </td>
                <td>
                    <span class="badge badge-plan badge-plan-${c.plan}">${planName}</span>
                    <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">$${c.planDetails ? c.planDetails.priceMonthly : 0} USD/mes</div>
                </td>
                <td>
                    <div>${statusBadge}</div>
                    <div style="font-size: 0.78rem; margin-top: 4px;">${daysText}</div>
                    <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">Vence: ${new Date(c.validUntil).toLocaleDateString()}</div>
                </td>
                <td>
                    <div style="font-size: 0.82rem; font-weight: 600; color: var(--text-primary); display: flex; justify-content: space-between; align-items: center;">
                        <span>${msgCount.toLocaleString()}</span>
                        <span style="font-size: 0.75rem; color: var(--text-muted);">${maxMsgs ? `/ ${maxMsgs.toLocaleString()}` : '∞ Ilimitado'}</span>
                    </div>
                    ${maxMsgs ? `
                        <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; margin-top: 5px; overflow: hidden;">
                            <div style="width: ${usagePct}%; height: 100%; background: ${usageColor}; border-radius: 3px;"></div>
                        </div>
                    ` : `
                        <div style="font-size: 0.72rem; color: var(--brand-wa); margin-top: 4px;">Plan sin límite</div>
                    `}
                </td>
                <td>
                    <div style="display: flex; flex-direction: column; gap: 6px;">
                        <button class="btn btn-secondary btn-sm" onclick="openKeysModal('${c.id}')" title="Administrar Claves para Aplicaciones" style="text-align: left; padding: 4px 8px; font-size: 0.78rem;">
                            🔑 ${keysCount} Clave${keysCount === 1 ? '' : 's'} (${activeKeysCount} activas)
                        </button>
                        ${hasWebhook ? `
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <span class="badge badge-active" style="font-size: 0.7rem; padding: 2px 6px;">🌐 Webhook Activo</span>
                                <button class="btn btn-outline btn-sm" onclick="handleTestWebhook('${c.id}')" title="Enviar Ping de Prueba al Webhook" style="padding: 2px 6px; font-size: 0.7rem;">
                                    Probar
                                </button>
                            </div>
                        ` : `
                            <span style="font-size: 0.72rem; color: var(--text-muted);">Sin Webhook</span>
                        `}
                    </div>
                </td>
                <td style="text-align: right;">
                    <div style="display: inline-flex; gap: 6px;">
                        <button class="btn btn-primary btn-sm" onclick="openPaymentModalDirect('${c.id}')" title="Registrar Pago">
                            + Pago
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="openEditClientModal('${c.id}')" title="Editar Cliente">
                            ✏
                        </button>
                        <button class="btn ${c.status === 'suspended' ? 'btn-outline' : 'btn-secondary'} btn-sm" onclick="toggleClientSuspension('${c.id}', '${c.status}')" title="${c.status === 'suspended' ? 'Reactivar' : 'Suspender'}">
                            ${c.status === 'suspended' ? '▶ Reactivar' : '⏸ Pausar'}
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="confirmDeleteClient('${c.id}', '${escapeHtml(c.name)}')" title="Eliminar Cliente">
                            🗑
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function filterClientsTable() {
    const q = document.getElementById('clientSearchInput').value.toLowerCase().trim();
    const plan = document.getElementById('clientPlanFilter').value;

    const filtered = allClients.filter(c => {
        const matchesPlan = !plan || c.plan === plan;
        if (!matchesPlan) return false;

        if (!q) return true;

        const nameMatch = (c.name || '').toLowerCase().includes(q);
        const emailMatch = (c.email || '').toLowerCase().includes(q);
        const keyMatch = c.apiKeys && c.apiKeys.some(k => (k.key || '').toLowerCase().includes(q) || (k.appName || '').toLowerCase().includes(q));

        return nameMatch || emailMatch || keyMatch;
    });

    renderClientsTable(filtered);
}

// --- GESTIÓN DE CLIENTES: ALTA Y EDICIÓN ---

function openNewClientModal() {
    document.getElementById('modalClientTitle').textContent = 'Registrar Nuevo Cliente';
    document.getElementById('formClient').reset();
    document.getElementById('clientId').value = '';
    document.getElementById('clientWebhookUrl').value = '';
    document.getElementById('clientWebhookSecret').value = '';
    document.getElementById('groupInitialDays').style.display = 'block';
    document.getElementById('initialKeySection').style.display = 'block';
    document.getElementById('editStatusSection').style.display = 'none';
    generateSuggestedKey('initialApiKey');
    openModal('modalClient');
}

function openEditClientModal(id) {
    const client = allClients.find(c => c.id === id);
    if (!client) return;

    document.getElementById('modalClientTitle').textContent = `Editar: ${client.name}`;
    document.getElementById('clientId').value = client.id;
    document.getElementById('clientName').value = client.name;
    document.getElementById('clientEmail').value = client.email || '';
    document.getElementById('clientPhone').value = client.phone || '';
    document.getElementById('clientPlan').value = client.plan;
    document.getElementById('clientWebhookUrl').value = client.webhookUrl || '';
    document.getElementById('clientWebhookSecret').value = client.webhookSecret || '';
    
    // Ocultar sección de vigencia inicial y clave inicial al editar
    document.getElementById('groupInitialDays').style.display = 'none';
    document.getElementById('initialKeySection').style.display = 'none';
    document.getElementById('editStatusSection').style.display = 'grid';

    document.getElementById('clientStatus').value = client.status;
    if (client.validUntil) {
        document.getElementById('clientValidUntil').value = client.validUntil.substring(0, 10);
    }

    openModal('modalClient');
}

async function handleSaveClient(e) {
    e.preventDefault();
    const btn = document.getElementById('btnSaveClient');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    const id = document.getElementById('clientId').value;
    const name = document.getElementById('clientName').value.trim();
    const email = document.getElementById('clientEmail').value.trim();
    const phone = document.getElementById('clientPhone').value.trim();
    const plan = document.getElementById('clientPlan').value;
    const webhookUrl = document.getElementById('clientWebhookUrl').value.trim();
    const webhookSecret = document.getElementById('clientWebhookSecret').value.trim();

    try {
        if (!id) {
            // Alta
            const initialDays = document.getElementById('clientInitialDays').value;
            const initialApiKey = document.getElementById('initialApiKey').value.trim();
            const initialAppName = document.getElementById('initialAppName').value.trim();

            const { ok, data } = await fetchAdmin('/clients', {
                method: 'POST',
                body: JSON.stringify({
                    name,
                    email,
                    phone,
                    plan,
                    initialDays,
                    initialApiKey,
                    initialAppName,
                    webhookUrl,
                    webhookSecret
                })
            });

            if (ok && data.success) {
                closeModal('modalClient');
                // NOTIFICACIÓN STICKY (Regla obligatoria)
                showStickyNotification('Cliente Registrado', `Se ha registrado "${name}" con plan ${plan.toUpperCase()}${webhookUrl ? ' y Webhook configurado' : ''}.`, 'success');
                await loadInitialData();
            } else {
                showStickyNotification('Error al crear cliente', data.error || 'No se pudo completar el registro', 'error');
            }
        } else {
            // Edición
            const status = document.getElementById('clientStatus').value;
            const validUntilInput = document.getElementById('clientValidUntil').value;

            const updates = { name, email, phone, plan, status, webhookUrl, webhookSecret };
            if (validUntilInput) {
                updates.validUntil = new Date(validUntilInput + 'T23:59:59').toISOString();
            }

            const { ok, data } = await fetchAdmin(`/clients/${id}`, {
                method: 'PUT',
                body: JSON.stringify(updates)
            });

            if (ok && data.success) {
                closeModal('modalClient');
                // NOTIFICACIÓN STICKY (Regla obligatoria)
                showStickyNotification('Cliente Actualizado', `Información de "${name}" actualizada correctamente.`, 'success');
                await loadInitialData();
            } else {
                showStickyNotification('Error al actualizar', data.error || 'No se pudo guardar los cambios', 'error');
            }
        }
    } catch (err) {
        showStickyNotification('Error de red', 'Ocurrió un fallo en la comunicación con el servidor', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Guardar Cliente';
    }
}

async function handleTestWebhook(clientId) {
    const client = allClients.find(c => c.id === clientId);
    const clientName = client ? client.name : 'Cliente';

    showStickyNotification('Probando Webhook...', `Enviando evento de prueba a la URL de ${clientName}`, 'warning', 2500);

    try {
        const { ok, data } = await fetchAdmin(`/clients/${clientId}/test-webhook`, {
            method: 'POST'
        });

        if (ok && data.success) {
            showStickyNotification('Webhook Exitoso', `Respuesta HTTP ${data.result.status} desde el servidor destino (${data.result.targetUrl})`, 'success', 5000);
        } else {
            showStickyNotification('Fallo de Webhook', data.error || (data.result ? `HTTP ${data.result.status}: ${data.result.error}` : 'No se pudo contactar el endpoint'), 'error', 6000);
        }
    } catch (err) {
        showStickyNotification('Error de Prueba', 'Fallo de red al intentar disparar el webhook de prueba', 'error');
    }
}

// MODAL DE CONFIRMACIÓN PARA BORRADO (Regla obligatoria)
function confirmDeleteClient(id, name) {
    showConfirmModal({
        title: '¿Eliminar Cliente?',
        message: `¿Estás seguro de que deseas eliminar permanentemente a "${name}"? Todas sus claves de API quedarán revocadas y no podrá enviar mensajes.`,
        confirmText: 'Sí, Eliminar Cliente',
        danger: true,
        onConfirm: async () => {
            try {
                const { ok, data } = await fetchAdmin(`/clients/${id}`, { method: 'DELETE' });
                if (ok && data.success) {
                    showStickyNotification('Cliente Eliminado', `"${name}" fue retirado del sistema.`, 'success');
                    await loadInitialData();
                } else {
                    showStickyNotification('Error al eliminar', data.error || 'No se pudo eliminar el cliente', 'error');
                }
            } catch (err) {
                showStickyNotification('Error', 'Fallo al procesar eliminación', 'error');
            }
        }
    });
}

function toggleClientSuspension(id, currentStatus) {
    const isSuspended = currentStatus === 'suspended';
    const actionName = isSuspended ? 'Reactivar' : 'Pausar';

    showConfirmModal({
        title: `¿${actionName} Cliente?`,
        message: isSuspended
            ? 'La cuenta volverá a estar habilitada para el envío de mensajes siempre que su vigencia esté al día.'
            : 'Al suspender al cliente, todas las peticiones con sus claves maestras serán rechazadas con HTTP 403.',
        confirmText: `Sí, ${actionName}`,
        danger: !isSuspended,
        onConfirm: async () => {
            try {
                const { ok, data } = await fetchAdmin(`/clients/${id}`, {
                    method: 'PUT',
                    body: JSON.stringify({ status: isSuspended ? 'active' : 'suspended' })
                });

                if (ok && data.success) {
                    showStickyNotification('Estado Modificado', `Cliente ${isSuspended ? 'reactivado' : 'suspendido'} exitosamente.`, 'success');
                    await loadInitialData();
                }
            } catch (err) {
                showStickyNotification('Error', 'No se pudo cambiar el estado', 'error');
            }
        }
    });
}

// --- GESTIÓN DE API KEYS POR CLIENTE ---

function openKeysModal(clientId) {
    const client = allClients.find(c => c.id === clientId);
    if (!client) return;

    document.getElementById('keysClientId').value = client.id;
    document.getElementById('modalKeysClientName').textContent = client.name;
    document.getElementById('newKeyAppName').value = '';
    document.getElementById('newKeyString').value = '';

    generateSuggestedKey('newKeyString');
    renderClientKeys(client);
    openModal('modalKeys');
}

function renderClientKeys(client) {
    const container = document.getElementById('clientKeysList');
    if (!container) return;

    const keys = client.apiKeys || [];

    if (keys.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 18px;">Este cliente no tiene claves configuradas aún.</div>`;
        return;
    }

    container.innerHTML = keys.map(k => {
        return `
            <div class="key-item">
                <div class="key-item-info">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="key-item-app">${escapeHtml(k.appName || 'Aplicación')}</span>
                        <span class="badge ${k.isActive ? 'badge-active' : 'badge-suspended'}">${k.isActive ? 'Activa' : 'Desactivada'}</span>
                    </div>
                    <div class="key-pill" style="margin-top: 4px;">
                        <span>${escapeHtml(k.key)}</span>
                        <button type="button" class="btn-icon" onclick="copyToClipboard('${k.key}', 'Clave API')" title="Copiar Clave" style="background: none; border: none; color: var(--brand-wa); cursor: pointer;">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        </button>
                    </div>
                </div>
                <div class="key-item-actions">
                    <button class="btn btn-secondary btn-sm" onclick="handleToggleApiKey('${client.id}', '${k.id}')" title="${k.isActive ? 'Desactivar clave temporalmente' : 'Reactivar clave'}">
                        ${k.isActive ? 'Pausar' : 'Activar'}
                    </button>
                    <button class="btn btn-danger btn-sm btn-icon" onclick="confirmRemoveApiKey('${client.id}', '${k.id}', '${escapeHtml(k.appName || k.key)}')" title="Eliminar clave permanentemente">
                        🗑
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

async function handleAddApiKey() {
    const clientId = document.getElementById('keysClientId').value;
    const appName = document.getElementById('newKeyAppName').value.trim();
    const key = document.getElementById('newKeyString').value.trim();

    if (!appName) {
        showStickyNotification('Campo Requerido', 'Debes ingresar el nombre de la aplicación donde se integrará la clave (ej. CRM, Ventas, etc.).', 'warning');
        return;
    }

    try {
        const { ok, data } = await fetchAdmin(`/clients/${clientId}/keys`, {
            method: 'POST',
            body: JSON.stringify({ key, appName })
        });

        if (ok && data.success) {
            document.getElementById('newKeyAppName').value = '';
            document.getElementById('newKeyString').value = '';
            showStickyNotification('Clave Vinculada', `Nueva clave asignada para la aplicación "${appName}".`, 'success');

            // Refrescar cliente
            await loadClients();
            const refreshed = allClients.find(c => c.id === clientId);
            if (refreshed) renderClientKeys(refreshed);
        } else {
            showStickyNotification('Error', data.error || 'No se pudo agregar la clave', 'error');
        }
    } catch (err) {
        showStickyNotification('Error de red', 'Fallo al vincular clave', 'error');
    }
}

function confirmRemoveApiKey(clientId, keyId, label) {
    showConfirmModal({
        title: '¿Revocar Clave de API?',
        message: `¿Deseas eliminar la clave de "${label}"? La aplicación vinculada no podrá seguir enviando mensajes.`,
        confirmText: 'Sí, Revocar Clave',
        danger: true,
        onConfirm: async () => {
            try {
                const { ok, data } = await fetchAdmin(`/clients/${clientId}/keys/${keyId}`, { method: 'DELETE' });
                if (ok && data.success) {
                    showStickyNotification('Clave Revocada', 'La clave de API fue eliminada con éxito.', 'success');
                    await loadClients();
                    const refreshed = allClients.find(c => c.id === clientId);
                    if (refreshed) renderClientKeys(refreshed);
                } else {
                    showStickyNotification('Error', data.error || 'No se pudo eliminar la clave', 'error');
                }
            } catch (err) {
                showStickyNotification('Error', 'Fallo al procesar solicitud', 'error');
            }
        }
    });
}

async function handleToggleApiKey(clientId, keyId) {
    try {
        const { ok, data } = await fetchAdmin(`/clients/${clientId}/keys/${keyId}/toggle`, { method: 'PATCH' });
        if (ok && data.success) {
            showStickyNotification('Estado de Clave', data.message || 'Clave actualizada', 'success');
            await loadClients();
            const refreshed = allClients.find(c => c.id === clientId);
            if (refreshed) renderClientKeys(refreshed);
        }
    } catch (err) {
        showStickyNotification('Error', 'Fallo al cambiar estado de la clave', 'error');
    }
}

async function generateSuggestedKey(inputId) {
    try {
        const { ok, data } = await fetchAdmin('/generate-key?prefix=mk');
        if (ok && data.key) {
            const input = document.getElementById(inputId);
            if (input) input.value = data.key;
        }
    } catch (e) {}
}

// --- GESTIÓN DE PAGOS & VIGENCIAS ---

function populatePaymentClientSelect() {
    const select = document.getElementById('payClientSelect');
    if (!select) return;

    if (allClients.length === 0) {
        select.innerHTML = '<option value="">No hay clientes registrados</option>';
        return;
    }

    select.innerHTML = allClients.map(c => {
        const planName = c.planDetails ? c.planDetails.name : c.plan;
        return `<option value="${c.id}">${escapeHtml(c.name)} — Plan ${planName}</option>`;
    }).join('');
}

function openPaymentModalDirect(clientId = '') {
    populatePaymentClientSelect();

    if (clientId) {
        document.getElementById('payClientSelect').value = clientId;
    }

    document.getElementById('payPeriod').value = '1';
    document.getElementById('payReference').value = '';
    document.getElementById('payNotes').value = '';

    calculateSuggestedPaymentAmount();
    openModal('modalPayment');
}

function handlePaymentClientSelectChange() {
    calculateSuggestedPaymentAmount();
}

function calculateSuggestedPaymentAmount() {
    const clientId = document.getElementById('payClientSelect').value;
    const client = allClients.find(c => c.id === clientId);
    const months = Number(document.getElementById('payPeriod').value) || 1;

    let baseMonthlyPrice = 9;
    if (client && client.planDetails) {
        baseMonthlyPrice = client.planDetails.priceMonthly;
    } else if (client && allPlans[client.plan]) {
        baseMonthlyPrice = allPlans[client.plan].priceMonthly;
    }

    const total = baseMonthlyPrice * months;
    document.getElementById('payAmount').value = total.toFixed(2);
}

async function handleRecordPayment(e) {
    e.preventDefault();
    const btn = document.getElementById('btnSubmitPayment');
    btn.disabled = true;
    btn.textContent = 'Procesando...';

    const clientId = document.getElementById('payClientSelect').value;
    const periodMonths = document.getElementById('payPeriod').value;
    const amount = document.getElementById('payAmount').value;
    const reference = document.getElementById('payReference').value.trim();
    const notes = document.getElementById('payNotes').value.trim();

    try {
        const { ok, data } = await fetchAdmin('/payments', {
            method: 'POST',
            body: JSON.stringify({
                clientId,
                periodMonths,
                amount,
                reference,
                notes
            })
        });

        if (ok && data.success) {
            closeModal('modalPayment');
            // NOTIFICACIÓN STICKY (Regla obligatoria)
            showStickyNotification('Pago Registrado Exitosamente', data.message, 'success', 6000);
            await loadInitialData();
        } else {
            showStickyNotification('Error al registrar pago', data.error || 'No se pudo registrar el pago', 'error');
        }
    } catch (err) {
        showStickyNotification('Error de red', 'Fallo al comunicarse con el servidor', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Confirmar Pago & Extender';
    }
}

function renderPaymentsTable(payments) {
    const tbody = document.getElementById('paymentsTableBody');
    if (!tbody) return;

    if (!payments || payments.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 32px;">No se han registrado pagos aún.</td></tr>`;
        return;
    }

    tbody.innerHTML = payments.map(p => {
        return `
            <tr>
                <td><code style="color: var(--accent-cyan); font-size: 0.8rem;">${p.id}</code></td>
                <td><strong style="color: var(--text-primary);">${escapeHtml(p.clientName)}</strong></td>
                <td><span class="badge badge-plan badge-plan-${p.plan}">${(p.plan || '').toUpperCase()}</span></td>
                <td><strong style="color: var(--brand-wa);">$${Number(p.amount).toFixed(2)} USD</strong></td>
                <td>+${p.periodMonths} mes${p.periodMonths === 1 ? '' : 'es'}</td>
                <td>${new Date(p.paymentDate).toLocaleDateString()}</td>
                <td><span style="color: #A7F3D0;">${new Date(p.validUntilResult).toLocaleDateString()}</span></td>
                <td>${escapeHtml(p.reference || '—')}</td>
            </tr>
        `;
    }).join('');
}

// --- RENDERIZADO & EDICIÓN DE PLANES DE SERVICIO OFICIALES ---

function populatePlanSelectOptions() {
    const select = document.getElementById('clientPlan');
    if (!select || !allPlans) return;

    const currentVal = select.value || 'developer';
    const planKeys = ['developer', 'business', 'enterprise'];

    select.innerHTML = planKeys.map(key => {
        const p = allPlans[key];
        if (!p) return '';
        const limitText = p.monthlyMsgLimit ? `${p.monthlyMsgLimit.toLocaleString()} msgs` : 'Ilimitado';
        const sessionsText = p.maxSessions ? `${p.maxSessions} Sesión${p.maxSessions > 1 ? 'es' : ''}` : 'Sesiones ilimitadas';
        return `<option value="${key}">${p.name} ($${p.priceMonthly} USD/mes - ${sessionsText}, ${limitText})</option>`;
    }).join('');

    if (allPlans[currentVal]) {
        select.value = currentVal;
    }
}

function renderPlansView(plans) {
    const container = document.getElementById('plansGridContainer');
    if (!container) return;

    const planKeys = ['developer', 'business', 'enterprise'];

    container.innerHTML = planKeys.map(key => {
        const p = plans[key];
        if (!p) return '';

        const limitStr = p.monthlyMsgLimit ? `${p.monthlyMsgLimit.toLocaleString()} msgs/mes` : 'Mensajes Ilimitados';
        const sessionsStr = p.maxSessions ? `${p.maxSessions} Sesión${p.maxSessions > 1 ? 'es' : ''}` : 'Sesiones Ilimitadas';

        return `
            <div class="card" style="border-top: 4px solid ${key === 'enterprise' ? 'var(--accent-purple)' : key === 'business' ? 'var(--brand-wa)' : 'var(--accent-cyan)'}; display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                    <div class="card-header" style="align-items: flex-start;">
                        <div>
                            <h3 class="card-title">${escapeHtml(p.name)}</h3>
                            <p style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px;">${escapeHtml(p.badge)}</p>
                        </div>
                        <div style="font-size: 1.5rem; font-weight: 800; color: var(--brand-wa); font-family: 'Outfit'; text-align: right;">
                            $${p.priceMonthly} <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 500;">USD/mes</span>
                        </div>
                    </div>
                    <div class="card-body">
                        <!-- Badges de Límite y Sesiones -->
                        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px;">
                            <span class="badge badge-active" style="font-size: 0.75rem;">📩 ${limitStr}</span>
                            <span class="badge badge-plan badge-plan-${key}" style="font-size: 0.75rem;">📱 ${sessionsStr}</span>
                        </div>

                        <ul style="list-style: none; display: flex; flex-direction: column; gap: 10px; font-size: 0.88rem;">
                            ${(p.features || []).map(f => `
                                <li style="display: flex; align-items: flex-start; gap: 8px; color: var(--text-secondary);">
                                    <span style="color: var(--brand-wa); font-weight: 700;">✓</span>
                                    <span>${escapeHtml(f)}</span>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                </div>

                <div style="padding: 16px 20px; border-top: 1px solid var(--border-color); background: rgba(255,255,255,0.01); display: flex; justify-content: flex-end;">
                    <button class="btn btn-secondary btn-sm" onclick="openEditPlanModal('${key}')" title="Modificar Tarifa y Límites">
                        ✏ Modificar Tarifas & Límites
                    </button>
                </div>
            </div>
        `;
    }).join('');

    populatePlanSelectOptions();
}

function openEditPlanModal(planId) {
    const plan = allPlans[planId];
    if (!plan) return;

    document.getElementById('modalEditPlanTitle').textContent = `Editar Perfil: Plan ${plan.name}`;
    document.getElementById('planEditId').value = plan.id || planId;
    document.getElementById('planEditName').value = plan.name || '';
    document.getElementById('planEditBadge').value = plan.badge || '';
    document.getElementById('planEditPrice').value = plan.priceMonthly || 0;
    document.getElementById('planEditMsgLimit').value = plan.monthlyMsgLimit !== undefined ? plan.monthlyMsgLimit : 0;
    document.getElementById('planEditSessions').value = plan.maxSessions !== undefined ? plan.maxSessions : 0;
    document.getElementById('planEditFeatures').value = (plan.features || []).join('\n');

    openModal('modalEditPlan');
}

async function handleSavePlan(e) {
    e.preventDefault();
    const btn = document.getElementById('btnSavePlan');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    const planId = document.getElementById('planEditId').value;
    const name = document.getElementById('planEditName').value.trim();
    const badge = document.getElementById('planEditBadge').value.trim();
    const priceMonthly = Number(document.getElementById('planEditPrice').value);
    const monthlyMsgLimit = Number(document.getElementById('planEditMsgLimit').value);
    const maxSessions = Number(document.getElementById('planEditSessions').value);
    const featuresRaw = document.getElementById('planEditFeatures').value;
    const features = featuresRaw.split('\n').map(f => f.trim()).filter(f => f.length > 0);

    try {
        const { ok, data } = await fetchAdmin(`/plans/${planId}`, {
            method: 'PUT',
            body: JSON.stringify({
                name,
                badge,
                priceMonthly,
                monthlyMsgLimit,
                maxSessions,
                features
            })
        });

        if (ok && data.success) {
            closeModal('modalEditPlan');
            showStickyNotification('Plan Actualizado', `El perfil "${name}" ahora cuesta $${priceMonthly} USD/mes con ${monthlyMsgLimit ? `${monthlyMsgLimit.toLocaleString()} msgs/mes` : 'mensajes ilimitados'}.`, 'success', 5000);
            await loadInitialData();
        } else {
            showStickyNotification('Error', data.error || 'No se pudo guardar la configuración del plan', 'error');
        }
    } catch (err) {
        showStickyNotification('Error de red', 'Fallo al comunicarse con el servidor', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Guardar Cambios de Plan';
    }
}

// --- SESIONES WHATSAPP, PAGINACIÓN & PRUEBAS DE FUNCIONAMIENTO ---

let allSessionsList = [];
let filteredSessionsList = [];
let sessionsCurrentPage = 1;
let sessionsPageSize = 10;
let qrPollingInterval = null;
let currentActiveQrSessionId = null;

async function loadSessionsData() {
    try {
        const { ok, data } = await fetchAdmin('/sessions');
        if (ok && data.success) {
            allSessionsList = data.sessions || [];
            
            // Actualizar contadores
            const opTotal = document.getElementById('opTotalSessions');
            const opActive = document.getElementById('opActiveSessions');
            if (opTotal) opTotal.textContent = data.totalCount || 0;
            if (opActive) opActive.textContent = data.activeMemoryCount || 0;

            filterSessionsTable();
            populateTestSessionSelect(allSessionsList);
            populateQrSessionSelect(allSessionsList);
        }
    } catch (err) {
        console.error('Error al cargar sesiones:', err);
    }
}

function filterSessionsTable() {
    const searchInput = document.getElementById('sessionSearchInput');
    const statusSelect = document.getElementById('sessionStatusFilter');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const statusFilter = statusSelect ? statusSelect.value : '';

    filteredSessionsList = allSessionsList.filter(s => {
        const matchQuery = !query || 
            s.sessionId.toLowerCase().includes(query) ||
            (s.client && s.client.name && s.client.name.toLowerCase().includes(query)) ||
            (s.appName && s.appName.toLowerCase().includes(query));

        let matchStatus = true;
        if (statusFilter === 'connected') {
            matchStatus = (s.status === 'Connected' || s.status === 'Ready');
        } else if (statusFilter === 'waiting') {
            matchStatus = (s.status === 'QR Code Generated' || s.status === 'Initializing');
        } else if (statusFilter === 'stored') {
            matchStatus = (!s.inMemory || s.status.includes('Stored') || s.status === 'Disconnected');
        }

        return matchQuery && matchStatus;
    });

    sessionsCurrentPage = 1;
    renderSessionsTable();
}

function renderSessionsTable() {
    const tbody = document.getElementById('opSessionsTableBody');
    if (!tbody) return;

    if (!filteredSessionsList || filteredSessionsList.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 32px;">
                    No se encontraron sesiones registradas que coincidan con la búsqueda. Puedes conectar una nueva haciendo clic en <strong>"+ Conectar Sesión con QR"</strong>.
                </td>
            </tr>
        `;
        renderSessionsPagination(0, 1, sessionsPageSize);
        return;
    }

    const totalItems = filteredSessionsList.length;
    const totalPages = Math.ceil(totalItems / sessionsPageSize);
    if (sessionsCurrentPage > totalPages) sessionsCurrentPage = totalPages || 1;

    const startIndex = (sessionsCurrentPage - 1) * sessionsPageSize;
    const endIndex = Math.min(startIndex + sessionsPageSize, totalItems);
    const pagedSessions = filteredSessionsList.slice(startIndex, endIndex);

    tbody.innerHTML = pagedSessions.map(s => {
        let statusBadge = '<span class="badge" style="background: rgba(148, 163, 184, 0.15); color: #94A3B8;">⚪ Guardada en disco</span>';
        if (s.status === 'Connected' || s.status === 'Ready') {
            statusBadge = '<span class="badge badge-active">🟢 Conectada & Lista</span>';
        } else if (s.status === 'Authenticated') {
            statusBadge = '<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: var(--accent-cyan); font-weight: 600;">🔄 Sincronizando chats</span>';
        } else if (s.status === 'QR Code Generated') {
            statusBadge = '<span class="badge badge-warning">🟡 Esperando QR</span>';
        } else if (s.status === 'Initializing') {
            statusBadge = '<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: var(--accent-cyan);">⏳ Inicializando</span>';
        }

        let clientLabel = '<span style="color: var(--text-muted); font-size: 0.85rem;">Instancia Independiente / Master Key</span>';
        if (s.client) {
            clientLabel = `
                <div>
                    <strong style="color: var(--text-primary); font-size: 0.88rem;">${escapeHtml(s.client.name)}</strong>
                    <div style="font-size: 0.75rem; color: var(--accent-cyan);">${escapeHtml(s.appName || 'App')} • Plan ${escapeHtml(s.client.plan)}</div>
                </div>
            `;
        }

        const dateStr = s.lastActivity ? new Date(s.lastActivity).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' }) : 'Reciente';

        return `
            <tr>
                <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="code-badge" style="font-size: 0.82rem;">${escapeHtml(s.sessionId)}</span>
                        <button class="btn btn-outline btn-icon" style="padding: 2px 6px;" onclick="copyToClipboard('${escapeHtml(s.sessionId)}', 'Identificador de Sesión')" title="Copiar Clave">📋</button>
                    </div>
                </td>
                <td>${clientLabel}</td>
                <td>${statusBadge}</td>
                <td style="font-size: 0.82rem; color: var(--text-muted);">${dateStr}</td>
                <td style="text-align: right;">
                    <div style="display: flex; gap: 6px; justify-content: flex-end;">
                        <button class="btn btn-outline btn-sm" onclick="openSessionQrModal('${escapeHtml(s.sessionId)}')" title="Escanear código QR para conectar esta sesión">
                            📱 Código QR
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="handleDisconnectSession('${escapeHtml(s.sessionId)}')" title="Desconectar y liberar esta sesión">
                            Desconectar
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    renderSessionsPagination(totalItems, sessionsCurrentPage, sessionsPageSize);
}

function renderSessionsPagination(totalItems, currentPage, pageSize) {
    const infoEl = document.getElementById('sessionsPaginationInfo');
    const buttonsEl = document.getElementById('sessionsPaginationButtons');
    if (!infoEl || !buttonsEl) return;

    if (totalItems === 0) {
        infoEl.innerHTML = 'Mostrando 0 de 0 sesiones';
        buttonsEl.innerHTML = '';
        return;
    }

    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    const startNum = (currentPage - 1) * pageSize + 1;
    const endNum = Math.min(currentPage * pageSize, totalItems);

    infoEl.innerHTML = `Mostrando <strong style="color: var(--text-primary); font-weight: 600;">${startNum} - ${endNum}</strong> de <strong style="color: var(--text-primary); font-weight: 600;">${totalItems}</strong> sesiones`;

    let html = '';
    // Botón Anterior
    html += `
        <button class="pagination-btn" ${currentPage <= 1 ? 'disabled' : ''} onclick="changeSessionsPage(${currentPage - 1})" title="Página anterior">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            <span>Anterior</span>
        </button>
    `;

    // Números de página
    for (let p = 1; p <= totalPages; p++) {
        if (p === 1 || p === totalPages || (p >= currentPage - 1 && p <= currentPage + 1)) {
            const isActive = p === currentPage;
            html += `<button class="pagination-btn ${isActive ? 'active' : ''}" onclick="changeSessionsPage(${p})">${p}</button>`;
        } else if (p === currentPage - 2 || p === currentPage + 2) {
            html += `<span class="pagination-ellipsis">...</span>`;
        }
    }

    // Botón Siguiente
    html += `
        <button class="pagination-btn" ${currentPage >= totalPages ? 'disabled' : ''} onclick="changeSessionsPage(${currentPage + 1})" title="Página siguiente">
            <span>Siguiente</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
    `;

    buttonsEl.innerHTML = html;
}

function changeSessionsPage(newPage) {
    sessionsCurrentPage = newPage;
    renderSessionsTable();
}

function handleSessionsPageSizeChange() {
    const select = document.getElementById('sessionsPageSizeSelect');
    if (select) {
        sessionsPageSize = parseInt(select.value, 10) || 10;
        sessionsCurrentPage = 1;
        renderSessionsTable();
    }
}

// --- MODAL DE CONEXIÓN QR CON POLLING LIVE ---

function populateQrSessionSelect(sessions) {
    const select = document.getElementById('qrSessionSelectDropdown');
    if (!select) return;

    select.innerHTML = '<option value="">-- Selecciona una clave de cliente para vincular --</option>';

    allClients.forEach(c => {
        if (c.apiKeys && Array.isArray(c.apiKeys)) {
            c.apiKeys.forEach(k => {
                const isConnected = sessions.some(s => s.sessionId === k.key && (s.status === 'Connected' || s.status === 'Ready'));
                const statusTag = isConnected ? '🟢 [Conectada]' : '⚪ [Disponible para conectar]';
                const opt = document.createElement('option');
                opt.value = k.key;
                opt.textContent = `${statusTag} ${c.name} (${k.appName || 'App'}) - ${k.key.substring(0, 16)}...`;
                select.appendChild(opt);
            });
        }
    });
}

function openConnectModalDirect() {
    const modal = document.getElementById('modalSessionQr');
    const selectWrap = document.getElementById('qrSessionSelectWrap');
    const spinner = document.getElementById('qrLoadingSpinner');
    const container = document.getElementById('qrImageContainer');
    const statusMsg = document.getElementById('qrStatusMessage');
    const title = document.getElementById('modalSessionQrTitle');

    if (qrPollingInterval) clearInterval(qrPollingInterval);
    currentActiveQrSessionId = null;

    title.textContent = 'Vincular Nueva Sesión de WhatsApp';
    selectWrap.style.display = 'block';
    spinner.style.display = 'none';
    container.style.display = 'none';
    statusMsg.textContent = 'Selecciona una clave de cliente y haz clic en "Generar QR".';

    populateQrSessionSelect(allSessionsList);
    openModal('modalSessionQr');
}

function handleQrSelectChange() {
    const select = document.getElementById('qrSessionSelectDropdown');
    if (select && select.value) {
        startQrForSelectedSession();
    }
}

function startQrForSelectedSession() {
    const select = document.getElementById('qrSessionSelectDropdown');
    const sessionId = select ? select.value.trim() : '';
    if (!sessionId) {
        showStickyNotification('Selecciona una clave', 'Por favor elige una clave de cliente en la lista', 'warning');
        return;
    }
    startQrPolling(sessionId);
}

function openSessionQrModal(sessionId) {
    const modal = document.getElementById('modalSessionQr');
    const selectWrap = document.getElementById('qrSessionSelectWrap');
    const title = document.getElementById('modalSessionQrTitle');

    title.textContent = `Vincular Sesión: ${sessionId.substring(0, 14)}...`;
    selectWrap.style.display = 'none';
    openModal('modalSessionQr');
    startQrPolling(sessionId);
}

function startQrPolling(sessionId) {
    if (qrPollingInterval) clearInterval(qrPollingInterval);
    currentActiveQrSessionId = sessionId;

    const spinner = document.getElementById('qrLoadingSpinner');
    const spinnerText = document.getElementById('qrSpinnerText');
    const container = document.getElementById('qrImageContainer');
    const img = document.getElementById('qrDisplayImg');
    const statusMsg = document.getElementById('qrStatusMessage');

    spinner.style.display = 'block';
    spinnerText.textContent = 'Inicializando instancia y generando código QR seguro...';
    container.style.display = 'none';
    statusMsg.textContent = 'Conectando con el motor de WhatsApp Web...';

    let syncElapsedSeconds = 0;

    // Función de consulta
    const fetchQr = async () => {
        if (!currentActiveQrSessionId || currentActiveQrSessionId !== sessionId) return;

        try {
            const { ok, data } = await fetchAdmin(`/sessions/${sessionId}/qr`);
            if (ok && data.success) {
                if (data.status === 'Connected' || data.status === 'Ready') {
                    if (qrPollingInterval) clearInterval(qrPollingInterval);
                    spinner.style.display = 'none';
                    container.style.display = 'none';
                    statusMsg.innerHTML = '<span style="color: var(--brand-wa); font-weight: 700; font-size: 1.05rem;">🎉 ¡Sesión vinculada y 100% lista para enviar mensajes!</span>';
                    showStickyNotification('¡Conexión Exitosa!', `La sesión de WhatsApp (${sessionId.substring(0, 12)}...) está 100% lista.`, 'success', 5000);
                    await loadSessionsData();
                } else if (data.status === 'Authenticated') {
                    syncElapsedSeconds += 2;
                    spinner.style.display = 'block';
                    spinnerText.textContent = `Sincronizando chats con WhatsApp (${syncElapsedSeconds}s)...`;
                    container.style.display = 'none';
                    
                    let extraHtml = '';
                    if (syncElapsedSeconds >= 12) {
                        extraHtml = `<div style="margin-top: 10px;"><button class="btn btn-outline btn-sm" onclick="forceCheckSession('${escapeHtml(sessionId)}')">🔍 Comprobar Estado Ahora</button></div>`;
                    }

                    statusMsg.innerHTML = `
                        <div style="color: var(--accent-cyan); font-weight: 600;">
                            🔄 ¡Código QR escaneado con éxito! Sincronizando chats e iniciando sesión...
                        </div>
                        ${extraHtml}
                    `;

                    // Si ya pasaron más de 10s en Authenticated, intentar chequear la lista general de sesiones
                    if (syncElapsedSeconds >= 10 && syncElapsedSeconds % 4 === 0) {
                        const sessRes = await fetchAdmin('/sessions');
                        if (sessRes.ok && sessRes.data.success && Array.isArray(sessRes.data.sessions)) {
                            const found = sessRes.data.sessions.find(s => s.sessionId === sessionId);
                            if (found && (found.status === 'Connected' || found.status === 'Ready')) {
                                if (qrPollingInterval) clearInterval(qrPollingInterval);
                                spinner.style.display = 'none';
                                container.style.display = 'none';
                                statusMsg.innerHTML = '<span style="color: var(--brand-wa); font-weight: 700; font-size: 1.05rem;">🎉 ¡Sesión vinculada y 100% lista para enviar mensajes!</span>';
                                showStickyNotification('¡Conexión Exitosa!', `La sesión (${sessionId.substring(0, 12)}...) está lista.`, 'success', 5000);
                                await loadSessionsData();
                            }
                        }
                    }
                } else if (data.qrDataUrl) {
                    spinner.style.display = 'none';
                    img.src = data.qrDataUrl;
                    container.style.display = 'inline-block';
                    statusMsg.textContent = '🟢 Código QR activo. Escanéalo en Ajustes > Dispositivos vinculados.';
                } else {
                    statusMsg.textContent = `Estado: ${data.status} (iniciando conexión con WhatsApp...)`;
                }
            }
        } catch (err) {
            console.warn('Polling QR error:', err);
        }
    };

    // Consulta inicial inmediata
    fetchQr();

    // Polling cada 2 segundos
    qrPollingInterval = setInterval(fetchQr, 2000);
}

async function forceCheckSession(sessionId) {
    const statusMsg = document.getElementById('qrStatusMessage');
    if (statusMsg) statusMsg.textContent = 'Verificando estado activo con WhatsApp...';
    
    try {
        const { ok, data } = await fetchAdmin('/sessions');
        if (ok && data.success) {
            await loadSessionsData();
            const found = data.sessions.find(s => s.sessionId === sessionId);
            if (found && (found.status === 'Connected' || found.status === 'Ready')) {
                if (qrPollingInterval) clearInterval(qrPollingInterval);
                const spinner = document.getElementById('qrLoadingSpinner');
                const container = document.getElementById('qrImageContainer');
                if (spinner) spinner.style.display = 'none';
                if (container) container.style.display = 'none';
                if (statusMsg) statusMsg.innerHTML = '<span style="color: var(--brand-wa); font-weight: 700; font-size: 1.05rem;">🎉 ¡Sesión vinculada y 100% lista!</span>';
                showStickyNotification('¡Sesión Lista!', `Sesión (${sessionId.substring(0, 12)}...) conectada con éxito.`, 'success', 4000);
            } else {
                showStickyNotification('Sincronizando', 'WhatsApp sigue transfiriendo datos, aguarda unos segundos más.', 'info', 3000);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

function closeSessionQrModal() {
    if (qrPollingInterval) {
        clearInterval(qrPollingInterval);
        qrPollingInterval = null;
    }
    currentActiveQrSessionId = null;
    closeModal('modalSessionQr');
}

function handleDisconnectSession(sessionId) {
    showConfirmModal({
        title: '¿Desconectar Sesión de WhatsApp?',
        message: `Se cerrará y liberará la sesión "${sessionId}". Deberás volver a escanear el código QR si deseas usarla nuevamente.`,
        confirmText: 'Sí, Desconectar',
        danger: true,
        onConfirm: async () => {
            try {
                const { ok, data } = await fetchAdmin(`/sessions/${sessionId}`, {
                    method: 'DELETE'
                });

                if (ok && data.success) {
                    showStickyNotification('Sesión Desconectada', data.message || 'La sesión ha sido cerrada y liberada.', 'success', 4000);
                    await loadSessionsData();
                } else {
                    showStickyNotification('Error', data.error || 'No se pudo desconectar la sesión', 'error');
                }
            } catch (err) {
                showStickyNotification('Error de conexión', 'Fallo al comunicarse con el servidor', 'error');
            }
        }
    });
}

function handleCleanInactiveSessions() {
    const daysSelect = document.getElementById('cleanInactiveDaysSelect');
    const days = daysSelect ? daysSelect.value : '7';

    showConfirmModal({
        title: '¿Limpiar Sesiones Inactivas?',
        message: `Se eliminarán del servidor las sesiones de WhatsApp que tengan más de ${days} días sin actividad ni envío de mensajes. Las sesiones conectadas no serán afectadas.`,
        confirmText: 'Sí, Limpiar Inactivas',
        danger: false,
        onConfirm: async () => {
            try {
                const { ok, data } = await fetchAdmin('/sessions/clean', {
                    method: 'POST',
                    body: JSON.stringify({ days })
                });

                if (ok && data.success) {
                    showStickyNotification('Limpieza Completada', data.message, 'success', 5000);
                    await loadSessionsData();
                } else {
                    showStickyNotification('Error', data.error || 'No se pudo completar la limpieza', 'error');
                }
            } catch (err) {
                showStickyNotification('Error de conexión', 'Fallo al comunicarse con el servidor', 'error');
            }
        }
    });
}

function populateTestSessionSelect(sessions) {
    const select = document.getElementById('testSessionSelect');
    if (!select) return;

    const previousValue = select.value;
    select.innerHTML = '<option value="">-- Selecciona una sesión o clave --</option>';

    // Recolectar opciones de clientes registrados
    allClients.forEach(c => {
        if (c.apiKeys && Array.isArray(c.apiKeys)) {
            c.apiKeys.forEach(k => {
                const isConnected = sessions.some(s => s.sessionId === k.key && (s.status === 'Connected' || s.status === 'Ready'));
                const statusTag = isConnected ? '🟢 [Conectada]' : '⚪ [Sin conectar]';
                const opt = document.createElement('option');
                opt.value = k.key;
                opt.textContent = `${statusTag} ${c.name} (${k.appName || 'App'}) - ${k.key.substring(0, 14)}...`;
                select.appendChild(opt);
            });
        }
    });

    // Sesiones sueltas o activas en memoria que no coincidan con clientes
    sessions.forEach(s => {
        const alreadyInSelect = Array.from(select.options).some(o => o.value === s.sessionId);
        if (!alreadyInSelect) {
            const isConnected = s.status === 'Connected' || s.status === 'Ready';
            const statusTag = isConnected ? '🟢 [Conectada]' : '⚪ [Sesión guardada]';
            const opt = document.createElement('option');
            opt.value = s.sessionId;
            opt.textContent = `${statusTag} Sesión ${s.sessionId}`;
            select.appendChild(opt);
        }
    });

    if (previousValue && Array.from(select.options).some(o => o.value === previousValue)) {
        select.value = previousValue;
    }
}

function setPresetTestMessage() {
    const body = document.getElementById('testMessageBody');
    if (body) {
        body.value = `🚀 ¡Hola! Este es un mensaje de prueba exitoso enviado desde el Panel de Administración de Mk WhatsApp API [${new Date().toLocaleTimeString()}].`;
        showStickyNotification('Texto Insertado', 'Mensaje de prueba sugerido cargado en el formulario', 'success', 2000);
    }
}

async function handleExecuteTestMessage(e) {
    e.preventDefault();
    const btn = document.getElementById('btnTestSendSubmit');
    const resultDiv = document.getElementById('testMessageResult');
    const sessionId = document.getElementById('testSessionSelect').value;
    const to = document.getElementById('testPhoneNumber').value.trim();
    const message = document.getElementById('testMessageBody').value.trim();

    if (!sessionId) {
        showStickyNotification('Falta información', 'Por favor selecciona la sesión o clave emisora.', 'warning');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span style="display: inline-block; animation: spin 1s linear infinite;">⏳</span> Enviando a WhatsApp...';
    resultDiv.style.display = 'none';

    try {
        const { ok, data } = await fetchAdmin('/test/send-message', {
            method: 'POST',
            body: JSON.stringify({ sessionId, to, message })
        });

        if (ok && data.success) {
            resultDiv.style.display = 'block';
            resultDiv.style.background = 'rgba(37, 211, 102, 0.12)';
            resultDiv.style.border = '1px solid rgba(37, 211, 102, 0.35)';
            resultDiv.style.color = '#86EFAC';
            resultDiv.innerHTML = `<strong>✅ Envío Exitoso:</strong> ${escapeHtml(data.message)}`;
            
            showStickyNotification('¡Mensaje Enviado!', `El mensaje de prueba se envió correctamente a ${to}.`, 'success', 5000);
            await loadSessionsData();
        } else {
            resultDiv.style.display = 'block';
            resultDiv.style.background = 'rgba(239, 68, 68, 0.12)';
            resultDiv.style.border = '1px solid rgba(239, 68, 68, 0.35)';
            resultDiv.style.color = '#FCA5A5';
            resultDiv.innerHTML = `<strong>❌ No se pudo enviar:</strong> ${escapeHtml(data.error || 'Verifica que la sesión esté escaneada y conectada.')}`;
            
            showStickyNotification('Fallo de Envío', data.error || 'No se pudo enviar el mensaje', 'error', 6000);
        }
    } catch (err) {
        resultDiv.style.display = 'block';
        resultDiv.style.background = 'rgba(239, 68, 68, 0.12)';
        resultDiv.style.border = '1px solid rgba(239, 68, 68, 0.35)';
        resultDiv.style.color = '#FCA5A5';
        resultDiv.innerHTML = '<strong>❌ Error de Red:</strong> No se pudo comunicar con el servidor de la API.';
        showStickyNotification('Error de Red', 'Fallo al comunicarse con el servidor', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px;"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            Enviar Mensaje de Prueba
        `;
    }
}

// --- INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
});
