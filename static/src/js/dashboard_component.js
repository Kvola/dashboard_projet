/** @odoo-module */

import { Component, useState, onWillStart, onMounted, useRef } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { jsonrpc } from "@web/core/network/rpc_service";

class DashboardProjet extends Component {
    static template = "dashboard_projet.Dashboard";

    setup() {
        // Services avec gestion d'erreur améliorée
        this.services = this._initializeServices();
        
        // État réactif avec OWL
        this.state = useState({
            loading: true,
            dateDebut: this.getCurrentDate(-360),
            dateFin: this.getCurrentDate(0),
            dashboardData: this._getEmptyDashboardData(),
            showExportModal: false,
            systemStatus: {
                healthy: false,
                lastCheck: null,
                errors: [],
                warnings: []
            },
            loadingStates: {
                dashboard: false,
                margins: false,
                export: false
            }
        });

        // Références et timeouts
        this.dateChangeTimeout = null;
        this.healthCheckInterval = null;
        this.retryCount = 0;
        this.maxRetries = 3;

        // Hooks de cycle de vie
        onWillStart(async () => {
            await this._performStartupSequence();
        });

        onMounted(() => {
            console.log("Dashboard OWL monté avec succès");
            this._setupHealthMonitoring();
        });
    }

    // ===== INITIALIZATION =====
    
    _initializeServices() {
        const services = {};
        
        const serviceList = [
            { name: 'orm', required: false },
            { name: 'notification', required: false },
            { name: 'action', required: false },
            { name: 'dashboard_projet', required: false }
        ];

        serviceList.forEach(({ name, required }) => {
            try {
                services[name] = useService(name);
                console.log(`✅ Service ${name} chargé`);
            } catch (error) {
                console.warn(`⚠️ Service ${name} non disponible:`, error);
                services[name] = null;
                if (required) {
                    this.state.systemStatus.errors.push(`Service requis ${name} indisponible`);
                }
            }
        });

        return services;
    }

    async _performStartupSequence() {
        try {
            console.log("🚀 Début séquence de démarrage dashboard");
            
            // 1. Test de connectivité
            await this._performHealthCheck();
            
            // 2. Chargement des données
            if (this.state.systemStatus.healthy) {
                await this.loadDashboardData();
            } else {
                console.warn("⚠️ Système non sain, chargement des données par défaut");
                this.state.loading = false;
            }
            
            console.log("✅ Séquence de démarrage terminée");
            
        } catch (error) {
            console.error("❌ Erreur lors du démarrage:", error);
            this.state.loading = false;
            this._handleError("Erreur lors de l'initialisation", error);
        }
    }

    _setupHealthMonitoring() {
        // Vérification périodique de santé (toutes les 5 minutes)
        this.healthCheckInterval = setInterval(() => {
            this._performHealthCheck();
        }, 300000); // 5 minutes
    }

    // ===== HEALTH MONITORING =====
    
    async _performHealthCheck() {
        try {
            const healthResult = await jsonrpc('/dashboard_projet/health', {});
            
            this.state.systemStatus = {
                healthy: healthResult.status === 'healthy',
                lastCheck: new Date().toISOString(),
                errors: healthResult.status === 'error' ? [healthResult.message] : [],
                warnings: healthResult.status === 'degraded' ? ['Système dégradé'] : [],
                details: healthResult.details || {}
            };

            if (!this.state.systemStatus.healthy) {
                console.warn("⚠️ Problème de santé système:", healthResult);
            }

            return this.state.systemStatus.healthy;
            
        } catch (error) {
            console.error("❌ Health check failed:", error);
            this.state.systemStatus = {
                healthy: false,
                lastCheck: new Date().toISOString(),
                errors: [`Health check failed: ${error.message}`],
                warnings: [],
                details: {}
            };
            return false;
        }
    }

    // ===== DATA LOADING =====
    
