from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List
import os
import aiofiles
import tempfile
from dotenv import load_dotenv
from openai import OpenAI
from PyPDF2 import PdfReader
from ebooklib import epub
from bs4 import BeautifulSoup
import nltk
from textstat import flesch_reading_ease
import re
import requests
import json
import asyncio
from concurrent.futures import ThreadPoolExecutor

# Charger les variables d'environnement
load_dotenv()

# Initialiser FastAPI
app = FastAPI(title="Book Study Assistant API", version="1.0.0")

# Configuration CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Accepter toutes les origines pour le déploiement
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Télécharger les ressources NLTK nécessaires
try:
    nltk.download('punkt', quiet=True)
    nltk.download('stopwords', quiet=True)
except:
    pass

# Modèles Pydantic
class StudyRequest(BaseModel):
    text: str
    task_type: str  # "summary", "questions", "analysis", "quotes"
    language: str = "fr"

class StudyResponse(BaseModel):
    result: str
    task_type: str
    metadata: dict

class ChatRequest(BaseModel):
    text: str
    question: str
    language: str = "fr"

class ChatResponse(BaseModel):
    answer: str
    question: str
    metadata: dict

class TTSRequest(BaseModel):
    text: str
    language: str = "fr"
    speed: float = 1.0

class TTSResponse(BaseModel):
    audio_url: str
    text: str
    metadata: dict

class PDFPageRequest(BaseModel):
    file_path: str
    page_number: int
    language: str = "fr"

class PDFPageResponse(BaseModel):
    page_text: str
    page_number: int
    total_pages: int
    audio_url: Optional[str] = None

class PDFNavigationRequest(BaseModel):
    file_path: str
    start_page: int
    end_page: int
    language: str = "fr"
    speed: float = 1.0

class PDFNavigationResponse(BaseModel):
    audio_urls: List[str]
    pages: List[int]
    metadata: dict

# Configuration OpenAI (optionnel)
client = None
openai_key = os.getenv("OPENAI_API_KEY", "").strip()
if openai_key and openai_key != "":
    client = OpenAI(api_key=openai_key)

# Configuration Ollama
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "mistral")

# Configuration TTS
TTS_ENGINE = os.getenv("TTS_ENGINE", "gtts")  # gtts (gratuit) ou openai (payant)
AUDIO_DIR = "audio_files"
os.makedirs(AUDIO_DIR, exist_ok=True)

def get_available_voices():
    """Obtenir la liste des voix disponibles avec détails"""
    try:
        import pyttsx3
        engine = pyttsx3.init()
        voices = engine.getProperty('voices')
        
        voice_list = []
        for voice in voices:
            voice_info = {
                "id": voice.id,
                "name": voice.name,
                "languages": getattr(voice, 'languages', []),
                "gender": getattr(voice, 'gender', None),
                "age": getattr(voice, 'age', None)
            }
            voice_list.append(voice_info)
        
        return voice_list
    except Exception as e:
        print(f"Erreur lors de la détection des voix: {str(e)}")
        return []

def setup_best_voice(engine, language: str = "en"):
    """Configurer la meilleure voix disponible pour une langue donnée"""
    voices = engine.getProperty('voices')
    
    if language == "fr":
        # Priorités pour les voix françaises
        french_priorities = [
            'french', 'france', 'français', 'fr', 
            'virginie', 'hortense', 'zoe'
        ]
    else:  # english
        # Priorités pour les voix anglaises (Windows high-quality voices)
        english_priorities = [
            'zira', 'david', 'hazel', 'susan', 'mark', 
            'english', 'en-us', 'en-gb', 'en', 'us'
        ]
    
    priorities = french_priorities if language == "fr" else english_priorities
    
    # Chercher la meilleure voix selon les priorités
    for priority in priorities:
        for voice in voices:
            if (priority.lower() in voice.name.lower() or 
                priority.lower() in voice.id.lower()):
                return voice.id
    
    # Si aucune voix spécifique trouvée, retourner la première
    return voices[0].id if voices else None

# Fonctions utilitaires
def extract_text_from_pdf(file_path: str) -> str:
    """Extraire le texte d'un fichier PDF"""
    try:
        with open(file_path, 'rb') as file:
            reader = PdfReader(file)
            text = ""
            for page in reader.pages:
                text += page.extract_text()
        return text
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors de l'extraction PDF: {str(e)}")

