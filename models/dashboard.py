# models/dashboard.py
from odoo import models, fields, api
from datetime import datetime, timedelta
from odoo.exceptions import ValidationError
import logging
import json

_logger = logging.getLogger(__name__)

class DashboardProjet(models.Model):
    _name = 'dashboard.projet'
    _description = 'Tableau de Bord Projet Amélioré'
    
    name = fields.Char('Nom', default='Tableau de Bord')
    date_debut = fields.Date('Date de début', default=fields.Date.today)
    date_fin = fields.Date('Date de fin', default=lambda self: fields.Date.today() + timedelta(days=30))
    
    @api.model
    def get_chiffre_affaires(self, date_debut=None, date_fin=None):
        """Calcul du chiffre d'affaires sur la période avec méthodes multiples"""
        try:
            total_ca = 0
            
            # Méthode 1: Via les factures validées
            if self._model_exists('account.move'):
                domain = [
                    ('state', '=', 'posted'),
                    ('move_type', '=', 'out_invoice')
                ]
                
                if date_debut:
                    date_debut = self._parse_date(date_debut)
                    if date_debut:
                        domain.append(('invoice_date', '>=', date_debut))
                
                if date_fin:
                    date_debut = self._parse_date(date_debut)
            date_fin = self._parse_date(date_fin)
            
            if not date_debut or not date_fin:
                return []
            
            # Génération de données par mois entre les deux dates
            evolution_data = []
            current_date = date_debut
            
            while current_date <= date_fin:
                # Calcul du CA pour le mois en cours
                month_start = current_date.replace(day=1)
                if current_date.month == 12:
                    month_end = month_start.replace(year=current_date.year + 1, month=1, day=1) - timedelta(days=1)
                else:
                    month_end = month_start.replace(month=current_date.month + 1, day=1) - timedelta(days=1)
                
                month_ca = self.get_chiffre_affaires(month_start, month_end)
                
                evolution_data.append({
                    'periode': current_date.strftime('%Y-%m'),
                    'ca_realise': month_ca,
                    'ca_prevu': month_ca * (0.9 + (hash(str(current_date)) % 20) / 100)  # Simulation CA prévu
                })
                
                # Passage au mois suivant
                if current_date.month == 12:
                    current_date = current_date.replace(year=current_date.year + 1, month=1)
                else:
                    current_date = current_date.replace(month=current_date.month + 1)
            
            return evolution_data
            
        except Exception as e:
            _logger.warning(f"Erreur génération évolution CA: {str(e)}")
            return []

    # Méthodes utilitaires
    def _model_exists(self, model_name):
        """Vérifie si un modèle existe"""
        try:
            return model_name in self.env
        except:
            return False

    def _field_exists(self, model_name, field_name):
        """Vérifie si un champ existe dans un modèle"""
        try:
            return (self._model_exists(model_name) and 
                    field_name in self.env[model_name]._fields)
        except:
            return False

    def _parse_date(self, date_input):
        """Parse une date depuis string ou objet date"""
        if not date_input:
            return None
        
        try:
            if isinstance(date_input, str):
                return fields.Date.from_string(date_input)
            return date_input
        except:
            return None

    def _get_empty_marge(self):
        """Retourne une structure de marge vide"""
        return {
            'revenus': 0,
            'cout_salarial': 0,
            'marge': 0,
            'taux_marge': 0
        }

    @api.model
    def generate_sample_data(self, nb_projets=10):
        """Génère des données d'exemple pour les tests"""
        try:
            sample_projets = []
            
            for i in range(1, nb_projets + 1):
                # Simulation de données réalistes
                ca_base = 50000 + (i * 10000)
                heures_base = 200 + (i * 50)
                
                sample_projets.append({
                    'id': i,
                    'name': f'Projet Test {i:02d}',
                    'ca': ca_base + (hash(f'ca_{i}') % 20000),
                    'nb_personnes': 2 + (i % 3),
                    'heures': heures_base + (hash(f'heures_{i}') % 100),
                    'stage': ['En cours', 'Planifié', 'Terminé', 'En attente'][i % 4],
                    'budget_prevu': ca_base * 1.2,
                    'budget_consomme': ca_base * (0.8 + ((i % 10) / 20)),
                    'marge_data': {
                        'revenus': ca_base,
                        'cout_salarial': ca_base * 0.6,
                        'marge': ca_base * 0.4,
                        'taux_marge': 40.0 - (i % 20)
                    }
                })
            
            return {
                'chiffre_affaires': sum(p['ca'] for p in sample_projets),
                'projets': sample_projets,
                'marge_administrative': {
                    'ca_total': sum(p['ca'] for p in sample_projets),
                    'cout_admin': sum(p['ca'] for p in sample_projets) * 0.15,
                    'marge_admin': sum(p['ca'] for p in sample_projets) * 0.25,
                    'taux_marge_admin': 25.0
                },
                'budget_comparison': {
                    'budget_total': sum(p['budget_prevu'] for p in sample_projets),
                    'budget_consomme': sum(p['budget_consomme'] for p in sample_projets),
                    'ecart_budget': 5.0
                }
            }
            
        except Exception as e:
            _logger.error(f"Erreur génération données test: {str(e)}")
            return self.get_dashboard_data()