    getCurrentDate(offsetDays = 0) {
        const date = new Date();
        date.setDate(date.getDate() + offsetDays);
        return date.toISOString().split('T')[0];
    }

    async loadDashboardData() {
        if (this.state.loadingStates.dashboard) {
            console.log("⏳ Chargement déjà en cours, ignoré");
            return;
        }

        try {
            console.log("📊 Chargement des données dashboard");
            this.state.loading = true;
            this.state.loadingStates.dashboard = true;

            // Clear previous errors
            this.state.systemStatus.errors = this.state.systemStatus.errors.filter(
                error => !error.includes('données dashboard')
            );

            // Try service first, then direct RPC
            let data = await this._loadDataWithFallback();

            // Handle potential error in response
            if (data.error) {
                throw new Error(data.error);
            }

            // Apply data with validation
            this.state.dashboardData = this._validateAndNormalizeDashboardData(data);

            // Load project margins separately
            if (this.state.dashboardData.projets.length > 0) {
                await this._loadProjectMargins();
            }

            this.retryCount = 0; // Reset retry count on success
            this._showNotification("Données chargées avec succès", { type: "success" });
            
            console.log("✅ Données dashboard chargées");

        } catch (error) {
            console.error("❌ Erreur chargement dashboard:", error);
            this._handleLoadingError(error);
        } finally {
            this.state.loading = false;
            this.state.loadingStates.dashboard = false;
        }
    }

    async _loadDataWithFallback() {
        // Try dashboard service first
        if (this.services.dashboard_projet) {
            try {
                console.log("🔄 Tentative via service dashboard");
                return await this.services.dashboard_projet.getDashboardData(
                    this.state.dateDebut,
                    this.state.dateFin
                );
            } catch (error) {
                console.warn("⚠️ Service échoué, tentative RPC directe:", error);
            }
        }

        // Fallback to direct RPC
        console.log("🔄 Chargement via RPC direct");
        return await jsonrpc('/dashboard_projet/data', {
            date_debut: this.state.dateDebut,
            date_fin: this.state.dateFin
        });
    }

    async _loadProjectMargins() {
        if (this.state.loadingStates.margins) return;

        try {
            console.log(`📈 Chargement marges pour ${this.state.dashboardData.projets.length} projets`);
            this.state.loadingStates.margins = true;

            // Créer une copie des projets pour éviter les mutations directes
            const projetsWithMargins = [...(this.state.dashboardData.projets || [])];
            
            const marginPromises = projetsWithMargins.map(async (projet, index) => {
                try {
                    let margeData;

                    // Ajouter un délai minimal pour éviter de surcharger le serveur
                    await new Promise(resolve => setTimeout(resolve, index * 100));

                    if (this.services.dashboard_projet) {
                        margeData = await this.services.dashboard_projet.getProjetMarge(
                            projet.id,
                            this.state.dateDebut,
                            this.state.dateFin
                        );
                    } else {
                        margeData = await jsonrpc(`/dashboard_projet/projet_marge/${projet.id}`, {
                            date_debut: this.state.dateDebut,
                            date_fin: this.state.dateFin
                        });
                    }

                    // Validation approfondie des données de marge
                    if (margeData && typeof margeData === 'object' && !margeData.error) {
                        projet.marge_data = this._validateMargeData(margeData);
                        
                        // Vérification de cohérence
                        if (projet.marge_data.taux_marge > 100 || projet.marge_data.taux_marge < -100) {
                            console.warn(`⚠️ Taux de marge anormal pour projet ${projet.id}: ${projet.marge_data.taux_marge}`);
                            projet.marge_data.taux_marge = Math.max(Math.min(projet.marge_data.taux_marge, 100), -100);
                        }
                    } else {
                        console.warn(`⚠️ Données de marge invalides pour projet ${projet.id}:`, margeData);
                        projet.marge_data = this._getEmptyMargeData();
                    }

                    return projet;

                } catch (error) {
                    console.error(`❌ Erreur marge projet ${projet.id}:`, error);
                    projet.marge_data = this._getEmptyMargeData();
                    return projet;
                }
            });

            // Traitement par lots pour éviter la surcharge
            const batchSize = 3;
            for (let i = 0; i < marginPromises.length; i += batchSize) {
                const batch = marginPromises.slice(i, i + batchSize);
                await Promise.allSettled(batch);
                
                // Mettre à jour l'état progressivement
                this.state.dashboardData.projets = [...projetsWithMargins];
            }
            
            console.log("✅ Marges projets chargées avec succès");

        } catch (error) {
            console.error("❌ Erreur chargement marges:", error);
            this._showNotification("Erreur lors du calcul des marges projet", { type: "warning" });
        } finally {
            this.state.loadingStates.margins = false;
        }
    }

