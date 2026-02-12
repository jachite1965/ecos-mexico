
import React, { useState, useEffect, useRef } from 'react';
import { 
  HistoryIcon, UsersIcon, SparklesIcon, 
  SunIcon, MoonIcon, ArrowLeftIcon,
  MessageSquareIcon, SendIcon, MusicIcon, Volume2Icon, Loader2Icon,
  TrophyIcon, PaletteIcon, ZapIcon, AlertTriangleIcon, KeyIcon, Trash2Icon, HomeIcon
} from 'lucide-react';
import { 
  researchLocationAndLanguage, 
  generateDialogueAudio, 
  chatWithFigure, 
  generateSpeech,
  generateCharacterPortrait 
} from './services/geminiService';
import { HistoricalScenario, FamousFigure, ChatMessage, EraCategory } from './types';
import { InputForm } from './components/InputForm';
import { ScenarioDisplay } from './components/ScenarioDisplay';

const FIGURES: FamousFigure[] = [
  { id: 'p1', name: 'Moctezuma II', title: 'Huey Tlatoani', period: '1502–1520', era: 'prehispanic', avatarUrl: '', gender: 'male', voice: 'zephyr', bio: 'Gobernante mexica.', fullDescription: 'Gobernó Tenochtitlan durante la llegada de los españoles.' },
  { id: 'p2', name: 'Nezahualcóyotl', title: 'El Rey Poeta', period: '1402–1472', era: 'prehispanic', avatarUrl: '', gender: 'male', voice: 'charon', bio: 'Rey de Texcoco.', fullDescription: 'Arquitecto, poeta y guerrero sabio del mundo antiguo.' },
  { id: 'p3', name: 'Cuauhtémoc', title: 'Águila que Descendió', period: '1520–1521', era: 'prehispanic', avatarUrl: '', gender: 'male', voice: 'fenrir', bio: 'Último tlatoani.', fullDescription: 'Lideró la resistencia final contra la conquista española.' },
  { id: 'v1', name: 'Sor Juana Inés', title: 'La Décima Musa', period: '1648–1695', era: 'colonial', avatarUrl: '', gender: 'female', voice: 'kore', bio: 'Poetisa erudita.', fullDescription: 'Máxima exponente de las letras hispánicas en la Nueva España.' },
  { id: 'i1', name: 'Miguel Hidalgo', title: 'Padre de la Patria', period: '1753–1811', era: 'independent', avatarUrl: '', gender: 'male', voice: 'charon', bio: 'Iniciador de la lucha.', fullDescription: 'Sacerdote que dio el Grito de Dolores contra el dominio español.' },
  { id: 'a1', name: 'Frida Kahlo', title: 'Icono del Arte', period: '1907–1954', era: 'arts', avatarUrl: '', gender: 'female', voice: 'puck', bio: 'Pintora surrealista.', fullDescription: 'Exploró la identidad, el dolor y la mexicanidad en sus autorretratos.' },
  { id: 'd1', name: 'Hugo Sánchez', title: 'El Niño de Oro', period: '1958–Presente', era: 'sports', avatarUrl: '', gender: 'male', voice: 'zephyr', bio: 'Goleador histórico.', fullDescription: 'Considerado el mejor futbolista mexicano de todos los tiempos.' },
  { id: 'm1', name: 'Pedro Infante', title: 'Ídolo de Guamúchil', period: '1917–1957', era: 'music', avatarUrl: '', gender: 'male', voice: 'zephyr', bio: 'Rey de la canción ranchera.', fullDescription: 'El máximo icono de la época de oro del cine y la música mexicana.' },
];

const CATEGORIES: { id: EraCategory, label: string, icon: any }[] = [
  { id: 'prehispanic', label: 'Prehispánico', icon: SparklesIcon },
  { id: 'colonial', label: 'Virreinal', icon: HistoryIcon },
  { id: 'independent', label: 'Independencia', icon: UsersIcon },
  { id: 'music', label: 'Música', icon: MusicIcon },
  { id: 'arts', label: 'Arte', icon: PaletteIcon },
  { id: 'sports', label: 'Deportes', icon: TrophyIcon },
];

