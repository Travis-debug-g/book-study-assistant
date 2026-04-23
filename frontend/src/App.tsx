import React, { useState } from 'react';
import { Upload, BookOpen, FileText, MessageSquare, BarChart3, Quote, Loader2, CheckCircle, Send, MessageCircle, Volume2, Play, Pause, RotateCcw } from 'lucide-react';
import axios from 'axios';
import PDFReader from './PDFReader';

interface ChatRequest {
  text: string;
  question: string;
  language: string;
}

interface ChatResponse {
  answer: string;
  question: string;
  metadata: {
    original_length: number;
    processed_length: number;
    question_length: number;
    language: string;
  };
}

interface TTSRequest {
  text: string;
  language: string;
  speed: number;
}

interface TTSResponse {
  audio_url: string;
  text: string;
  metadata: {
    original_length: number;
    processed_length: number;
    language: string;
    speed: number;
    engine: string;
  };
}

interface Message {
  id: string;
  question: string;
  answer: string;
  timestamp: Date;
}

interface FileUploadResponse {
  filename: string;
  file_path: string;
  text: string;  // Ajouter le champ texte
  text_length: number;
  complexity: {
    sentences: number;
    words: number;
    readability_score: number;
    difficulty: string;
  };
  message: string;
}

interface StudyResponse {
  result: string;
  task_type: string;
  metadata: {
    original_length: number;
    processed_length: number;
    task_type: string;
    language: string;
  };
}

