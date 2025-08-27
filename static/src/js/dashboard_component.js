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
            dateDebut: this.getCurrentDate(-30),
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

    // Ajouter ces méthodes à la classe DashboardProjet

    // ===== GRAPHIQUES =====

    /**
     * Initialise les graphiques avec Chart.js
     */
    _initGraphiques() {
        if (typeof Chart === 'undefined') {
            console.warn('Chart.js non disponible, les graphiques seront désactivés');
            return;
        }

        this._destroyGraphiques(); // Nettoyer les anciens graphiques

        // Graphique à barres - CA par projet
        this._initGraphiqueCA();

        // Graphique circulaire - Répartition des statuts
        this._initGraphiqueStatuts();

        // Graphique linéaire - Évolution mensuelle du CA
        this._initGraphiqueEvolution();
    }

    /**
     * Initialise le graphique à barres pour le CA par projet
     */
    _initGraphiqueCA() {
        const ctx = document.getElementById('graphique-ca');
        if (!ctx) return;

        const data = this.state.dashboardData.graphique_data?.graphique_ca || {};
        
        this.graphiqueCA = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.labels || [],
                datasets: [{
                    label: 'Chiffre d\'affaires par projet (CFA)',
                    data: data.data || [],
                    backgroundColor: data.backgroundColors || '#007bff',
                    borderColor: 'rgba(0, 123, 255, 0.8)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'CA par Projet',
                        font: { size: 16, weight: 'bold' }
                    },
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                return `CA: ${this.formatCurrency(context.raw)}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: (value) => {
                                if (value >= 1000) {
                                    return 'CFA' + (value / 1000).toFixed(1) + 'k';
                                }
                                return 'CFA' + value;
                            }
                        }
                    }
                }
            }
        });
    }

    /**
     * Initialise le graphique circulaire pour la répartition des statuts
     */
    _initGraphiqueStatuts() {
        const ctx = document.getElementById('graphique-statuts');
        if (!ctx) return;

        const data = this.state.dashboardData.graphique_data?.graphique_statuts || {};
        
        this.graphiqueStatuts = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: data.labels || [],
                datasets: [{
                    data: data.data || [],
                    backgroundColor: data.backgroundColors || ['#007bff', '#28a745', '#ffc107'],
                    borderWidth: 2,
                    borderColor: '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Répartition par Statut',
                        font: { size: 16, weight: 'bold' }
                    },
                    legend: {
                        position: 'right',
                        labels: {
                            boxWidth: 15,
                            padding: 15
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = Math.round((context.raw / total) * 100);
                                return `${context.label}: ${context.raw} projet(s) (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    /**
     * Initialise le graphique linéaire pour l'évolution mensuelle du CA
     */
    _initGraphiqueEvolution() {
        const ctx = document.getElementById('graphique-evolution');
        if (!ctx) return;

        const data = this.state.dashboardData.graphique_data?.graphique_evolution || {};
        
        this.graphiqueEvolution = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.labels || [],
                datasets: [{
                    label: 'Évolution du CA (CFA)',
                    data: data.data || [],
                    fill: true,
                    backgroundColor: 'rgba(0, 123, 255, 0.1)',
                    borderColor: '#007bff',
                    borderWidth: 2,
                    pointBackgroundColor: '#007bff',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Évolution Mensuelle du CA',
                        font: { size: 16, weight: 'bold' }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                return `CA: ${this.formatCurrency(context.raw)}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: (value) => {
                                if (value >= 1000) {
                                    return 'CFA' + (value / 1000).toFixed(1) + 'k';
                                }
                                return 'CFA' + value;
                            }
                        }
                    }
                }
            }
        });
    }

    /**
     * Détruit tous les graphiques existants
     */
    _destroyGraphiques() {
        if (this.graphiqueCA) {
            this.graphiqueCA.destroy();
            this.graphiqueCA = null;
        }
        if (this.graphiqueStatuts) {
            this.graphiqueStatuts.destroy();
            this.graphiqueStatuts = null;
        }
        if (this.graphiqueEvolution) {
            this.graphiqueEvolution.destroy();
            this.graphiqueEvolution = null;
        }
    }

    // Mettre à jour la méthode loadDashboardData pour initialiser les graphiques
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

            // Initialiser les graphiques après le chargement des données
            this._initGraphiques();

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

    // ===== EXTENSION POUR L'EXPORT PDF DES DIAGRAMMES =====
    // À ajouter dans dashboard_component.js

































    // ===== EXPORT PDF AVEC GRAPHIQUES =====

    /**
     * Exporte le dashboard complet avec graphiques en PDF
     */
    async exportDashboardWithGraphiques() {
        try {
            this.state.loadingStates.export = true;
            
            // Vérifier que jsPDF est disponible
            if (typeof window.jspdf === 'undefined') {
                throw new Error('jsPDF n\'est pas disponible. Veuillez recharger la page.');
            }
            
            const { jsPDF } = window.jspdf;
            
            // Capturer les graphiques
            const graphiques = await this._captureAllGraphiques();
            
            if (graphiques.length === 0) {
                throw new Error('Aucun graphique disponible pour l\'export');
            }

            // Générer le PDF complet avec données et graphiques
            const pdfBlob = await this._generateCompleteDashboardPDF(jsPDF, graphiques);
            
            // Télécharger le fichier
            const filename = `dashboard_complet_${this.state.dateDebut}_${this.state.dateFin}.pdf`;
            this._downloadBlob(pdfBlob, filename);
            
            this._showNotification("Export PDF avec graphiques réussi", { type: "success" });
            
        } catch (error) {
            console.error("❌ Erreur export PDF avec graphiques:", error);
            this._showNotification(`Erreur export: ${error.message}`, { type: "danger" });
        } finally {
            this.state.loadingStates.export = false;
        }
    }

    /**
     * Génère un PDF complet avec données et graphiques
     */
    async _generateCompleteDashboardPDF(jsPDF, graphiques) {
        // Créer le document PDF
        const doc = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: 'A4'
        });
        
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 15;
        const contentWidth = pageWidth - (margin * 2);
        
        let currentY = margin;
        
        // Titre principal
        doc.setFontSize(20);
        doc.setFont('helvetica', 'bold');
        doc.text('TABLEAU DE BORD PROJETS', pageWidth / 2, currentY, { align: 'center' });
        currentY += 10;
        
        // Période
        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        doc.text(`Période: ${this.state.dateDebut} au ${this.state.dateFin}`, pageWidth / 2, currentY, { align: 'center' });
        currentY += 15;
        
        // Métriques principales
        currentY = this._addMetricsSection(doc, currentY, margin, contentWidth, pageHeight);
        
        // Graphiques
        for (const graphique of graphiques) {
            // Vérifier l'espace disponible
            if (currentY + 100 > pageHeight - margin) {
                doc.addPage();
                currentY = margin;
            }
            
            // Titre du graphique
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.text(graphique.title, margin, currentY);
            currentY += 10;
            
            // Ajouter l'image du graphique
            try {
                const imgAspectRatio = graphique.dimensions.width / graphique.dimensions.height;
                const imgWidth = contentWidth * 0.8;
                const imgHeight = imgWidth / imgAspectRatio;
                const imgX = (pageWidth - imgWidth) / 2;
                
                doc.addImage(
                    graphique.imageData,
                    'PNG',
                    imgX,
                    currentY,
                    imgWidth,
                    imgHeight,
                    `graphique_${graphique.id}`,
                    'FAST'
                );
                
                currentY += imgHeight + 20;
            } catch (imageError) {
                console.error("❌ Erreur ajout image:", imageError);
                doc.setFontSize(10);
                doc.setTextColor(255, 0, 0);
                doc.text(`Erreur: Impossible d'ajouter le graphique ${graphique.title}`, margin, currentY);
                currentY += 10;
                doc.setTextColor(0, 0, 0);
            }
        }
        
        // Données détaillées des projets
        if (this.state.dashboardData.projets.length > 0) {
            if (currentY + 50 > pageHeight - margin) {
                doc.addPage();
                currentY = margin;
            }
            
            currentY = this._addProjectsTable(doc, currentY, margin, contentWidth, pageHeight);
        }
        
        // Pied de page
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(128, 128, 128);
            doc.text(
                `Page ${i} sur ${totalPages} - Généré le ${new Date().toLocaleDateString('fr-FR')}`,
                pageWidth / 2,
                pageHeight - 10,
                { align: 'center' }
            );
        }
        
        return doc.output('blob');
    }

    /**
     * Vérifie et initialise jsPDF
     */
    _ensureJsPDF() {
        return new Promise((resolve, reject) => {
            if (typeof window.jspdf !== 'undefined') {
                resolve(window.jspdf);
                return;
            }
            
            // Tentative de rechargement
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
            script.onload = () => {
                if (typeof window.jspdf !== 'undefined') {
                    resolve(window.jspdf);
                } else {
                    reject(new Error('jsPDF n\'a pas pu être chargé'));
                }
            };
            script.onerror = () => reject(new Error('Échec du chargement de jsPDF'));
            
            document.head.appendChild(script);
        });
    }

    // Méthode pour capturer les canvas des graphiques
    // async _captureGraphiqueCanvas(canvasId) {
    //     return new Promise((resolve) => {
    //         const canvas = document.getElementById(canvasId);
    //         if (!canvas) {
    //             resolve(null);
    //             return;
    //         }
            
    //         // Attendre que le graphique soit rendu
    //         setTimeout(() => {
    //             try {
    //                 const dataURL = canvas.toDataURL('image/png', 0.9);
    //                 resolve(dataURL);
    //             } catch (error) {
    //                 console.error(`Erreur capture ${canvasId}:`, error);
    //                 resolve(null);
    //             }
    //         }, 100);
    //     });
    // }

    /**
     * Génère un PDF complet avec données et graphiques
     */
    async _generateCompleteDashboardPDF(graphiques) {
        const { jsPDF } = window;
        
        // Créer le document PDF
        const doc = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: 'A4'
        });
        
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 15;
        const contentWidth = pageWidth - (margin * 2);
        
        let currentY = margin;
        
        // Titre principal
        doc.setFontSize(20);
        doc.setFont('helvetica', 'bold');
        doc.text('TABLEAU DE BORD PROJETS', pageWidth / 2, currentY, { align: 'center' });
        currentY += 10;
        
        // Période
        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        doc.text(`Période: ${this.state.dateDebut} au ${this.state.dateFin}`, pageWidth / 2, currentY, { align: 'center' });
        currentY += 15;
        
        // Métriques principales
        currentY = this._addMetricsSection(doc, currentY, margin, contentWidth, pageHeight);
        
        // Graphiques
        for (const graphique of graphiques) {
            // Vérifier l'espace disponible
            if (currentY + 100 > pageHeight - margin) {
                doc.addPage();
                currentY = margin;
            }
            
            // Titre du graphique
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.text(graphique.title, margin, currentY);
            currentY += 10;
            
            // Ajouter l'image du graphique
            const imgAspectRatio = graphique.dimensions.width / graphique.dimensions.height;
            const imgWidth = contentWidth * 0.8;
            const imgHeight = imgWidth / imgAspectRatio;
            const imgX = (pageWidth - imgWidth) / 2;
            
            doc.addImage(
                graphique.imageData,
                'PNG',
                imgX,
                currentY,
                imgWidth,
                imgHeight,
                `graphique_${graphique.id}`,
                'FAST'
            );
            
            currentY += imgHeight + 20;
        }
        
        // Données détaillées des projets
        if (this.state.dashboardData.projets.length > 0) {
            if (currentY + 50 > pageHeight - margin) {
                doc.addPage();
                currentY = margin;
            }
            
            currentY = this._addProjectsTable(doc, currentY, margin, contentWidth, pageHeight);
        }
        
        // Pied de page
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(128, 128, 128);
            doc.text(
                `Page ${i} sur ${totalPages} - Généré le ${new Date().toLocaleDateString('fr-FR')}`,
                pageWidth / 2,
                pageHeight - 10,
                { align: 'center' }
            );
        }
        
        return new Promise((resolve) => {
            const pdfBlob = doc.output('blob');
            resolve(pdfBlob);
        });
    }

    /**
     * Ajoute la section des métriques au PDF
     */
    _addMetricsSection(doc, currentY, margin, contentWidth, pageHeight) {
        const data = this.state.dashboardData;
        
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('MÉTRIQUES PRINCIPALES', margin, currentY);
        currentY += 10;
        
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        
        const metrics = [
            ['Chiffre d\'affaires:', this.formatCurrency(data.chiffre_affaires)],
            ['Projets en cours:', `${data.projets.length} projet(s)`],
            ['Personnel mobilisé:', `${this.getTotalPersonnel()} personne(s)`],
            ['Heures totales:', `${this.getTotalHeures().toFixed(0)}h`],
            ['Marge administrative:', `${data.marge_administrative?.taux_marge_admin?.toFixed(1) || 0}%`]
        ];
        
        metrics.forEach(([label, value]) => {
            doc.text(`${label} ${value}`, margin + 5, currentY);
            currentY += 7;
        });
        
        return currentY + 10;
    }

    /**
     * Ajoute le tableau des projets au PDF
     */
    _addProjectsTable(doc, currentY, margin, contentWidth, pageHeight) {
        const data = this.state.dashboardData;
        
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('DÉTAIL DES PROJETS', margin, currentY);
        currentY += 10;
        
        // En-têtes du tableau
        const headers = ['Projet', 'CA', 'Personnes', 'Heures', 'Marge'];
        const colWidths = [contentWidth * 0.4, contentWidth * 0.15, contentWidth * 0.15, contentWidth * 0.15, contentWidth * 0.15];
        
        // Dessiner les en-têtes
        doc.setFont('helvetica', 'bold');
        let x = margin;
        headers.forEach((header, i) => {
            doc.text(header, x, currentY);
            x += colWidths[i];
        });
        currentY += 8;
        
        // Ligne de séparation
        doc.line(margin, currentY - 2, margin + contentWidth, currentY - 2);
        currentY += 5;
        
        // Données des projets
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        
        data.projets.slice(0, 20).forEach(projet => { // Limiter à 20 projets
            if (currentY + 10 > pageHeight - margin) {
                doc.addPage();
                currentY = margin;
                // Redessiner les en-têtes
                doc.setFont('helvetica', 'bold');
                let x = margin;
                headers.forEach((header, i) => {
                    doc.text(header, x, currentY);
                    x += colWidths[i];
                });
                currentY += 8;
                doc.line(margin, currentY - 2, margin + contentWidth, currentY - 2);
                currentY += 5;
                doc.setFont('helvetica', 'normal');
            }
            
            let x = margin;
            
            // Nom du projet (tronqué)
            const projetName = projet.name.length > 30 ? projet.name.substring(0, 27) + '...' : projet.name;
            doc.text(projetName, x, currentY);
            x += colWidths[0];
            
            // CA
            doc.text(this.formatCurrency(projet.ca), x, currentY, { align: 'right' });
            x += colWidths[1];
            
            // Personnes
            doc.text(projet.nb_personnes.toString(), x, currentY, { align: 'center' });
            x += colWidths[2];
            
            // Heures
            doc.text(projet.heures.toFixed(0), x, currentY, { align: 'center' });
            x += colWidths[3];
            
            // Marge
            const marge = this.getMargeProjet(projet);
            doc.text(`${marge.toFixed(1)}%`, x, currentY, { align: 'right' });
            
            currentY += 6;
        });
        
        return currentY + 10;
    }



































    /**
     * Exporte les graphiques en PDF (version simplifiée)
     */
    async exportGraphiquesToPDFSimple() {
        try {
            // Vérifier que jsPDF est disponible
            if (typeof window.jspdf === 'undefined') {
                // Charger jsPDF dynamiquement
                await this._loadJsPDF();
            }
            
            const { jsPDF } = window.jspdf;
            
            // Capturer les graphiques
            const graphiques = await this._captureAllGraphiques();
            
            if (graphiques.length === 0) {
                this._showNotification("Aucun graphique à exporter", { type: "warning" });
                return;
            }
            
            const doc = new jsPDF();
            let yPosition = 20;
            
            // Titre
            doc.setFontSize(16);
            doc.text('Graphiques Dashboard', 20, yPosition);
            yPosition += 15;
            
            doc.setFontSize(10);
            doc.text(`Période: ${this.state.dateDebut} au ${this.state.dateFin}`, 20, yPosition);
            yPosition += 20;
            
            // Ajouter chaque graphique
            for (const graphique of graphiques) {
                if (yPosition > 250) { // Nouvelle page si nécessaire
                    doc.addPage();
                    yPosition = 20;
                }
                
                // Titre du graphique
                doc.setFontSize(12);
                doc.text(graphique.title, 20, yPosition);
                yPosition += 10;
                
                try {
                    // Ajouter l'image (taille réduite pour le PDF)
                    doc.addImage(
                        graphique.imageData,
                        'PNG',
                        20,
                        yPosition,
                        170,
                        100,
                        `graphique_${graphique.id}`,
                        'FAST'
                    );
                    yPosition += 110;
                } catch (error) {
                    console.error("Erreur ajout image:", error);
                    doc.setFontSize(10);
                    doc.setTextColor(255, 0, 0);
                    doc.text('Erreur lors de l\'ajout du graphique', 20, yPosition);
                    doc.setTextColor(0, 0, 0);
                    yPosition += 15;
                }
                
                yPosition += 10;
            }
            
            // Sauvegarder le PDF
            doc.save(`graphiques_dashboard_${this.state.dateDebut}_${this.state.dateFin}.pdf`);
            this._showNotification("Export des graphiques réussi", { type: "success" });
            
        } catch (error) {
            console.error("❌ Erreur export graphiques:", error);
            this._showNotification(`Erreur export: ${error.message}`, { type: "danger" });
        }
    }

    /**
     * Charge jsPDF dynamiquement
     */
    _loadJsPDF() {
        return new Promise((resolve, reject) => {
            if (typeof window.jspdf !== 'undefined') {
                resolve();
                return;
            }
            
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
            script.onload = () => {
                if (typeof window.jspdf !== 'undefined') {
                    resolve();
                } else {
                    reject(new Error('jsPDF non chargé'));
                }
            };
            script.onerror = reject;
            
            document.head.appendChild(script);
        });
    }











    /**
     * Capture tous les graphiques disponibles
     */
    async _captureAllGraphiques() {
        const graphiques = [];
        
        const graphiqueConfigs = [
            { id: 'graphique-ca', title: 'Chiffre d\'Affaires par Projet' },
            { id: 'graphique-statuts', title: 'Répartition par Statut' },
            { id: 'graphique-evolution', title: 'Évolution Mensuelle du CA' }
        ];
        
        for (const config of graphiqueConfigs) {
            try {
                const canvas = document.getElementById(config.id);
                if (canvas) {
                    const imageData = await this._captureGraphiqueCanvas(config.id);
                    if (imageData) {
                        graphiques.push({
                            ...config,
                            imageData,
                            dimensions: {
                                width: canvas.width,
                                height: canvas.height
                            }
                        });
                    }
                }
            } catch (error) {
                console.error(`❌ Erreur capture ${config.id}:`, error);
            }
        }
        
        return graphiques;
    }

    /**
     * Capture un canvas graphique en image
     */
    _captureGraphiqueCanvas(canvasId) {
        return new Promise((resolve) => {
            const canvas = document.getElementById(canvasId);
            if (!canvas) {
                resolve(null);
                return;
            }
            
            // Attendre que le graphique soit complètement rendu
            setTimeout(() => {
                try {
                    // Créer un canvas temporaire avec fond blanc
                    const tempCanvas = document.createElement('canvas');
                    const tempCtx = tempCanvas.getContext('2d');
                    
                    tempCanvas.width = canvas.width;
                    tempCanvas.height = canvas.height;
                    
                    // Fond blanc
                    tempCtx.fillStyle = 'white';
                    tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
                    
                    // Dessiner le graphique
                    tempCtx.drawImage(canvas, 0, 0);
                    
                    // Convertir en data URL
                    const dataURL = tempCanvas.toDataURL('image/png', 0.9);
                    resolve(dataURL);
                    
                } catch (error) {
                    console.error(`Erreur capture canvas ${canvasId}:`, error);
                    resolve(null);
                }
            }, 500); // Délai plus long pour s'assurer du rendu
        });
    }










    /**
     * Exporte les diagrammes Chart.js en PDF
     * @param {Object} options - Options d'export
     */
    async exportGraphiquesToPDF(options = {}) {
        try {
            console.log("📊 Début export diagrammes PDF");
            
            // Configuration par défaut
            const config = {
                filename: `graphiques_dashboard_${this.state.dateDebut}_${this.state.dateFin}.pdf`,
                title: `Graphiques Dashboard - ${this.state.dateDebut} au ${this.state.dateFin}`,
                includeData: true,
                pageSize: 'A4',
                orientation: 'landscape',
                quality: 0.95,
                ...options
            };

            // Vérifier que jsPDF est disponible
            if (typeof window.jsPDF === 'undefined') {
                throw new Error('jsPDF n\'est pas disponible. Veuillez l\'inclure dans votre template.');
            }

            this.state.loadingStates.export = true;
            
            // Capturer les graphiques
            const graphiques = await this._captureAllGraphiques();
            
            if (graphiques.length === 0) {
                throw new Error('Aucun graphique disponible pour l\'export');
            }

            // Générer le PDF
            const pdfBlob = await this._generateGraphiquesPDF(graphiques, config);
            
            // Télécharger le fichier
            this._downloadBlob(pdfBlob, config.filename);
            
            this._showNotification("Export des graphiques réussi", { type: "success" });
            console.log("✅ Export diagrammes PDF terminé");
            
        } catch (error) {
            console.error("❌ Erreur export diagrammes:", error);
            this._showNotification(`Erreur export: ${error.message}`, { type: "danger" });
        } finally {
            this.state.loadingStates.export = false;
        }
    }

    /**
     * Capture tous les graphiques disponibles
     * @returns {Array} Liste des graphiques capturés
     * @private
     */
    // async _captureAllGraphiques() {
    //     const graphiques = [];
        
    //     // Liste des graphiques à capturer
    //     const graphiqueConfigs = [
    //         {
    //             id: 'graphique-ca',
    //             title: 'Chiffre d\'Affaires par Projet',
    //             chart: this.graphiqueCA
    //         },
    //         {
    //             id: 'graphique-statuts',
    //             title: 'Répartition par Statut',
    //             chart: this.graphiqueStatuts
    //         },
    //         {
    //             id: 'graphique-evolution',
    //             title: 'Évolution Mensuelle du CA',
    //             chart: this.graphiqueEvolution
    //         }
    //     ];
        
    //     for (const config of graphiqueConfigs) {
    //         try {
    //             const canvas = document.getElementById(config.id);
    //             const chart = config.chart;
                
    //             if (canvas && chart) {
    //                 // Capturer l'image du graphique
    //                 const imageData = await this._captureGraphique(chart, canvas);
                    
    //                 if (imageData) {
    //                     graphiques.push({
    //                         ...config,
    //                         imageData,
    //                         dimensions: {
    //                             width: canvas.width,
    //                             height: canvas.height
    //                         }
    //                     });
    //                     console.log(`📸 Graphique capturé: ${config.title}`);
    //                 }
    //             } else {
    //                 console.warn(`⚠️ Graphique non trouvé: ${config.id}`);
    //             }
    //         } catch (error) {
    //             console.error(`❌ Erreur capture ${config.id}:`, error);
    //         }
    //     }
        
    //     return graphiques;
    // }

    /**
     * Capture un graphique Chart.js en image
     * @param {Chart} chart - Instance Chart.js
     * @param {HTMLCanvasElement} canvas - Élément canvas
     * @returns {Promise<string>} Data URL de l'image
     * @private
     */
    async _captureGraphique(chart, canvas) {
        return new Promise((resolve, reject) => {
            try {
                // Forcer le rendu du graphique
                chart.update('none');
                
                // Attendre que le rendu soit terminé
                setTimeout(() => {
                    try {
                        // Capturer avec fond blanc pour le PDF
                        const tempCanvas = document.createElement('canvas');
                        const tempCtx = tempCanvas.getContext('2d');
                        
                        tempCanvas.width = canvas.width;
                        tempCanvas.height = canvas.height;
                        
                        // Fond blanc
                        tempCtx.fillStyle = 'white';
                        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
                        
                        // Dessiner le graphique par-dessus
                        tempCtx.drawImage(canvas, 0, 0);
                        
                        // Convertir en data URL
                        const dataURL = tempCanvas.toDataURL('image/png', 0.95);
                        resolve(dataURL);
                        
                    } catch (error) {
                        reject(error);
                    }
                }, 100);
                
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Génère le PDF avec les graphiques
     * @param {Array} graphiques - Liste des graphiques capturés
     * @param {Object} config - Configuration PDF
     * @returns {Promise<Blob>} Blob PDF
     * @private
     */
    async _generateGraphiquesPDF(graphiques, config) {
        const { jsPDF } = window;
        
        // Créer le document PDF
        const doc = new jsPDF({
            orientation: config.orientation,
            unit: 'mm',
            format: config.pageSize
        });
        
        // Dimensions de la page
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 15;
        const contentWidth = pageWidth - (margin * 2);
        
        let currentY = margin;
        
        // Titre principal
        doc.setFontSize(20);
        doc.setFont('helvetica', 'bold');
        doc.text(config.title, pageWidth / 2, currentY, { align: 'center' });
        currentY += 15;
        
        // Informations de génération
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        const dateGeneration = new Date().toLocaleDateString('fr-FR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        doc.text(`Généré le ${dateGeneration}`, pageWidth / 2, currentY, { align: 'center' });
        currentY += 20;
        
        // Traiter chaque graphique
        for (let i = 0; i < graphiques.length; i++) {
            const graphique = graphiques[i];
            
            // Vérifier si on a assez de place (estimation)
            const estimatedHeight = 120; // Hauteur estimée pour un graphique + titre
            
            if (currentY + estimatedHeight > pageHeight - margin) {
                doc.addPage();
                currentY = margin;
            }
            
            // Titre du graphique
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.text(graphique.title, margin, currentY);
            currentY += 10;
            
            // Calculer les dimensions de l'image
            const imgAspectRatio = graphique.dimensions.width / graphique.dimensions.height;
            const maxWidth = contentWidth;
            const maxHeight = 100; // Hauteur max pour un graphique
            
            let imgWidth = maxWidth;
            let imgHeight = maxWidth / imgAspectRatio;
            
            if (imgHeight > maxHeight) {
                imgHeight = maxHeight;
                imgWidth = maxHeight * imgAspectRatio;
            }
            
            // Centrer l'image
            const imgX = (pageWidth - imgWidth) / 2;
            
            try {
                // Ajouter l'image au PDF
                doc.addImage(
                    graphique.imageData,
                    'PNG',
                    imgX,
                    currentY,
                    imgWidth,
                    imgHeight,
                    `graphique_${i}`,
                    'FAST'
                );
                
                currentY += imgHeight + 15;
                
            } catch (error) {
                console.error(`❌ Erreur ajout image ${graphique.title}:`, error);
                
                // Texte d'erreur si l'image ne peut pas être ajoutée
                doc.setFontSize(12);
                doc.setTextColor(255, 0, 0);
                doc.text(`Erreur: Impossible d'inclure le graphique ${graphique.title}`, margin, currentY);
                doc.setTextColor(0, 0, 0);
                currentY += 10;
            }
            
            // Ajouter des données si demandé
            if (config.includeData) {
                currentY = await this._addGraphiqueData(doc, graphique, currentY, margin, contentWidth, pageHeight);
            }
            
            // Espacement entre graphiques
            currentY += 10;
        }
        
        // Pied de page sur toutes les pages
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(128, 128, 128);
            doc.text(
                `Page ${i} sur ${totalPages}`,
                pageWidth / 2,
                pageHeight - 10,
                { align: 'center' }
            );
        }
        
        // Retourner le PDF comme blob
        return new Promise((resolve) => {
            const pdfBlob = doc.output('blob');
            resolve(pdfBlob);
        });
    }

    /**
     * Ajoute les données du graphique au PDF
     * @param {jsPDF} doc - Document PDF
     * @param {Object} graphique - Graphique avec données
     * @param {number} currentY - Position Y actuelle
     * @param {number} margin - Marge
     * @param {number} contentWidth - Largeur du contenu
     * @param {number} pageHeight - Hauteur de la page
     * @returns {Promise<number>} Nouvelle position Y
     * @private
     */
    async _addGraphiqueData(doc, graphique, currentY, margin, contentWidth, pageHeight) {
        try {
            const chart = graphique.chart;
            if (!chart || !chart.data) return currentY;
            
            const data = chart.data;
            
            // Vérifier l'espace disponible
            const minSpaceNeeded = 40;
            if (currentY + minSpaceNeeded > pageHeight - margin) {
                doc.addPage();
                currentY = margin;
            }
            
            // Titre des données
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text('Données:', margin, currentY);
            currentY += 8;
            
            // Préparer les données pour le tableau
            const tableData = [];
            const labels = data.labels || [];
            
            if (data.datasets && data.datasets.length > 0) {
                const dataset = data.datasets[0];
                const values = dataset.data || [];
                
                // En-têtes
                tableData.push(['Item', 'Valeur']);
                
                // Données
                for (let i = 0; i < Math.min(labels.length, values.length, 10); i++) {
                    const label = labels[i] || `Item ${i + 1}`;
                    const value = this._formatValueForTable(values[i], graphique.id);
                    tableData.push([label, value]);
                }
                
                if (labels.length > 10) {
                    tableData.push(['...', '(données tronquées)']);
                }
            }
            
            // Créer le tableau avec autoTable si disponible
            if (typeof doc.autoTable === 'function' && tableData.length > 1) {
                doc.autoTable({
                    startY: currentY,
                    head: [tableData[0]],
                    body: tableData.slice(1),
                    styles: {
                        fontSize: 8,
                        cellPadding: 2
                    },
                    headStyles: {
                        fillColor: [52, 58, 64],
                        textColor: 255,
                        fontStyle: 'bold'
                    },
                    columnStyles: {
                        0: { cellWidth: contentWidth * 0.6 },
                        1: { cellWidth: contentWidth * 0.4, halign: 'right' }
                    },
                    margin: { left: margin, right: margin }
                });
                
                currentY = doc.lastAutoTable.finalY + 5;
            } else {
                // Fallback sans autoTable
                doc.setFontSize(8);
                for (let i = 1; i < Math.min(tableData.length, 6); i++) {
                    const row = tableData[i];
                    doc.text(`${row[0]}: ${row[1]}`, margin + 5, currentY);
                    currentY += 4;
                }
            }
            
            return currentY;
            
        } catch (error) {
            console.error("❌ Erreur ajout données graphique:", error);
            return currentY;
        }
    }

    /**
     * Formate une valeur pour l'affichage dans le tableau
     * @param {*} value - Valeur à formater
     * @param {string} graphiqueId - ID du graphique pour le contexte
     * @returns {string} Valeur formatée
     * @private
     */
    _formatValueForTable(value, graphiqueId) {
        if (value === null || value === undefined) return '-';
        
        if (typeof value === 'number') {
            if (graphiqueId.includes('ca') || graphiqueId.includes('evolution')) {
                return this.formatCurrency(value);
            } else if (graphiqueId.includes('statuts')) {
                return `${value} projet${value > 1 ? 's' : ''}`;
            } else {
                return value.toLocaleString('fr-FR');
            }
        }
        
        return String(value);
    }

    /**
     * Télécharge un blob comme fichier
     * @param {Blob} blob - Blob à télécharger
     * @param {string} filename - Nom du fichier
     * @private
     */
    _downloadBlob(blob, filename) {
        try {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            
            link.href = url;
            link.download = filename;
            link.style.display = 'none';
            
            document.body.appendChild(link);
            link.click();
            
            // Nettoyer après un délai
            setTimeout(() => {
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            }, 100);
            
        } catch (error) {
            console.error("❌ Erreur téléchargement:", error);
            throw new Error('Impossible de télécharger le fichier');
        }
    }

    /**
     * Exporte un graphique spécifique en PDF
     * @param {string} graphiqueId - ID du graphique à exporter
     */
    async exportSingleGraphiquePDF(graphiqueId) {
        try {
            const graphiqueConfigs = {
                'graphique-ca': {
                    title: 'Chiffre d\'Affaires par Projet',
                    chart: this.graphiqueCA
                },
                'graphique-statuts': {
                    title: 'Répartition par Statut',
                    chart: this.graphiqueStatuts
                },
                'graphique-evolution': {
                    title: 'Évolution Mensuelle du CA',
                    chart: this.graphiqueEvolution
                }
            };
            
            const config = graphiqueConfigs[graphiqueId];
            if (!config) {
                throw new Error(`Graphique ${graphiqueId} non trouvé`);
            }
            
            const canvas = document.getElementById(graphiqueId);
            if (!canvas || !config.chart) {
                throw new Error(`Graphique ${graphiqueId} non disponible`);
            }
            
            // Capturer le graphique
            const imageData = await this._captureGraphique(config.chart, canvas);
            
            const graphique = {
                id: graphiqueId,
                title: config.title,
                chart: config.chart,
                imageData,
                dimensions: {
                    width: canvas.width,
                    height: canvas.height
                }
            };
            
            // Générer le PDF avec un seul graphique
            const pdfBlob = await this._generateGraphiquesPDF([graphique], {
                filename: `${graphiqueId}_${this.state.dateDebut}_${this.state.dateFin}.pdf`,
                title: config.title,
                includeData: true
            });
            
            this._downloadBlob(pdfBlob, `${graphiqueId}_${this.state.dateDebut}_${this.state.dateFin}.pdf`);
            
            this._showNotification(`Export ${config.title} réussi`, { type: "success" });
            
        } catch (error) {
            console.error(`❌ Erreur export ${graphiqueId}:`, error);
            this._showNotification(`Erreur export: ${error.message}`, { type: "danger" });
        }
    }

    // ===== MÉTHODES D'EXPORT SPÉCIALISÉES =====

    /**
     * Exporte le graphique CA en PDF
     */
    async exportGraphiqueCA() {
        return await this.exportSingleGraphiquePDF('graphique-ca');
    }

    /**
     * Exporte le graphique des statuts en PDF
     */
    async exportGraphiqueStatuts() {
        return await this.exportSingleGraphiquePDF('graphique-statuts');
    }

    /**
     * Exporte le graphique d'évolution en PDF
     */
    async exportGraphiqueEvolution() {
        return await this.exportSingleGraphiquePDF('graphique-evolution');
    }

    /**
     * Exporte tous les graphiques avec options avancées
     */
    async exportAllGraphiquesAdvanced() {
        const options = {
            includeData: true,
            orientation: 'landscape', // Paysage pour plus d'espace
            title: `Rapport Graphiques Complet - Dashboard ${this.state.dateDebut} au ${this.state.dateFin}`,
            filename: `rapport_graphiques_complet_${this.state.dateDebut}_${this.state.dateFin}.pdf`
        };
        
        return await this.exportGraphiquesToPDF(options);
    }

    /**
     * Prévisualise les graphiques avant export
     */
    async previewGraphiquesExport() {
        try {
            const graphiques = await this._captureAllGraphiques();
            
            if (graphiques.length === 0) {
                this._showNotification("Aucun graphique disponible", { type: "warning" });
                return;
            }
            
            // Créer une modal de prévisualisation
            const modal = this._createPreviewModal(graphiques);
            document.body.appendChild(modal);
            
            // Afficher la modal
            modal.style.display = 'block';
            
        } catch (error) {
            console.error("❌ Erreur prévisualisation:", error);
            this._showNotification(`Erreur: ${error.message}`, { type: "danger" });
        }
    }

    /**
     * Crée une modal de prévisualisation
     * @param {Array} graphiques - Liste des graphiques
     * @returns {HTMLElement} Élément modal
     * @private
     */
    _createPreviewModal(graphiques) {
        const modal = document.createElement('div');
        modal.className = 'modal fade';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 9999;
            display: none;
        `;
        
        const modalContent = document.createElement('div');
        modalContent.className = 'modal-dialog modal-lg';
        modalContent.style.cssText = `
            position: relative;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            border-radius: 8px;
            max-height: 80vh;
            overflow-y: auto;
            padding: 20px;
        `;
        
        let content = `
            <div class="modal-header">
                <h5>Prévisualisation Export PDF</h5>
                <button type="button" class="close" onclick="this.closest('.modal').remove()">×</button>
            </div>
            <div class="modal-body">
                <p><strong>${graphiques.length}</strong> graphique(s) seront exportés :</p>
        `;
        
        graphiques.forEach(graphique => {
            content += `
                <div style="margin-bottom: 20px; border: 1px solid #ddd; padding: 10px; border-radius: 4px;">
                    <h6>${graphique.title}</h6>
                    <img src="${graphique.imageData}" style="max-width: 100%; height: auto; border: 1px solid #ccc;">
                </div>
            `;
        });
        
        content += `
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Annuler</button>
                <button class="btn btn-primary" onclick="window.dashboardInstance.exportGraphiquesToPDF(); this.closest('.modal').remove();">
                    Exporter en PDF
                </button>
            </div>
        `;
        
        modalContent.innerHTML = content;
        modal.appendChild(modalContent);
        
        return modal;
    }





































    






















    // Mettre à jour la méthode _validateAndNormalizeDashboardData
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
            
            // Données budget
            if (data.budget_data && typeof data.budget_data === 'object') {
                const bd = data.budget_data;
                normalized.budget_data = {
                    total_budget: this._safeNumber(bd.total_budget),
                    budget_utilise: this._safeNumber(bd.budget_utilise),
                    budget_restant: this._safeNumber(bd.budget_restant),
                    taux_utilisation: this._safeNumber(bd.taux_utilisation),
                    projets_budget: Array.isArray(bd.projets_budget) ? 
                        bd.projets_budget.map(projet => ({
                            id: projet.id || 0,
                            name: projet.name || 'Projet sans nom',
                            budget: this._safeNumber(projet.budget),
                            ca_realise: this._safeNumber(projet.ca_realise),
                            taux_utilisation: this._safeNumber(projet.taux_utilisation),
                            budget_restant: this._safeNumber(projet.budget_restant)
                        })) : []
                };
            }
            
            // Données graphiques
            if (data.graphique_data && typeof data.graphique_data === 'object') {
                const gd = data.graphique_data;
                normalized.graphique_data = {
                    graphique_ca: gd.graphique_ca || { labels: [], data: [], backgroundColors: [] },
                    graphique_statuts: gd.graphique_statuts || { labels: [], data: [], backgroundColors: [] },
                    graphique_evolution: gd.graphique_evolution || { labels: [], data: [] }
                };
            }
        }

        return normalized;
    }

    // Mettre à jour la méthode _getEmptyDashboardData
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
            budget_data: {
                total_budget: 0,
                budget_utilise: 0,
                budget_restant: 0,
                taux_utilisation: 0,
                projets_budget: []
            },
            graphique_data: {
                graphique_ca: { labels: [], data: [], backgroundColors: [] },
                graphique_statuts: { labels: [], data: [], backgroundColors: [] },
                graphique_evolution: { labels: [], data: [] }
            }
        };
    }

    // Ajouter la méthode willDestroy pour nettoyer les graphiques
    willDestroy() {
        if (this.dateChangeTimeout) {
            clearTimeout(this.dateChangeTimeout);
        }
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
        
        // Détruire les graphiques
        this._destroyGraphiques();
    }

    // Ajouter des helpers pour les données budget
    getBudgetUtilisationClass(taux) {
        if (taux <= 70) return "bg-success";
        if (taux <= 90) return "bg-warning text-dark";
        return "bg-danger";
    }

    getBudgetUtilisationText(taux) {
        if (taux <= 70) return "Sous contrôle";
        if (taux <= 90) return "Attention";
        return "Dépassement";
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

    // ===== ANALYSIS METHODS =====

    /**
     * Calcule la durée de la période en jours
     */
    getPeriodDuration() {
        if (!this.state.dateDebut || !this.state.dateFin) return 0;
        
        const start = new Date(this.state.dateDebut);
        const end = new Date(this.state.dateFin);
        const diffTime = Math.abs(end - start);
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    }

    /**
     * Calcule la moyenne quotidienne de CA
     */
    getDailyAverageCA() {
        const duration = this.getPeriodDuration();
        if (duration === 0) return 0;
        
        return this.state.dashboardData.chiffre_affaires / duration;
    }

    /**
     * Calcule les heures par personne
     */
    getHoursPerPerson() {
        const totalPersonnel = this.getTotalPersonnel();
        if (totalPersonnel === 0) return 0;
        
        return this.getTotalHeures() / totalPersonnel;
    }

    /**
     * Calcule le CA moyen par projet
     */
    getAverageCAPerProject() {
        const projectCount = this.state.dashboardData.projets?.length || 0;
        if (projectCount === 0) return 0;
        
        return this.state.dashboardData.chiffre_affaires / projectCount;
    }

    /**
     * Calcule la taille moyenne d'équipe
     */
    getAverageTeamSize() {
        const projectCount = this.state.dashboardData.projets?.length || 0;
        if (projectCount === 0) return 0;
        
        return this.getTotalPersonnel() / projectCount;
    }

    /**
     * Retourne un label d'efficacité de marge
     */
    getMarginEfficiencyLabel() {
        const margin = this.state.dashboardData.marge_administrative?.taux_marge_admin || 0;
        
        if (margin >= 20) return "Excellente";
        if (margin >= 15) return "Bonne";
        if (margin >= 10) return "Moyenne";
        if (margin >= 5) return "Faible";
        return "Critique";
    }

    /**
     * Recommandation sur les ressources
     */
    getPersonnelRecommendation() {
        const totalPersonnel = this.getTotalPersonnel();
        
        if (totalPersonnel > 30) {
            return "Charge de travail élevée - envisagez de redistribuer les ressources";
        } else if (totalPersonnel > 20) {
            return "Charge modérée - surveillance recommandée";
        } else if (totalPersonnel > 10) {
            return "Charge optimale - bon équilibre ressources/projets";
        } else {
            return "Capacité disponible - possibilité de nouveaux projets";
        }
    }

    /**
     * Recommandation sur la marge
     */
    getMarginRecommendation() {
        const margin = this.state.dashboardData.marge_administrative?.taux_marge_admin || 0;
        
        if (margin >= 20) {
            return "Performance exceptionnelle - maintenez cette trajectoire";
        } else if (margin >= 15) {
            return "Bonne rentabilité - opportunités d'optimisation limitées";
        } else if (margin >= 10) {
            return "Rentabilité acceptable - analysez les coûts pour amélioration";
        } else if (margin >= 5) {
            return "Rentabilité faible - revoir la structure des coûts urgente";
        } else {
            return "Situation critique - audit financier immédiat nécessaire";
        }
    }

    /**
     * Recommandation sur le portefeuille
     */
    getPortfolioRecommendation() {
        const projectCount = this.state.dashboardData.projets?.length || 0;
        const avgMargin = this.state.dashboardData.marge_administrative?.taux_marge_admin || 0;
        
        if (projectCount === 0) {
            return "Aucun projet actif - développez le portefeuille commercial";
        }
        
        let recommendation = `${projectCount} projet(s) en cours. `;
        
        if (projectCount > 15) {
            recommendation += "Portefeuille très diversifié - concentrez-vous sur la rentabilité";
        } else if (projectCount > 8) {
            recommendation += "Portefeuille équilibré - bon mix risque/rendement";
        } else {
            recommendation += "Portefeuille concentré - envisagez de diversifier";
        }
        
        if (avgMargin < 10) {
            recommendation += " | Attention: rentabilité globale faible";
        }
        
        return recommendation;
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
        if (amount === undefined || amount === null) return "0 CFA";
        return new Intl.NumberFormat('fr-FR', {
            style: 'currency',
            currency: 'XOF',
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
}

// Register the component
registry.category("actions").add("dashboard_projet.dashboard", DashboardProjet);