    async _processConcurrent(promises, limit = 5) {
        const results = [];
        for (let i = 0; i < promises.length; i += limit) {
            const batch = promises.slice(i, i + limit);
            const batchResults = await Promise.allSettled(batch);
            results.push(...batchResults);
        }
        return results;
    }

    // ===== DATA VALIDATION =====
    
    _validateAndNormalizeDashboardData(data) {
        const normalized = this._getEmptyDashboardData();

        if (data && typeof data === 'object') {
            normalized.chiffre_affaires = this._safeNumber(data.chiffre_affaires);
            
            if (Array.isArray(data.projets)) {
                normalized.projets = data.projets.map(this._validateProjectData.bind(this));
            }
            
            if (data.marge_administrative && typeof data.marge_administrative === 'object') {
                const ma = data.marge_administrative;
                normalized.marge_administrative = {
                    ca_total: this._safeNumber(ma.ca_total),
                    cout_admin: this._safeNumber(ma.cout_admin),
                    marge_admin: this._safeNumber(ma.marge_admin),
                    taux_marge_admin: this._safeNumber(ma.taux_marge_admin)
                };
            }
        }

        return normalized;
    }

    _validateProjectData(projet) {
        return {
            id: projet.id || 0,
            name: projet.name || `Projet ${projet.id || 'Unknown'}`,
            ca: this._safeNumber(projet.ca),
            nb_personnes: this._safeNumber(projet.nb_personnes, 0, true),
            heures: this._safeNumber(projet.heures),
            stage: projet.stage || 'Non défini',
            marge_data: null
        };
    }

    _validateMargeData(data) {
        if (!data || typeof data !== 'object') {
            return this._getEmptyMargeData();
        }

        const revenus = this._safeNumber(data.revenus);
        const cout_salarial = this._safeNumber(data.cout_salarial);
        const marge = this._safeNumber(data.marge);
        
        // Calcul du taux de marge si non fourni ou incohérent
        let taux_marge = this._safeNumber(data.taux_marge);
        
        if ((taux_marge === 0 || isNaN(taux_marge)) && revenus > 0) {
            // Recalculer le taux si nécessaire
            taux_marge = ((revenus - cout_salarial) / revenus) * 100;
        }

        // Validation de la cohérence
        if (Math.abs(marge - (revenus - cout_salarial)) > 1) {
            console.warn("Incohérence dans les données de marge, recalcul...");
            marge = revenus - cout_salarial;
        }

        return {
            revenus: revenus,
            cout_salarial: cout_salarial,
            marge: marge,
            taux_marge: Math.round(taux_marge * 10) / 10 // Arrondir à 1 décimale
        };
    }

    _safeNumber(value, defaultValue = 0, isInteger = false) {
        const num = parseFloat(value) || defaultValue;
        return isInteger ? Math.floor(num) : num;
    }

    // ===== EVENT HANDLERS =====
    