const App: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<FileUploadResponse | null>(null);
  const [studyResult, setStudyResult] = useState<StudyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedTask, setSelectedTask] = useState<string>('summary');
  const [error, setError] = useState<string>('');
  
  // États pour le chat
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<string>('');
  const [chatLoading, setChatLoading] = useState<boolean>(false);
  const [showChat, setShowChat] = useState<boolean>(false);
  
  // États pour la lecture audio
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [ttsLoading, setTtsLoading] = useState<boolean>(false);
  const [showAudio, setShowAudio] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('fr');
  const audioRef = React.useRef<HTMLAudioElement>(null);
  
  // État pour le lecteur PDF
  const [showPDFReader, setShowPDFReader] = useState<boolean>(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.type === 'application/pdf' || selectedFile.name.endsWith('.epub')) {
        setFile(selectedFile);
        setError('');
      } else {
        setError('Veuillez sélectionner un fichier PDF ou EPUB');
      }
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setLoading(true);
    setError('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post<FileUploadResponse>('http://localhost:8001/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      setUploadResult(response.data);
      setStudyResult(null);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Erreur lors de l\'upload du fichier');
    } finally {
      setLoading(false);
    }
  };

  const handleStudy = async () => {
    if (!uploadResult) return;

    setLoading(true);
    setError('');

    try {
      const response = await axios.post<StudyResponse>('http://localhost:8001/study', {
        text: uploadResult.text,  // Utiliser le texte extrait du fichier uploadé
        task_type: selectedTask,
        language: 'fr'
      });
      setStudyResult(response.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Erreur lors de l\'analyse du texte');
    } finally {
      setLoading(false);
    }
  };

  const handleChat = async () => {
    if (!uploadResult || !currentQuestion.trim()) return;

    setChatLoading(true);
    setError('');

    try {
      const response = await axios.post<ChatResponse>('http://localhost:8001/chat', {
        text: uploadResult.text,
        question: currentQuestion,
        language: 'fr'
      });

      const newMessage: Message = {
        id: Date.now().toString(),
        question: currentQuestion,
        answer: response.data.answer,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, newMessage]);
      setCurrentQuestion('');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Erreur lors du chat');
    } finally {
      setChatLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChat();
    }
  };

  const handleTTS = async () => {
    if (!uploadResult) return;

    setTtsLoading(true);
    setError('');

    try {
      const response = await axios.post<TTSResponse>('http://localhost:8001/tts', {
        text: uploadResult.text,
        language: selectedLanguage,
        speed: playbackSpeed
      });

      setAudioUrl(response.data.audio_url);
      setShowAudio(true);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Erreur lors de la génération audio');
    } finally {
      setTtsLoading(false);
    }
  };

  const togglePlayPause = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
  };

  const regenerateAudio = () => {
    setIsPlaying(false);
    handleTTS();
  };

  const taskTypes = [
    { id: 'summary', label: 'Résumé', icon: FileText, description: 'Obtenir un résumé structuré' },
    { id: 'questions', label: 'Questions', icon: MessageSquare, description: 'Générer des questions de compréhension' },
    { id: 'analysis', label: 'Analyse', icon: BarChart3, description: 'Analyse approfondie du texte' },
    { id: 'quotes', label: 'Citations', icon: Quote, description: 'Extraire les citations importantes' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-8">
        <header className="text-center mb-12">
          <div className="flex items-center justify-center mb-4">
            <BookOpen className="w-12 h-12 text-indigo-600 mr-3" />
            <h1 className="text-4xl font-bold text-gray-800">Assistant d'Étude de Livres</h1>
          </div>
          <p className="text-gray-600 text-lg">Analysez et comprenez vos livres avec l'intelligence artificielle</p>
        </header>

        <div className="max-w-4xl mx-auto">
          {/* Section Upload */}
          <div className="bg-white rounded-xl shadow-lg p-8 mb-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-6 flex items-center">
              <Upload className="w-6 h-6 mr-2 text-indigo-600" />
              Télécharger un livre
            </h2>
            
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-indigo-400 transition-colors">
              <input
                type="file"
                id="file-upload"
                accept=".pdf,.epub"
                onChange={handleFileChange}
                className="hidden"
              />
              <label htmlFor="file-upload" className="cursor-pointer">
                <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600 mb-2">
                  {file ? file.name : 'Cliquez pour sélectionner un fichier PDF ou EPUB'}
                </p>
                <p className="text-sm text-gray-500">Formats supportés: PDF, EPUB</p>
              </label>
            </div>

            {file && (
              <button
                onClick={handleUpload}
                disabled={loading}
                className="mt-6 w-full bg-indigo-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-indigo-700 transition-colors disabled:bg-gray-400 flex items-center justify-center"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Traitement en cours...
                  </>
                ) : (
                  'Analyser le fichier'
                )}
              </button>
            )}

            {error && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                {error}
              </div>
            )}
          </div>

          {/* Résultats de l'upload */}
          {uploadResult && (
            <div className="bg-white rounded-xl shadow-lg p-8 mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 mb-6 flex items-center">
                <CheckCircle className="w-6 h-6 mr-2 text-green-600" />
                Fichier analysé avec succès
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h3 className="font-semibold text-gray-700 mb-2">Informations</h3>
                  <p className="text-sm text-gray-600">Nom: {uploadResult.filename}</p>
                  <p className="text-sm text-gray-600">Longueur du texte: {uploadResult.text_length} caractères</p>
                </div>
                
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h3 className="font-semibold text-gray-700 mb-2">Complexité</h3>
                  <p className="text-sm text-gray-600">Mots: {uploadResult.complexity.words}</p>
                  <p className="text-sm text-gray-600">Phrases: {uploadResult.complexity.sentences}</p>
                  <p className="text-sm text-gray-600">Difficulté: {uploadResult.complexity.difficulty}</p>
                </div>
              </div>

              {/* Sélection de la tâche */}
              <div className="mb-6">
                <h3 className="font-semibold text-gray-700 mb-4">Que souhaitez-vous faire?</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {taskTypes.map((task) => {
                    const Icon = task.icon;
                    return (
                      <button
                        key={task.id}
                        onClick={() => setSelectedTask(task.id)}
                        className={`p-4 rounded-lg border-2 transition-all ${
                          selectedTask === task.id
                            ? 'border-indigo-500 bg-indigo-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center mb-2">
                          <Icon className="w-5 h-5 mr-2 text-indigo-600" />
                          <span className="font-semibold">{task.label}</span>
                        </div>
                        <p className="text-sm text-gray-600 text-left">{task.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={handleStudy}
                disabled={loading}
                className="w-full bg-green-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-green-700 transition-colors disabled:bg-gray-400 flex items-center justify-center"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Analyse en cours...
                  </>
                ) : (
                  'Lancer l\'analyse'
                )}
              </button>

              {/* Bouton pour afficher le chat */}
              <button
                onClick={() => setShowChat(!showChat)}
                className="w-full bg-purple-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-purple-700 transition-colors flex items-center justify-center mt-4"
              >
                <MessageCircle className="w-5 h-5 mr-2" />
                {showChat ? 'Masquer le chat' : 'Poser des questions sur le document'}
              </button>

              {/* Bouton pour la lecture audio */}
              <button
                onClick={() => setShowAudio(!showAudio)}
                className="w-full bg-green-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-green-700 transition-colors flex items-center justify-center mt-4"
              >
                <Volume2 className="w-5 h-5 mr-2" />
                {showAudio ? 'Masquer la lecture audio' : 'Écouter le document (voix off)'}
              </button>

              {/* Bouton pour le lecteur PDF */}
              {uploadResult && uploadResult.filename.endsWith('.pdf') && (
                <button
                  onClick={() => setShowPDFReader(!showPDFReader)}
                  className="w-full bg-indigo-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-indigo-700 transition-colors flex items-center justify-center mt-4"
                >
                  <BookOpen className="w-5 h-5 mr-2" />
                  {showPDFReader ? 'Masquer le lecteur PDF' : 'Lecteur PDF avec voix off'}
                </button>
              )}
            </div>
          )}

          {/* Interface de Lecture Audio */}
          {showAudio && uploadResult && (
            <div className="bg-white rounded-xl shadow-lg p-8 mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 mb-6 flex items-center">
                <Volume2 className="w-6 h-6 mr-2 text-green-600" />
                Lecture Audio du Document
              </h2>
              
              {/* Sélecteur de langue */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Langue de lecture
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => setSelectedLanguage('fr')}
                    className={`p-3 rounded-lg border-2 transition-all ${
                      selectedLanguage === 'fr'
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:border-gray-300 text-gray-700'
                    }`}
                  >
                    🇫🇷 Français
                  </button>
                  <button
                    onClick={() => setSelectedLanguage('en')}
                    className={`p-3 rounded-lg border-2 transition-all ${
                      selectedLanguage === 'en'
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:border-gray-300 text-gray-700'
                    }`}
                  >
                    🇬🇧 English
                  </button>
                </div>
              </div>
              
              {/* Contrôles de vitesse */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Vitesse de lecture: {playbackSpeed}x
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={playbackSpeed}
                  onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>

              {/* Bouton de génération audio */}
              {!audioUrl && (
                <button
                  onClick={handleTTS}
                  disabled={ttsLoading}
                  className="w-full bg-green-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-green-700 transition-colors disabled:bg-gray-400 flex items-center justify-center mb-4"
                >
                  {ttsLoading ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Génération audio en cours...
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-5 h-5 mr-2" />
                      Générer la lecture audio
                    </>
                  )}
                </button>
              )}

              {/* Lecteur audio */}
              {audioUrl && (
                <div className="bg-gray-50 rounded-lg p-6">
                  {/* Contrôles personnalisés */}
                  <div className="flex items-center justify-center gap-4 mb-4">
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
                      onClick={regenerateAudio}
                      disabled={ttsLoading}
                      className="bg-blue-600 text-white p-3 rounded-full hover:bg-blue-700 transition-colors disabled:bg-gray-400"
                    >
                      <RotateCcw className="w-6 h-6" />
                    </button>
                  </div>
                  
                  <audio
                    ref={audioRef}
                    src={audioUrl}
                    onEnded={handleAudioEnded}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    className="w-full mb-4"
                    controls
                  />
                  
                  <div className="text-center text-sm text-gray-600">
                    <p>📖 Lecture avec voix off {selectedLanguage === 'fr' ? 'française' : 'anglaise'} (100% hors ligne)</p>
                    <p>🎧 Utilisez les contrôles pour naviguer</p>
                    <p>⚡ {selectedLanguage === 'en' ? 'Voix anglaise de haute qualité' : 'Voix française naturelle'}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Lecteur PDF avec voix off */}
          {showPDFReader && uploadResult && uploadResult.filename.endsWith('.pdf') && (
            <PDFReader 
              fileUrl={`http://localhost:8001/pdf/${uploadResult.filename}`}
              filename={uploadResult.filename}
            />
          )}

          {/* Interface de Chat */}
          {showChat && uploadResult && (
            <div className="bg-white rounded-xl shadow-lg p-8 mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 mb-6 flex items-center">
                <MessageCircle className="w-6 h-6 mr-2 text-purple-600" />
                Chat avec votre document
              </h2>
              
              {/* Messages */}
              <div className="bg-gray-50 rounded-lg p-4 h-96 overflow-y-auto mb-4">
                {messages.length === 0 ? (
                  <p className="text-gray-500 text-center">Posez votre première question sur le document !</p>
                ) : (
                  messages.map((message) => (
                    <div key={message.id} className="mb-4">
                      <div className="bg-blue-100 rounded-lg p-3 mb-2">
                        <p className="font-semibold text-blue-800">Vous:</p>
                        <p className="text-blue-700">{message.question}</p>
                      </div>
                      <div className="bg-green-100 rounded-lg p-3">
                        <p className="font-semibold text-green-800">Assistant:</p>
                        <p className="text-green-700 whitespace-pre-wrap">{message.answer}</p>
                      </div>
                    </div>
                  ))
                )}
                {chatLoading && (
                  <div className="bg-gray-100 rounded-lg p-3">
                    <p className="text-gray-600 flex items-center">
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      L'assistant réfléchit...
                    </p>
                  </div>
                )}
              </div>

              {/* Input pour la question */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={currentQuestion}
                  onChange={(e) => setCurrentQuestion(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Posez votre question sur le document..."
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  disabled={chatLoading}
                />
                <button
                  onClick={handleChat}
                  disabled={chatLoading || !currentQuestion.trim()}
                  className="bg-purple-600 text-white p-3 rounded-lg hover:bg-purple-700 transition-colors disabled:bg-gray-400 flex items-center"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}

          {/* Résultats de l'étude */}
          {studyResult && (
            <div className="bg-white rounded-xl shadow-lg p-8">
              <h2 className="text-2xl font-semibold text-gray-800 mb-6">
                Résultats de l'analyse
              </h2>
              
              <div className="prose max-w-none">
                <div className="bg-gray-50 p-6 rounded-lg">
                  <h3 className="font-semibold text-gray-700 mb-4 capitalize">
                    {taskTypes.find(t => t.id === studyResult.task_type)?.label}
                  </h3>
                  <div className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                    {studyResult.result}
                  </div>
                </div>
                
                <div className="mt-4 text-sm text-gray-500">
                  <p>Longueur originale: {studyResult.metadata.original_length} caractères</p>
                  <p>Longueur traitée: {studyResult.metadata.processed_length} caractères</p>
                  <p>Langue: {studyResult.metadata.language}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