# Modèle de configuration pour le dashboard
class DashboardConfiguration(models.Model):
    _name = 'dashboard.projet.config'
    _description = 'Configuration Dashboard Projet'
    
    name = fields.Char('Nom Configuration', required=True)
    user_id = fields.Many2one('res.users', 'Utilisateur', default=lambda self: self.env.user)
    
    # Paramètres d'affichage
    show_charts = fields.Boolean('Afficher Graphiques', default=True)
    show_budget = fields.Boolean('Afficher Budget', default=True)
    auto_refresh = fields.Integer('Auto-actualisation (minutes)', default=5)
    
    # Filtres par défaut
    default_period_days = fields.Integer('Période par défaut (jours)', default=30)
    
    # Paramètres d'export
    export_include_charts = fields.Boolean('Inclure graphiques dans export', default=False)
    export_include_details = fields.Boolean('Inclure détails dans export', default=True)
    
    # Seuils d'alerte
    marge_alert_min = fields.Float('Seuil alerte marge minimum (%)', default=10.0)
    budget_alert_max = fields.Float('Seuil alerte dépassement budget (%)', default=90.0)
    
    @api.model
    def get_user_config(self):
        """Récupère la configuration de l'utilisateur courant"""
        config = self.search([('user_id', '=', self.env.user.id)], limit=1)
        if not config:
            # Création d'une configuration par défaut
            config = self.create({
                'name': f'Config {self.env.user.name}',
                'user_id': self.env.user.id
            })
        return config
    
    def get_config_dict(self):
        """Retourne la configuration sous forme de dictionnaire"""
        return {
            'show_charts': self.show_charts,
            'show_budget': self.show_budget,
            'auto_refresh': self.auto_refresh,
            'default_period_days': self.default_period_days,
            'export_include_charts': self.export_include_charts,
            'export_include_details': self.export_include_details,
            'marge_alert_min': self.marge_alert_min,
            'budget_alert_max': self.budget_alert_max
        }date_fin)
                    if date_fin:
                        domain.append(('invoice_date', '<=', date_fin))
                
                factures = self.env['account.move'].search(domain)
                ca_factures = sum(facture.amount_total_signed for facture in factures 
                                if facture.amount_total_signed and facture.amount_total_signed > 0)
                total_ca = max(total_ca, ca_factures)
            
            # Méthode 2: Via les commandes de vente confirmées (fallback)
            if total_ca == 0 and self._model_exists('sale.order'):
                domain = [('state', 'in', ['sale', 'done'])]
                
                if date_debut and self._field_exists('sale.order', 'date_order'):
                    domain.append(('date_order', '>=', date_debut))
                if date_fin and self._field_exists('sale.order', 'date_order'):
                    domain.append(('date_order', '<=', date_fin))
                
                commandes = self.env['sale.order'].search(domain)
                total_ca = sum(cmd.amount_total for cmd in commandes if cmd.amount_total)
            
            _logger.info(f"CA calculé: {total_ca} pour la période {date_debut} à {date_fin}")
            return total_ca
            
        except Exception as e:
            _logger.error(f"Erreur dans get_chiffre_affaires: {str(e)}")
            return 0

    @api.model
    def get_projets_data(self, date_debut=None, date_fin=None):
        """Récupération des données des projets avec calculs optimisés et budget"""
        try:
            if not self._model_exists('project.project'):
                _logger.warning("Modèle project.project non disponible")
                return []
            
            # Recherche des projets actifs
            domain = []
            if self._field_exists('project.project', 'active'):
                domain.append(('active', '=', True))
            
            # Filtrage par date si possible
            date_debut = self._parse_date(date_debut)
            date_fin = self._parse_date(date_fin)
            
            if date_debut and self._field_exists('project.project', 'date_start'):
                domain.append(('date_start', '>=', date_debut))
            if date_fin and self._field_exists('project.project', 'date'):
                domain.append(('date', '<=', date_fin))
            
            projets = self.env['project.project'].search(domain, limit=500)
            _logger.info(f"Trouvé {len(projets)} projets")
            
            projets_data = []
            
            for projet in projets:
                try:
                    # Données budget
                    budget_data = self._get_budget_projet(projet, date_debut, date_fin)
                    
                    projet_info = {
                        'id': projet.id,
                        'name': projet.name or f'Projet {projet.id}',
                        'ca': self._get_ca_projet_optimized(projet, date_debut, date_fin),
                        'nb_personnes': self._get_nb_personnes_projet(projet),
                        'heures': self._get_heures_projet(projet, date_debut, date_fin),
                        'stage': self._get_stage_projet(projet),
                        'budget_prevu': budget_data.get('budget_prevu', 0),
                        'budget_consomme': budget_data.get('budget_consomme', 0),
                        'ecart_budget': budget_data.get('ecart_budget', 0),
                        'marge_data': None  # Sera calculé séparément
                    }
                    
                    projets_data.append(projet_info)
                    
                except Exception as e:
                    _logger.error(f"Erreur traitement projet {projet.id}: {str(e)}")
                    projets_data.append({
                        'id': projet.id,
                        'name': projet.name or f'Projet {projet.id}',
                        'ca': 0,
                        'nb_personnes': 0,
                        'heures': 0,
                        'stage': 'Erreur',
                        'budget_prevu': 0,
                        'budget_consomme': 0,
                        'ecart_budget': 0,
                        'marge_data': None
                    })
            
            return projets_data
            
        except Exception as e:
            _logger.error(f"Erreur critique dans get_projets_data: {str(e)}")
            return []

    def _get_budget_projet(self, projet, date_debut=None, date_fin=None):
        """Calcul des données budgétaires d'un projet"""
        try:
            budget_prevu = 0
            budget_consomme = 0
            
            # Méthode 1: Via les budgets analytiques (si disponible)
            if (self._model_exists('crossovered.budget') and 
                hasattr(projet, 'analytic_account_id') and 
                projet.analytic_account_id):
                
                # Recherche des lignes budgétaires
                domain = [('analytic_account_id', '=', projet.analytic_account_id.id)]
                
                if date_debut:
                    domain.append(('date_from', '>=', date_debut))
                if date_fin:
                    domain.append(('date_to', '<=', date_fin))
                
                if self._model_exists('crossovered.budget.lines'):
                    budget_lines = self.env['crossovered.budget.lines'].search(domain)
                    budget_prevu = sum(line.planned_amount for line in budget_lines if line.planned_amount)
                    budget_consomme = sum(line.practical_amount for line in budget_lines if line.practical_amount)
            
            # Méthode 2: Calcul basé sur les données projet (fallback)
            if budget_prevu == 0:
                # Estimation basée sur le CA et un ratio
                ca_projet = self._get_ca_projet_optimized(projet, date_debut, date_fin)
                budget_prevu = ca_projet * 1.2  # Estimation: budget = CA + 20%
                
                # Budget consommé = coûts réels
                budget_consomme = self._get_cout_salarial_projet(projet, date_debut, date_fin)
            
            # Calcul de l'écart
            ecart_budget = 0
            if budget_prevu > 0:
                ecart_budget = ((budget_consomme / budget_prevu) - 1) * 100
            
            return {
                'budget_prevu': budget_prevu,
                'budget_consomme': budget_consomme,
                'ecart_budget': ecart_budget
            }
            
        except Exception as e:
            _logger.warning(f"Erreur calcul budget projet {projet.id}: {str(e)}")
            return {
                'budget_prevu': 0,
                'budget_consomme': 0,
                'ecart_budget': 0
            }

    def _get_ca_projet_optimized(self, projet, date_debut=None, date_fin=None):
        """Calcul optimisé du CA d'un projet"""
        try:
            ca = 0
            
            # Méthode 1: Via les lignes de facture avec compte analytique
            if (self._model_exists('account.move.line') and 
                hasattr(projet, 'analytic_account_id') and 
                projet.analytic_account_id):
                
                domain = [
                    ('move_id.state', '=', 'posted'),
                    ('move_id.move_type', '=', 'out_invoice')
                ]
                
                # Recherche par distribution analytique (Odoo 16+)
                if self._field_exists('account.move.line', 'analytic_distribution'):
                    domain.append(('analytic_distribution', 'like', f'%{projet.analytic_account_id.id}%'))
                # Fallback pour versions antérieures
                elif self._field_exists('account.move.line', 'analytic_account_id'):
                    domain.append(('analytic_account_id', '=', projet.analytic_account_id.id))
                
                if date_debut:
                    domain.append(('move_id.invoice_date', '>=', date_debut))
                if date_fin:
                    domain.append(('move_id.invoice_date', '<=', date_fin))
                
                lignes = self.env['account.move.line'].search(domain)
                ca = sum(ligne.price_subtotal for ligne in lignes if ligne.price_subtotal)
            
            # Méthode 2: Via les commandes de vente liées au projet
            if ca == 0 and self._model_exists('sale.order'):
                domain = [('state', 'in', ['sale', 'done'])]
                
                if self._field_exists('sale.order', 'project_id'):
                    domain.append(('project_id', '=', projet.id))
                elif (self._field_exists('sale.order', 'analytic_account_id') and 
                      hasattr(projet, 'analytic_account_id') and projet.analytic_account_id):
                    domain.append(('analytic_account_id', '=', projet.analytic_account_id.id))
                
                if date_debut and self._field_exists('sale.order', 'date_order'):
                    domain.append(('date_order', '>=', date_debut))
                if date_fin and self._field_exists('sale.order', 'date_order'):
                    domain.append(('date_order', '<=', date_fin))
                
                commandes = self.env['sale.order'].search(domain)
                ca = sum(cmd.amount_total for cmd in commandes if cmd.amount_total)
            
            return ca
            
        except Exception as e:
            _logger.warning(f"Erreur calcul CA projet {projet.id}: {str(e)}")
            return 0

    def _get_nb_personnes_projet(self, projet):
        """Calcul du nombre de personnes affectées au projet"""
        try:
            # Méthode 1: Via user_ids (responsables/membres)
            if hasattr(projet, 'user_ids') and projet.user_ids:
                return len(projet.user_ids)
            
            # Méthode 2: Via user_id (responsable unique)
            if hasattr(projet, 'user_id') and projet.user_id:
                return 1
            
            # Méthode 3: Via les timesheets (personnes ayant travaillé)
            if self._model_exists('account.analytic.line'):
                timesheets = self.env['account.analytic.line'].search([
                    ('project_id', '=', projet.id),
                    ('employee_id', '!=', False)
                ])
                return len(set(timesheets.mapped('employee_id.id')))
            
            return 0
            
        except Exception as e:
            _logger.warning(f"Erreur comptage personnel projet {projet.id}: {str(e)}")
            return 0

    def _get_heures_projet(self, projet, date_debut=None, date_fin=None):
        """Calcul des heures travaillées sur le projet"""
        try:
            if not self._model_exists('account.analytic.line'):
                return 0
            
            domain = [('project_id', '=', projet.id)]
            
            if date_debut:
                domain.append(('date', '>=', date_debut))
            if date_fin:
                domain.append(('date', '<=', date_fin))
            
            timesheets = self.env['account.analytic.line'].search(domain)
            return sum(ts.unit_amount for ts in timesheets if ts.unit_amount)
            
        except Exception as e:
            _logger.warning(f"Erreur calcul heures projet {projet.id}: {str(e)}")
            return 0

    def _get_stage_projet(self, projet):
        """Récupération du statut/étape du projet"""
        try:
            if hasattr(projet, 'stage_id') and projet.stage_id:
                return projet.stage_id.name
            elif hasattr(projet, 'state'):
                state_mapping = {
                    'template': 'Modèle',
                    'draft': 'Brouillon', 
                    'open': 'En cours',
                    'pending': 'En attente',
                    'close': 'Fermé',
                    'cancelled': 'Annulé'
                }
                return state_mapping.get(projet.state, str(projet.state))
            
            return 'Actif'
            
        except Exception as e:
            _logger.warning(f"Erreur récupération statut projet {projet.id}: {str(e)}")
            return 'Indéterminé'

    @api.model
    def get_marge_salariale_projet(self, projet_id, date_debut=None, date_fin=None):
        """Calcul de la marge salariale par projet"""
        try:
            if not projet_id:
                return self._get_empty_marge()
            
            projet = self.env['project.project'].browse(projet_id)
            if not projet.exists():
                return self._get_empty_marge()
            
            date_debut = self._parse_date(date_debut)
            date_fin = self._parse_date(date_fin)
            
            # Calcul des revenus
            revenus = self._get_ca_projet_optimized(projet, date_debut, date_fin)
            
            # Calcul des coûts salariaux
            cout_salarial = self._get_cout_salarial_projet(projet, date_debut, date_fin)
            
            # Calcul de la marge
            marge = revenus - cout_salarial
            taux_marge = (marge / revenus * 100) if revenus > 0 else 0
            
            result = {
                'revenus': revenus,
                'cout_salarial': cout_salarial,
                'marge': marge,
                'taux_marge': taux_marge
            }
            
            _logger.info(f"Marge calculée pour projet {projet_id}: {result}")
            return result
            
        except Exception as e:
            _logger.error(f"Erreur calcul marge projet {projet_id}: {str(e)}")
            return self._get_empty_marge()

    def _get_cout_salarial_projet(self, projet, date_debut=None, date_fin=None):
        """Calcul des coûts salariaux d'un projet"""
        try:
            if not self._model_exists('account.analytic.line'):
                return 0
            
            domain = [('project_id', '=', projet.id)]
            
            if date_debut:
                domain.append(('date', '>=', date_debut))
            if date_fin:
                domain.append(('date', '<=', date_fin))
            
            timesheets = self.env['account.analytic.line'].search(domain)
            
            # Les montants dans account.analytic.line sont généralement négatifs pour les coûts
            cout_total = 0
            for ts in timesheets:
                if hasattr(ts, 'amount') and ts.amount:
                    cout_total += abs(ts.amount)  # Prendre la valeur absolue
                elif hasattr(ts, 'unit_amount') and hasattr(ts.employee_id, 'hourly_cost'):
                    # Calcul basé sur le coût horaire si disponible
                    cout_total += ts.unit_amount * (ts.employee_id.hourly_cost or 0)
            
            return cout_total
            
        except Exception as e:
            _logger.warning(f"Erreur calcul coût salarial projet {projet.id}: {str(e)}")
            return 0

    @api.model
    def get_marge_administrative(self, date_debut=None, date_fin=None):
        """Calcul de la marge administrative globale"""
        try:
            # CA total
            ca_total = self.get_chiffre_affaires(date_debut, date_fin)
            
            # Coûts administratifs
            cout_admin = self._get_cout_administratif(date_debut, date_fin)
            
            # Calcul de la marge
            marge_admin = ca_total - cout_admin
            taux_marge_admin = (marge_admin / ca_total * 100) if ca_total > 0 else 0
            
            result = {
                'ca_total': ca_total,
                'cout_admin': cout_admin,
                'marge_admin': marge_admin,
                'taux_marge_admin': taux_marge_admin
            }
            
            _logger.info(f"Marge administrative calculée: {result}")
            return result
            
        except Exception as e:
            _logger.error(f"Erreur calcul marge administrative: {str(e)}")
            return {
                'ca_total': 0,
                'cout_admin': 0,
                'marge_admin': 0,
                'taux_marge_admin': 0
            }

    def _get_cout_administratif(self, date_debut=None, date_fin=None):
        """Calcul des coûts administratifs"""
        try:
            cout_admin = 0
            date_debut = self._parse_date(date_debut)
            date_fin = self._parse_date(date_fin)
            
            # Méthode 1: Via les employés administratifs
            if (self._model_exists('hr.employee') and 
                self._model_exists('account.analytic.line')):
                
                # Recherche des employés admin
                admin_domain = []
                if self._field_exists('hr.employee', 'department_id'):
                    admin_domain.extend([
                        '|', ('department_id.name', 'ilike', 'admin'),
                        ('department_id.name', 'ilike', 'direction')
                    ])
                elif self._field_exists('hr.employee', 'job_id'):
                    admin_domain.extend([
                        '|', ('job_id.name', 'ilike', 'admin'),
                        ('job_id.name', 'ilike', 'manager')
                    ])
                
                if admin_domain:
                    employes_admin = self.env['hr.employee'].search(admin_domain)
                    
                    if employes_admin:
                        domain_timesheet = [('employee_id', 'in', employes_admin.ids)]
                        
                        if date_debut:
                            domain_timesheet.append(('date', '>=', date_debut))
                        if date_fin:
                            domain_timesheet.append(('date', '<=', date_fin))
                        
                        timesheets_admin = self.env['account.analytic.line'].search(domain_timesheet)
                        cout_admin = sum(abs(ts.amount) for ts in timesheets_admin if ts.amount)
            
            # Méthode 2: Pourcentage du CA si pas de données spécifiques
            if cout_admin == 0:
                ca_total = self.get_chiffre_affaires(date_debut, date_fin)
                cout_admin = ca_total * 0.15  # Estimation 15% de coûts admin
            
            return cout_admin
            
        except Exception as e:
            _logger.warning(f"Erreur calcul coût administratif: {str(e)}")
            return 0

    @api.model
    def get_budget_comparison(self, date_debut=None, date_fin=None):
        """Comparaison budget global vs réalisé"""
        try:
            budget_total = 0
            budget_consomme = 0
            
            # Récupération des données projets avec budget
            projets_data = self.get_projets_data(date_debut, date_fin)
            
            for projet in projets_data:
                budget_total += projet.get('budget_prevu', 0)
                budget_consomme += projet.get('budget_consomme', 0)
            
            # Calcul de l'écart global
            ecart_budget = 0
            if budget_total > 0:
                ecart_budget = ((budget_consomme / budget_total) - 1) * 100
            
            result = {
                'budget_total': budget_total,
                'budget_consomme': budget_consomme,
                'ecart_budget': ecart_budget,
                'projets_budget': projets_data
            }
            
            _logger.info(f"Comparaison budget calculée: {result}")
            return result
            
        except Exception as e:
            _logger.error(f"Erreur comparaison budget: {str(e)}")
            return {
                'budget_total': 0,
                'budget_consomme': 0,
                'ecart_budget': 0,
                'projets_budget': []
            }

    @api.model
    def get_dashboard_data(self, date_debut=None, date_fin=None):
        """Méthode principale pour récupérer toutes les données du dashboard"""
        try:
            _logger.info(f"Récupération données dashboard: {date_debut} à {date_fin}")
            
            result = {
                'chiffre_affaires': 0,
                'projets': [],
                'marge_administrative': {
                    'ca_total': 0,
                    'cout_admin': 0,
                    'marge_admin': 0,
                    'taux_marge_admin': 0
                },
                'budget_comparison': {
                    'budget_total': 0,
                    'budget_consomme': 0,
                    'ecart_budget': 0
                }
            }
            
            # Calcul séquentiel avec gestion d'erreur
            try:
                result['chiffre_affaires'] = self.get_chiffre_affaires(date_debut, date_fin)
            except Exception as e:
                _logger.error(f"Erreur CA: {str(e)}")
            
            try:
                result['projets'] = self.get_projets_data(date_debut, date_fin)
            except Exception as e:
                _logger.error(f"Erreur projets: {str(e)}")
            
            try:
                result['marge_administrative'] = self.get_marge_administrative(date_debut, date_fin)
            except Exception as e:
                _logger.error(f"Erreur marge admin: {str(e)}")
            
            try:
                result['budget_comparison'] = self.get_budget_comparison(date_debut, date_fin)
            except Exception as e:
                _logger.error(f"Erreur budget: {str(e)}")
            
            return result
            
        except Exception as e:
            _logger.error(f"Erreur critique dashboard: {str(e)}")
            return {
                'chiffre_affaires': 0,
                'projets': [],
                'marge_administrative': {
                    'ca_total': 0,
                    'cout_admin': 0,
                    'marge_admin': 0,
                    'taux_marge_admin': 0
                },
                'budget_comparison': {
                    'budget_total': 0,
                    'budget_consomme': 0,
                    'ecart_budget': 0
                }
            }

    @api.model
    def get_chart_data(self, date_debut=None, date_fin=None):
        """Données spécifiques pour les graphiques"""
        try:
            projets_data = self.get_projets_data(date_debut, date_fin)
            
            # Évolution CA par mois (simulation)
            ca_evolution = self._get_ca_evolution(date_debut, date_fin)
            
            # Répartition projets par statut
            stages = {}
            for projet in projets_data:
                stage = projet.get('stage', 'Non défini')
                stages[stage] = stages.get(stage, 0) + 1
            
            projets_by_stage = [{'stage': k, 'count': v} for k, v in stages.items()]
            
            # Marges par projet
            marges_projets = []
            for projet in projets_data:
                if projet.get('marge_data'):
                    marges_projets.append({
                        'projet_name': projet['name'],
                        'marge': projet['marge_data'].get('taux_marge', 0),
                        'ca': projet.get('ca', 0)
                    })
            
            # Budget vs réalisé
            budget_comparison = []
            for projet in projets_data:
                budget_prevu = projet.get('budget_prevu', 0)
                budget_consomme = projet.get('budget_consomme', 0)
                if budget_prevu > 0:
                    budget_comparison.append({
                        'projet_name': projet['name'],
                        'budget_prevu': budget_prevu,
                        'budget_consomme': budget_consomme,
                        'ecart': ((budget_consomme / budget_prevu - 1) * 100) if budget_prevu > 0 else 0
                    })
            
            return {
                'ca_evolution': ca_evolution,
                'projets_by_stage': projets_by_stage,
                'marges_projets': marges_projets,
                'budget_comparison': budget_comparison
            }
            
        except Exception as e:
            _logger.error(f"Erreur données graphiques: {str(e)}")
            return {
                'ca_evolution': [],
                'projets_by_stage': [],
                'marges_projets': [],
                'budget_comparison': []
            }

    def _get_ca_evolution(self, date_debut, date_fin):
        """Génère les données d'évolution du CA par période"""
        try:
            if not date_debut or not date_fin:
                return []
            
            date_debut = self._parse_date(date_debut)
            date_fin = self._parse_date(date_fin)

            # Simulation de données d'évolution CA
            return [
                {'date': date_debut, 'ca': 1000},
                {'date': date_fin, 'ca': 1500}
            ]

        except Exception as e:
            _logger.error(f"Erreur génération évolution CA: {str(e)}")
            return []