def extract_text_from_epub(file_path: str) -> str:
    """Extraire le texte d'un fichier EPUB"""
    try:
        book = epub.read_epub(file_path)
        text = ""
        for item in book.get_items():
            if item.get_type() == epub.ITEM_DOCUMENT:
                soup = BeautifulSoup(item.get_content(), 'html.parser')
                text += soup.get_text()
        return text
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors de l'extraction EPUB: {str(e)}")

def analyze_text_complexity(text: str) -> dict:
    """Analyser la complexité du texte"""
    try:
        sentences = len(nltk.sent_tokenize(text))
        words = len(nltk.word_tokenize(text))
        readability = flesch_reading_ease(text)
        
        return {
            "sentences": sentences,
            "words": words,
            "readability_score": readability,
            "difficulty": "Facile" if readability > 60 else "Moyen" if readability > 30 else "Difficile"
        }
    except:
        return {"error": "Impossible d'analyser la complexité du texte"}

async def process_with_ollama(text: str, task_type: str, language: str = "fr") -> str:
    """Traiter le texte avec Ollama (gratuit)"""
    
    prompts = {
        "summary": f"Tu es un expert en analyse littéraire francophone. Fais un résumé structuré et pertinent du texte suivant en français. Sois concis mais précis. Inclus les idées principales, les thèmes clés et une conclusion percutante. Réponds UNIQUEMENT en français.",
        "questions": f"Tu es un enseignant francophone expert en analyse de texte. Génère 10 questions variées et pertinentes sur ce texte en français : questions de compréhension, d'analyse critique, de réflexion personnelle et d'interprétation. Les questions doivent stimuler la pensée critique. Réponds UNIQUEMENT en français.",
        "analysis": f"Tu es un critique littéraire francophone. Fais une analyse approfondie et nuancée de ce texte en français. Identifie les thèmes principaux, le style d'écriture, les techniques littéraires utilisées, les personnages s'il y en a, le contexte et la portée de l'œuvre. Sois précis et analytique. Réponds UNIQUEMENT en français.",
        "quotes": f"Tu es un expert en littérature francophone. Extrais 5 citations marquantes de ce texte et explique leur signification, leur impact et leur importance dans l'œuvre. Les analyses doivent être profondes et éclairantes. Réponds UNIQUEMENT en français."
    }
    
    prompt = prompts.get(task_type, prompts["summary"])
    
    try:
        response = requests.post(
            f"{OLLAMA_BASE_URL}/api/generate",
            json={
                "model": OLLAMA_MODEL,
                "prompt": f"{prompt}\n\nTexte à analyser:\n{text[:4000]}",  # Optimisé pour Mistral
                "stream": False,
                "options": {
                    "temperature": 0.3,  # Plus cohérent
                    "num_predict": 800,  # Bon équilibre vitesse/qualité
                    "top_p": 0.9,
                    "repeat_penalty": 1.1
                }
            }
        )
        
        if response.status_code == 200:
            result = response.json()
            return result.get("response", "Réponse non disponible")
        else:
            raise Exception(f"Erreur Ollama: {response.status_code}")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors du traitement Ollama: {str(e)}")

async def chat_with_ollama(text: str, question: str, language: str = "fr") -> str:
    """Chat avec Ollama pour poser des questions sur le texte"""
    
    try:
        response = requests.post(
            f"{OLLAMA_BASE_URL}/api/generate",
            json={
                "model": OLLAMA_MODEL,
                "prompt": f"Tu es un assistant expert en analyse de texte. Base-toi UNIQUEMENT sur le texte suivant pour répondre à la question. Sois précis et complet dans ta réponse. Si la réponse n'est pas dans le texte, dis-le clairement. Réponds en français.\n\nTexte:\n{text[:4000]}\n\nQuestion: {question}\n\nRéponse:",
                "stream": False,
                "options": {
                    "temperature": 0.2,  # Plus factuel et cohérent
                    "num_predict": 600,  # Réponses détaillées mais rapides
                    "top_p": 0.9,
                    "repeat_penalty": 1.1
                }
            }
        )
        
        if response.status_code == 200:
            result = response.json()
            return result.get("response", "Je ne peux pas répondre à cette question basée sur le texte fourni.")
        else:
            raise Exception(f"Erreur Ollama: {response.status_code}")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors du chat Ollama: {str(e)}")