export default function App() {
  const [tab, setTab] = useState<'home' | 'people'>('home');
  const [darkMode, setDarkMode] = useState(false);
  const [loading, setLoading] = useState<'idle' | 'busy' | 'media' | 'portraits'>('idle');
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [isPro, setIsPro] = useState(false);
  
  const [scenario, setScenario] = useState<HistoricalScenario | null>(null);
  const [audio, setAudio] = useState<AudioBuffer | null>(null);
  
  const [selectedEra, setSelectedEra] = useState<EraCategory | null>(null);
  const [selectedFigure, setSelectedFigure] = useState<FamousFigure | null>(null);
  const [isChatting, setIsChatting] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [messageCount, setMessageCount] = useState(0);
  const [currentInput, setCurrentInput] = useState('');
  const [useProModel, setUseProModel] = useState(false);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Added filteredFigures calculation to fix reference error
  const filteredFigures = selectedEra ? FIGURES.filter(f => f.era === selectedEra) : [];

  useEffect(() => {
    checkApiKeyStatus();
  }, []);

  const resetAllStates = () => {
    setScenario(null);
    setAudio(null);
    setSelectedFigure(null);
    setIsChatting(false);
    setChatHistory([]);
    setMessageCount(0);
    setCurrentInput('');
    setLoading('idle');
    if (sourceRef.current) sourceRef.current.stop();
  };

  const checkApiKeyStatus = async () => {
    try {
      // @ts-ignore
      const hasKey = await window.aistudio.hasSelectedApiKey();
      setIsPro(hasKey);
    } catch (e) {
      console.debug("Entorno sin gestión de llaves externa");
    }
  };

  const handleOpenKeySelection = async () => {
    try {
      // @ts-ignore
      await window.aistudio.openSelectKey();
      setIsPro(true);
      setQuotaExceeded(false);
    } catch (e) {
      console.error("No se pudo abrir el selector de llaves");
    }
  };

  const playVoice = (buffer: AudioBuffer) => {
    if (sourceRef.current) sourceRef.current.stop();
    if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current.destination);
    source.start();
    sourceRef.current = source;
  };

  const handleEraSelection = async (era: EraCategory) => {
    resetAllStates();
    setSelectedEra(era);
    const eraFigures = FIGURES.filter(f => f.era === era);
    const needsPortraits = eraFigures.filter(f => !f.avatarUrl);
    
    if (needsPortraits.length > 0) {
      setLoading('portraits');
      try {
        await Promise.all(needsPortraits.map(async (figure) => {
          const url = await generateCharacterPortrait(figure.name, figure.fullDescription, figure.gender);
          figure.avatarUrl = url;
        }));
      } catch (e: any) {
        if (e.message?.includes('quota')) setQuotaExceeded(true);
      } finally {
        setLoading('idle');
      }
    }
  };

  const handleSendMessage = async () => {
    if (!currentInput || messageCount >= 5 || !selectedFigure) return;
    const userMsg: ChatMessage = { role: 'user', text: currentInput };
    setChatHistory(prev => [...prev, userMsg]);
    const input = currentInput;
    setCurrentInput('');
    setMessageCount(prev => prev + 1);
    
    setLoading('busy');
    try {
      const textResponse = await chatWithFigure(selectedFigure.name, input, selectedFigure.gender, useProModel);
      const audioBuffer = await generateSpeech(textResponse, selectedFigure.voice);
      setChatHistory(prev => [...prev, { role: 'model', text: textResponse, audio: audioBuffer }]);
      playVoice(audioBuffer);
    } catch (e: any) {
      if (e.message === 'quota_exceeded') setQuotaExceeded(true);
      else setChatHistory(prev => [...prev, { role: 'model', text: "Mi voz se desvanece..." }]);
    } finally {
      setLoading('idle');
    }
  };

  return (
    <div className={`${darkMode ? 'dark' : ''} min-h-screen bg-[#fcfaf7] dark:bg-[#060a13] text-stone-900 dark:text-stone-100 transition-colors duration-500 flex flex-col`}>
      <header className="border-b border-stone-200 dark:border-white/5 py-5 px-8 flex justify-between items-center glass sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={() => { resetAllStates(); setTab('home'); setSelectedEra(null); }} className="bg-red-700 text-white font-serif font-black px-3 py-1.5 rounded shadow-lg transform hover:scale-105 transition-all uppercase tracking-tighter">ET&T</button>
          <h1 className="font-serif text-lg font-black uppercase tracking-tighter hidden md:block">Ecos de México</h1>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={handleOpenKeySelection} className={`flex items-center gap-2 px-4 py-2 rounded-full text-[10px] font-black uppercase transition-all shadow-sm ${isPro ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-stone-100 text-stone-400 border border-stone-200 hover:text-stone-600'}`}>
            <ZapIcon size={14} fill={isPro ? "currentColor" : "none"} /> {isPro ? "PRO" : "GRATIS"}
          </button>
          <button onClick={() => setDarkMode(!darkMode)} className="p-2.5 rounded-full border border-stone-200 dark:border-white/10 hover:bg-stone-100 dark:hover:bg-white/5 transition-all text-stone-500">
            {darkMode ? <SunIcon size={20} /> : <MoonIcon size={20} />}
          </button>
        </div>
      </header>

      {quotaExceeded && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-stone-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-[3rem] p-12 shadow-2xl border border-red-200 text-center space-y-8 animate-in zoom-in-95">
            <div className="w-24 h-24 bg-red-100 text-red-700 rounded-full flex items-center justify-center mx-auto shadow-inner"><AlertTriangleIcon size={48} /></div>
            <div className="space-y-3">
              <h3 className="font-serif text-3xl font-black text-red-900 dark:text-red-50 uppercase tracking-tighter">Frecuencia Saturada</h3>
              <p className="text-sm text-stone-600 dark:text-stone-400 leading-relaxed font-medium">La frecuencia gratuita ha alcanzado su límite. Espera un momento o conecta tu llave PRO para continuar.</p>
            </div>
            <button onClick={handleOpenKeySelection} className="w-full py-5 bg-amber-600 text-white rounded-[2rem] font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:scale-[1.02] transition-all">CONECTAR LLAVE PRO</button>
            <button onClick={() => setQuotaExceeded(false)} className="text-[11px] font-black text-stone-400 uppercase tracking-[0.2em] hover:text-red-700">Cerrar</button>
          </div>
        </div>
      )}

      <main className="flex-1 pb-32">
        {scenario ? (
          <div className="animate-in slide-in-from-bottom-6 duration-500 max-w-5xl mx-auto py-10 px-4">
            <button onClick={resetAllStates} className="flex items-center gap-2 mb-10 text-xs font-black uppercase text-red-700 hover:opacity-70 transition-opacity"><ArrowLeftIcon size={16}/> Volver al Menú</button>
            <ScenarioDisplay scenario={scenario} audioBuffer={audio} />
          </div>
        ) : selectedFigure ? (
          <div className="animate-in slide-in-from-bottom-10 duration-500 space-y-10 max-w-5xl mx-auto py-10 px-4">
            <div className="flex justify-between items-center">
              <button onClick={() => { setSelectedFigure(null); setIsChatting(false); }} className="flex items-center gap-2 text-xs font-black uppercase text-red-700 hover:opacity-70"><ArrowLeftIcon size={16}/> Volver a la Galería</button>
              {isChatting && (
                <div className="flex gap-3">
                  <button onClick={() => setChatHistory([])} className="p-2.5 text-stone-400 hover:text-red-700 transition-all rounded-full hover:bg-red-50" title="Limpiar Chat"><Trash2Icon size={20} /></button>
                  <button onClick={resetAllStates} className="flex items-center gap-2 text-[10px] font-black uppercase bg-stone-100 dark:bg-white/5 px-6 py-2.5 rounded-full hover:bg-stone-200 transition-all shadow-sm"><HomeIcon size={16}/> Menú</button>
                </div>
              )}
            </div>
            
            <div className="relative h-[45vh] md:h-[55vh] rounded-[4rem] overflow-hidden shadow-2xl border-4 border-white dark:border-stone-800">
              <img src={selectedFigure.avatarUrl} className="w-full h-full object-cover animate-in fade-in duration-1000" />
              <div className="absolute inset-0 bg-gradient-to-t from-stone-900 via-stone-900/40 to-transparent"></div>
              <div className="absolute bottom-12 left-12 right-12">
                <h2 className="text-6xl md:text-8xl font-serif font-black text-white uppercase tracking-tighter leading-none">{selectedFigure.name}</h2>
                <div className="flex flex-wrap gap-5 mt-4 items-center">
                  <span className="bg-amber-600 text-white font-black uppercase tracking-[0.2em] text-[10px] px-4 py-1.5 rounded-full shadow-lg">{selectedFigure.title}</span>
                  <span className="text-stone-300 font-bold uppercase tracking-[0.2em] text-[10px]">{selectedFigure.period}</span>
                </div>
              </div>
            </div>

            {!isChatting ? (
              <div className="max-w-2xl mx-auto text-center space-y-10 py-10">
                <div className="flex justify-center gap-6">
                  <button onClick={() => setUseProModel(false)} className={`px-10 py-4 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] border-2 transition-all ${!useProModel ? 'bg-white text-stone-900 border-red-700 shadow-2xl scale-105' : 'border-stone-200 opacity-40'}`}>Flash</button>
                  <button onClick={() => setUseProModel(true)} className={`px-10 py-4 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] border-2 transition-all ${useProModel ? 'bg-white text-stone-900 border-amber-600 shadow-2xl scale-105' : 'border-stone-200 opacity-40'}`}>Pro</button>
                </div>
                <p className="text-2xl text-stone-700 dark:text-stone-300 leading-relaxed font-serif italic font-medium px-4">"{selectedFigure.fullDescription}"</p>
                <button onClick={() => setIsChatting(true)} className="w-full py-6 bg-red-700 text-white rounded-[2.5rem] font-black text-xl uppercase tracking-[0.3em] shadow-2xl hover:scale-[1.02] active:scale-95 transition-all">Iniciar Diálogo</button>
              </div>
            ) : (
              <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in duration-500">
                <div className="flex justify-between items-center bg-white dark:bg-white/5 p-6 rounded-[3rem] shadow-xl border border-stone-100 dark:border-white/10">
                   <div className="flex items-center gap-5">
                      <div className="w-16 h-16 rounded-3xl overflow-hidden border-2 border-red-700/20 shadow-lg"><img src={selectedFigure.avatarUrl} className="w-full h-full object-cover" /></div>
                      <div className="flex flex-col gap-1">
                        <span className="font-black text-sm uppercase tracking-tight">{selectedFigure.name}</span>
                        <span className={`text-[9px] font-black uppercase px-3 py-1 rounded-full ${selectedFigure.gender === 'male' ? 'bg-blue-50 text-blue-700' : 'bg-pink-50 text-pink-700'}`}>{selectedFigure.gender === 'male' ? 'HOMBRE' : 'MUJER'}</span>
                      </div>
                   </div>
                   <div className="text-right"><span className="text-[10px] font-black text-red-700 bg-red-700/10 px-6 py-2.5 rounded-full">{5 - messageCount} Mensajes</span></div>
                </div>
                
                <div className="h-[50vh] overflow-y-auto space-y-8 pr-4 custom-scroll scroll-smooth">
                  {chatHistory.length === 0 && (
                    <div className="text-center py-20 opacity-30 italic font-black uppercase tracking-[0.4em] text-[11px]">Invoca su voz con una pregunta...</div>
                  )}
                  {chatHistory.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-4 duration-300`}>
                      <div className={`group relative max-w-[85%] p-7 rounded-[2.5rem] shadow-xl ${m.role === 'user' ? 'bg-red-700 text-white rounded-tr-none' : 'bg-white dark:bg-white/10 border border-stone-100 dark:border-white/5 rounded-tl-none'}`}>
                        <p className="text-base md:text-lg font-medium leading-relaxed">{m.text}</p>
                        {m.audio && (
                          <button onClick={() => playVoice(m.audio!)} className={`mt-5 flex items-center gap-3 text-[10px] font-black uppercase px-4 py-2 rounded-xl transition-all shadow-md ${m.role === 'user' ? 'bg-white/20 hover:bg-white/30' : 'bg-red-700 text-white hover:bg-red-800'}`}><Volume2Icon size={16} /> Escuchar</button>
                        )}
                      </div>
                    </div>
                  ))}
                  {loading === 'busy' && (
                    <div className="flex justify-start">
                      <div className="bg-white dark:bg-white/5 p-6 rounded-[2rem] shadow-lg animate-pulse flex gap-2">
                        <div className="w-2 h-2 bg-red-700 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-red-700 rounded-full animate-bounce delay-100"></div>
                        <div className="w-2 h-2 bg-red-700 rounded-full animate-bounce delay-200"></div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-4 pt-6 items-end">
                   <textarea rows={1} value={currentInput} onChange={e => setCurrentInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage())} disabled={messageCount >= 5 || loading === 'busy'} placeholder="Escribe tu pregunta..." className="flex-1 bg-white dark:bg-white/5 border border-stone-200 dark:border-white/10 rounded-[2.5rem] py-6 px-10 text-base outline-none focus:ring-2 focus:ring-red-700 transition-all resize-none shadow-2xl" />
                   <button onClick={handleSendMessage} disabled={!currentInput || messageCount >= 5 || loading === 'busy'} className="w-20 h-20 bg-red-700 text-white rounded-full flex items-center justify-center shadow-2xl active:scale-90 transition-all disabled:opacity-30 flex-shrink-0 shadow-red-900/30"><SendIcon size={28} /></button>
                </div>
              </div>
            )}
          </div>
        ) : (
          tab === 'home' ? (
            <div className="flex flex-col items-center gap-12 py-12 animate-in fade-in">
              <div className="text-center space-y-4 max-w-2xl px-4">
                <span className="text-red-700 font-black text-[10px] uppercase tracking-[0.4em] mb-2 block">Archivo General de la Nación Digital</span>
                <h2 className="text-5xl md:text-7xl font-serif font-black text-stone-900 dark:text-white leading-tight uppercase tracking-tighter">Ecos de México</h2>
                <p className="text-stone-500 dark:text-stone-400 font-medium text-sm italic tracking-wide">Revive la historia a través de las voces de quienes la forjaron.</p>
              </div>
              <div className="w-full max-w-xl">
                <InputForm onSubmit={async (loc, lang) => {
                  resetAllStates();
                  setLoading('busy');
                  try {
                    const s = await researchLocationAndLanguage(loc, lang);
                    setScenario(s);
                    setLoading('media');
                    const a = await generateDialogueAudio(s);
                    setAudio(a);
                  } catch (e: any) {
                    if (e.message === 'quota_exceeded') setQuotaExceeded(true);
                    else alert("Frecuencia no encontrada.");
                  } finally { setLoading('idle'); }
                }} isLoading={loading !== 'idle'} />
              </div>
            </div>
          ) : (
            <div className="space-y-10 py-6 animate-in fade-in max-w-5xl mx-auto px-4">
              <div className="flex justify-between items-center">
                <h2 className="text-4xl font-serif font-black uppercase">{selectedEra ? CATEGORIES.find(c => c.id === selectedEra)?.label : "Personajes"}</h2>
                <div className="bg-amber-600 text-white px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider shadow-lg">HISTORIA VIVA</div>
              </div>
              {!selectedEra ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                  {CATEGORIES.map((cat) => (
                    <div key={cat.id} onClick={() => handleEraSelection(cat.id)} className="historical-card p-10 cursor-pointer group hover:border-red-700 hover:shadow-2xl transition-all text-center flex flex-col items-center gap-6">
                      <div className="w-20 h-20 bg-red-700/10 rounded-3xl flex items-center justify-center text-red-700 group-hover:scale-110 group-hover:bg-red-700 group-hover:text-white transition-all shadow-sm"><cat.icon size={36} /></div>
                      <span className="text-[12px] font-black uppercase tracking-[0.2em]">{cat.label}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-12">
                   <button onClick={() => setSelectedEra(null)} className="flex items-center gap-2 text-xs font-black uppercase text-red-700"><ArrowLeftIcon size={16}/> Volver</button>
                   <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                      {filteredFigures.map(f => (
                        <button key={f.id} onClick={() => { resetAllStates(); setSelectedFigure(f); }} className="flex flex-col items-center gap-4 group">
                          <div className="w-32 h-32 md:w-44 md:h-44 rounded-full overflow-hidden border-4 border-white dark:border-stone-800 group-hover:border-red-700 transition-all shadow-2xl bg-stone-200">
                            {f.avatarUrl ? <img src={f.avatarUrl} alt={f.name} className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500" /> : <div className="w-full h-full flex items-center justify-center text-stone-400"><UsersIcon size={40} /></div>}
                          </div>
                          <div className="text-center space-y-1">
                            <span className="text-[13px] font-black uppercase block leading-tight">{f.name}</span>
                            <span className="text-[9px] font-bold text-stone-500 uppercase tracking-tighter opacity-60">{f.title}</span>
                          </div>
                        </button>
                      ))}
                   </div>
                </div>
              )}
            </div>
          )
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 glass border-t border-stone-200 dark:border-white/5 px-10 py-5 flex justify-between items-center z-50 shadow-lg">
        <button onClick={() => { resetAllStates(); setTab('home'); setSelectedEra(null); }} className={`flex flex-col items-center gap-1.5 transition-all ${tab === 'home' ? 'text-red-700 scale-110 font-black' : 'text-stone-400 opacity-60'}`}>
          <HistoryIcon size={26} /> <span className="text-[10px] font-black uppercase tracking-widest">Ecos</span>
        </button>
        <button onClick={() => { resetAllStates(); setTab('people'); setSelectedEra(null); }} className={`flex flex-col items-center gap-1.5 transition-all ${tab === 'people' ? 'text-red-700 scale-110 font-black' : 'text-stone-400 opacity-60'}`}>
          <UsersIcon size={26} /> <span className="text-[10px] font-black uppercase tracking-widest">Figuras</span>
        </button>
        <div onClick={resetAllStates} className="w-16 h-16 bg-red-700 rounded-[1.5rem] flex items-center justify-center text-white shadow-2xl -mt-12 border-4 border-[#fcfaf7] dark:border-[#060a13] cursor-pointer hover:rotate-12 transition-transform"><SparklesIcon size={24} /></div>
        <button className="flex flex-col items-center gap-1.5 text-stone-400 opacity-40 cursor-not-allowed">
          <MessageSquareIcon size={26} /> <span className="text-[10px] font-black uppercase tracking-widest">Chats</span>
        </button>
        <div className="w-12 h-12 rounded-2xl bg-stone-200 dark:bg-white/10 flex items-center justify-center text-[11px] font-black border border-stone-300 dark:border-white/5 opacity-50 cursor-not-allowed">ET</div>
      </nav>
    </div>
  );
}
