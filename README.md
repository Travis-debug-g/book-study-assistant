# Assistant d'Étude de Livres

Une application web d'intelligence artificielle pour vous aider à étudier et analyser des livres.

## Fonctionnalités

- **Upload de fichiers** : Supporte les formats PDF et EPUB
- **Analyse intelligente** : Utilise l'IA pour analyser le contenu des livres
- **Plusieurs types d'analyse** :
  - Résumé structuré
  - Questions de compréhension
  - Analyse approfondie
  - Extraction de citations importantes
- **Interface moderne** : Construite avec React et TailwindCSS
- **Analyse de complexité** : Évalue la difficulté de lecture

## Architecture

### Backend (FastAPI)
- API RESTful avec FastAPI
- Intégration OpenAI GPT pour l'analyse de texte
- Extraction de texte depuis PDF (PyPDF2) et EPUB (ebooklib)
- Analyse de complexité textuelle (NLTK, textstat)

### Frontend (React + TypeScript)
- Interface utilisateur moderne avec React et TypeScript
- Styling avec TailwindCSS
- Icônes avec Lucide React
- Communication avec l'API via Axios

## Installation

### Prérequis
- Python 3.8+
- Node.js 16+
- Clé API OpenAI

### Configuration du Backend

1. Clonez le repository et naviguez dans le dossier :
```bash
cd book-study-assistant
```

2. Créez un environnement virtuel :
```bash
python -m venv venv
venv\Scripts\activate  # Windows
```

3. Installez les dépendances :
```bash
pip install -r requirements.txt
```

4. Configurez les variables d'environnement :
```bash
cp .env.example .env
# Éditez .env et ajoutez votre clé API OpenAI
```

5. Démarrez le serveur backend :
```bash
python main.py
```

Le backend sera disponible sur `http://localhost:8000`

### Configuration du Frontend

1. Naviguez dans le dossier frontend :
```bash
cd frontend
```

2. Installez les dépendances :
```bash
npm install
```

3. Démarrez le serveur de développement :
```bash
npm start
```

Le frontend sera disponible sur `http://localhost:3000`

## Utilisation

1. Ouvrez l'application dans votre navigateur
2. Uploadez un fichier PDF ou EPUB
3. Choisissez le type d'analyse souhaité
4. Lancez l'analyse et consultez les résultats

## Endpoints API

### POST /upload
Upload un fichier livre et extrait le texte

**Paramètres :**
- `file` : Fichier PDF ou EPUB

**Réponse :**
```json
{
  "filename": "livre.pdf",
  "file_path": "uploads/livre.pdf",
  "text_length": 15000,
  "complexity": {
    "sentences": 120,
    "words": 2500,
    "readability_score": 65.2,
    "difficulty": "Facile"
  },
  "message": "Fichier uploadé et traité avec succès"
}
```

### POST /study
Analyse un texte selon le type de tâche

**Corps de la requête :**
```json
{
  "text": "Texte à analyser...",
  "task_type": "summary",
  "language": "fr"
}
```

**Types de tâches :**
- `summary` : Résumé structuré
- `questions` : Questions de compréhension
- `analysis` : Analyse approfondie
- `quotes` : Extraction de citations

### GET /health
Vérifie l'état de l'API

## Technologies Utilisées

### Backend
- **FastAPI** : Framework web moderne pour Python
- **OpenAI API** : Traitement du langage naturel
- **PyPDF2** : Extraction de texte depuis PDF
- **ebooklib** : Traitement de fichiers EPUB
- **NLTK** : Traitement du langage naturel
- **textstat** : Analyse de lisibilité

### Frontend
- **React** : Bibliothèque JavaScript pour l'interface utilisateur
- **TypeScript** : Superset typé de JavaScript
- **TailwindCSS** : Framework CSS utilitaire
- **Lucide React** : Bibliothèque d'icônes
- **Axios** : Client HTTP

## Développement

### Structure du projet
```
book-study-assistant/
├── main.py              # Application FastAPI principale
├── requirements.txt     # Dépendances Python
├── .env.example        # Exemple de configuration
├── uploads/            # Fichiers uploadés
├── frontend/           # Application React
│   ├── src/
│   │   ├── App.tsx    # Composant principal
│   │   ├── index.tsx  # Point d'entrée
│   │   └── index.css  # Styles globaux
│   ├── package.json   # Dépendances Node.js
│   └── tailwind.config.js
└── README.md
```

### Contribuer
1. Fork le projet
2. Créez une branche pour votre fonctionnalité
3. Committez vos changements
4. Pushez vers votre branche
5. Créez une Pull Request

## Licence

Ce projet est sous licence MIT.
