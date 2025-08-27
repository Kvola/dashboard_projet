{
    "name": "Tableau de Bord Projet",
    "version": "17.0.1.0.0",
    "category": "Project",
    "summary": "Tableau de bord pour le suivi des projets et marges",
    "description": """
        Module de tableau de bord présentant :
        - Le chiffre d'affaires
        - Les projets
        - La marge salariale par projet
        - La marge salariale administrative
        - Le nombre de personnes affectées par projet
    """,
    "author": "Votre Société",
    "depends": [
        "base",
        "project",
        "sale",
        "hr",
        "account",
        "web",
        "hr_timesheet",  # Pour les feuilles de temps
        "sale_timesheet",  # Pour lier ventes et projets
    ],
    "data": [
        "security/ir.model.access.csv",
        "views/dashboard_views.xml",
    ],
    "assets": {
        "web.assets_backend": [
            # Charger jsPDF en premier
            "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
            "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js",
            
            # Chart.js
            "https://cdn.jsdelivr.net/npm/chart.js@3.7.0/dist/chart.min.js",
            
            # Vos fichiers
            "dashboard_projet/static/src/css/dashboard.css",
            "dashboard_projet/static/src/js/dashboard_service.js",
            "dashboard_projet/static/src/js/dashboard_component.js",
            "dashboard_projet/static/src/xml/dashboard.xml",
            "dashboard_projet/static/src/xml/dashboard_chart.xml",
        ],
    },
    "installable": True,
    "application": True,
    "auto_install": False,
}