async def chat_with_llm(text: str, question: str, language: str = "fr") -> str:
    """Chat avec un modèle de langage (OpenAI ou Ollama)"""
    
    # Utiliser Ollama par défaut (gratuit)
    if not client:
        return await chat_with_ollama(text, question, language)
    
    # Utiliser OpenAI si configuré
    try:
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": f"Tu es un assistant expert en analyse de texte. Base-toi UNIQUEMENT sur le texte fourni pour répondre. Si l'information n'est pas dans le texte, dis-le clairement. Réponds en {language}."},
                {"role": "user", "content": f"Texte: {text[:4000]}\n\nQuestion: {question}"}
            ],
            max_tokens=600,
            temperature=0.3
        )
        
        return response.choices[0].message.content
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors du chat LLM: {str(e)}")

async def process_with_llm(text: str, task_type: str, language: str = "fr") -> str:
    """Traiter le texte avec un modèle de langage (OpenAI ou Ollama)"""
    
    # Utiliser Ollama par défaut (gratuit)
    if not client:
        return await process_with_ollama(text, task_type, language)
    
    # Utiliser OpenAI si configuré
    prompts = {
        "summary": f"Analyse ce texte et fournis un résumé structuré en {language}. Inclus les points clés, les idées principales et une conclusion brève.",
        "questions": f"Génère 10 questions pertinentes sur ce texte en {language}. Inclus des questions de compréhension, d'analyse et de réflexion.",
        "analysis": f"Fais une analyse approfondie de ce texte en {language}. Inclus les thèmes principaux, le style d'écriture, les personnages s'il y en a, et le contexte.",
        "quotes": f"Extrais 5 citations importantes de ce texte et explique leur signification en {language}."
    }
    
    prompt = prompts.get(task_type, prompts["summary"])
    
    try:
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",  # Le modèle le moins cher
            messages=[
                {"role": "system", "content": f"Tu es un assistant expert en analyse littéraire. Réponds en {language} de manière claire et structurée."},
                {"role": "user", "content": f"{prompt}\n\nTexte à analyser:\n{text[:2000]}"}  # Réduit à 2000 caractères pour économiser
            ],
            max_tokens=500,  # Réduit pour économiser
            temperature=0.7
        )
        
        return response.choices[0].message.content
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors du traitement LLM: {str(e)}")