    async onDateChange() {
        clearTimeout(this.dateChangeTimeout);
        this.dateChangeTimeout = setTimeout(async () => {
            console.log("📅 Changement de dates détecté");
            await this.refreshDashboard();
        }, 800); // Debounce increased to 800ms
    }

    async refreshDashboard() {
        try {
            await this._performHealthCheck();
            
            if (this.state.systemStatus.healthy) {
                await this.loadDashboardData();
            } else {
                this._showNotification("Système indisponible, impossible d'actualiser", { type: "warning" });
            }
        } catch (error) {
            this._handleError("Erreur lors de l'actualisation", error);
        }
    }

    // ===== EXPORT FUNCTIONALITY =====
    
    async exportDashboard(format = 'xlsx') {
        if (this.state.loadingStates.export) {
            console.log("Export déjà en cours...");
            return;
        }

        try {
            console.log(`🔤 Export dashboard format: ${format}`);
            this.state.loadingStates.export = true;

            // Validation du format
            const supportedFormats = ['xlsx', 'pdf', 'json', 'csv'];
            if (!supportedFormats.includes(format.toLowerCase())) {
                throw new Error(`Format non supporté: ${format}`);
            }

            // Validation des dates
            if (!this.state.dateDebut || !this.state.dateFin) {
                throw new Error('Les dates de début et fin sont requises pour l\'export');
            }

            // Tentative via le service d'abord
            if (this.services.dashboard_projet) {
                try {
                    console.log("📤 Export via service dashboard");
                    await this.services.dashboard_projet.exportDashboard(
                        this.state.dateDebut,
                        this.state.dateFin,
                        format
                    );
                    
                    this._showNotification(`Export ${format.toUpperCase()} lancé avec succès`, { type: "success" });
                    console.log("✅ Export via service réussi");
                    return;
                    
                } catch (serviceError) {
                    console.warn("⚠️ Service export échoué, tentative fallback:", serviceError);
                }
            }

            // Fallback : téléchargement direct via URL
            console.log("📂 Export via téléchargement direct");
            await this._exportViaDirect(format);
            
            this._showNotification(`Export ${format.toUpperCase()} lancé`, { type: "info" });

        } catch (error) {
            console.error("❌ Erreur export:", error);
            this._showNotification(`Erreur export: ${error.message}`, { type: "danger" });
        } finally {
            this.state.loadingStates.export = false;
        }
    }

    // Nouvelle méthode helper pour l'export direct
    async _exportViaDirect(format) {
        try {
            // Construction des paramètres URL
            const params = new URLSearchParams({
                date_debut: this.state.dateDebut || '',
                date_fin: this.state.dateFin || '',
                format: format.toLowerCase()
            });

            const url = `/dashboard_projet/export?${params.toString()}`;
            
            // Différentes stratégies selon le format
            if (format.toLowerCase() === 'json') {
                // Pour JSON, ouvrir dans nouvel onglet
                const newWindow = window.open(url, '_blank', 'noopener,noreferrer');
                if (!newWindow) {
                    throw new Error('Popup bloqué. Veuillez autoriser les popups pour ce site.');
                }
            } else {
                // Pour Excel/PDF/CSV, téléchargement via lien temporaire
                await this._triggerFileDownload(url, `dashboard_${this.state.dateDebut}_${this.state.dateFin}.${format.toLowerCase()}`);
            }
            
        } catch (error) {
            console.error("❌ Erreur export direct:", error);
            throw error;
        }
    }

