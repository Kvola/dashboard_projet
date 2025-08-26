/** @odoo-module */

import { registry } from "@web/core/registry";
import { jsonrpc } from "@web/core/network/rpc_service";

/**
 * Service pour le dashboard projet
 * Gère les appels API vers le backend pour récupérer les données du dashboard
 */
class DashboardProjetService {
    constructor(env) {
        this.env = env;
    }

    /**
     * Récupère toutes les données du dashboard
     * @param {string} dateDebut - Date de début au format YYYY-MM-DD
     * @param {string} dateFin - Date de fin au format YYYY-MM-DD
     * @returns {Promise<Object>} Données du dashboard
     */
    async getDashboardData(dateDebut, dateFin) {
        try {
            const result = await jsonrpc('/dashboard_projet/data', {
                date_debut: dateDebut,
                date_fin: dateFin
            });
            
            // Validation des données reçues
            if (result && result.error) {
                console.error('Erreur retournée par le serveur:', result.error);
                throw new Error(result.error);
            }
            
            return this.formatDashboardData(result);
        } catch (error) {
            console.error('Erreur lors de la récupération des données du dashboard:', error);
            throw error;
        }
    }

    /**
     * Récupère les données de marge pour un projet spécifique
     * @param {number} projetId - ID du projet
     * @param {string} dateDebut - Date de début au format YYYY-MM-DD
     * @param {string} dateFin - Date de fin au format YYYY-MM-DD
     * @returns {Promise<Object>} Données de marge du projet
     */
    async getProjetMarge(projetId, dateDebut, dateFin) {
        try {
            const result = await jsonrpc(`/dashboard_projet/projet_marge/${projetId}`, {
                date_debut: dateDebut,
                date_fin: dateFin
            });
            
            if (result && result.error) {
                console.warn(`Erreur marge projet ${projetId}:`, result.error);
                // Retourner des données par défaut plutôt que de throw
                return this._getDefaultMargeData();
            }
            
            return this._validateMargeData(result);
        } catch (error) {
            console.error(`Erreur lors de la récupération de la marge du projet ${projetId}:`, error);
            // Retourner des données par défaut en cas d'erreur
            return this._getDefaultMargeData();
        }
    }

    /**
     * Lance l'export des données du dashboard - VERSION CORRIGÉE
     * @param {string} dateDebut - Date de début au format YYYY-MM-DD
     * @param {string} dateFin - Date de fin au format YYYY-MM-DD
     * @param {string} format - Format d'export ('xlsx', 'pdf', 'json', 'csv')
     */
    exportDashboard(dateDebut, dateFin, format = 'xlsx') {
        try {
            // Validation des paramètres
            if (!dateDebut || !dateFin) {
                throw new Error('Les dates de début et fin sont requises pour l\'export');
            }

            if (!['xlsx', 'pdf', 'json', 'csv'].includes(format.toLowerCase())) {
                throw new Error(`Format d'export non supporté: ${format}`);
            }

            // Construction de l'URL avec paramètres
            const params = new URLSearchParams({
                date_debut: dateDebut,
                date_fin: dateFin,
                format: format.toLowerCase()
            });
            
            const url = `/dashboard_projet/export?${params.toString()}`;
            
            // Différentes stratégies selon le format
            if (format.toLowerCase() === 'json') {
                // Pour JSON, on peut afficher dans une nouvelle fenêtre
                window.open(url, '_blank', 'noopener,noreferrer');
            } else {
                // Pour Excel/PDF/CSV, téléchargement direct
                this._triggerDownload(url, `dashboard_${dateDebut}_${dateFin}.${format.toLowerCase()}`);
            }

            console.log(`Export ${format.toUpperCase()} lancé avec succès`);
            return true;
            
        } catch (error) {
            console.error('Erreur lors de l\'export:', error);
            throw error;
        }
    }

