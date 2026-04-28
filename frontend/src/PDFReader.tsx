import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Play, Pause, Volume2, VolumeX, RotateCcw, Loader2, BookOpen } from 'lucide-react';
import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';

interface PDFReaderProps {
  fileUrl: string;
  filename: string;
}

interface PageData {
  page_text: string;
  page_number: number;
  total_pages: number;
  audio_url?: string;
}

const PDFReader: React.FC<PDFReaderProps> = ({ fileUrl, filename }) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageText, setPageText] = useState<string>('');
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [ttsLoading, setTtsLoading] = useState<boolean>(false);
  const [showAudio, setShowAudio] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(0.8); // Vitesse plus lente pour naturel
  const [targetPage, setTargetPage] = useState<string>('');
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [showPDF, setShowPDF] = useState(true);
  const [textFullscreen, setTextFullscreen] = useState(false);
  const [preloadedAudio, setPreloadedAudio] = useState<{ [key: number]: string }>({});
  const [isPreloading, setIsPreloading] = useState<{ [key: number]: boolean }>({});
  const [currentWordIndex, setCurrentWordIndex] = useState<number>(-1);
  const [words, setWords] = useState<string[]>([]);
  const [highlightEnabled, setHighlightEnabled] = useState<boolean>(true);
  const [highlightSpeed, setHighlightSpeed] = useState<number>(1.05);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('fr');
  const [audioError, setAudioError] = useState<string>('');
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const pdfRef = useRef<HTMLIFrameElement>(null);

  // Diviser le texte en mots pour le surlignage
  const splitTextIntoWords = (text: string) => {
    return text.split(/\s+/).filter(word => word && word.length > 0);
  };

  // Simulation de surlignage synchronisé (basé sur le temps)
  const startWordHighlighting = () => {
    if (!audioRef.current || words.length === 0) return;
    
    const audio = audioRef.current;
    let highlightInterval: NodeJS.Timeout;
    let lastHighlightedIndex = -1;
    
    // Attendre que l'audio soit prêt
    const waitForAudio = () => {
      if (audio.readyState >= 2) { // HAVE_CURRENT_DATA
        const duration = audio.duration;
        if (!duration || duration === 0) {
          setTimeout(waitForAudio, 100);
          return;
        }
        
        // Calcul plus rapide : synchronisation parfaite avec la voix
        const wordsPerSecond = (words.length / duration) * highlightSpeed; // Utiliser la vitesse de surlignage personnalisée
        
        highlightInterval = setInterval(() => {
          if (!audio.paused && !audio.ended && audio.currentTime > 0) {
            const currentTime = audio.currentTime;
            // Utiliser le temps réel, pas la vitesse de lecture
            const wordIndex = Math.floor(currentTime * wordsPerSecond);
            
            // Ne mettre à jour que si le mot a changé et est dans les limites
            if (wordIndex >= 0 && wordIndex < words.length && wordIndex !== lastHighlightedIndex) {
              setCurrentWordIndex(wordIndex);
              lastHighlightedIndex = wordIndex;
            }
          } else if (audio.ended || audio.paused) {
            // Ne réinitialiser que si vraiment terminé ou en pause
            setCurrentWordIndex(-1);
            lastHighlightedIndex = -1;
            if (highlightInterval) clearInterval(highlightInterval);
          }
        }, 150); // 150ms pour plus de réactivité
      } else {
        setTimeout(waitForAudio, 100);
      }
    };
    
    waitForAudio();
  };
  const preloadNextPagesAudio = async (startPage: number, count: number = 2) => {
    for (let i = 1; i <= count; i++) {
      const nextPage = startPage + i;
      if (nextPage <= totalPages && !preloadedAudio[nextPage] && !isPreloading[nextPage]) {
        setIsPreloading(prev => ({ ...prev, [nextPage]: true }));
        
        try {
          const response = await axios.post<PageData>(`${API_BASE_URL}/pdf/page/audio`, {
            file_path: `uploads/${filename}`,
            page_number: nextPage
          });
          
          if (response.data.audio_url) {
            setPreloadedAudio(prev => ({ ...prev, [nextPage]: response.data.audio_url! }));
          }
        } catch (error) {
          console.error(`Erreur préchargement page ${nextPage}:`, error);
        } finally {
          setIsPreloading(prev => ({ ...prev, [nextPage]: false }));
        }
      }
    }
  };

  // Charger une page spécifique
  const loadPage = async (pageNumber: number) => {
    setIsLoading(true);
    try {
      const response = await axios.post<PageData>(`${API_BASE_URL}/pdf/page`, {
        file_path: `uploads/${filename}`,
        page_number: pageNumber
      });
      
      setPageText(response.data.page_text);
      setTotalPages(response.data.total_pages);
      setCurrentPage(pageNumber);
      
      // Préparer les mots pour le surlignage
      const pageWords = splitTextIntoWords(response.data.page_text);
      setWords(pageWords);
      setCurrentWordIndex(-1); // Réinitialiser le surlignage
      
      // Utiliser l'audio préchargé si disponible
      if (preloadedAudio[pageNumber]) {
        setAudioUrl(preloadedAudio[pageNumber]);
      } else {
        setAudioUrl(response.data.audio_url || '');
      }
      
      // Précharger les pages suivantes en arrière-plan
      preloadNextPagesAudio(pageNumber);
      
    } catch (error) {
      console.error('Erreur lors du chargement de la page:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Générer l'audio pour la page actuelle
  const generatePageAudio = async () => {
    setIsGeneratingAudio(true);
    try {
      const response = await axios.post<PageData>(`${API_BASE_URL}/pdf/page/audio`, {
        file_path: `uploads/${filename}`,
        page_number: currentPage,
        language: selectedLanguage
      });
      
      setAudioUrl(response.data.audio_url || '');
      
    } catch (error) {
      console.error('Erreur lors de la génération audio:', error);
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  // Navigation
  const goToPreviousPage = () => {
    if (currentPage > 1) {
      loadPage(currentPage - 1);
    }
  };

  const goToNextPage = () => {
    if (currentPage < totalPages) {
      loadPage(currentPage + 1);
    }
  };

  const goToSpecificPage = () => {
    const pageNumber = parseInt(targetPage);
    if (pageNumber >= 1 && pageNumber <= totalPages) {
      loadPage(pageNumber);
      setTargetPage(''); // Vider le champ après navigation
    }
  };

  // Contrôles audio
  const togglePlayPause = async () => {
    if (!audioRef.current || !audioUrl) return;

    try {
      setAudioError('');
      if (isPlaying) {
        audioRef.current.pause();
        setCurrentWordIndex(-1); // Arrêter le surlignage
      } else {
        // Forcer la vitesse avant de jouer
        audioRef.current.playbackRate = playbackSpeed;
        await audioRef.current.play();
        // Démarrer le surlignage avec un délai plus long
        if (highlightEnabled) {
          setTimeout(() => startWordHighlighting(), 1000);
        }
      }
      setIsPlaying(!isPlaying);
    } catch (error) {
      console.error('Erreur lors de la lecture/pause:', error);
      console.error('Audio URL:', audioUrl);
      setAudioError('Impossible de lire l\'audio. Le fichier est peut-être invalide ou vide.');
      // Forcer l'état à false en cas d'erreur
      setIsPlaying(false);
      setCurrentWordIndex(-1);
    }
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    
    audioRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  // Rendu du texte avec surlignage
  const renderHighlightedText = () => {
    if (!pageText) return null;
    
    const paragraphs = pageText.split('\n\n');
    let globalWordCounter = 0;
    
    return paragraphs.map((paragraph, paraIndex) => {
      const paragraphWords = paragraph.split(/\s+/).filter(word => word.length > 0);
      
      return (
        <p key={paraIndex} className="text-justify indent-8 first-line:indent-0 leading-relaxed">
          {paragraphWords.map((word, wordIndex) => {
            const currentGlobalIndex = globalWordCounter;
            globalWordCounter++;
            
            const isHighlighted = currentGlobalIndex === currentWordIndex;
            
            return (
              <span 
                key={`${paraIndex}-${wordIndex}`} 
                className={`transition-all duration-200 ${
                  isHighlighted && highlightEnabled 
                    ? 'bg-yellow-300 text-gray-900 rounded px-2 py-1 font-bold shadow-md' 
                    : ''
                }`}
              >
                {word}{wordIndex < paragraphWords.length - 1 ? ' ' : ''}
              </span>
            );
          })}
        </p>
      );
    });
  };

  const regenerateAudio = () => {
    setIsPlaying(false);
    generatePageAudio();
  };

  // Effet pour forcer la vitesse quand l'URL audio change
  useEffect(() => {
    if (audioRef.current && audioUrl) {
      console.log('Audio URL changed:', audioUrl);
      audioRef.current.load();

      // Petit délai pour s'assurer que l'audio est chargé
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.playbackRate = playbackSpeed;
        }
      }, 100);
    }
  }, [audioUrl, playbackSpeed]);

  // Effet pour réinitialiser le surlignage quand on change de page
  useEffect(() => {
    setCurrentWordIndex(-1);
  }, [currentPage]);

  // Effets principaux
  useEffect(() => {
    if (filename) {
      loadPage(1);
    }
  }, [filename]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentWordIndex(-1);
      // Passer à la page suivante automatiquement
      if (currentPage < totalPages) {
        setTimeout(() => {
          goToNextPage();
        }, 2000); // Augmenté à 2 secondes pour laisser le temps
      }
    };

    const handlePlay = () => {
      setIsPlaying(true);
      // Forcer la vitesse correcte au démarrage
      if (audio) {
        audio.playbackRate = playbackSpeed;
      }
    };
    
    const handlePause = () => {
      setIsPlaying(false);
      setCurrentWordIndex(-1);
    };

    const handleError = (e: Event) => {
      console.error('Erreur audio:', e);
      setIsPlaying(false);
      setCurrentWordIndex(-1);
    };

    // Appliquer la vitesse de lecture immédiatement
    if (audio) {
      audio.playbackRate = playbackSpeed;
    }

    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('error', handleError);
    };
  }, [currentPage, totalPages, playbackSpeed]);

  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold text-gray-800 flex items-center">
          <BookOpen className="w-6 h-6 mr-2 text-blue-600" />
          Lecteur PDF avec Voix Off
        </h2>
        
        <button
          onClick={() => setShowPDF(!showPDF)}
          className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
        >
          {showPDF ? 'Masquer le PDF' : 'Afficher le PDF'}
        </button>
      </div>

      {/* Contrôles de navigation */}
      <div className="flex items-center justify-between mb-6 bg-gray-50 rounded-lg p-4">
        <div className="flex items-center gap-4">
          <button
            onClick={goToPreviousPage}
            disabled={currentPage === 1 || isLoading}
            className="bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          
          <span className="text-lg font-medium">
            Page {currentPage} / {totalPages}
          </span>
          
          <button
            onClick={goToNextPage}
            disabled={currentPage === totalPages || isLoading}
            className="bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-4">
          {/* Navigation directe */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Aller à:</label>
            <input
              type="number"
              min="1"
              max={totalPages}
              value={targetPage}
              onChange={(e) => setTargetPage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && goToSpecificPage()}
              placeholder="N° page"
              className="w-20 px-2 py-1 border rounded text-center"
            />
            <button
              onClick={goToSpecificPage}
              disabled={!targetPage || parseInt(targetPage) < 1 || parseInt(targetPage) > totalPages}
              className="bg-indigo-600 text-white px-3 py-1 rounded hover:bg-indigo-700 transition-colors disabled:bg-gray-400 text-sm"
            >
              Go
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Vitesse:</label>
            <select
              value={playbackSpeed}
              onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
              className="px-3 py-1 border rounded-lg"
            >
              <option value={0.4}>0.4x (très lent)</option>
              <option value={0.5}>0.5x (lent)</option>
              <option value={0.6}>0.6x</option>
              <option value={0.75}>0.75x</option>
              <option value={0.8}>0.8x (naturel)</option>
              <option value={1.0}>1.0x</option>
              <option value={1.25}>1.25x</option>
              <option value={1.5}>1.5x</option>
              <option value={1.75}>1.75x</option>
              <option value={2.0}>2.0x (rapide)</option>
              <option value={2.5}>2.5x (très rapide)</option>
              <option value={3.0}>3.0x (ultra rapide)</option>
            </select>
          </div>

          {/* Slider de vitesse horizontal */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Slider:</label>
            <input
              type="range"
              min="0.4"
              max="3.0"
              step="0.1"
              value={playbackSpeed}
              onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
              className="w-32 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-sm font-medium w-12">{playbackSpeed.toFixed(1)}x</span>
          </div>

          {/* Slider de vitesse de surlignage */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Surlignage:</label>
            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.05"
              value={highlightSpeed}
              onChange={(e) => setHighlightSpeed(parseFloat(e.target.value))}
              className="w-32 h-2 bg-yellow-200 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-sm font-medium w-12">{highlightSpeed.toFixed(2)}x</span>
          </div>
        </div>
      </div>

      {/* Contenu principal */}
      <div className={`${textFullscreen ? 'grid-cols-1' : 'grid grid-cols-1 lg:grid-cols-2'} gap-6`}>
        {/* PDF */}
        {showPDF && !textFullscreen && (
          <div className="bg-gray-100 rounded-lg p-4">
            <h3 className="text-lg font-semibold mb-3">Document PDF</h3>
            {isLoading ? (
              <div className="flex items-center justify-center h-96">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              </div>
            ) : (
              <iframe
                ref={pdfRef}
                src={fileUrl}
                className="w-full h-80 rounded-lg border"
                title={`Page ${currentPage}`}
              />
            )}
          </div>
        )}

        {/* Texte et contrôles audio */}
        <div className={`${textFullscreen ? 'col-span-1' : ''} bg-gray-50 rounded-lg p-4`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold">Texte de la page</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTextFullscreen(!textFullscreen)}
                className="bg-indigo-600 text-white px-3 py-1 rounded text-sm hover:bg-indigo-700 transition-colors"
              >
                {textFullscreen ? 'Réduire' : 'Agrandir'}
              </button>
              <button
                onClick={() => setHighlightEnabled(!highlightEnabled)}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  highlightEnabled 
                    ? 'bg-yellow-500 text-gray-900 hover:bg-yellow-600' 
                    : 'bg-gray-400 text-white hover:bg-gray-500'
                }`}
              >
                {highlightEnabled ? '🎯 Surlignage ON' : '⚪ Surlignage OFF'}
              </button>
            </div>
          </div>
          
          {/* Sélecteur de langue */}
          <div className="bg-white rounded-lg p-4 mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Langue de lecture
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setSelectedLanguage('fr')}
                className={`p-2 rounded-lg border-2 transition-all text-sm ${
                  selectedLanguage === 'fr'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
                }`}
              >
                🇫🇷 Français
              </button>
              <button
                onClick={() => setSelectedLanguage('en')}
                className={`p-2 rounded-lg border-2 transition-all text-sm ${
                  selectedLanguage === 'en'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
                }`}
              >
                🇬🇧 English
              </button>
            </div>
          </div>
          
          {/* Bouton de génération audio - DÉPLACÉ ICI */}
          {!audioUrl && (
            <button
              onClick={generatePageAudio}
              disabled={isGeneratingAudio || !pageText}
              className="w-full bg-green-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-green-700 transition-colors disabled:bg-gray-400 flex items-center justify-center mb-4"
            >
              {isGeneratingAudio ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Génération audio en cours...
                </>
              ) : (
                <>
                  <Volume2 className="w-5 h-5 mr-2" />
                  Générer la lecture de cette page
                </>
              )}
            </button>
          )}
          
          {/* Contrôles audio - DÉPLACÉS EN HAUT */}
          {audioUrl && (
            <div className="bg-white rounded-lg p-4 mb-4">
              {audioError && (
                <div className="mb-3 rounded bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
                  {audioError}
                </div>
              )}
              <div className="flex items-center justify-center gap-3 mb-3">
                <button
                  onClick={togglePlayPause}
                  className="bg-green-600 text-white p-3 rounded-full hover:bg-green-700 transition-colors"
                >
                  {isPlaying ? (
                    <Pause className="w-6 h-6" />
                  ) : (
                    <Play className="w-6 h-6" />
                  )}
                </button>
                
                <button
                  onClick={toggleMute}
                  className="bg-gray-600 text-white p-3 rounded-full hover:bg-gray-700 transition-colors"
                >
                  {isMuted ? (
                    <VolumeX className="w-6 h-6" />
                  ) : (
                    <Volume2 className="w-6 h-6" />
                  )}
                </button>
                
                <button
                  onClick={regenerateAudio}
                  disabled={isGeneratingAudio}
                  className="bg-blue-600 text-white p-3 rounded-full hover:bg-blue-700 transition-colors disabled:bg-gray-400"
                >
                  <RotateCcw className="w-6 h-6" />
                </button>
              </div>
              
              <audio
                ref={audioRef}
                src={audioUrl}
                className="w-full"
                preload="metadata"
                onLoadedData={() => {
                  // Forcer la vitesse quand l'audio est chargé
                  if (audioRef.current) {
                    audioRef.current.playbackRate = playbackSpeed;
                  }
                }}
              />
            </div>
          )}
          
          {/* Texte de la page - AGRANDI avec surlignage */}
          <div className={`bg-white rounded-lg p-6 ${textFullscreen ? 'h-screen max-h-screen' : 'h-96'} overflow-y-auto mb-4`}>
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              </div>
            ) : (
              <div className={`text-gray-700 leading-loose space-y-4 ${textFullscreen ? 'text-xl' : 'text-lg'}`}>
                {renderHighlightedText()}
              </div>
            )}
          </div>

          {/* Contrôles audio - VIDÉ CAR DÉPLACÉS EN HAUT */}
          <div className="space-y-4">
            {audioUrl && (
              <div className="bg-white rounded-lg p-4">
                <div className="mt-3 text-center text-sm text-gray-600">
                  <p>🎵 Lecture page {currentPage}</p>
                  <p>🔄 Passage automatique à la page suivante</p>
                  <p>⚡ Préchargement des pages suivantes en arrière-plan</p>
                  <p>🎤 Lecture continue sans pauses artificielles</p>
                  <p>🎯 Surlignage: {highlightEnabled ? 'ACTIVÉ' : 'DÉSACTIVÉ'}</p>
                  <p className="text-xs text-gray-500 mt-1">Mot actuel: {currentWordIndex >= 0 ? `${currentWordIndex + 1}/${words.length}` : 'Aucun'}</p>
                  <p className="text-xs text-blue-500 mt-1">⚡ Vitesse: {playbackSpeed}x</p>
                  <p className="text-xs text-green-600 mt-1">🚀 Surlignage personnalisé ({highlightSpeed.toFixed(2)}x)</p>
                  {Object.keys(isPreloading).filter(page => isPreloading[parseInt(page)]).length > 0 && (
                    <p className="text-blue-600">📥 Préchargement des pages suivantes...</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Instructions */}
      <div className="mt-6 bg-blue-50 rounded-lg p-4">
        <h4 className="font-semibold text-blue-800 mb-2">Instructions:</h4>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>• Naviguez entre les pages avec les flèches</li>
          <li>• Allez directement à une page avec "Aller à: N° page + Go"</li>
          <li>• L'audio se génère automatiquement pour chaque page</li>
          <li>• Les 2 pages suivantes sont préchargées en arrière-plan</li>
          <li>• La lecture passe automatiquement à la page suivante</li>
          <li>• 🎤 Lecture continue sans pauses artificielles aux points</li>
          <li>• 🎯 Surlignage automatique des mots pendant la lecture</li>
          <li>• Ajustez la vitesse audio avec le slider (0.4x à 3x)</li>
          <li>• Ajustez la vitesse du surlignage avec le slider jaune (0.5x à 1.5x)</li>
          <li>• Masquez/affichez le PDF pour plus d'espace</li>
        </ul>
      </div>
    </div>
  );
};

export default PDFReader;
