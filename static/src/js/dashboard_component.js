/** @odoo-module */

import { Component, useState, onWillStart, onMounted, useRef } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { jsonrpc } from "@web/core/network/rpc_service";
import { download } from "@web/core/network/download";

class DashboardProjet extends Component {
    static template = "dashboard_projet.Dashboard";

    setup() {
        // Services avec gestion d'erreur améliorée
        this.services = this._initializeServices();
        
        // État réactif avec OWL
        this.state = useState({
            loading: true,
            dateDebut: this.getCurrentDate(-30),
            dateFin: this.getCurrentDate(0),
            dashboardData: this._getEmptyDashboardData(),
            showExportModal: false,
            chartData: {
                caEvolution: [],
                margeEvolution: [],
                projetsByStage: [],
                budgetComparison: []
            },
            systemStatus: {
                healthy: false,
                lastCheck: null,
                errors: [],
                warnings: []
            },
            loadingStates: {
                dashboard: false,
                margins: false,
                export: false,
                charts: false
            },
            scrollPosition: 0
        });

        // Références et timeouts
        this.dateChangeTimeout = null;
        this.healthCheckInterval = null;
        this.retryCount = 0;
        this.maxRetries = 3;
        this.scrollContainerRef = useRef("scrollContainer");

        // Hooks de cycle de vie
        onWillStart(async () => {
            await this._performStartupSequence();
        });

        onMounted(() => {
            console.log("Dashboard OWL monté avec succès");
            this._setupHealthMonitoring();
            this._setupScrollHandler();
        });
    }

    // ===== INITIALIZATION =====
    