    /**
     * Déclenche un téléchargement via un lien temporaire
     * @param {string} url - URL du fichier à télécharger
     * @param {string} filename - Nom du fichier suggéré
     * @private
     */
    _triggerDownload(url, filename) {
        try {
            // Créer un lien de téléchargement temporaire
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.style.display = 'none';
            
            // Ajouter au DOM, cliquer, puis supprimer
            document.body.appendChild(link);
            link.click();
            
            // Nettoyer après un petit délai pour s'assurer que le téléchargement a commencé
            setTimeout(() => {
                document.body.removeChild(link);
            }, 100);
            
        } catch (error) {
            console.error('Erreur lors du déclenchement du téléchargement:', error);
            // Fallback: ouvrir dans une nouvelle fenêtre
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    }

    /**
     * Récupère les marges pour plusieurs projets en lot
     * @param {Array} projetIds - Tableau des IDs de projets
     * @param {string} dateDebut - Date de début
     * @param {string} dateFin - Date de fin
     * @returns {Promise<Object>} Marges par projet ID
     */
    async getBatchMarges(projetIds, dateDebut, dateFin) {
        try {
            if (!Array.isArray(projetIds) || projetIds.length === 0) {
                return {};
            }

            const result = await jsonrpc('/dashboard_projet/batch_marges', {
                projet_ids: projetIds,
                date_debut: dateDebut,
                date_fin: dateFin
            });

            if (result && result.error) {
                console.error('Erreur batch marges:', result.error);
                // Retourner un objet vide plutôt que de throw
                return {};
            }

            return result.marges || {};
            
        } catch (error) {
            console.error('Erreur lors du calcul des marges en lot:', error);
            return {};
        }
    }

    /**
     * Teste la connexion au dashboard
     * @returns {Promise<Object>} Résultat du test
     */
    async testConnection() {
        try {
            const result = await jsonrpc('/dashboard_projet/test', {});
            return result;
        } catch (error) {
            console.error('Erreur test connexion dashboard:', error);
            return {
                status: 'error',
                message: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Vérifie la santé du système dashboard
     * @returns {Promise<Object>} Statut de santé
     */
    async checkHealth() {
        try {
            const result = await jsonrpc('/dashboard_projet/health', {});
            return result;
        } catch (error) {
            console.error('Erreur health check dashboard:', error);
            return {
                status: 'error',
                message: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Méthode utilitaire pour formater les données reçues
     * @param {Object} rawData - Données brutes du backend
     * @returns {Object} Données formatées
     */
    formatDashboardData(rawData) {
        if (!rawData || typeof rawData !== 'object') {
            return this._getDefaultDashboardData();
        }

        return {
            chiffre_affaires: this._safeNumber(rawData.chiffre_affaires),
            projets: Array.isArray(rawData.projets) ? rawData.projets.map(projet => ({
                id: projet.id || 0,
                name: projet.name || 'Projet sans nom',
                ca: this._safeNumber(projet.ca),
                nb_personnes: this._safeInteger(projet.nb_personnes),
                heures: this._safeNumber(projet.heures),
                stage: projet.stage || 'Non défini',
                marge_data: null // Sera rempli séparément
            })) : [],
            marge_administrative: {
                ca_total: this._safeNumber(rawData.marge_administrative?.ca_total),
                cout_admin: this._safeNumber(rawData.marge_administrative?.cout_admin),
                marge_admin: this._safeNumber(rawData.marge_administrative?.marge_admin),
                taux_marge_admin: this._safeNumber(rawData.marge_administrative?.taux_marge_admin)
            }
        };
    }

    /**
     * Valide et nettoie les données de marge
     * @param {Object} data - Données de marge brutes
     * @returns {Object} Données de marge validées
     * @private
     */
    _validateMargeData(data) {
        if (!data || typeof data !== 'object') {
            return this._getDefaultMargeData();
        }

        const revenus = this._safeNumber(data.revenus);
        const cout_salarial = this._safeNumber(data.cout_salarial);
        const marge = this._safeNumber(data.marge);
        let taux_marge = this._safeNumber(data.taux_marge);

        // Recalculer le taux si nécessaire
        if ((taux_marge === 0 || isNaN(taux_marge)) && revenus > 0) {
            taux_marge = ((revenus - cout_salarial) / revenus) * 100;
        }

        // Valider la cohérence
        const marge_calculee = revenus - cout_salarial;
        if (Math.abs(marge - marge_calculee) > 1) {
            console.warn('Incohérence données marge, recalcul automatique');
        }

        return {
            revenus: revenus,
            cout_salarial: cout_salarial,
            marge: marge_calculee, // Utiliser la valeur recalculée
            taux_marge: Math.round(taux_marge * 10) / 10 // Arrondir à 1 décimale
        };
    }

    /**
     * Convertit une valeur en nombre sécurisé
     * @param {*} value - Valeur à convertir
     * @param {number} defaultValue - Valeur par défaut
     * @returns {number} Nombre sécurisé
     * @private
     */
    _safeNumber(value, defaultValue = 0) {
        const num = parseFloat(value);
        return isNaN(num) ? defaultValue : num;
    }

    /**
     * Convertit une valeur en entier sécurisé
     * @param {*} value - Valeur à convertir
     * @param {number} defaultValue - Valeur par défaut
     * @returns {number} Entier sécurisé
     * @private
     */
    _safeInteger(value, defaultValue = 0) {
        const num = parseInt(value, 10);
        return isNaN(num) ? defaultValue : num;
    }

    /**
     * Retourne des données de dashboard par défaut
     * @returns {Object} Structure de données par défaut
     * @private
     */
    _getDefaultDashboardData() {
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

    /**
     * Retourne des données de marge par défaut
     * @returns {Object} Structure de marge par défaut
     * @private
     */
    _getDefaultMargeData() {
        return {
            revenus: 0,
            cout_salarial: 0,
            marge: 0,
            taux_marge: 0
        };
    }

    /**
     * Formate un montant en devise
     * @param {number} amount - Montant à formater
     * @returns {string} Montant formaté
     */
    formatCurrency(amount) {
        if (amount === undefined || amount === null) return "0 €";
        return new Intl.NumberFormat('fr-FR', {
            style: 'currency',
            currency: 'EUR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(amount);
    }

    /**
     * Formate un pourcentage
     * @param {number} value - Valeur à formater
     * @returns {string} Pourcentage formaté
     */
    formatPercentage(value) {
        return (value || 0).toFixed(1) + '%';
    }

    /**
     * Formate un nombre
     * @param {number} value - Valeur à formater
     * @param {number} decimals - Nombre de décimales
     * @returns {string} Nombre formaté
     */
    formatNumber(value, decimals = 1) {
        return (value || 0).toFixed(decimals);
    }
}

// Fonction factory pour créer le service
function createDashboardProjetService(env) {
    return new DashboardProjetService(env);
}

// Enregistrement du service dans le registre
registry.category("services").add("dashboard_projet", {
    start: createDashboardProjetService,
    dependencies: [] // Pas de dépendances spécifiques pour ce service
});