    // Méthode helper pour déclencher un téléchargement
    async _triggerFileDownload(url, suggestedFilename) {
        return new Promise((resolve, reject) => {
            try {
                // Créer un lien de téléchargement invisible
                const link = document.createElement('a');
                link.href = url;
                link.download = suggestedFilename;
                link.style.display = 'none';
                link.target = '_self';
                
                // Gérer les événements de téléchargement
                const cleanup = () => {
                    document.body.removeChild(link);
                };
                
                link.addEventListener('click', () => {
                    console.log(`📥 Téléchargement initié: ${suggestedFilename}`);
                    // Nettoyer après un délai pour laisser le temps au téléchargement
                    setTimeout(() => {
                        cleanup();
                        resolve();
                    }, 1000);
                });
                
                // Ajouter au DOM et déclencher le clic
                document.body.appendChild(link);
                link.click();
                
            } catch (error) {
                console.error("❌ Erreur déclenchement téléchargement:", error);
                
                // Fallback : ouvrir dans une nouvelle fenêtre
                try {
                    const newWindow = window.open(url, '_blank', 'noopener,noreferrer');
                    if (newWindow) {
                        resolve();
                    } else {
                        reject(new Error('Impossible d\'ouvrir le téléchargement'));
                    }
                } catch (fallbackError) {
                    reject(fallbackError);
                }
            }
        });
    }

    // Méthodes utilitaires pour les exports spécifiques
    async exportToExcel() {
        return await this.exportDashboard('xlsx');
    }

    async exportToPDF() {
        return await this.exportDashboard('pdf');
    }

    async exportToJSON() {
        return await this.exportDashboard('json');
    }

    async exportToCSV() {
        return await this.exportDashboard('csv');
    }

    // Méthode pour tester les exports
    async testExports() {
        const formats = ['xlsx', 'pdf', 'json', 'csv'];
        const results = {};
        
        this._showNotification("Test des exports en cours...", { type: "info" });
        
        for (const format of formats) {
            try {
                console.log(`🧪 Test export ${format}`);
                // Ne pas vraiment télécharger, juste tester l'URL
                const params = new URLSearchParams({
                    date_debut: this.state.dateDebut || '',
                    date_fin: this.state.dateFin || '',
                    format: format
                });
                
                const url = `/dashboard_projet/export?${params.toString()}`;
                
                // Test avec fetch (ne télécharge pas le fichier)
                const response = await fetch(url, { 
                    method: 'HEAD',  // HEAD pour éviter de télécharger
                    credentials: 'same-origin'
                });
                
                results[format] = {
                    success: response.ok,
                    status: response.status,
                    contentType: response.headers.get('content-type')
                };
                
            } catch (error) {
                results[format] = {
                    success: false,
                    error: error.message
                };
            }
        }
        
        console.log("🧪 Résultats test exports:", results);
        
        const successCount = Object.values(results).filter(r => r.success).length;
        this._showNotification(
            `Test terminé: ${successCount}/${formats.length} formats fonctionnels`, 
            { type: successCount === formats.length ? "success" : "warning" }
        );
        
        return results;
    }

    // ===== PROJECT DETAIL - VERSION CORRIGÉE =====

    /**
     * Ouvre le détail d'un projet avec gestion d'erreur robuste et fallbacks
     * @param {number|string} projectId - ID du projet à ouvrir
     * @param {Object} options - Options d'ouverture (target, view_type, etc.)
     */
    async openProjectDetail(projectId, options = {}) {
        // Validation des paramètres
        if (!this._validateProjectId(projectId)) {
            this._showNotification("ID de projet invalide", { type: "warning" });
            return false;
        }

        // Configuration par défaut
        const defaultOptions = {
            target: 'new',
            view_type: 'form',
            context: {},
            fallback_enabled: true,
            loading_message: true
        };

        const config = { ...defaultOptions, ...options };
        const numericProjectId = parseInt(projectId, 10);

        try {
            console.log(`🔍 Ouverture projet ID: ${numericProjectId}`);

            // Affichage du message de chargement si demandé
            if (config.loading_message) {
                this._showNotification("Ouverture du projet en cours...", { type: "info" });
            }

            // Vérification de l'existence du projet
            const projectExists = await this._checkProjectExists(numericProjectId);
            if (!projectExists) {
                throw new Error(`Le projet avec l'ID ${numericProjectId} n'existe pas ou n'est pas accessible`);
            }

            // Tentative d'ouverture via le service action
            const actionResult = await this._openViaActionService(numericProjectId, config);
            
            if (actionResult.success) {
                console.log("✅ Projet ouvert via service action");
                this._showNotification("Projet ouvert avec succès", { type: "success" });
                return true;
            }

            // Fallback si le service action échoue
            if (config.fallback_enabled) {
                console.warn("⚠️ Service action échoué, tentative de fallback");
                const fallbackResult = await this._openViaFallback(numericProjectId, config);
                
                if (fallbackResult.success) {
                    console.log("✅ Projet ouvert via fallback");
                    this._showNotification("Projet ouvert (mode dégradé)", { type: "warning" });
                    return true;
                }
            }

            throw new Error("Impossible d'ouvrir le projet avec les méthodes disponibles");

        } catch (error) {
            return this._handleProjectOpenError(error, numericProjectId, config);
        }
    }

