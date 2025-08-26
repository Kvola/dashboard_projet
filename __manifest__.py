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
        #"views/assets.xml",
        #"views/menu.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "dashboard_projet/static/src/css/dashboard.css",
            "dashboard_projet/static/src/js/dashboard_service.js",
            "dashboard_projet/static/src/js/dashboard_component.js",
            "dashboard_projet/static/src/xml/dashboard.xml",
            # Inclure Chart.js depuis CDN ou local
            'https://cdn.jsdelivr.net/npm/chart.js@3.7.0/dist/chart.min.js',
        ],
    },
    "installable": True,
    "application": True,
    "auto_install": False,
}
