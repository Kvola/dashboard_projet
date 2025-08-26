# controllers/dashboard_controller.py - VERSION CORRIGÉE
from odoo import http
from odoo.http import request, content_disposition
import io
from datetime import datetime
import xlsxwriter
import json
# --- PDF (ReportLab)
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Spacer
from reportlab.lib.units import cm
import logging
from odoo.exceptions import ValidationError, AccessError

_logger = logging.getLogger(__name__)

class DashboardController(http.Controller):
    
    @http.route('/dashboard_projet/data', type='json', auth='user', methods=['POST'], csrf=False)
    def get_dashboard_data(self, date_debut=None, date_fin=None):
        """Endpoint principal pour récupérer les données du dashboard"""
        try:
            _logger.info(f"Requête dashboard - début: {date_debut}, fin: {date_fin}")
            
            # Vérification de l'authentification
            if not request.env.user:
                return self._error_response('Utilisateur non authentifié')
            
            # Vérification du modèle
            if 'dashboard.projet' not in request.env:
                _logger.error("Modèle 'dashboard.projet' non trouvé")
                return self._default_dashboard_data()
            
            # Validation des dates
            date_debut = self._validate_date(date_debut)
            date_fin = self._validate_date(date_fin)
            
            # Récupération des données
            dashboard_model = request.env['dashboard.projet']
            result = dashboard_model.get_dashboard_data(date_debut, date_fin)
            
            # Validation du résultat
            result = self._ensure_valid_response(result)
            
            _logger.info(f"Données dashboard retournées avec succès - {len(result.get('projets', []))} projets")
            return result
            
        except AccessError as e:
            _logger.error(f"Erreur d'accès: {str(e)}")
            return self._error_response('Accès refusé', include_default=True)
            
        except ValidationError as e:
            _logger.error(f"Erreur de validation: {str(e)}")
            return self._error_response(f'Erreur de validation: {str(e)}', include_default=True)
            
        except Exception as e:
            _logger.error(f"Erreur inattendue: {str(e)}")
            return self._error_response(f'Erreur serveur: {str(e)}', include_default=True)
    
    @http.route('/dashboard_projet/projet_marge/<int:projet_id>', type='json', auth='user', methods=['POST'], csrf=False)
    def get_projet_marge(self, projet_id, date_debut=None, date_fin=None):
        """Endpoint pour récupérer la marge d'un projet spécifique"""
        try:
            _logger.info(f"Calcul marge demandé - projet: {projet_id}, début: {date_debut}, fin: {date_fin}")
            
            if not request.env.user:
                return self._error_response('Utilisateur non authentifié', default_marge=True)
            
            if not projet_id or projet_id <= 0:
                _logger.warning(f"ID projet invalide: {projet_id}")
                return self._default_marge_data()
            
            if 'dashboard.projet' not in request.env:
                _logger.error("Modèle 'dashboard.projet' non trouvé")
                return self._default_marge_data()
            
            # Validation des dates
            date_debut = self._validate_date(date_debut)
            date_fin = self._validate_date(date_fin)
            
            # Vérification que le projet existe
            if 'project.project' in request.env:
                projet = request.env['project.project'].browse(projet_id)
                if not projet.exists():
                    _logger.warning(f"Projet {projet_id} non trouvé")
                    return self._error_response('Projet non trouvé', default_marge=True)
            
            dashboard_model = request.env['dashboard.projet']
            result = dashboard_model.get_marge_salariale_projet(projet_id, date_debut, date_fin)
            
            # Validation et conversion du résultat
            result = self._ensure_valid_marge(result)
            
            _logger.info(f"Marge calculée pour projet {projet_id}: {result}")
            return result
            
        except AccessError as e:
            _logger.error(f"Erreur d'accès marge projet: {str(e)}")
            return self._error_response('Accès refusé', default_marge=True)
            
        except Exception as e:
            _logger.error(f"Erreur marge projet {projet_id}: {str(e)}")
            return self._error_response(f'Erreur serveur: {str(e)}', default_marge=True)

    # ===== EXPORT UNIFIÉ (CORRIGÉ) =====
    @http.route('/dashboard_projet/export', type='http', auth='user', methods=['GET'], csrf=False)
    def export_dashboard(self, date_debut=None, date_fin=None, format='xlsx', **kwargs):
        """Endpoint unifié pour l'export du dashboard"""
        try:
            _logger.info(f"Export dashboard demandé - format: {format}, dates: {date_debut} - {date_fin}")
            
            if not request.env.user:
                return request.make_response("Utilisateur non authentifié", status=401)
            
            # Validation des dates
            date_debut = self._validate_date(date_debut) or datetime.today().strftime("%Y-%m-%d")
            date_fin = self._validate_date(date_fin) or datetime.today().strftime("%Y-%m-%d")
            
            # Récupération des données via le modèle dashboard
            if 'dashboard.projet' not in request.env:
                return request.make_response("Modèle dashboard non disponible", status=500)
            
            dashboard_model = request.env['dashboard.projet']
            data = dashboard_model.get_dashboard_data(date_debut, date_fin)
            
            # Récupération des marges pour chaque projet
            projets_with_margins = []
            for projet in data.get("projets", []):
                try:
                    marge_data = dashboard_model.get_marge_salariale_projet(
                        projet["id"], date_debut, date_fin
                    )
                    projet_copy = dict(projet)
                    projet_copy["marge_data"] = self._ensure_valid_marge(marge_data)
                    projets_with_margins.append(projet_copy)
                except Exception as e:
                    _logger.warning(f"Erreur calcul marge projet {projet['id']}: {str(e)}")
                    projet_copy = dict(projet)
                    projet_copy["marge_data"] = self._default_marge_data()
                    projets_with_margins.append(projet_copy)
            
            data["projets"] = projets_with_margins
            
            # Génération du fichier selon le format
            if format.lower() in ("xlsx", "xls", "excel"):
                return self._make_xlsx_response(data, date_debut, date_fin)
            elif format.lower() == "pdf":
                return self._make_pdf_response(data, date_debut, date_fin)
            elif format.lower() == "json":
                return self._make_json_response(data, date_debut, date_fin)
            elif format.lower() == "csv":
                return self._make_csv_response(data, date_debut, date_fin)
            else:
                return request.make_response(f"Format '{format}' non supporté", status=400)
                
        except Exception as e:
            _logger.error(f"Erreur export dashboard: {str(e)}")
            return request.make_response(f"Erreur export: {str(e)}", status=500)

    def _make_xlsx_response(self, data, date_debut, date_fin):
        """Génère un fichier Excel avec formatage avancé"""
        try:
            buffer = io.BytesIO()
            wb = xlsxwriter.Workbook(buffer, {
                'in_memory': True,
                'strings_to_numbers': True,
                'strings_to_formulas': False,
                'strings_to_urls': False
            })
            
            # === FORMATS ===
            title_fmt = wb.add_format({
                'bold': True, 'font_size': 16, 'align': 'center',
                'valign': 'vcenter', 'bg_color': '#007bff',
                'font_color': 'white', 'border': 1
            })
            
            header_fmt = wb.add_format({
                'bold': True, 'bg_color': '#343a40',
                'font_color': 'white', 'border': 1,
                'align': 'center', 'text_wrap': True
            })
            
            money_fmt = wb.add_format({
                'num_format': '#,##0" €"',
                'border': 1, 'align': 'right'
            })
            
            percent_fmt = wb.add_format({
                'num_format': '0.0"%"',
                'border': 1, 'align': 'right'
            })
            
            normal_fmt = wb.add_format({'border': 1, 'align': 'left'})
            number_fmt = wb.add_format({'border': 1, 'align': 'right'})
            center_fmt = wb.add_format({'border': 1, 'align': 'center'})
            
            # === ONGLET RÉSUMÉ ===
            ws_summary = wb.add_worksheet("Résumé")
            ws_summary.merge_range('A1:H1', f"DASHBOARD PROJETS - Du {date_debut} au {date_fin}", title_fmt)
            
            # Métriques principales
            metrics_data = [
                ['Métrique', 'Valeur', 'Détails'],
                ['Chiffre d\'affaires total', data.get("chiffre_affaires", 0), 'CA période'],
                ['Nombre de projets', len(data.get("projets", [])), 'Projets actifs'],
                ['Personnel total', sum(p.get('nb_personnes', 0) for p in data.get("projets", [])), 'Personnes affectées'],
                ['Heures totales', sum(p.get('heures', 0) for p in data.get("projets", [])), 'Heures travaillées']
            ]
            
            for row, (label, value, detail) in enumerate(metrics_data, start=3):
                ws_summary.write(row, 0, label, header_fmt if row == 3 else normal_fmt)
                if isinstance(value, (int, float)):
                    ws_summary.write(row, 1, value, money_fmt if 'CA' in label else number_fmt)
                else:
                    ws_summary.write(row, 1, value, normal_fmt)
                ws_summary.write(row, 2, detail, normal_fmt)
            
            # Marge administrative
            ma = data.get("marge_administrative", {})
            start_row = len(metrics_data) + 4
            
            marge_data = [
                ['Marge Administrative', '', ''],
                ['CA Total', ma.get("ca_total", 0), ''],
                ['Coûts Administratifs', ma.get("cout_admin", 0), ''],
                ['Marge Administrative', ma.get("marge_admin", 0), ''],
                ['Taux de Marge', ma.get("taux_marge_admin", 0), '%']
            ]
            
            for row, (label, value, unit) in enumerate(marge_data, start=start_row):
                ws_summary.write(row, 0, label, header_fmt if row == start_row else normal_fmt)
                if value != '':
                    if '%' in unit:
                        ws_summary.write(row, 1, value, percent_fmt)
                    else:
                        ws_summary.write(row, 1, value, money_fmt)
                ws_summary.write(row, 2, unit, normal_fmt)
            
            # === ONGLET PROJETS DÉTAILLÉ ===
            ws_projects = wb.add_worksheet("Projets Détail")
            
            # En-têtes
            headers = [
                "ID", "Nom du Projet", "CA (€)", "Personnes", 
                "Heures", "Statut", "Revenus (€)", "Coût Salarial (€)", 
                "Marge (€)", "Taux Marge (%)"
            ]
            
            for col, header in enumerate(headers):
                ws_projects.write(0, col, header, header_fmt)
            
            # Données des projets
            for row, projet in enumerate(data.get("projets", []), start=1):
                marge_data = projet.get("marge_data", {}) or {}
                
                ws_projects.write(row, 0, projet.get("id", ""), center_fmt)
                ws_projects.write(row, 1, projet.get("name", ""), normal_fmt)
                ws_projects.write(row, 2, projet.get("ca", 0), money_fmt)
                ws_projects.write(row, 3, projet.get("nb_personnes", 0), center_fmt)
                ws_projects.write(row, 4, projet.get("heures", 0), number_fmt)
                ws_projects.write(row, 5, projet.get("stage", "Non défini"), center_fmt)
                ws_projects.write(row, 6, marge_data.get("revenus", 0), money_fmt)
                ws_projects.write(row, 7, marge_data.get("cout_salarial", 0), money_fmt)
                ws_projects.write(row, 8, marge_data.get("marge", 0), money_fmt)
                ws_projects.write(row, 9, marge_data.get("taux_marge", 0), percent_fmt)
            
            # Ajustement des largeurs de colonnes
            ws_summary.set_column(0, 2, 20)
            ws_projects.set_column(0, 0, 8)   # ID
            ws_projects.set_column(1, 1, 40)  # Nom projet
            ws_projects.set_column(2, 9, 15)  # Autres colonnes
            
            wb.close()
            buffer.seek(0)
            
            filename = f"dashboard_complet_{date_debut}_{date_fin}.xlsx"
            return request.make_response(
                buffer.getvalue(),
                headers=[
                    ('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
                    ('Content-Disposition', content_disposition(filename)),
                ],
            )
            
        except Exception as e:
            _logger.error(f"Erreur génération Excel: {str(e)}")
            return request.make_response(f"Erreur génération Excel: {str(e)}", status=500)

    def _make_pdf_response(self, data, date_debut, date_fin):
        """Génère un PDF professionnel"""
        try:
            buffer = io.BytesIO()
            doc = SimpleDocTemplate(
                buffer,
                pagesize=landscape(A4),
                leftMargin=1.5 * cm,
                rightMargin=1.5 * cm,
                topMargin=1.5 * cm,
                bottomMargin=1.5 * cm,
                title=f"Dashboard Projets {date_debut} - {date_fin}",
            )
            
            styles = getSampleStyleSheet()
            story = []
            
            # Style titre
            title_style = styles['Title']
            title_style.alignment = 1  # Centré
            title_style.fontSize = 16
            title_style.spaceAfter = 20
            
            # Titre principal
            title = Paragraph(f"<b>DASHBOARD PROJETS</b><br/>Du {date_debut} au {date_fin}", title_style)
            story.append(title)
            story.append(Spacer(1, 0.5 * cm))
            
            # Métriques principales
            story.append(Paragraph("<b>MÉTRIQUES PRINCIPALES</b>", styles['Heading2']))
            
            metrics_data = [
                ['Chiffre d\'affaires total:', f"{data.get('chiffre_affaires', 0):,.0f} €"],
                ['Nombre de projets:', str(len(data.get('projets', [])))],
                ['Personnel total:', str(sum(p.get('nb_personnes', 0) for p in data.get('projets', [])))],
                ['Heures totales:', f"{sum(p.get('heures', 0) for p in data.get('projets', [])):,.1f} h"]
            ]
            
            for label, value in metrics_data:
                story.append(Paragraph(f"<b>{label}</b> {value}", styles['Normal']))
            
            story.append(Spacer(1, 0.5 * cm))
            
            # Marge administrative
            story.append(Paragraph("<b>MARGE ADMINISTRATIVE</b>", styles['Heading2']))
            ma = data.get("marge_administrative", {})
            
            marge_data = [
                ['CA Total:', f"{ma.get('ca_total', 0):,.0f} €"],
                ['Coûts Administratifs:', f"{ma.get('cout_admin', 0):,.0f} €"],
                ['Marge Administrative:', f"{ma.get('marge_admin', 0):,.0f} €"],
                ['Taux de Marge:', f"{ma.get('taux_marge_admin', 0):.1f} %"]
            ]
            
            for label, value in marge_data:
                story.append(Paragraph(f"<b>{label}</b> {value}", styles['Normal']))
            
            story.append(Spacer(1, 1 * cm))
            
            # Tableau des projets (limité à 30 pour éviter les PDF trop longs)
            story.append(Paragraph("<b>DÉTAIL DES PROJETS</b>", styles['Heading2']))
            
            table_data = [[
                Paragraph('<b>ID</b>', styles['Normal']),
                Paragraph('<b>Projet</b>', styles['Normal']),
                Paragraph('<b>CA (€)</b>', styles['Normal']),
                Paragraph('<b>Pers.</b>', styles['Normal']),
                Paragraph('<b>Heures</b>', styles['Normal']),
                Paragraph('<b>Statut</b>', styles['Normal']),
                Paragraph('<b>Marge (€)</b>', styles['Normal']),
                Paragraph('<b>Taux (%)</b>', styles['Normal'])
            ]]
            
            for projet in data.get("projets", [])[:30]:  # Limiter à 30 projets
                marge_data = projet.get("marge_data", {}) or {}
                
                table_data.append([
                    Paragraph(str(projet.get("id", "")), styles['Normal']),
                    Paragraph(projet.get("name", "")[:30], styles['Normal']),  # Tronquer le nom si trop long
                    Paragraph(f"{projet.get('ca', 0):,.0f}", styles['Normal']),
                    Paragraph(str(projet.get('nb_personnes', 0)), styles['Normal']),
                    Paragraph(f"{projet.get('heures', 0):.1f}", styles['Normal']),
                    Paragraph(projet.get('stage', 'Non défini')[:15], styles['Normal']),
                    Paragraph(f"{marge_data.get('marge', 0):,.0f}", styles['Normal']),
                    Paragraph(f"{marge_data.get('taux_marge', 0):.1f}", styles['Normal'])
                ])
            
            # Création du tableau
            table = Table(table_data, repeatRows=1)
            table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#343a40")),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, 0), 8),
                ('BACKGROUND', (0, 1), (-1, -1), colors.white),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('ALIGN', (2, 1), (2, -1), 'RIGHT'),
                ('ALIGN', (6, 1), (7, -1), 'RIGHT'),
                ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
                ('FONTSIZE', (0, 1), (-1, -1), 7),
                ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ]))
            
            story.append(table)
            
            # Pied de page
            story.append(Spacer(1, 1 * cm))
            footer_text = f"Généré le {datetime.now().strftime('%d/%m/%Y à %H:%M')} par {request.env.user.name}"
            story.append(Paragraph(footer_text, styles['Italic']))
            
            doc.build(story)
            buffer.seek(0)
            
            filename = f"dashboard_complet_{date_debut}_{date_fin}.pdf"
            return request.make_response(
                buffer.getvalue(),
                headers=[
                    ('Content-Type', 'application/pdf'),
                    ('Content-Disposition', content_disposition(filename)),
                ],
            )
            
        except Exception as e:
            _logger.error(f"Erreur génération PDF: {str(e)}")
            return request.make_response(f"Erreur génération PDF: {str(e)}", status=500)

    def _make_json_response(self, data, date_debut, date_fin):
        """Génère un export JSON"""
        try:
            response_data = json.dumps(
                data, 
                indent=2, 
                default=self._json_serializer, 
                ensure_ascii=False
            )
            
            filename = f"dashboard_{date_debut}_{date_fin}.json"
            return request.make_response(
                response_data,
                headers=[
                    ('Content-Type', 'application/json; charset=utf-8'),
                    ('Content-Disposition', content_disposition(filename))
                ]
            )
        except Exception as e:
            _logger.error(f"Erreur génération JSON: {str(e)}")
            return request.make_response(f"Erreur génération JSON: {str(e)}", status=500)

    def _make_csv_response(self, data, date_debut, date_fin):
        """Génère un export CSV"""
        try:
            import csv
            
            output = io.StringIO()
            writer = csv.writer(output, delimiter=';')
            
            # En-têtes
            writer.writerow([
                'ID Projet', 'Nom', 'CA (€)', 'Personnes', 'Heures', 'Statut',
                'Revenus (€)', 'Coût Salarial (€)', 'Marge (€)', 'Taux Marge (%)'
            ])
            
            # Données des projets
            for projet in data.get("projets", []):
                marge_data = projet.get("marge_data", {}) or {}
                
                writer.writerow([
                    projet.get('id', ''),
                    projet.get('name', ''),
                    projet.get('ca', 0),
                    projet.get('nb_personnes', 0),
                    projet.get('heures', 0),
                    projet.get('stage', ''),
                    marge_data.get('revenus', 0),
                    marge_data.get('cout_salarial', 0),
                    marge_data.get('marge', 0),
                    marge_data.get('taux_marge', 0)
                ])
            
            csv_content = output.getvalue()
            output.close()
            
            filename = f"dashboard_{date_debut}_{date_fin}.csv"
            return request.make_response(
                csv_content.encode('utf-8'),
                headers=[
                    ('Content-Type', 'text/csv; charset=utf-8'),
                    ('Content-Disposition', content_disposition(filename))
                ]
            )
            
        except Exception as e:
            _logger.error(f"Erreur génération CSV: {str(e)}")
            return request.make_response(f"Erreur génération CSV: {str(e)}", status=500)

    # ===== AUTRES ENDPOINTS (inchangés) =====
    
    @http.route('/dashboard_projet/test', type='json', auth='user', methods=['POST'], csrf=False)
    def test_dashboard(self):
        """Test endpoint pour vérifier le fonctionnement du dashboard"""
        try:
            models_available = {
                'dashboard.projet': 'dashboard.projet' in request.env,
                'project.project': 'project.project' in request.env,
                'account.move': 'account.move' in request.env,
                'account.move.line': 'account.move.line' in request.env,
                'sale.order': 'sale.order' in request.env,
                'account.analytic.line': 'account.analytic.line' in request.env,
                'hr.employee': 'hr.employee' in request.env,
            }
            
            return {
                'status': 'success',
                'message': 'Dashboard controller opérationnel',
                'user': request.env.user.name,
                'user_id': request.env.user.id,
                'company': request.env.company.name,
                'models_available': models_available,
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            return {
                'status': 'error',
                'message': str(e),
                'timestamp': datetime.now().isoformat()
            }
    
    @http.route('/dashboard_projet/health', type='json', auth='user', methods=['POST'], csrf=False)
    def health_check(self):
        """Endpoint de vérification de santé du dashboard"""
        try:
            health_status = {
                'status': 'healthy',
                'checks': {
                    'database': 'ok',
                    'models': 'ok',
                    'permissions': 'ok'
                },
                'details': {},
                'timestamp': datetime.now().isoformat()
            }
            
            # Test de connexion base de données
            try:
                request.env.cr.execute("SELECT 1")
                health_status['details']['database'] = 'Connexion DB active'
            except Exception as e:
                health_status['checks']['database'] = 'error'
                health_status['details']['database'] = str(e)
                health_status['status'] = 'degraded'
            
            # Test des modèles requis
            required_models = ['dashboard.projet', 'project.project']
            missing_models = []
            for model in required_models:
                if model not in request.env:
                    missing_models.append(model)
            
            if missing_models:
                health_status['checks']['models'] = 'error'
                health_status['details']['missing_models'] = missing_models
                health_status['status'] = 'unhealthy'
            
            return health_status
            
        except Exception as e:
            return {
                'status': 'error',
                'message': f'Health check failed: {str(e)}',
                'timestamp': datetime.now().isoformat()
            }

    # ===== MÉTHODES UTILITAIRES =====
    
    def _validate_date(self, date_str):
        """Valide et convertit une chaîne de date"""
        if not date_str:
            return None
        try:
            datetime.strptime(date_str, '%Y-%m-%d')
            return date_str
        except ValueError:
            _logger.warning(f"Format de date invalide: {date_str}")
            return None
    
    def _error_response(self, message, include_default=False, default_marge=False):
        """Génère une réponse d'erreur standardisée"""
        response = {'error': message}
        
        if default_marge:
            response.update(self._default_marge_data())
        elif include_default:
            response.update(self._default_dashboard_data())
        
        return response
    
    def _default_marge_data(self):
        """Données par défaut pour la marge"""
        return {
            'revenus': 0.0,
            'cout_salarial': 0.0,
            'marge': 0.0,
            'taux_marge': 0.0
        }
    
    def _ensure_valid_marge(self, data):
        """S'assure que les données de marge sont valides"""
        if not isinstance(data, dict):
            return self._default_marge_data()
        
        return {
            'revenus': float(data.get('revenus', 0) or 0),
            'cout_salarial': float(data.get('cout_salarial', 0) or 0),
            'marge': float(data.get('marge', 0) or 0),
            'taux_marge': float(data.get('taux_marge', 0) or 0)
        }
    
    def _json_serializer(self, obj):
        """Sérialiseur JSON pour les objets non sérialisables"""
        if hasattr(obj, 'isoformat'):
            return obj.isoformat()
        elif hasattr(obj, '__str__'):
            return str(obj)
        return None

    # Ajouter cette méthode à la classe DashboardController

    @http.route('/dashboard_projet/graphique_data', type='json', auth='user', methods=['POST'], csrf=False)
    def get_graphique_data(self, date_debut=None, date_fin=None):
        """Endpoint pour récupérer les données des graphiques"""
        try:
            if not request.env.user:
                return self._error_response('Utilisateur non authentifié')
            
            if 'dashboard.projet' not in request.env:
                return {'error': 'Modèle dashboard non disponible'}
            
            date_debut = self._validate_date(date_debut)
            date_fin = self._validate_date(date_fin)
            
            dashboard_model = request.env['dashboard.projet']
            result = dashboard_model.get_graphique_data(date_debut, date_fin)
            
            return result
            
        except Exception as e:
            _logger.error(f"Erreur récupération données graphiques: {str(e)}")
            return {
                'graphique_ca': {'labels': [], 'data': [], 'backgroundColors': []},
                'graphique_statuts': {'labels': [], 'data': [], 'backgroundColors': []},
                'graphique_evolution': {'labels': [], 'data': []}
            }

    # Mettre à jour la méthode _ensure_valid_response pour inclure les nouvelles données
    def _ensure_valid_response(self, data):
        """S'assure que la réponse a une structure valide"""
        if not isinstance(data, dict):
            return self._default_dashboard_data()
        
        data['chiffre_affaires'] = float(data.get('chiffre_affaires', 0) or 0)
        
        if not isinstance(data.get('projets'), list):
            data['projets'] = []
        else:
            for projet in data['projets']:
                if isinstance(projet, dict):
                    projet['ca'] = float(projet.get('ca', 0) or 0)
                    projet['nb_personnes'] = int(projet.get('nb_personnes', 0) or 0)
                    projet['heures'] = float(projet.get('heures', 0) or 0)
        
        marge_admin = data.get('marge_administrative', {})
        if not isinstance(marge_admin, dict):
            marge_admin = {}
        
        data['marge_administrative'] = {
            'ca_total': float(marge_admin.get('ca_total', 0) or 0),
            'cout_admin': float(marge_admin.get('cout_admin', 0) or 0),
            'marge_admin': float(marge_admin.get('marge_admin', 0) or 0),
            'taux_marge_admin': float(marge_admin.get('taux_marge_admin', 0) or 0)
        }
        
        # Données budget
        budget_data = data.get('budget_data', {})
        if not isinstance(budget_data, dict):
            budget_data = {}
        
        data['budget_data'] = {
            'total_budget': float(budget_data.get('total_budget', 0) or 0),
            'budget_utilise': float(budget_data.get('budget_utilise', 0) or 0),
            'budget_restant': float(budget_data.get('budget_restant', 0) or 0),
            'taux_utilisation': float(budget_data.get('taux_utilisation', 0) or 0),
            'projets_budget': budget_data.get('projets_budget', []) or []
        }
        
        # Données graphiques
        graphique_data = data.get('graphique_data', {})
        if not isinstance(graphique_data, dict):
            graphique_data = {}
        
        data['graphique_data'] = {
            'graphique_ca': graphique_data.get('graphique_ca', {'labels': [], 'data': [], 'backgroundColors': []}),
            'graphique_statuts': graphique_data.get('graphique_statuts', {'labels': [], 'data': [], 'backgroundColors': []}),
            'graphique_evolution': graphique_data.get('graphique_evolution', {'labels': [], 'data': []})
        }
        
        return data

    # Mettre à jour la méthode _default_dashboard_data
    def _default_dashboard_data(self):
        """Données par défaut pour le dashboard"""
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