async def optimize_text_for_tts_with_ollama(text: str, language: str = "fr") -> str:
    """Optimiser le texte pour la synthèse vocale avec Ollama"""
    
    print(f"Début optimisation texte pour TTS: {text[:50]}...")
    
    try:
        if language == "en":
            prompt = f"""You are an expert in text-to-speech optimization. Improve this text to make it more natural and fluent for speech synthesis:
        
Original text: {text[:3000]}
        
Instructions:
- Add natural punctuation at appropriate places
- Break long sentences into shorter, more manageable ones
- Add logical pauses with periods or commas
- Expand abbreviations if necessary (e.g., "Dr." to "Doctor", "St." to "Saint")
- Keep the same meaning but make it more readable for speech
- Handle numbers properly (write them as words when appropriate)
- Respond ONLY with the optimized text, without any comments

Optimized text:"""
        else:
            prompt = f"""Tu es un expert en synthèse vocale. Améliore ce texte pour le rendre plus naturel et fluide à l'oral:
        
Texte original: {text[:3000]}
        
Instructions:
- Ajoute des ponctuations naturelles aux endroits appropriés
- Sépare les longues phrases en phrases plus courtes
- Ajoute des pauses logiques avec des points ou des virgules
- Corrige les abréviations si nécessaire
- Garde le même sens mais rend-le plus lisible
- Réponds UNIQUEMENT avec le texte optimisé, sans aucun commentaire

Texte optimisé:"""

        print(f"Envoi à Ollama avec modèle: {OLLAMA_MODEL}")
        
        response = requests.post(
            f"{OLLAMA_BASE_URL}/api/generate",
            json={
                "model": OLLAMA_MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": 0.3,
                    "num_predict": 2000,
                    "top_p": 0.9,
                    "repeat_penalty": 1.1
                }
            }
        )
        
        print(f"Réponse Ollama status: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            optimized_text = result.get("response", "").strip()
            print(f"Texte optimisé: {optimized_text[:100]}...")
            return optimized_text if optimized_text else text
        else:
            print(f"Erreur Ollama: {response.status_code} - {response.text}")
            return text
            
    except Exception as e:
        print(f"Erreur optimisation TTS avec Ollama: {str(e)}")
        return text

async def generate_tts_ollama_enhanced(text: str, language: str = "fr", speed: float = 1.0) -> str:
    """Générer de l'audio avec optimisation Ollama + pyttsx3"""
    try:
        # D'abord optimiser le texte avec Ollama
        optimized_text = await optimize_text_for_tts_with_ollama(text, language)
        
        # Puis générer l'audio avec pyttsx3 mais avec un nom de fichier différent
        try:
            import pyttsx3
            import hashlib
            
            # Créer un hash du texte optimisé pour le cache
            text_hash = hashlib.md5(f"ollama_{optimized_text}_{language}_{speed}".encode()).hexdigest()
            filename = f"tts_ollama_enhanced_{text_hash}.mp3"
            filepath = os.path.join(AUDIO_DIR, filename)
            
            # Vérifier si le fichier existe déjà dans le cache
            if os.path.exists(filepath):
                return f"http://localhost:8001/audio/{filename}"
            
            # Limiter la longueur du texte
            max_length = 5000
            text_to_speak = optimized_text[:max_length]
            
            # Initialiser le moteur TTS
            engine = pyttsx3.init()
            
            # Configurer la voix avec notre nouvelle fonction
            best_voice_id = setup_best_voice(engine, language)
            if best_voice_id:
                engine.setProperty('voice', best_voice_id)
            
            # Configurer la vitesse
            rate = engine.getProperty('rate')
            engine.setProperty('rate', int(rate * speed))
            
            # Sauvegarder dans un fichier
            engine.save_to_file(text_to_speak, filepath)
            engine.runAndWait()
            
            return f"http://localhost:8001/audio/{filename}"
            
        except ImportError:
            raise HTTPException(status_code=500, detail="pyttsx3 n'est pas installé. Installez-le avec: pip install pyttsx3")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Erreur TTS pyttsx3: {str(e)}")
        
    except Exception as e:
        # En cas d'erreur, utiliser la méthode standard
        print(f"Erreur dans TTS Ollama enhanced, fallback sur pyttsx3: {str(e)}")
        return await generate_tts_pyttsx3(text, language, speed)

async def generate_tts_pyttsx3(text: str, language: str = "fr", speed: float = 1.0) -> str:
    """Générer de l'audio avec pyttsx3 (local, gratuit, sans limite)"""
    try:
        import pyttsx3
        import hashlib
        
        # Créer un hash du texte pour le cache
        text_hash = hashlib.md5(f"{text}_{language}_{speed}".encode()).hexdigest()
        filename = f"tts_pyttsx3_{text_hash}.mp3"
        filepath = os.path.join(AUDIO_DIR, filename)
        
        # Vérifier si le fichier existe déjà dans le cache
        if os.path.exists(filepath):
            return f"http://localhost:8001/audio/{filename}"
        
        # Limiter la longueur du texte
        max_length = 5000
        text_to_speak = text[:max_length]
        
        # Initialiser le moteur TTS
        engine = pyttsx3.init()
        
        # Configurer la voix avec notre nouvelle fonction
        best_voice_id = setup_best_voice(engine, language)
        if best_voice_id:
            engine.setProperty('voice', best_voice_id)
        
        # Configurer la vitesse
        rate = engine.getProperty('rate')
        engine.setProperty('rate', int(rate * speed))
        
        # Sauvegarder dans un fichier
        engine.save_to_file(text_to_speak, filepath)
        engine.runAndWait()
        
        return f"http://localhost:8001/audio/{filename}"
        
    except ImportError:
        raise HTTPException(status_code=500, detail="pyttsx3 n'est pas installé. Installez-le avec: pip install pyttsx3")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur TTS pyttsx3: {str(e)}")

async def generate_tts_gtts(text: str, language: str = "fr", speed: float = 1.0) -> str:
    """Générer de l'audio avec Google Text-to-Speech (gratuit) avec cache"""
    try:
        import gtts
        import io
        import base64
        import hashlib
        
        # Créer un hash du texte pour le cache
        text_hash = hashlib.md5(f"{text}_{language}_{speed}".encode()).hexdigest()
        filename = f"tts_{text_hash}.mp3"
        filepath = os.path.join(AUDIO_DIR, filename)
        
        # Vérifier si le fichier existe déjà dans le cache
        if os.path.exists(filepath):
            return f"http://localhost:8001/audio/{filename}"
        
        # Lire le texte tel quel, sans ajouter de pauses artificielles
        text_to_speak = text
        
        # Limiter la longueur du texte pour éviter les timeouts
        max_length = 5000
        text_to_speak = text_to_speak[:max_length]
        
        # Ajouter un délai pour éviter la limite de taux
        import time
        time.sleep(1)
        
        # Créer l'audio avec vitesse normale (slow=False pour lecture continue)
        tts = gtts.gTTS(text=text_to_speak, lang=language, slow=False)
        
        # Utiliser ThreadPoolExecutor pour éviter le blocage
        loop = asyncio.get_event_loop()
        with ThreadPoolExecutor() as pool:
            await loop.run_in_executor(pool, tts.save, filepath)
        
        return f"http://localhost:8001/audio/{filename}"
        
    except ImportError:
        raise HTTPException(status_code=500, detail="gTTS n'est pas installé. Installez-le avec: pip install gtts")
    except Exception as e:
        if "429" in str(e):
            raise HTTPException(status_code=429, detail="Trop de requêtes TTS. Veuillez patienter quelques secondes avant de réessayer.")
        raise HTTPException(status_code=500, detail=f"Erreur TTS gTTS: {str(e)}")

async def generate_tts_openai(text: str, language: str = "fr", speed: float = 1.0) -> str:
    """Générer de l'audio avec OpenAI TTS (payant)"""
    try:
        # Mapper la langue vers la voix OpenAI
        voice_mapping = {
            "fr": "nova",  # Voix française
            "en": "alloy",  # Voix anglaise
            "es": "nova",  # Voix espagnole (utilise nova)
            "de": "alloy",  # Voix allemande
        }
        
        voice = voice_mapping.get(language, "nova")
        
        # Limiter la longueur
        max_length = 4000
        text_to_speak = text[:max_length]
        
        response = client.audio.speech.create(
            model="tts-1",
            voice=voice,
            input=text_to_speak,
            speed=speed
        )
        
        # Sauvegarder l'audio
        filename = f"tts_openai_{hash(text_to_speak)}.mp3"
        filepath = os.path.join(AUDIO_DIR, filename)
        
        loop = asyncio.get_event_loop()
        with ThreadPoolExecutor() as pool:
            await loop.run_in_executor(pool, response.stream_to_file, filepath)
        
        return f"http://localhost:8000/audio/{filename}"
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur TTS OpenAI: {str(e)}")

async def generate_tts(text: str, language: str = "fr", speed: float = 1.0) -> str:
    """Générer de l'audio avec le moteur TTS configuré"""
    
    print(f"TTS_ENGINE configuré: {TTS_ENGINE}")
    
    if TTS_ENGINE == "openai" and client:
        print("Utilisation OpenAI TTS")
        return await generate_tts_openai(text, language, speed)
    elif TTS_ENGINE == "gtts":
        print("Utilisation gTTS")
        return await generate_tts_gtts(text, language, speed)
    elif TTS_ENGINE == "ollama_enhanced":
        print("Utilisation Ollama Enhanced TTS")
        return await generate_tts_ollama_enhanced(text, language, speed)
    else:
        print("Utilisation pyttsx3 par défaut")
        return await generate_tts_pyttsx3(text, language, speed)
def extract_pdf_page_text(file_path: str, page_number: int) -> tuple[str, int]:
    """Extraire le texte d'une page spécifique d'un PDF"""
    try:
        with open(file_path, 'rb') as file:
            reader = PdfReader(file)
            total_pages = len(reader.pages)
            
            if page_number < 1 or page_number > total_pages:
                raise HTTPException(status_code=400, detail="Numéro de page invalide")
            
            page = reader.pages[page_number - 1]  # Les pages sont 0-indexées
            page_text = page.extract_text()
            
            return page_text, total_pages
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors de l'extraction de la page: {str(e)}")

@app.post("/pdf/page", response_model=PDFPageResponse)
async def get_pdf_page(request: PDFPageRequest):
    """Obtenir le texte d'une page spécifique du PDF"""
    
    page_text, total_pages = extract_pdf_page_text(request.file_path, request.page_number)
    
    return PDFPageResponse(
        page_text=page_text,
        page_number=request.page_number,
        total_pages=total_pages
    )

@app.post("/pdf/page/audio", response_model=PDFPageResponse)
async def get_pdf_page_with_audio(request: PDFPageRequest):
    """Obtenir le texte et l'audio d'une page spécifique du PDF"""
    
    page_text, total_pages = extract_pdf_page_text(request.file_path, request.page_number)
    
    # Générer l'audio pour cette page
    try:
        audio_url = await generate_tts(page_text, request.language, 1.0)
    except Exception as e:
        audio_url = None
    
    return PDFPageResponse(
        page_text=page_text,
        page_number=request.page_number,
        total_pages=total_pages,
        audio_url=audio_url
    )

@app.post("/pdf/navigation", response_model=PDFNavigationResponse)
async def generate_pdf_navigation_audio(request: PDFNavigationRequest):
    """Générer l'audio pour une plage de pages"""
    
    audio_urls = []
    pages = []
    
    for page_num in range(request.start_page, min(request.end_page + 1, 100)):  # Limiter à 100 pages
        try:
            page_text, total_pages = extract_pdf_page_text(request.file_path, page_num)
            audio_url = await generate_tts(page_text, request.language, request.speed)
            
            audio_urls.append(audio_url)
            pages.append(page_num)
            
        except Exception as e:
            print(f"Erreur page {page_num}: {str(e)}")
            continue
    
    metadata = {
        "total_pages": len(pages),
        "language": request.language,
        "speed": request.speed,
        "engine": TTS_ENGINE
    }
    
    return PDFNavigationResponse(
        audio_urls=audio_urls,
        pages=pages,
        metadata=metadata
    )
@app.post("/tts", response_model=TTSResponse)
async def text_to_speech(request: TTSRequest):
    """Convertir du texte en audio (voix off)"""
    
    # Limiter la longueur du texte
    max_length = 5000
    text_to_speak = request.text[:max_length]
    
    if len(request.text) > max_length:
        text_to_speak += "\n\n[Texte tronqué pour la synthèse vocale]"
    
    try:
        audio_url = await generate_tts(text_to_speak, request.language, request.speed)
        
        metadata = {
            "original_length": len(request.text),
            "processed_length": len(text_to_speak),
            "language": request.language,
            "speed": request.speed,
            "engine": TTS_ENGINE
        }
        
        return TTSResponse(
            audio_url=audio_url,
            text=text_to_speak,
            metadata=metadata
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors de la synthèse vocale: {str(e)}")

@app.get("/pdf/{filename}")
async def get_pdf_file(filename: str):
    """Servir les fichiers PDF uploadés"""
    from fastapi.responses import FileResponse
    
    file_path = os.path.join("uploads", filename)
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Fichier PDF non trouvé")
    
    return FileResponse(file_path, media_type="application/pdf")
@app.get("/audio/{filename}")
async def get_audio_file(filename: str):
    """Servir les fichiers audio générés"""
    from fastapi.responses import FileResponse
    
    file_path = os.path.join(AUDIO_DIR, filename)
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Fichier audio non trouvé")
    
    return FileResponse(file_path, media_type="audio/mpeg")
@app.post("/chat", response_model=ChatResponse)
async def chat_with_document(request: ChatRequest):
    """Poser une question sur le texte du document"""
    
    # Limiter la longueur du texte
    max_length = 8000
    text_to_process = request.text[:max_length]
    
    if len(request.text) > max_length:
        text_to_process += "\n\n[Texte tronqué pour le traitement]"
    
    try:
        answer = await chat_with_llm(text_to_process, request.question, request.language)
        
        metadata = {
            "original_length": len(request.text),
            "processed_length": len(text_to_process),
            "question_length": len(request.question),
            "language": request.language
        }
        
        return ChatResponse(
            answer=answer,
            question=request.question,
            metadata=metadata
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors du chat: {str(e)}")

# Routes API
@app.get("/")
async def root():
    return {"message": "Book Study Assistant API", "version": "1.0.0"}

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """Uploader un fichier livre (PDF ou EPUB)"""
    
    print(f"Tentative d'upload: {file.filename}")
    
    # Vérifier le type de fichier
    if not file.filename.lower().endswith(('.pdf', '.epub')):
        print(f"Type de fichier non accepté: {file.filename}")
        raise HTTPException(status_code=400, detail="Seuls les fichiers PDF et EPUB sont acceptés")
    
    # Créer un répertoire d'upload s'il n'existe pas
    upload_dir = "uploads"
    os.makedirs(upload_dir, exist_ok=True)
    
    # Sauvegarder le fichier
    file_path = os.path.join(upload_dir, file.filename)
    
    try:
        print(f"Sauvegarde du fichier vers: {file_path}")
        async with aiofiles.open(file_path, 'wb') as f:
            content = await file.read()
            await f.write(content)
        
        print(f"Fichier sauvegardé, taille: {len(content)} bytes")
        
        # Extraire le texte
        if file.filename.lower().endswith('.pdf'):
            print("Extraction texte depuis PDF")
            text = extract_text_from_pdf(file_path)
        else:
            print("Extraction texte depuis EPUB")
            text = extract_text_from_epub(file_path)
        
        print(f"Texte extrait, longueur: {len(text)}")
        
        # Analyser la complexité
        complexity = analyze_text_complexity(text)
        
        result = {
            "filename": file.filename,
            "file_path": file_path,
            "text": text,  # Ajouter le texte extrait pour l'analyse
            "text_length": len(text),
            "complexity": complexity,
            "message": "Fichier uploadé et traité avec succès"
        }
        
        print(f"Upload réussi: {file.filename}")
        return result
        
    except Exception as e:
        print(f"Erreur lors de l'upload: {str(e)}")
        # Nettoyer le fichier en cas d'erreur
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=500, detail=f"Erreur lors du traitement du fichier: {str(e)}")

@app.post("/study", response_model=StudyResponse)
async def study_text(request: StudyRequest):
    """Analyser un texte selon le type de tâche demandé"""
    
    # Limiter la longueur du texte pour éviter les timeouts
    max_length = 8000
    text_to_process = request.text[:max_length]
    
    if len(request.text) > max_length:
        text_to_process += "\n\n[Texte tronqué pour le traitement]"
    
    try:
        result = await process_with_llm(text_to_process, request.task_type, request.language)
        
        metadata = {
            "original_length": len(request.text),
            "processed_length": len(text_to_process),
            "task_type": request.task_type,
            "language": request.language
        }
        
        return StudyResponse(
            result=result,
            task_type=request.task_type,
            metadata=metadata
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors de l'analyse: {str(e)}")

@app.get("/voices")
async def list_available_voices():
    """Lister toutes les voix TTS disponibles"""
    voices = get_available_voices()
    return {
        "voices": voices,
        "total_count": len(voices),
        "engine": "pyttsx3 (local)"
    }

@app.post("/tts/test")
async def test_tts_voice(language: str = "en", text: str = None):
    """Tester la synthèse vocale avec la meilleure voix disponible"""
    if not text:
        if language == "en":
            text = "Hello, this is a test of the English text-to-speech system. The voice quality should be clear and natural."
        else:
            text = "Bonjour, ceci est un test du système de synthèse vocale français. La qualité de la voix doit être claire et naturelle."
    
    try:
        audio_url = await generate_tts_pyttsx3(text, language, 1.0)
        
        # Obtenir les informations sur la voix utilisée
        voices = get_available_voices()
        current_engine = pyttsx3.init()
        current_voice_id = current_engine.getProperty('voice')
        current_voice_info = next((v for v in voices if v["id"] == current_voice_id), None)
        
        return {
            "audio_url": audio_url,
            "text": text,
            "language": language,
            "current_voice": current_voice_info,
            "available_voices": voices
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors du test TTS: {str(e)}")

@app.get("/health")
async def health_check():
    """Vérifier l'état de l'API"""
    return {"status": "healthy", "api_key_configured": bool(os.getenv("OPENAI_API_KEY"))}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