    /**
     * Valide l'ID du projet
     * @param {*} projectId 
     * @returns {boolean}
     */
    _validateProjectId(projectId) {
        if (projectId === null || projectId === undefined) {
            console.error("❌ Project ID is null or undefined");
            return false;
        }

        const numericId = parseInt(projectId, 10);
        if (isNaN(numericId) || numericId <= 0) {
            console.error(`❌ Invalid project ID: ${projectId}`);
            return false;
        }

        return true;
    }

    /**
     * Vérifie si le projet existe et est accessible
     * @param {number} projectId 
     * @returns {Promise<boolean>}
     */
    async _checkProjectExists(projectId) {
        try {
            // Tentative via service ORM si disponible
            if (this.services.orm) {
                const projects = await this.services.orm.searchRead(
                    'project.project',
                    [['id', '=', projectId]],
                    ['id', 'name'],
                    { limit: 1 }
                );
                return projects.length > 0;
            }

            // Fallback via RPC direct
            const result = await jsonrpc('/web/dataset/search_read', {
                model: 'project.project',
                domain: [['id', '=', projectId]],
                fields: ['id', 'name'],
                limit: 1
            });

            return result.records && result.records.length > 0;

        } catch (error) {
            console.warn(`⚠️ Impossible de vérifier l'existence du projet ${projectId}:`, error);
            // En cas d'erreur de vérification, on assume que le projet existe
            return true;
        }
    }

