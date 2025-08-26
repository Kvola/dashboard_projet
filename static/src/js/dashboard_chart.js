/** @odoo-module */

/**
 * Gestionnaire des graphiques pour le dashboard projet
 * Utilise Chart.js pour créer des visualisations interactives
 */
export class DashboardCharts {
    constructor(dashboardComponent) {
        this.component = dashboardComponent;
        this.charts = {};
        this.colors = {
            primary: '#3498db',
            success: '#27ae60',
            warning: '#f39c12',
            danger: '#e74c3c',
            secondary: '#6c757d',
            info: '#17a2b8',
            light: '#f8f9fa',
            dark: '#343a40'
        };
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;
        
        try {
            // Vérifier que Chart.js est disponible
            if (typeof Chart === 'undefined') {
                console.warn('Chart.js non disponible, chargement depuis CDN...');
                await this.loadChartJS();
            }
            
            this.setupChartDefaults();
            this.initialized = true;
            console.log('✅ Dashboard Charts initialisé');
            
        } catch (error) {
            console.error('❌ Erreur initialisation Chart.js:', error);
        }
    }

    async loadChartJS() {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    setupChartDefaults() {
        if (typeof Chart !== 'undefined') {
            Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            Chart.defaults.font.size = 12;
            Chart.defaults.color = '#6c757d';
            Chart.defaults.plugins.legend.position = 'bottom';
            Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(0,0,0,0.8)';
            Chart.defaults.plugins.tooltip.titleColor = '#ffffff';
            Chart.defaults.plugins.tooltip.bodyColor = '#ffffff';
            Chart.defaults.plugins.tooltip.cornerRadius = 8;
        }
    }

    // ===== GRAPHIQUE ÉVOLUTION CA =====
    
    createCaEvolutionChart(canvasId, data) {
        try {
            const ctx = document.getElementById(canvasId);
            if (!ctx || !data || data.length === 0) {
                console.warn(`Canvas ${canvasId} non trouvé ou données vides`);
                return null;
            }

            // Destruction du graphique existant
            if (this.charts[canvasId]) {
                this.charts[canvasId].destroy();
            }

            const chartData = {
                labels: data.map(item => this.formatPeriodLabel(item.periode || item.date)),
                datasets: [
                    {
                        label: 'CA Réalisé',
                        data: data.map(item => item.ca_realise || item.ca || 0),
                        borderColor: this.colors.primary,
                        backgroundColor: this.addAlpha(this.colors.primary, 0.1),
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 6,
                        pointHoverRadius: 8,
                        pointBackgroundColor: this.colors.primary,
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2
                    },
                    {
                        label: 'CA Prévu',
                        data: data.map(item => item.ca_prevu || (item.ca || 0) * 1.1),
                        borderColor: this.colors.secondary,
                        backgroundColor: this.addAlpha(this.colors.secondary, 0.05),
                        borderWidth: 2,
                        borderDash: [5, 5],
                        fill: false,
                        tension: 0.4,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        pointBackgroundColor: this.colors.secondary
                    }
                ]
            };

            const options = {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    title: {
                        display: true,
                        text: 'Évolution du Chiffre d\'Affaires',
                        font: { size: 16, weight: 'bold' }
                    },
                    legend: {
                        display: true,
                        position: 'bottom',
                        labels: {
                            usePointStyle: true,
                            padding: 20
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const value = context.parsed.y;
                                return `${context.dataset.label}: ${this.formatCurrency(value)}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: (value) => this.formatCurrency(value)
                        },
                        grid: {
                            color: 'rgba(0,0,0,0.05)'
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        }
                    }
                },
                elements: {
                    point: {
                        hoverBorderWidth: 3
                    }
                }
            };

            this.charts[canvasId] = new Chart(ctx, {
                type: 'line',
                data: chartData,
                options: options
            });

            return this.charts[canvasId];

        } catch (error) {
            console.error(`❌ Erreur création graphique CA ${canvasId}:`, error);
            return null;
        }
    }

    // ===== GRAPHIQUE PROJETS PAR STATUT =====
    
    createProjectsStageChart(canvasId, data) {
        try {
            const ctx = document.getElementById(canvasId);
            if (!ctx || !data || data.length === 0) {
                console.warn(`Canvas ${canvasId} non trouvé ou données vides`);
                return null;
            }

            if (this.charts[canvasId]) {
                this.charts[canvasId].destroy();
            }

            // Palette de couleurs pour les statuts
            const statusColors = [
                this.colors.success,
                this.colors.primary,
                this.colors.warning,
                this.colors.danger,
                this.colors.info,
                this.colors.secondary
            ];

            const chartData = {
                labels: data.map(item => item.stage || item.statut || 'Non défini'),
                datasets: [{
                    label: 'Nombre de projets',
                    data: data.map(item => item.count || item.nombre || 0),
                    backgroundColor: statusColors.slice(0, data.length).map(color => this.addAlpha(color, 0.8)),
                    borderColor: statusColors.slice(0, data.length),
                    borderWidth: 2,
                    hoverOffset: 10
                }]
            };

            const options = {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Répartition des Projets par Statut',
                        font: { size: 16, weight: 'bold' }
                    },
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 15,
                            usePointStyle: true
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = ((context.parsed / total) * 100).toFixed(1);
                                return `${context.label}: ${context.parsed} projet(s) (${percentage}%)`;
                            }
                        }
                    }
                }
            };

            this.charts[canvasId] = new Chart(ctx, {
                type: 'doughnut',
                data: chartData,
                options: options
            });

            return this.charts[canvasId];

        } catch (error) {
            console.error(`❌ Erreur création graphique projets ${canvasId}:`, error);
            return null;
        }
    }

    // ===== GRAPHIQUE MARGES =====
    
    createMargeChart(canvasId, data) {
        try {
            const ctx = document.getElementById(canvasId);
            if (!ctx || !data || data.length === 0) {
                console.warn(`Canvas ${canvasId} non trouvé ou données vides`);
                return null;
            }

            if (this.charts[canvasId]) {
                this.charts[canvasId].destroy();
            }

            // Tri des projets par CA décroissant
            const sortedData = [...data].sort((a, b) => (b.ca || 0) - (a.ca || 0));
            
            const chartData = {
                labels: sortedData.map(item => this.truncateLabel(item.projet_name || item.name, 15)),
                datasets: [
                    {
                        label: 'Taux de Marge (%)',
                        data: sortedData.map(item => item.marge || item.taux_marge || 0),
                        backgroundColor: sortedData.map(item => {
                            const marge = item.marge || item.taux_marge || 0;
                            if (marge >= 20) return this.addAlpha(this.colors.success, 0.7);
                            if (marge >= 10) return this.addAlpha(this.colors.warning, 0.7);
                            return this.addAlpha(this.colors.danger, 0.7);
                        }),
                        borderColor: sortedData.map(item => {
                            const marge = item.marge || item.taux_marge || 0;
                            if (marge >= 20) return this.colors.success;
                            if (marge >= 10) return this.colors.warning;
                            return this.colors.danger;
                        }),
                        borderWidth: 2,
                        borderRadius: 4,
                        borderSkipped: false
                    }
                ]
            };

            const options = {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                    title: {
                        display: true,
                        text: 'Marges par Projet',
                        font: { size: 16, weight: 'bold' }
                    },
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const projet = sortedData[context.dataIndex];
                                return [
                                    `Marge: ${context.parsed.x.toFixed(1)}%`,
                                    `CA: ${this.formatCurrency(projet.ca || 0)}`
                                ];
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        max: Math.max(50, Math.max(...sortedData.map(item => item.marge || item.taux_marge || 0)) + 5),
                        ticks: {
                            callback: (value) => value + '%'
                        },
                        grid: {
                            color: 'rgba(0,0,0,0.05)'
                        }
                    },
                    y: {
                        grid: {
                            display: false
                        }
                    }
                }
            };

            this.charts[canvasId] = new Chart(ctx, {
                type: 'bar',
                data: chartData,
                options: options
            });

            return this.charts[canvasId];

        } catch (error) {
            console.error(`❌ Erreur création graphique marges ${canvasId}:`, error);
            return null;
        }
    }

    // ===== GRAPHIQUE BUDGET VS RÉALISÉ =====
    
    createBudgetChart(canvasId, data) {
        try {
            const ctx = document.getElementById(canvasId);
            if (!ctx || !data || data.length === 0) {
                console.warn(`Canvas ${canvasId} non trouvé ou données vides`);
                return null;
            }

            if (this.charts[canvasId]) {
                this.charts[canvasId].destroy();
            }

            // Filtrer et trier les projets avec budget
            const validData = data.filter(item => (item.budget_prevu || 0) > 0)
                                 .sort((a, b) => (b.budget_prevu || 0) - (a.budget_prevu || 0))
                                 .slice(0, 15); // Limiter à 15 projets

            const chartData = {
                labels: validData.map(item => this.truncateLabel(item.projet_name || item.name, 20)),
                datasets: [
                    {
                        label: 'Budget Prévu',
                        data: validData.map(item => item.budget_prevu || 0),
                        backgroundColor: this.addAlpha(this.colors.info, 0.6),
                        borderColor: this.colors.info,
                        borderWidth: 2
                    },
                    {
                        label: 'Budget Consommé',
                        data: validData.map(item => item.budget_consomme || 0),
                        backgroundColor: validData.map(item => {
                            const ecart = item.ecart || 0;
                            if (ecart > 10) return this.addAlpha(this.colors.danger, 0.6);
                            if (ecart > 0) return this.addAlpha(this.colors.warning, 0.6);
                            return this.addAlpha(this.colors.success, 0.6);
                        }),
                        borderColor: validData.map(item => {
                            const ecart = item.ecart || 0;
                            if (ecart > 10) return this.colors.danger;
                            if (ecart > 0) return this.colors.warning;
                            return this.colors.success;
                        }),
                        borderWidth: 2
                    }
                ]
            };

            const options = {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Budget Prévu vs Budget Consommé',
                        font: { size: 16, weight: 'bold' }
                    },
                    legend: {
                        position: 'bottom',
                        labels: {
                            usePointStyle: true,
                            padding: 20
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const projet = validData[context.dataIndex];
                                const value = context.parsed.y;
                                const ecart = projet.ecart || 0;
                                return [
                                    `${context.dataset.label}: ${this.formatCurrency(value)}`,
                                    `Écart: ${ecart >= 0 ? '+' : ''}${ecart.toFixed(1)}%`
                                ];
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: (value) => this.formatCurrency(value)
                        },
                        grid: {
                            color: 'rgba(0,0,0,0.05)'
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        }
                    }
                },
                interaction: {
                    intersect: false,
                    mode: 'index'
                }
            };

            this.charts[canvasId] = new Chart(ctx, {
                type: 'bar',
                data: chartData,
                options: options
            });

            return this.charts[canvasId];

        } catch (error) {
            console.error(`❌ Erreur création graphique budget ${canvasId}:`, error);
            return null;
        }
    }

    // ===== MÉTHODES DE MISE À JOUR =====
    
    async updateCharts(chartData) {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            // Mise à jour de tous les graphiques avec les nouvelles données
            const updates = [
                this.updateCaEvolution(chartData.caEvolution || []),
                this.updateProjectsStage(chartData.projetsByStage || []),
                this.updateMarge(chartData.margeEvolution || []),
                this.updateBudget(chartData.budgetComparison || [])
            ];

            await Promise.allSettled(updates);
            console.log('✅ Graphiques mis à jour');

        } catch (error) {
            console.error('❌ Erreur mise à jour graphiques:', error);
        }
    }

    updateCaEvolution(data) {
        return new Promise((resolve) => {
            setTimeout(() => {
                this.createCaEvolutionChart('caEvolutionChart', data);
                resolve();
            }, 100);
        });
    }

    updateProjectsStage(data) {
        return new Promise((resolve) => {
            setTimeout(() => {
                this.createProjectsStageChart('projectsStageChart', data);
                resolve();
            }, 150);
        });
    }

    updateMarge(data) {
        return new Promise((resolve) => {
            setTimeout(() => {
                this.createMargeChart('margeChart', data);
                resolve();
            }, 200);
        });
    }

    updateBudget(data) {
        return new Promise((resolve) => {
            setTimeout(() => {
                this.createBudgetChart('budgetChart', data);
                resolve();
            }, 250);
        });
    }

    // ===== MÉTHODES UTILITAIRES =====
    
    formatCurrency(amount) {
        if (amount === null || amount === undefined) return "0 €";
        return new Intl.NumberFormat('fr-FR', {
            style: 'currency',
            currency: 'EUR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(amount);
    }

    formatPeriodLabel(period) {
        if (!period) return '';
        
        // Format YYYY-MM vers "Jan 2024"
        if (period.match(/^\d{4}-\d{2}$/)) {
            const [year, month] = period.split('-');
            const date = new Date(parseInt(year), parseInt(month) - 1);
            return date.toLocaleDateString('fr-FR', { 
                year: 'numeric', 
                month: 'short' 
            });
        }
        
        return period;
    }

    truncateLabel(label, maxLength = 20) {
        if (!label) return '';
        return label.length > maxLength ? label.substring(0, maxLength) + '...' : label;
    }

    addAlpha(color, alpha) {
        // Convertit une couleur hex en rgba avec alpha
        const hex = color.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    // ===== GESTION DE LA RESPONSIVITÉ =====
    
    handleResize() {
        Object.values(this.charts).forEach(chart => {
            if (chart && typeof chart.resize === 'function') {
                chart.resize();
            }
        });
    }

    // ===== NETTOYAGE =====
    
    destroyAllCharts() {
        Object.values(this.charts).forEach(chart => {
            if (chart && typeof chart.destroy === 'function') {
                chart.destroy();
            }
        });
        this.charts = {};
        console.log('🧹 Graphiques détruits');
    }

    destroy() {
        this.destroyAllCharts();
        this.initialized = false;
    }
}

// Export pour utilisation dans le composant principal
export default DashboardCharts;