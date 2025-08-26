# models/dashboard.py - CORRECTIONS pour le calcul des marges
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
                    date_fin = self._parse_date(date_fin)
                    if date_fin:
                        domain.append(('invoice_date', '<=', date_fin))
                
                factures = self.env['account.move'].search(domain)
                ca_factures = sum(facture.amount_total_signed for facture in factures 
                                if facture.amount_total_signed and facture.amount_total_signed > 0)
                total_ca = max(total_ca, ca_factures)
            
            # # Méthode 2: Via les commandes de vente confirmées (fallback)
            # if total_ca == 0 and self._model_exists('sale.order'):
            #     domain = [('state', 'in', ['sale', 'done'])]
                
            #     if date_debut and self._field_exists('sale.order', 'date_order'):
            #         domain.append(('date_order', '>=', date_debut))
            #     if date_fin and self._field_exists('sale.order', 'date_order'):
            #         domain.append(('date_order', '<=', date_fin))
                
            #     commandes = self.env['sale.order'].search(domain)
            #     total_ca = sum(cmd.amount_total for cmd in commandes if cmd.amount_total)
            
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
                        'marge_data': None
                    })
            
            return projets_data
            
        except Exception as e:
            _logger.error(f"Erreur critique dans get_projets_data: {str(e)}")
            return []

    def _get_ca_projet_optimized(self, projet, date_debut=None, date_fin=None):
        """Calcul optimisé du CA d'un projet - VERSION CORRIGÉE"""
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
                    # Vérifier si le compte analytique est dans la distribution
                    analytic_lines = self.env['account.move.line'].search([
                        ('move_id.state', '=', 'posted'),
                        ('move_id.move_type', '=', 'out_invoice'),
                        ('analytic_distribution', '!=', False)
                    ])
                    
                    if date_debut:
                        analytic_lines = analytic_lines.filtered(lambda l: l.move_id.invoice_date >= date_debut)
                    if date_fin:
                        analytic_lines = analytic_lines.filtered(lambda l: l.move_id.invoice_date <= date_fin)
                    
                    for ligne in analytic_lines:
                        if ligne.analytic_distribution:
                            # analytic_distribution est un dictionnaire JSON
                            if str(projet.analytic_account_id.id) in str(ligne.analytic_distribution):
                                ca += ligne.price_subtotal or 0
                                
                # Fallback pour versions antérieures
                elif self._field_exists('account.move.line', 'analytic_account_id'):
                    domain.append(('analytic_account_id', '=', projet.analytic_account_id.id))
                    
                    if date_debut:
                        domain.append(('move_id.invoice_date', '>=', date_debut))
                    if date_fin:
                        domain.append(('move_id.invoice_date', '<=', date_fin))
                    
                    lignes = self.env['account.move.line'].search(domain)
                    ca = sum(ligne.price_subtotal for ligne in lignes if ligne.price_subtotal)
            
            # # Méthode 2: Via les commandes de vente liées au projet
            # if ca == 0 and self._model_exists('sale.order'):
            #     domain = [('state', 'in', ['sale', 'done'])]
                
            #     # Recherche directe par project_id
            #     if self._field_exists('sale.order', 'project_id'):
            #         domain.append(('project_id', '=', projet.id))
            #     # Ou par compte analytique
            #     elif (self._field_exists('sale.order', 'analytic_account_id') and 
            #           hasattr(projet, 'analytic_account_id') and projet.analytic_account_id):
            #         domain.append(('analytic_account_id', '=', projet.analytic_account_id.id))
                
            #     if date_debut and self._field_exists('sale.order', 'date_order'):
            #         domain.append(('date_order', '>=', date_debut))
            #     if date_fin and self._field_exists('sale.order', 'date_order'):
            #         domain.append(('date_order', '<=', date_fin))
                
            #     commandes = self.env['sale.order'].search(domain)
            #     ca = sum(cmd.amount_total for cmd in commandes if cmd.amount_total)
            
            # # Méthode 3: Via les timesheets valorisés (si pas de données factures/commandes)
            # if ca == 0 and self._model_exists('account.analytic.line'):
            #     timesheet_domain = [
            #         ('project_id', '=', projet.id),
            #         ('amount', '>', 0)  # Revenus (montants positifs)
            #     ]
                
            #     if date_debut:
            #         timesheet_domain.append(('date', '>=', date_debut))
            #     if date_fin:
            #         timesheet_domain.append(('date', '<=', date_fin))
                
            #     timesheets_revenus = self.env['account.analytic.line'].search(timesheet_domain)
            #     ca = sum(abs(ts.amount) for ts in timesheets_revenus if ts.amount)
            
            _logger.debug(f"CA calculé pour projet {projet.id}: {ca}")
            return ca
            
        except Exception as e:
            _logger.warning(f"Erreur calcul CA projet {projet.id}: {str(e)}")
            return 0

    def _get_nb_personnes_projet(self, projet):
        """Calcul du nombre de personnes affectées au projet"""
        try:
            # # Méthode 1: Via user_ids (responsables/membres)
            # if hasattr(projet, 'user_ids') and projet.user_ids:
            #     return len(projet.user_ids)
            
            # # Méthode 2: Via user_id (responsable unique)
            # if hasattr(projet, 'user_id') and projet.user_id:
            #     return 1
            
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
            # if hasattr(projet, 'stage_id') and projet.stage_id:
            #     return projet.stage_id.name
            # elif hasattr(projet, 'state'):
            #     state_mapping = {
            #         'template': 'Modèle',
            #         'draft': 'Brouillon', 
            #         'open': 'En cours',
            #         'pending': 'En attente',
            #         'close': 'Fermé',
            #         'cancelled': 'Annulé'
            #     }
            #     return state_mapping.get(projet.state, str(projet.state))
            # elif hasattr(projet, 'last_update_status'):
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
        """Calcul de la marge salariale par projet - VERSION CORRIGÉE"""
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
        """Calcul des coûts salariaux d'un projet - VERSION COMPLÈTEMENT CORRIGÉE"""
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
                
                # Méthode 1: Utiliser le montant négatif des timesheets (coûts)
                if hasattr(ts, 'amount') and ts.amount is not None:
                    if ts.amount < 0:
                        # Les coûts sont négatifs, on prend la valeur absolue
                        cout_ligne = abs(ts.amount)
                        _logger.debug(f"Coût direct timesheet {ts.id}: {cout_ligne}")
                
                # # Méthode 2: Calcul basé sur le temps et le coût horaire employé
                # if cout_ligne == 0 and hasattr(ts, 'unit_amount') and ts.unit_amount:
                #     cout_horaire = 0
                    
                #     # Essayer de récupérer le coût horaire de l'employé
                #     if (hasattr(ts, 'employee_id') and ts.employee_id and
                #         hasattr(ts.employee_id, 'hourly_cost') and ts.employee_id.hourly_cost):
                #         cout_horaire = ts.employee_id.hourly_cost
                #         _logger.debug(f"Coût horaire employé {ts.employee_id.name}: {cout_horaire}")
                    
                #     # Ou via le coût du produit/service associé
                #     elif (hasattr(ts, 'product_id') and ts.product_id and
                #           hasattr(ts.product_id, 'standard_price') and ts.product_id.standard_price):
                #         cout_horaire = ts.product_id.standard_price
                #         _logger.debug(f"Coût produit {ts.product_id.name}: {cout_horaire}")
                    
                #     # Ou via le user si pas d'employé
                #     elif (hasattr(ts, 'user_id') and ts.user_id and 
                #           hasattr(ts.user_id, 'employee_id') and ts.user_id.employee_id and
                #           hasattr(ts.user_id.employee_id, 'hourly_cost') and ts.user_id.employee_id.hourly_cost):
                #         cout_horaire = ts.user_id.employee_id.hourly_cost
                #         _logger.debug(f"Coût via user->employee: {cout_horaire}")
                    
                #     if cout_horaire > 0:
                #         cout_ligne = ts.unit_amount * cout_horaire
                #         _logger.debug(f"Coût calculé timesheet {ts.id}: {ts.unit_amount}h × {cout_horaire} = {cout_ligne}")
                
                # # Méthode 3: Estimation si aucune donnée de coût n'est disponible
                # if cout_ligne == 0 and hasattr(ts, 'unit_amount') and ts.unit_amount:
                #     # Coût horaire moyen estimé (configurable)
                #     cout_horaire_moyen = self._get_cout_horaire_moyen()
                #     cout_ligne = ts.unit_amount * cout_horaire_moyen
                #     _logger.debug(f"Coût estimé timesheet {ts.id}: {ts.unit_amount}h × {cout_horaire_moyen} = {cout_ligne}")
                
                cout_total += cout_ligne
            
            _logger.info(f"Coût salarial total pour projet {projet.id}: {cout_total}")
            return cout_total
            
        except Exception as e:
            _logger.error(f"Erreur calcul coût salarial projet {projet.id}: {str(e)}")
            return 0

    def _get_cout_horaire_moyen(self):
        """Récupère le coût horaire moyen ou utilise une estimation"""
        try:
            # Essayer de calculer un coût horaire moyen depuis les employés
            if self._model_exists('hr.employee'):
                employes = self.env['hr.employee'].search([
                    ('hourly_cost', '>', 0)
                ], limit=50)
                
                if employes:
                    cout_moyen = sum(e.hourly_cost for e in employes) / len(employes)
                    _logger.debug(f"Coût horaire moyen calculé: {cout_moyen}")
                    return cout_moyen
            
            # Valeur par défaut configurable via paramètres système
            cout_defaut = float(self.env['ir.config_parameter'].sudo().get_param(
                'dashboard_projet.cout_horaire_defaut', '50.0'
            ))
            
            _logger.debug(f"Coût horaire par défaut: {cout_defaut}")
            return cout_defaut
            
        except Exception as e:
            _logger.warning(f"Erreur calcul coût horaire moyen: {str(e)}")
            return 50.0  # Valeur de fallback

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
        """Calcul des coûts administratifs - VERSION AMÉLIORÉE"""
        try:
            cout_admin = 0
            date_debut = self._parse_date(date_debut)
            date_fin = self._parse_date(date_fin)
            
            # # Méthode 1: Via les employés administratifs et leurs timesheets
            # if (self._model_exists('hr.employee') and 
            #     self._model_exists('account.analytic.line')):
                
            #     # Recherche des employés admin par département
            #     admin_domain = []
            #     if self._field_exists('hr.employee', 'department_id'):
            #         admin_domain = [
            #             '|', '|', '|',
            #             ('department_id.name', 'ilike', 'admin'),
            #             ('department_id.name', 'ilike', 'direction'),
            #             ('department_id.name', 'ilike', 'comptab'),
            #             ('department_id.name', 'ilike', 'finance')
            #         ]
            #     # Ou par type de poste
            #     elif self._field_exists('hr.employee', 'job_id'):
            #         admin_domain = [
            #             '|', '|', '|',
            #             ('job_id.name', 'ilike', 'admin'),
            #             ('job_id.name', 'ilike', 'manager'),
            #             ('job_id.name', 'ilike', 'comptab'),
            #             ('job_id.name', 'ilike', 'director')
            #         ]
                
            #     if admin_domain:
            #         employes_admin = self.env['hr.employee'].search(admin_domain)
            #         _logger.debug(f"Trouvé {len(employes_admin)} employés administratifs")
                    
            #         if employes_admin:
            #             # Calculer leurs coûts via timesheets
            #             for emp in employes_admin:
            #                 domain_timesheet = [('employee_id', '=', emp.id)]
                            
            #                 if date_debut:
            #                     domain_timesheet.append(('date', '>=', date_debut))
            #                 if date_fin:
            #                     domain_timesheet.append(('date', '<=', date_fin))
                            
            #                 timesheets_emp = self.env['account.analytic.line'].search(domain_timesheet)
                            
            #                 for ts in timesheets_emp:
            #                     if hasattr(ts, 'amount') and ts.amount and ts.amount < 0:
            #                         cout_admin += abs(ts.amount)
            #                     elif (hasattr(ts, 'unit_amount') and ts.unit_amount and
            #                           hasattr(emp, 'hourly_cost') and emp.hourly_cost):
            #                         cout_admin += ts.unit_amount * emp.hourly_cost
            
            # Méthode 2: Via les comptes comptables de frais généraux
            if cout_admin == 0 and self._model_exists('account.move.line'):
                # Recherche des comptes de charges administratives
                if self._model_exists('account.account'):
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
            
            # # Méthode 3: Pourcentage du CA si pas de données spécifiques
            # if cout_admin == 0:
            #     ca_total = self.get_chiffre_affaires(date_debut, date_fin)
            #     # Récupérer le pourcentage depuis les paramètres système
            #     pourcentage_admin = float(self.env['ir.config_parameter'].sudo().get_param(
            #         'dashboard_projet.pourcentage_frais_admin', '15.0'
            #     ))
            #     cout_admin = ca_total * (pourcentage_admin / 100)
            #     _logger.debug(f"Coût admin estimé à {pourcentage_admin}% du CA: {cout_admin}")
            
            return cout_admin
            
        except Exception as e:
            _logger.warning(f"Erreur calcul coût administratif: {str(e)}")
            return 0

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
                }
            }

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
    def test_marge_calculation(self, projet_id, date_debut=None, date_fin=None):
        """Méthode de test pour déboguer le calcul de marge - VERSION AMÉLIORÉE"""
        try:
            projet = self.env['project.project'].browse(projet_id)
            if not projet.exists():
                return {'error': 'Projet non trouvé'}
            
            date_debut = self._parse_date(date_debut)
            date_fin = self._parse_date(date_fin)
            
            # Calcul détaillé avec debug
            revenus = self._get_ca_projet_optimized(projet, date_debut, date_fin)
            cout_salarial = self._get_cout_salarial_projet(projet, date_debut, date_fin)
            heures = self._get_heures_projet(projet, date_debut, date_fin)
            
            # Informations détaillées sur les timesheets
            timesheet_info = {'count': 0, 'sample': [], 'detail_couts': []}
            
            if self._model_exists('account.analytic.line'):
                domain = [('project_id', '=', projet.id)]
                if date_debut:
                    domain.append(('date', '>=', date_debut))
                if date_fin:
                    domain.append(('date', '<=', date_fin))
                
                timesheets = self.env['account.analytic.line'].search(domain, limit=20)
                timesheet_info['count'] = len(timesheets)
                
                for ts in timesheets[:10]:  # Limiter aux 10 premiers
                    ts_info = {
                        'id': ts.id,
                        'date': str(ts.date) if ts.date else None,
                        'employee': ts.employee_id.name if ts.employee_id else None,
                        'user': ts.user_id.name if ts.user_id else None,
                        'hours': ts.unit_amount or 0,
                        'amount': ts.amount or 0,
                        'product': ts.product_id.name if ts.product_id else None
                    }
                    
                    # Calcul du coût pour ce timesheet
                    cout_ts = 0
                    if ts.amount and ts.amount < 0:
                        cout_ts = abs(ts.amount)
                        ts_info['cout_methode'] = 'amount_direct'
                    elif (ts.employee_id and ts.employee_id.hourly_cost and ts.unit_amount):
                        cout_ts = ts.unit_amount * ts.employee_id.hourly_cost
                        ts_info['cout_methode'] = 'hourly_cost'
                        ts_info['hourly_cost'] = ts.employee_id.hourly_cost
                    elif (ts.product_id and ts.product_id.standard_price and ts.unit_amount):
                        cout_ts = ts.unit_amount * ts.product_id.standard_price
                        ts_info['cout_methode'] = 'product_cost'
                        ts_info['product_cost'] = ts.product_id.standard_price
                    else:
                        cout_ts = ts.unit_amount * 50.0  # Estimation
                        ts_info['cout_methode'] = 'estimation'
                    
                    ts_info['cout_calcule'] = cout_ts
                    timesheet_info['sample'].append(ts_info)
            
            # Test des méthodes de revenus
            revenus_detail = {}
            
            # Test via factures
            if (self._model_exists('account.move.line') and 
                hasattr(projet, 'analytic_account_id') and projet.analytic_account_id):
                
                facture_domain = [
                    ('move_id.state', '=', 'posted'),
                    ('move_id.move_type', '=', 'out_invoice')
                ]
                
                if self._field_exists('account.move.line', 'analytic_distribution'):
                    lines = self.env['account.move.line'].search(facture_domain, limit=100)
                    revenus_factures = 0
                    for line in lines:
                        if (line.analytic_distribution and 
                            str(projet.analytic_account_id.id) in str(line.analytic_distribution)):
                            revenus_factures += line.price_subtotal or 0
                    revenus_detail['factures_analytique'] = revenus_factures
                
                elif self._field_exists('account.move.line', 'analytic_account_id'):
                    facture_domain.append(('analytic_account_id', '=', projet.analytic_account_id.id))
                    facture_lines = self.env['account.move.line'].search(facture_domain)
                    revenus_detail['factures_direct'] = sum(l.price_subtotal for l in facture_lines if l.price_subtotal)
            
            # Test via commandes de vente
            if self._model_exists('sale.order'):
                if self._field_exists('sale.order', 'project_id'):
                    commandes_projet = self.env['sale.order'].search([
                        ('project_id', '=', projet.id),
                        ('state', 'in', ['sale', 'done'])
                    ])
                    revenus_detail['commandes_projet'] = sum(c.amount_total for c in commandes_projet)
                
                if (self._field_exists('sale.order', 'analytic_account_id') and 
                    hasattr(projet, 'analytic_account_id') and projet.analytic_account_id):
                    commandes_analytique = self.env['sale.order'].search([
                        ('analytic_account_id', '=', projet.analytic_account_id.id),
                        ('state', 'in', ['sale', 'done'])
                    ])
                    revenus_detail['commandes_analytique'] = sum(c.amount_total for c in commandes_analytique)
            
            # Test via timesheets revenus
            if self._model_exists('account.analytic.line'):
                ts_revenus = self.env['account.analytic.line'].search([
                    ('project_id', '=', projet.id),
                    ('amount', '>', 0)
                ])
                revenus_detail['timesheets_revenus'] = sum(ts.amount for ts in ts_revenus)
            
            return {
                'projet': {
                    'id': projet.id,
                    'name': projet.name,
                    'analytic_account_id': projet.analytic_account_id.id if projet.analytic_account_id else None,
                    'analytic_account_name': projet.analytic_account_id.name if projet.analytic_account_id else None
                },
                'calculs': {
                    'revenus': float(revenus),
                    'cout_salarial': float(cout_salarial),
                    'heures': float(heures),
                    'marge': float(revenus - cout_salarial),
                    'taux_marge': float(((revenus - cout_salarial) / revenus * 100) if revenus > 0 else 0)
                },
                'revenus_detail': revenus_detail,
                'timesheet_info': timesheet_info,
                'parametres': {
                    'date_debut': str(date_debut) if date_debut else None,
                    'date_fin': str(date_fin) if date_fin else None,
                    'cout_horaire_moyen': self._get_cout_horaire_moyen()
                }
            }
            
        except Exception as e:
            _logger.error(f"Erreur test marge: {str(e)}")
            return {'error': str(e), 'details': str(e.__class__.__name__)}