    /**
     * Ouvre le projet via le service action
     * @param {number} projectId 
     * @param {Object} config 
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async _openViaActionService(projectId, config) {
        try {
            if (!this.services.action) {
                return { success: false, error: "Service action non disponible" };
            }

            const actionData = {
                type: 'ir.actions.act_window',
                name: `Projet ${projectId}`,
                res_model: 'project.project',
                res_id: projectId,
                views: [[false, config.view_type]],
                target: config.target,
                context: {
                    ...config.context,
                    default_res_id: projectId,
                    active_id: projectId,
                    active_model: 'project.project'
                },
                flags: {
                    mode: 'readonly'
                }
            };

            await this.services.action.doAction(actionData);
            return { success: true };

        } catch (error) {
            console.error("❌ Erreur service action:", error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Méthode de fallback pour ouvrir le projet
     * @param {number} projectId 
     * @param {Object} config 
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async _openViaFallback(projectId, config) {
        try {
            // Méthode 1: Redirection directe via URL
            // if (config.target === 'new') {
            //     const projectUrl = `/web#id=${projectId}&model=project.project&view_type=${config.view_type}`;
            //     window.open(projectUrl, '_blank', 'noopener,noreferrer');
            //     return { success: true };
            //}

            // Méthode 2: Navigation dans la même fenêtre
            if (typeof window !== 'undefined' && window.location) {
                const currentUrl = new URL(window.location);
                currentUrl.hash = `#id=${projectId}&model=project.project&view_type=${config.view_type}`;
                window.location.href = currentUrl.toString();
                return { success: true };
            }

            return { success: false, error: "Aucune méthode de fallback disponible" };

        } catch (error) {
            console.error("❌ Erreur fallback:", error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Gère les erreurs d'ouverture de projet
     * @param {Error} error 
     * @param {number} projectId 
     * @param {Object} config 
     * @returns {boolean}
     */
    _handleProjectOpenError(error, projectId, config) {
        const errorMessage = `Erreur ouverture projet ${projectId}: ${error.message}`;
        
        console.error("❌", errorMessage);
        
        // Log détaillé pour le debug
        console.error("Détails erreur:", {
            projectId,
            config,
            error: error.stack || error,
            services: Object.keys(this.services).filter(key => this.services[key] !== null),
            timestamp: new Date().toISOString()
        });

        // Ajout à l'état des erreurs système
        if (!this.state.systemStatus.errors.includes(errorMessage)) {
            this.state.systemStatus.errors.push(errorMessage);
        }

        // Notification utilisateur avec suggestions
        let notificationMessage = errorMessage;
        let suggestions = [];

        if (error.message.includes("n'existe pas")) {
            suggestions.push("Vérifiez que le projet n'a pas été supprimé");
            suggestions.push("Actualisez le dashboard pour mettre à jour les données");
        } else if (error.message.includes("Service")) {
            suggestions.push("Rechargez la page pour réinitialiser les services");
            suggestions.push("Contactez l'administrateur si le problème persiste");
        }

        if (suggestions.length > 0) {
            notificationMessage += `\nSuggestions: ${suggestions.join('; ')}`;
        }

        this._showNotification(notificationMessage, { 
            type: "danger",
            sticky: true // Garde la notification visible plus longtemps
        });

        return false;
    }

    /**
     * Version simplifiée pour ouverture rapide (pour compatibilité)
     * @param {number|string} projectId 
     */
    async quickOpenProject(projectId) {
        return await this.openProjectDetail(projectId, {
            loading_message: false,
            fallback_enabled: true
        });
    }

    /**
     * Ouvre un projet en mode lecture seule
     * @param {number|string} projectId 
     */
    async openProjectReadonly(projectId) {
        return await this.openProjectDetail(projectId, {
            view_type: 'form',
            context: { 'readonly': true },
            target: 'new'
        });
    }

    /**
     * Ouvre la vue liste des projets avec le projet sélectionné
     * @param {number|string} projectId 
     */
    async openProjectInList(projectId) {
        if (!this._validateProjectId(projectId)) {
            this._showNotification("ID de projet invalide", { type: "warning" });
            return false;
        }

        try {
            if (this.services.action) {
                await this.services.action.doAction({
                    type: 'ir.actions.act_window',
                    name: 'Projets',
                    res_model: 'project.project',
                    views: [[false, 'list'], [false, 'form']],
                    target: 'current',
                    context: {
                        'search_default_id': parseInt(projectId, 10)
                    }
                });
                return true;
            }
        } catch (error) {
            console.error("❌ Erreur ouverture liste projets:", error);
            this._showNotification(`Erreur: ${error.message}`, { type: "danger" });
        }
        
        return false;
    }

    // Version simplifiée si vous voulez garder la logique originale mais plus robuste
    async openProjectDetailSimple(projectId) {
        try {
            // Validation de base
            if (!projectId || isNaN(parseInt(projectId))) {
                this._showNotification("ID de projet invalide", { type: "warning" });
                return;
            }

            const numericProjectId = parseInt(projectId, 10);
            
            if (this.services.action) {
                await this.services.action.doAction({
                    type: 'ir.actions.act_window',
                    res_model: 'project.project',
                    res_id: numericProjectId,
                    views: [[false, 'form']],
                    target: 'new',
                    context: {
                        active_id: numericProjectId,
                        active_model: 'project.project'
                    }
                });
                
                this._showNotification("Projet ouvert", { type: "success" });
            } else {
                // Fallback simple
                const url = `/web#id=${numericProjectId}&model=project.project&view_type=form`;
                window.open(url, '_blank', 'noopener,noreferrer');
                this._showNotification("Projet ouvert (mode dégradé)", { type: "warning" });
            }
        } catch (error) {
            console.error("❌ Erreur ouverture projet:", error);
            this._showNotification(`Erreur: ${error.message}`, { type: "danger" });
        }
    }

