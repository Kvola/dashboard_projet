# models/dashboard.py - VERSION OPTIMISÉE
from odoo import models, fields, api
from datetime import datetime, timedelta
from odoo.exceptions import ValidationError
import logging

_logger = logging.getLogger(__name__)

class DashboardProjet(models.Model):
    _name = 'dashboard.projet'
    _description = 'Tableau de Bord Projet'
    
    name = fields.Char('Nom', default='Tableau de Bord')
    date_debut = fields.Date('Date de début', default=fields.Date.today)
    date_fin = fields.Date('Date de fin', default=lambda self: fields.Date.today() + timedelta(days=30))
    
    @api.model
    def get_chiffre_affaires(self, date_debut=None, date_fin=None):
        """Calcul du chiffre d'affaires sur la période via les factures validées"""
        try:
            total_ca = 0
            
            # Méthode recommandée: Via les factures validées
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
                    date_fin = self._parse_date(date_fin)
                    if date_fin:
                        domain.append(('invoice_date', '<=', date_fin))
                
                factures = self.env['account.move'].search(domain)
                ca_factures = sum(facture.amount_total_signed for facture in factures 
                                if facture.amount_total_signed and facture.amount_total_signed > 0)
                total_ca = max(total_ca, ca_factures)
            
            _logger.info(f"CA calculé: {total_ca} pour la période {date_debut} à {date_fin}")
            return total_ca
            
        except Exception as e:
            _logger.error(f"Erreur dans get_chiffre_affaires: {str(e)}")
            return 0

    @api.model
    def get_projets_data(self, date_debut=None, date_fin=None):
        """Récupération des données des projets avec calculs optimisés"""
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
                    projet_info = {
                        'id': projet.id,
                        'name': projet.name or f'Projet {projet.id}',
                        'ca': self._get_ca_projet_optimized(projet, date_debut, date_fin),
                        'nb_personnes': self._get_nb_personnes_projet(projet),
                        'heures': self._get_heures_projet(projet, date_debut, date_fin),
                        'stage': self._get_stage_projet(projet),
                        'marge_data': None
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
                        'marge_data': None
                    })
            
            return projets_data
            
        except Exception as e:
            _logger.error(f"Erreur critique dans get_projets_data: {str(e)}")
            return []

    def _get_ca_projet_optimized(self, projet, date_debut=None, date_fin=None):
        """Calcul optimisé du CA d'un projet via les factures analytiques"""
        try:
            ca = 0
            
            # Méthode recommandée: Via les lignes de facture avec distribution analytique
            if (self._model_exists('account.move.line') and 
                hasattr(projet, 'analytic_account_id') and 
                projet.analytic_account_id):
                
                domain = [
                    ('move_id.state', '=', 'posted'),
                    ('move_id.move_type', '=', 'out_invoice'),
                    ('analytic_distribution', '!=', False)
                ]
                
                # Recherche par distribution analytique (Odoo 16+)
                analytic_lines = self.env['account.move.line'].search(domain)
                
                if date_debut:
                    analytic_lines = analytic_lines.filtered(lambda l: l.move_id.invoice_date >= date_debut)
                if date_fin:
                    analytic_lines = analytic_lines.filtered(lambda l: l.move_id.invoice_date <= date_fin)
                
                for ligne in analytic_lines:
                    if ligne.analytic_distribution:
                        # Vérifier si le compte analytique est dans la distribution
                        if str(projet.analytic_account_id.id) in str(ligne.analytic_distribution):
                            ca += ligne.price_subtotal or 0
            
            _logger.debug(f"CA calculé pour projet {projet.id}: {ca}")
            return ca
            
        except Exception as e:
            _logger.warning(f"Erreur calcul CA projet {projet.id}: {str(e)}")
            return 0

    def _get_nb_personnes_projet(self, projet):
        """Calcul du nombre de personnes via les timesheets"""
        try:
            # Méthode recommandée: Via les timesheets (personnes ayant travaillé)
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
        """Calcul des heures travaillées sur le projet via timesheets"""
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
            # Méthode recommandée: Via last_update_status
            if hasattr(projet, 'last_update_status'):
                last_update_status_mapping = {
                    'on_track': 'En bonne voie',
                    'at_risk': 'En danger', 
                    'off_track': 'En retard',
                    'on_hold': 'En attente',
                    'done': 'Fait',
                    'to_define': 'À définir'
                }
                return last_update_status_mapping.get(projet.last_update_status, str(projet.last_update_status))

            return 'Actif'
            
        except Exception as e:
            _logger.warning(f"Erreur récupération statut projet {projet.id}: {str(e)}")
            return 'Bizarre'

    @api.model
    def get_marge_salariale_projet(self, projet_id, date_debut=None, date_fin=None):
        """Calcul de la marge salariale par projet"""
        try:
            if not projet_id:
                return self._get_empty_marge()
            
            projet = self.env['project.project'].browse(projet_id)
            if not projet.exists():
                _logger.warning(f"Projet {projet_id} non trouvé")
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
                'revenus': float(revenus),
                'cout_salarial': float(cout_salarial),
                'marge': float(marge),
                'taux_marge': round(float(taux_marge), 2)
            }
            
            _logger.info(f"Marge calculée pour projet {projet_id} ({projet.name}): {result}")
            return result
            
        except Exception as e:
            _logger.error(f"Erreur calcul marge projet {projet_id}: {str(e)}")
            return self._get_empty_marge()

    def _get_cout_salarial_projet(self, projet, date_debut=None, date_fin=None):
        """Calcul des coûts salariaux d'un projet via les timesheets"""
        try:
            if not self._model_exists('account.analytic.line'):
                return 0
            
            domain = [('project_id', '=', projet.id)]
            
            if date_debut:
                domain.append(('date', '>=', date_debut))
            if date_fin:
                domain.append(('date', '<=', date_fin))
            
            timesheets = self.env['account.analytic.line'].search(domain)
            cout_total = 0
            
            _logger.debug(f"Analyse {len(timesheets)} timesheets pour projet {projet.id}")
            
            for ts in timesheets:
                cout_ligne = 0
                
                # Méthode recommandée: Utiliser le montant négatif des timesheets (coûts)
                if hasattr(ts, 'amount') and ts.amount is not None and ts.amount < 0:
                    cout_ligne = abs(ts.amount)
                    _logger.debug(f"Coût direct timesheet {ts.id}: {cout_ligne}")
                
                cout_total += cout_ligne
            
            _logger.info(f"Coût salarial total pour projet {projet.id}: {cout_total}")
            return cout_total
            
        except Exception as e:
            _logger.error(f"Erreur calcul coût salarial projet {projet.id}: {str(e)}")
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
                'ca_total': float(ca_total),
                'cout_admin': float(cout_admin),
                'marge_admin': float(marge_admin),
                'taux_marge_admin': round(float(taux_marge_admin), 2)
            }
            
            _logger.info(f"Marge administrative calculée: {result}")
            return result
            
        except Exception as e:
            _logger.error(f"Erreur calcul marge administrative: {str(e)}")
            return {
                'ca_total': 0.0,
                'cout_admin': 0.0,
                'marge_admin': 0.0,
                'taux_marge_admin': 0.0
            }

    def _get_cout_administratif(self, date_debut=None, date_fin=None):
        """Calcul des coûts administratifs via les comptes comptables"""
        try:
            cout_admin = 0
            date_debut = self._parse_date(date_debut)
            date_fin = self._parse_date(date_fin)
            
            # Méthode recommandée: Via les comptes comptables de frais généraux
            if self._model_exists('account.move.line') and self._model_exists('account.account'):
                # Recherche des comptes de charges administratives
                comptes_admin = self.env['account.account'].search([
                    '|', '|', '|', '|',
                    ('code', 'like', '6%'),  # Comptes de charges
                    ('name', 'ilike', 'admin'),
                    ('name', 'ilike', 'frais généraux'),
                    ('name', 'ilike', 'direction'),
                    ('name', 'ilike', 'management')
                ])
                
                if comptes_admin:
                    domain_charges = [
                        ('account_id', 'in', comptes_admin.ids),
                        ('move_id.state', '=', 'posted')
                    ]
                    
                    if date_debut:
                        domain_charges.append(('date', '>=', date_debut))
                    if date_fin:
                        domain_charges.append(('date', '<=', date_fin))
                    
                    lignes_charges = self.env['account.move.line'].search(domain_charges)
                    cout_admin = sum(abs(ligne.debit - ligne.credit) for ligne in lignes_charges)
            
            return cout_admin
            
        except Exception as e:
            _logger.warning(f"Erreur calcul coût administratif: {str(e)}")
            return 0

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
            'revenus': 0.0,
            'cout_salarial': 0.0,
            'marge': 0.0,
            'taux_marge': 0.0
        }

    @api.model
    def get_budget_data(self, date_debut=None, date_fin=None):
        """Récupération des données budgétaires"""
        try:
            budget_data = {
                'total_budget': 0.0,
                'budget_utilise': 0.0,
                'budget_restant': 0.0,
                'taux_utilisation': 0.0,
                'projets_budget': []
            }
            
            if not self._model_exists('project.project'):
                return budget_data
            
            # Récupérer les projets avec budget
            domain = [('budget', '>', 0)]
            if date_debut and self._field_exists('project.project', 'date_start'):
                domain.append(('date_start', '>=', date_debut))
            if date_fin and self._field_exists('project.project', 'date'):
                domain.append(('date', '<=', date_fin))
            
            projets = self.env['project.project'].search(domain)
            
            total_budget = sum(projet.budget for projet in projets if projet.budget)
            total_ca = 0
            
            for projet in projets:
                ca_projet = self._get_ca_projet_optimized(projet, date_debut, date_fin)
                total_ca += ca_projet
                
                taux_utilisation = (ca_projet / projet.budget * 100) if projet.budget > 0 else 0
                
                budget_data['projets_budget'].append({
                    'id': projet.id,
                    'name': projet.name,
                    'budget': projet.budget,
                    'ca_realise': ca_projet,
                    'taux_utilisation': taux_utilisation,
                    'budget_restant': max(0, projet.budget - ca_projet)
                })
            
            budget_data['total_budget'] = total_budget
            budget_data['budget_utilise'] = total_ca
            budget_data['budget_restant'] = max(0, total_budget - total_ca)
            budget_data['taux_utilisation'] = (total_ca / total_budget * 100) if total_budget > 0 else 0
            
            return budget_data
            
        except Exception as e:
            _logger.error(f"Erreur récupération données budget: {str(e)}")
            return {
                'total_budget': 0.0,
                'budget_utilise': 0.0,
                'budget_restant': 0.0,
                'taux_utilisation': 0.0,
                'projets_budget': []
            }

    @api.model
    def get_graphique_data(self, date_debut=None, date_fin=None):
        """Prépare les données pour les graphiques"""
        try:
            # Données pour graphique à barres (CA par projet)
            projets_data = self.get_projets_data(date_debut, date_fin)
            graphique_ca = {
                'labels': [],
                'data': [],
                'backgroundColors': []
            }
            
            # Couleurs pour le graphique
            colors = ['#007bff', '#28a745', '#ffc107', '#dc3545', '#6f42c1', 
                    '#20c997', '#fd7e14', '#e83e8c', '#6c757d', '#17a2b8']
            
            for i, projet in enumerate(projets_data):
                if projet['ca'] > 0:  # N'afficher que les projets avec CA
                    graphique_ca['labels'].append(projet['name'][:20] + '...' if len(projet['name']) > 20 else projet['name'])
                    graphique_ca['data'].append(projet['ca'])
                    graphique_ca['backgroundColors'].append(colors[i % len(colors)])
            
            # Données pour graphique circulaire (Répartition statuts)
            statuts = {}
            for projet in projets_data:
                statut = projet['stage']
                statuts[statut] = statuts.get(statut, 0) + 1
            
            graphique_statuts = {
                'labels': list(statuts.keys()),
                'data': list(statuts.values()),
                'backgroundColors': colors[:len(statuts)]
            }
            
            # Données pour graphique linéaire (Évolution mensuelle du CA)
            graphique_evolution = self._get_evolution_mensuelle_ca(date_debut, date_fin)
            
            return {
                'graphique_ca': graphique_ca,
                'graphique_statuts': graphique_statuts,
                'graphique_evolution': graphique_evolution
            }
            
        except Exception as e:
            _logger.error(f"Erreur préparation données graphiques: {str(e)}")
            return {
                'graphique_ca': {'labels': [], 'data': [], 'backgroundColors': []},
                'graphique_statuts': {'labels': [], 'data': [], 'backgroundColors': []},
                'graphique_evolution': {'labels': [], 'data': []}
            }

    def _get_evolution_mensuelle_ca(self, date_debut=None, date_fin=None):
        """Calcule l'évolution mensuelle du CA"""
        try:
            if not self._model_exists('account.move'):
                return {'labels': [], 'data': []}
            
            # Déterminer la plage de dates
            if not date_debut:
                date_debut = (datetime.now() - timedelta(days=365)).strftime('%Y-%m-%d')
            if not date_fin:
                date_fin = datetime.now().strftime('%Y-%m-%d')
            
            date_debut = self._parse_date(date_debut)
            date_fin = self._parse_date(date_fin)
            
            # Générer tous les mois dans l'intervalle
            current = date_debut.replace(day=1)
            end = date_fin.replace(day=1)
            months = []
            
            while current <= end:
                months.append(current.strftime('%Y-%m'))
                # Passer au mois suivant
                if current.month == 12:
                    current = current.replace(year=current.year + 1, month=1)
                else:
                    current = current.replace(month=current.month + 1)
            
            # Récupérer le CA pour chaque mois
            ca_par_mois = []
            for month in months:
                start_date = datetime.strptime(month + '-01', '%Y-%m-%d')
                if start_date.month == 12:
                    end_date = start_date.replace(year=start_date.year + 1, month=1, day=1) - timedelta(days=1)
                else:
                    end_date = start_date.replace(month=start_date.month + 1, day=1) - timedelta(days=1)
                
                ca_mois = self.get_chiffre_affaires(
                    start_date.strftime('%Y-%m-%d'),
                    end_date.strftime('%Y-%m-%d')
                )
                ca_par_mois.append(ca_mois)
            
            # Formater les labels en français
            mois_fr = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 
                    'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc']
            
            labels = []
            for month in months:
                year, month_num = month.split('-')
                labels.append(f"{mois_fr[int(month_num)-1]} {year}")
            
            return {
                'labels': labels,
                'data': ca_par_mois
            }
            
        except Exception as e:
            _logger.error(f"Erreur calcul évolution mensuelle CA: {str(e)}")
            return {'labels': [], 'data': []}

    @api.model
    def get_dashboard_data(self, date_debut=None, date_fin=None):
        """Méthode principale pour récupérer toutes les données du dashboard"""
        try:
            _logger.info(f"Récupération données dashboard: {date_debut} à {date_fin}")
            
            result = {
                'chiffre_affaires': 0.0,
                'projets': [],
                'marge_administrative': {
                    'ca_total': 0.0,
                    'cout_admin': 0.0,
                    'marge_admin': 0.0,
                    'taux_marge_admin': 0.0
                },
                'budget_data': {
                    'total_budget': 0.0,
                    'budget_utilise': 0.0,
                    'budget_restant': 0.0,
                    'taux_utilisation': 0.0,
                    'projets_budget': []
                },
                'graphique_data': {
                    'graphique_ca': {'labels': [], 'data': [], 'backgroundColors': []},
                    'graphique_statuts': {'labels': [], 'data': [], 'backgroundColors': []},
                    'graphique_evolution': {'labels': [], 'data': []}
                }
            }
            
            # Calcul séquentiel avec gestion d'erreur
            try:
                result['chiffre_affaires'] = float(self.get_chiffre_affaires(date_debut, date_fin))
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
                result['budget_data'] = self.get_budget_data(date_debut, date_fin)
            except Exception as e:
                _logger.error(f"Erreur données budget: {str(e)}")
            
            try:
                result['graphique_data'] = self.get_graphique_data(date_debut, date_fin)
            except Exception as e:
                _logger.error(f"Erreur données graphiques: {str(e)}")
            
            return result
            
        except Exception as e:
            _logger.error(f"Erreur critique dashboard: {str(e)}")
            return {
                'chiffre_affaires': 0.0,
                'projets': [],
                'marge_administrative': {
                    'ca_total': 0.0,
                    'cout_admin': 0.0,
                    'marge_admin': 0.0,
                    'taux_marge_admin': 0.0
                },
                'budget_data': {
                    'total_budget': 0.0,
                    'budget_utilise': 0.0,
                    'budget_restant': 0.0,
                    'taux_utilisation': 0.0,
                    'projets_budget': []
                },
                'graphique_data': {
                    'graphique_ca': {'labels': [], 'data': [], 'backgroundColors': []},
                    'graphique_statuts': {'labels': [], 'data': [], 'backgroundColors': []},
                    'graphique_evolution': {'labels': [], 'data': []}
                }
            }