    _initializeServices() {
        const services = {};
        
        const serviceList = [
            { name: 'orm', required: false },
            { name: 'notification', required: false },
            { name: 'action', required: false },
            { name: 'dashboard_projet', required: false },
            { name: 'download', required: false }
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

    _setupScrollHandler() {
        if (this.scrollContainerRef.el) {
            this.scrollContainerRef.el.addEventListener('scroll', (e) => {
                this.state.scrollPosition = e.target.scrollTop;
            });
        }
    }

    async _performStartupSequence() {
        try {
            console.log("🚀 Début séquence de démarrage dashboard");
            
            // 1. Test de connectivité
            await this._performHealthCheck();
            
            // 2. Chargement des données
            if (this.state.systemStatus.healthy) {
                await this.loadDashboardData();
                await this.loadChartData();
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
                await this._loadProjectBudgets();
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

            const marginPromises = this.state.dashboardData.projets.map(async (projet) => {
                try {
                    let margeData;

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

                    if (margeData.error) {
                        console.warn(`⚠️ Erreur marge projet ${projet.id}:`, margeData.error);
                        projet.marge_data = this._getEmptyMargeData();
                    } else {
                        projet.marge_data = this._validateMargeData(margeData);
                    }

                    return projet;

                } catch (error) {
                    console.error(`❌ Erreur marge projet ${projet.id}:`, error);
                    projet.marge_data = this._getEmptyMargeData();
                    return projet;
                }
            });

            // Attendre toutes les promesses avec limitation de concurrence
            await this._processConcurrent(marginPromises, 5);
            
            console.log("✅ Marges projets chargées");

        } catch (error) {
            console.error("❌ Erreur chargement marges:", error);
        } finally {
            this.state.loadingStates.margins = false;
        }
    }

    async _loadProjectBudgets() {
        try {
            // Chargement des données budgétaires
            const budgetData = await jsonrpc('/dashboard_projet/budget_data', {
                date_debut: this.state.dateDebut,
                date_fin: this.state.dateFin
            });

            if (budgetData && !budgetData.error) {
                this.state.dashboardData.budget_comparison = budgetData;
            }
        } catch (error) {
            console.warn("⚠️ Erreur chargement budget:", error);
        }
    }

    async loadChartData() {
        if (this.state.loadingStates.charts) return;

        try {
            this.state.loadingStates.charts = true;
            console.log("📊 Chargement données graphiques");

            // Données pour graphiques
            const chartDataPromises = [
                this._loadCaEvolution(),
                this._loadMargeEvolution(),
                this._loadProjetsByStage(),
                this._loadBudgetComparison()
            ];

            const [caEvolution, margeEvolution, projetsByStage, budgetComparison] = 
                await Promise.allSettled(chartDataPromises);

            this.state.chartData = {
                caEvolution: caEvolution.status === 'fulfilled' ? caEvolution.value : [],
                margeEvolution: margeEvolution.status === 'fulfilled' ? margeEvolution.value : [],
                projetsByStage: projetsByStage.status === 'fulfilled' ? projetsByStage.value : [],
                budgetComparison: budgetComparison.status === 'fulfilled' ? budgetComparison.value : []
            };

            console.log("✅ Données graphiques chargées");

        } catch (error) {
            console.error("❌ Erreur chargement graphiques:", error);
        } finally {
            this.state.loadingStates.charts = false;
        }
    }

    async _loadCaEvolution() {
        // Simuler données évolution CA (remplacer par vraie API)
        const data = [];
        const currentDate = new Date(this.state.dateDebut);
        const endDate = new Date(this.state.dateFin);
        
        while (currentDate <= endDate) {
            const monthCA = Math.random() * 100000 + 50000;
            data.push({
                date: currentDate.toISOString().slice(0, 7),
                ca: monthCA,
                ca_prevu: monthCA * (0.9 + Math.random() * 0.2)
            });
            currentDate.setMonth(currentDate.getMonth() + 1);
        }
        
        return data;
    }

    async _loadMargeEvolution() {
        // Simuler données évolution marge
        return this.state.dashboardData.projets.map(projet => ({
            projet_name: projet.name,
            marge: projet.marge_data ? projet.marge_data.taux_marge : 0,
            ca: projet.ca
        }));
    }

    async _loadProjetsByStage() {
        // Grouper projets par statut
        const stages = {};
        this.state.dashboardData.projets.forEach(projet => {
            const stage = projet.stage || 'Non défini';
            stages[stage] = (stages[stage] || 0) + 1;
        });

        return Object.entries(stages).map(([stage, count]) => ({
            stage,
            count,
            percentage: (count / this.state.dashboardData.projets.length) * 100
        }));
    }

    async _loadBudgetComparison() {
        // Comparaison budget vs réalisé
        return this.state.dashboardData.projets.map(projet => ({
            projet_name: projet.name,
            budget_prevu: projet.budget_prevu || projet.ca * 1.2,
            ca_realise: projet.ca,
            ecart: ((projet.ca / (projet.budget_prevu || projet.ca * 1.2)) - 1) * 100
        }));
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

    // ===== EVENT HANDLERS =====
    
    async onDateChange() {
        clearTimeout(this.dateChangeTimeout);
        this.dateChangeTimeout = setTimeout(async () => {
            console.log("📅 Changement de dates détecté");
            await this.refreshDashboard();
        }, 800);
    }

    async refreshDashboard() {
        try {
            await this._performHealthCheck();
            
            if (this.state.systemStatus.healthy) {
                await this.loadDashboardData();
                await this.loadChartData();
            } else {
                this._showNotification("Système indisponible, impossible d'actualiser", { type: "warning" });
            }
        } catch (error) {
            this._handleError("Erreur lors de l'actualisation", error);
        }
    }

    scrollToTop() {
        if (this.scrollContainerRef.el) {
            this.scrollContainerRef.el.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    // ===== EXPORT FUNCTIONALITY =====
    
    async exportDashboard(format = 'json') {
        if (this.state.loadingStates.export) return;

        try {
            console.log(`📤 Export dashboard format: ${format}`);
            this.state.loadingStates.export = true;

            const params = {
                date_debut: this.state.dateDebut || '',
                date_fin: this.state.dateFin || '',
                format: format,
                include_charts: true,
                include_budget: true
            };

            if (['excel', 'xlsx'].includes(format.toLowerCase())) {
                await this._exportExcel(params);
            } else if (format.toLowerCase() === 'pdf') {
                await this._exportPDF(params);
            } else {
                // JSON et CSV via endpoint existant
                if (this.services.download) {
                    await this.services.download({
                        url: '/dashboard_projet/export',
                        data: params,
                        complete: () => {
                            this._showNotification(`Export ${format.toUpperCase()} terminé`, { type: "success" });
                        },
                        error: (error) => {
                            this._showNotification(`Erreur export: ${error.message}`, { type: "danger" });
                        }
                    });
                } else {
                    // Fallback
                    const urlParams = new URLSearchParams(params);
                    const url = `/dashboard_projet/export?${urlParams.toString()}`;
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `dashboard_${this.state.dateDebut}_${this.state.dateFin}.${format}`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                }
            }

        } catch (error) {
            console.error("❌ Erreur export:", error);
            this._showNotification(`Erreur export: ${error.message}`, { type: "danger" });
        } finally {
            this.state.loadingStates.export = false;
        }
    }

    async _exportExcel(params) {
        try {
            const response = await jsonrpc('/dashboard_projet/export_excel', params);
            if (response.url) {
                window.open(response.url, '_blank');
                this._showNotification("Export Excel lancé", { type: "success" });
            } else if (response.error) {
                throw new Error(response.error);
            }
        } catch (error) {
            throw new Error(`Erreur export Excel: ${error.message}`);
        }
    }

    async _exportPDF(params) {
        try {
            const response = await jsonrpc('/dashboard_projet/export_pdf', params);
            if (response.url) {
                window.open(response.url, '_blank');
                this._showNotification("Export PDF lancé", { type: "success" });
            } else if (response.error) {
                throw new Error(response.error);
            }
        } catch (error) {
            throw new Error(`Erreur export PDF: ${error.message}`);
        }
    }

    // ===== PROJECT DETAIL =====
    
    async openProjectDetail(projectId) {
        try {
            if (!projectId) {
                throw new Error("ID de projet invalide");
            }

            if (this.services.action) {
                await this.services.action.doAction({
                    type: 'ir.actions.act_window',
                    res_model: 'project.project',
                    res_id: projectId,
                    views: [[false, 'form']],
                    target: 'new',
                });
            } else {
                this._showNotification("Service d'action non disponible", { type: "warning" });
            }
        } catch (error) {
            console.error("❌ Erreur ouverture projet:", error);
            this._showNotification(`Erreur ouverture projet: ${error.message}`, { type: "danger" });
        }
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

            if (data.budget_comparison) {
                normalized.budget_comparison = data.budget_comparison;
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
            budget_prevu: this._safeNumber(projet.budget_prevu),
            budget_consomme: this._safeNumber(projet.budget_consomme),
            marge_data: null
        };
    }

    _validateMargeData(data) {
        if (!data || typeof data !== 'object') {
            return this._getEmptyMargeData();
        }

        return {
            revenus: this._safeNumber(data.revenus),
            cout_salarial: this._safeNumber(data.cout_salarial),
            marge: this._safeNumber(data.marge),
            taux_marge: this._safeNumber(data.taux_marge)
        };
    }

    _safeNumber(value, defaultValue = 0, isInteger = false) {
        const num = parseFloat(value) || defaultValue;
        return isInteger ? Math.floor(num) : num;
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
            },
            budget_comparison: {
                budget_total: 0,
                budget_consomme: 0,
                ecart_budget: 0
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

    getTotalBudget() {
        if (!this.state.dashboardData.projets) return 0;
        return this.state.dashboardData.projets.reduce((total, projet) => {
            return total + (projet.budget_prevu || 0);
        }, 0);
    }

    getBudgetConsomme() {
        if (!this.state.dashboardData.projets) return 0;
        return this.state.dashboardData.projets.reduce((total, projet) => {
            return total + (projet.budget_consomme || 0);
        }, 0);
    }

    getBudgetEcart() {
        const total = this.getTotalBudget();
        const consomme = this.getBudgetConsomme();
        return total > 0 ? ((consomme / total - 1) * 100) : 0;
    }

    getMargeProjet(projet) {
        return projet.marge_data ? (projet.marge_data.taux_marge || 0) : 0;
    }

    getMargeClass(marge) {
        if (marge >= 20) return "bg-success";
        if (marge >= 10) return "bg-warning text-dark";
        return "bg-danger";
    }

    getBudgetClass(ecart) {
        if (ecart <= 0) return "bg-success";
        if (ecart <= 10) return "bg-warning text-dark";
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

    showScrollToTop() {
        return this.state.scrollPosition > 200;
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