    // ===== ERROR HANDLING =====
    
    _handleLoadingError(error) {
        this.retryCount++;
        
        if (this.retryCount <= this.maxRetries) {
            console.log(`🔄 Tentative ${this.retryCount}/${this.maxRetries} dans 2s`);
            setTimeout(() => this.loadDashboardData(), 2000);
        } else {
            this._handleError("Échec du chargement après plusieurs tentatives", error);
            this.state.dashboardData = this._getEmptyDashboardData();
        }
    }

    _handleError(message, error) {
        console.error(`❌ ${message}:`, error);
        this.state.systemStatus.errors.push(`${message}: ${error.message}`);
        this._showNotification(`${message}: ${error.message}`, { type: "danger" });
    }

    // ===== UTILITY METHODS =====
    
    _getEmptyDashboardData() {
        return {
            chiffre_affaires: 0,
            projets: [],
            marge_administrative: {
                ca_total: 0,
                cout_admin: 0,
                marge_admin: 0,
                taux_marge_admin: 0
            }
        };
    }

    _getEmptyMargeData() {
        return {
            revenus: 0,
            cout_salarial: 0,
            marge: 0,
            taux_marge: 0
        };
    }

    _showNotification(message, options = {}) {
        try {
            if (this.services.notification) {
                this.services.notification.add(message, options);
            } else {
                console.log(`📢 ${options.type || 'info'}: ${message}`);
            }
        } catch (error) {
            console.error("❌ Erreur notification:", error);
        }
    }

    // ===== TEMPLATE HELPERS =====
    
    formatCurrency(amount) {
        if (amount === undefined || amount === null) return "0 €";
        return new Intl.NumberFormat('fr-FR', {
            style: 'currency',
            currency: 'EUR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(amount);
    }

    formatPercentage(value) {
        return (value || 0).toFixed(1) + '%';
    }

    formatNumber(value, decimals = 1) {
        return (value || 0).toFixed(decimals);
    }

    getTotalPersonnel() {
        if (!this.state.dashboardData.projets) return 0;
        return this.state.dashboardData.projets.reduce((total, projet) => {
            return total + (projet.nb_personnes || 0);
        }, 0);
    }

    getTotalHeures() {
        if (!this.state.dashboardData.projets) return 0;
        return this.state.dashboardData.projets.reduce((total, projet) => {
            return total + (projet.heures || 0);
        }, 0);
    }

    getMargeProjet(projet) {
        return projet.marge_data ? (projet.marge_data.taux_marge || 0) : 0;
    }

    getMargeClass(marge) {
        if (marge >= 20) return "bg-success";
        if (marge >= 10) return "bg-warning text-dark";
        return "bg-danger";
    }

    getHealthStatusClass() {
        if (this.state.systemStatus.healthy) return "text-success";
        if (this.state.systemStatus.warnings.length > 0) return "text-warning";
        return "text-danger";
    }

    getHealthStatusIcon() {
        if (this.state.systemStatus.healthy) return "fa-check-circle";
        if (this.state.systemStatus.warnings.length > 0) return "fa-exclamation-triangle";
        return "fa-times-circle";
    }

    // ===== CLEANUP =====
    
    willDestroy() {
        if (this.dateChangeTimeout) {
            clearTimeout(this.dateChangeTimeout);
        }
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
    }
}

// Register the component
registry.category("actions").add("dashboard_projet.dashboard", DashboardProjet);