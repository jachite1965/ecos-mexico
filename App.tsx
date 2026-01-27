import React, { useState, useEffect, useRef } from 'react';
import { 
  SparklesIcon, Loader2Icon, PlayIcon, PauseIcon, 
  UserIcon, MoonIcon, SunIcon, 
  ChevronRightIcon, HistoryIcon, MapPinIcon, 
  BookmarkIcon, FileTextIcon, InfoIcon, AlertCircleIcon, ExternalLinkIcon
} from 'lucide-react';
import { GoogleGenAI, Modality, Type } from "@google/genai";

// --- TYPES ---
interface Character {
  name: string;
  gender: 'male' | 'female';
  voice: string;
  visualDescription: string;
  bio: string;
  avatarUrl?: string;
}

interface DialogueLine {
  speaker: string;
  text: string;
  translation: string;
}

interface HistoricalScenario {
  id: string;
  timestamp: number;
  locationInput: string;
  dateInput: string;
  context: string;
  narratorIntro: string;
  accentProfile: string;
  characters: Character[];
  script: DialogueLine[];
  sources: { title: string; uri: string; }[];
}

// --- UTILS ---
function extractJSON(text: string): any {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("JSON Parse Error:", e);
    throw new Error("Error en el formato de la crónica.");
  }
}

function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

async function decodeAudioToBuffer(data: Uint8Array, ctx: AudioContext): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
  const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < dataInt16.length; i++) channelData[i] = dataInt16[i] / 32768.0;
  return buffer;
}

// --- SERVICES ---
const FLASH_MODEL = 'gemini-3-flash-preview'; 
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const IMAGE_MODEL = 'gemini-2.5-flash-image';

async function researchHistory(location: string, date: string): Promise<HistoricalScenario> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const searchResponse = await ai.models.generateContent({
    model: FLASH_MODEL,
    contents: `Investiga con Google Search: "${location}" en ${date || 'su época histórica'}. Hechos verídicos y personajes clave.`,
    config: { tools: [{ googleSearch: {} }] }
  });

  const facts = searchResponse.text;
  const grounding = searchResponse.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const sources = grounding.filter((c: any) => c.web?.uri).map((c: any) => ({ title: c.web.title || "Fuente", uri: c.web.uri })).slice(0, 3);

  const structureResponse = await ai.models.generateContent({
    model: FLASH_MODEL,
    contents: `Crea un JSON histórico inmersivo basado en: ${facts}. 
    REGLA DE VOCES: 
    - Hombre (male): Usa 'Charon' o 'Puck'.
    - Mujer (female): Usa 'Kore' o 'Aoede'.
    ASEGÚRATE DE ASIGNAR EL GÉNERO CORRECTO A PERSONAJES HISTÓRICOS (ej. Ignacio Zaragoza es 'male' / 'Charon').
    
    Estructura JSON:
    {
      "context": "Contexto épico",
      "narratorIntro": "Intro breve",
      "accentProfile": "Acento de época",
      "characters": [{"name": "Nombre", "gender": "male|female", "voice": "Charon|Kore", "visualDescription": "Aspecto físico para retrato", "bio": "Rol"}],
      "script": [{"speaker": "Nombre", "text": "Diálogo", "translation": "Traducción"}]
    }`,
    config: { responseMimeType: "application/json" }
  });

  return { ...extractJSON(structureResponse.text), sources, id: crypto.randomUUID(), timestamp: Date.now(), locationInput: location, dateInput: date };
}

async function generateAudio(scenario: HistoricalScenario): Promise<AudioBuffer | null> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    // Usamos nombres neutros para la configuración interna pero manteniendo el género asignado
    const speakerNames = ["Narrador", "Personaje"];
    const speakerVoiceConfigs = [
      { speaker: speakerNames[0], voiceConfig: { prebuiltVoiceConfig: { voiceName: scenario.characters[0]?.voice || 'Charon' } } },
      { speaker: speakerNames[1], voiceConfig: { prebuiltVoiceConfig: { voiceName: scenario.characters[1]?.voice || 'Kore' } } }
    ];

    let ttsText = `${speakerNames[0]}: ${scenario.narratorIntro}\n\n`;
    scenario.script.forEach((line, i) => {
      const charIdx = scenario.characters.findIndex(c => c.name === line.speaker);
      const sName = charIdx <= 0 ? speakerNames[0] : speakerNames[1];
      ttsText += `${sName}: ${line.text}\n`;
    });

    const response = await ai.models.generateContent({
      model: TTS_MODEL, 
      contents: [{ parts: [{ text: ttsText }] }],
      config: {
        responseModalities: [Modality.AUDIO], 
        speechConfig: { multiSpeakerVoiceConfig: { speakerVoiceConfigs } }
      }
    });
    
    const base64 = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
    if (!base64) return null;
    
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    const buffer = await decodeAudioToBuffer(decodeBase64(base64), ctx);
    await ctx.close();
    return buffer;
  } catch (e) {
    console.error("Audio error:", e);
    return null;
  }
}

async function generateAvatar(desc: string): Promise<string | null> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: { parts: [{ text: `Historical portrait: ${desc}. Cinematic oil painting style, realistic face, high quality.` }] }
    });
    const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    return part ? `data:image/png;base64,${part.inlineData.data}` : null;
  } catch { return null; }
}

export default function App() {
  const [loading, setLoading] = useState<'idle' | 'busy' | 'media'>('idle');
  const [scenario, setScenario] = useState<HistoricalScenario | null>(null);
  const [audio, setAudio] = useState<AudioBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [history, setHistory] = useState<HistoricalScenario[]>([]);
  const [activeTab, setActiveTab] = useState<'script' | 'details'>('script');
  const [isPlaying, setIsPlaying] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('hist_mex_v8');
    if (saved) setHistory(JSON.parse(saved));
  }, []);

  const handleSearch = async (loc: string, date: string) => {
    setLoading('busy');
    setError(null);
    setScenario(null);
    setAudio(null);
    try {
      const data = await researchHistory(loc, date);
      setScenario(data);
      setLoading('media');

      generateAudio(data).then(buf => buf && setAudio(buf));

      data.characters.forEach(async (c, i) => {
        const url = await generateAvatar(c.visualDescription);
        if (url) {
          setScenario(prev => {
            if (!prev) return prev;
            const newChars = [...prev.characters];
            newChars[i] = { ...newChars[i], avatarUrl: url };
            return { ...prev, characters: newChars };
          });
        }
      });

      const updatedHistory = [data, ...history.filter(h => h.locationInput !== loc)].slice(0, 5);
      setHistory(updatedHistory);
      localStorage.setItem('hist_mex_v8', JSON.stringify(updatedHistory));
      setLoading('idle');
    } catch (e: any) {
      setError(e.message || "Interferencia temporal detectada.");
      setLoading('idle');
    }
  };

  const togglePlay = () => {
    if (isPlaying) {
      sourceNodeRef.current?.stop();
      setIsPlaying(false);
    } else if (audio) {
      if (!audioContextRef.current) audioContextRef.current = new AudioContext();
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audio;
      source.connect(audioContextRef.current.destination);
      source.start();
      sourceNodeRef.current = source;
      setIsPlaying(true);
      source.onended = () => setIsPlaying(false);
    }
  };

  return (
    <div className={`${darkMode ? 'dark' : ''} min-h-screen bg-[#fcfaf7] dark:bg-[#060a13] text-stone-900 dark:text-stone-100 transition-colors duration-500`}>
      
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body { background: white !important; color: black !important; padding: 2cm !important; }
          .report-card { border: 2px solid #555 !important; border-radius: 0 !important; box-shadow: none !important; }
          .avatar-img { filter: grayscale(100%); width: 100px !important; height: 100px !important; }
          .header-report { border-bottom: 3px double black; margin-bottom: 1rem; padding-bottom: 1rem; }
        }
      `}</style>

      <header className="no-print border-b border-stone-200 dark:border-white/5 py-4 px-6 flex justify-between items-center glass sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="bg-red-700 text-white font-serif font-black px-2 py-0.5 rounded shadow-lg">ET&T</div>
          <h1 className="font-serif text-lg font-black uppercase tracking-tighter">Ecos de México</h1>
        </div>
        <button onClick={() => setDarkMode(!darkMode)} className="p-2 rounded-full border border-stone-200 dark:border-white/10 hover:bg-stone-100 dark:hover:bg-white/5 transition-all">
          {darkMode ? <SunIcon size={18} /> : <MoonIcon size={18} />}
        </button>
      </header>

      <main className="container mx-auto max-w-5xl px-4 py-8">
        {!scenario && loading === 'idle' && (
          <div className="flex flex-col items-center gap-10 py-12 animate-in fade-in">
            <div className="text-center space-y-3">
              <span className="text-red-700 font-black text-[10px] uppercase tracking-[0.4em]">Archivo General de la Nación Digital</span>
              <h2 className="text-4xl md:text-6xl font-serif font-black">¿Qué momento deseas sintonizar?</h2>
            </div>
            <form onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              handleSearch(fd.get('loc') as string, fd.get('date') as string);
            }} className="w-full max-w-lg glass p-10 rounded-[2.5rem] border border-stone-200 dark:border-white/5 shadow-2xl space-y-6">
              <div className="space-y-4">
                <div className="relative">
                  <MapPinIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-red-700/40" size={18} />
                  <input name="loc" required placeholder="Lugar o suceso histórico..." className="w-full bg-stone-50 dark:bg-stone-900/50 py-4 pl-12 pr-6 rounded-xl outline-none focus:ring-2 focus:ring-red-700 transition-all font-medium" />
                </div>
                <div className="relative">
                  <HistoryIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-red-700/40" size={18} />
                  <input name="date" placeholder="Año o época..." className="w-full bg-stone-50 dark:bg-stone-900/50 py-4 pl-12 pr-6 rounded-xl outline-none focus:ring-2 focus:ring-red-700 transition-all font-medium" />
                </div>
              </div>
              <button type="submit" className="w-full py-5 rounded-xl bg-red-700 hover:bg-red-600 text-white font-black text-lg flex items-center justify-center gap-3 shadow-xl transition-all">
                <SparklesIcon size={24} /> ESCUCHAR EL PASADO
              </button>
            </form>
          </div>
        )}

        {loading === 'busy' && (
          <div className="flex flex-col items-center justify-center py-32 space-y-6">
            <div className="w-16 h-16 border-4 border-red-700/10 border-t-red-700 animate-spin rounded-full"></div>
            <p className="font-serif font-black text-xl uppercase tracking-widest animate-pulse">Sintonizando el tiempo...</p>
          </div>
        )}

        {scenario && (
          <div className="space-y-8 animate-in fade-in pb-12">
            <div className="report-card glass rounded-[2.5rem] border border-stone-200 dark:border-white/5 shadow-2xl p-8 md:p-12">
               <div className="header-report hidden print:block mb-8">
                  <h1 className="text-3xl font-serif font-black uppercase text-center">Crónica del Archivo Histórico de México</h1>
                  <p className="text-center text-xs font-bold uppercase tracking-widest text-stone-500 mt-2">Sintonización Temporal: {new Date().toLocaleDateString()}</p>
               </div>
               
               <div className="max-w-3xl space-y-6">
                  <span className="no-print text-red-700 font-black text-xs uppercase tracking-[0.4em]">Conexión Establecida</span>
                  <h2 className="text-4xl md:text-7xl font-serif font-black leading-none uppercase tracking-tighter">{scenario.locationInput}</h2>
                  <p className="text-xl md:text-2xl font-medium leading-relaxed italic border-l-4 border-red-700 pl-6 text-stone-600 dark:text-stone-300">{scenario.context}</p>
                  
                  <div className="flex flex-wrap gap-4 no-print">
                    <button onClick={togglePlay} disabled={!audio} className={`px-10 py-5 rounded-xl font-black flex items-center gap-4 shadow-xl transition-all ${!audio ? 'opacity-50 cursor-wait bg-stone-200' : isPlaying ? 'bg-stone-900 text-white' : 'bg-red-700 text-white'}`}>
                      {!audio ? <Loader2Icon size={24} className="animate-spin" /> : isPlaying ? <PauseIcon size={24} fill="currentColor" /> : <PlayIcon size={24} fill="currentColor" />}
                      <span>{!audio ? 'Sintonizando Audio...' : isPlaying ? 'Detener Eco' : 'Escuchar Crónica'}</span>
                    </button>
                    <button onClick={() => window.print()} className="px-10 py-5 rounded-xl font-black bg-stone-100 dark:bg-white/5 border border-stone-200 dark:border-white/10 flex items-center gap-4 hover:bg-stone-200 transition-all uppercase tracking-widest text-sm">
                      <FileTextIcon size={20} /> Generar Reporte
                    </button>
                  </div>
               </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-4 space-y-6">
                <h3 className="px-4 text-[10px] font-black uppercase tracking-widest text-stone-400">Figuras Reales</h3>
                {scenario.characters.map((char, idx) => (
                  <div key={idx} className="report-card glass p-6 rounded-[2rem] border border-stone-200 dark:border-white/5 flex items-center gap-5 shadow-lg">
                    <div className="avatar-img w-20 h-20 rounded-2xl overflow-hidden bg-stone-100 dark:bg-stone-800 ring-2 ring-red-700/20 flex-shrink-0 flex">
                      {char.avatarUrl ? <img src={char.avatarUrl} className="w-full h-full object-cover animate-in fade-in" /> : <div className="m-auto animate-pulse text-[10px] font-black uppercase text-stone-400">Pintando...</div>}
                    </div>
                    <div>
                      <h4 className="font-serif font-black text-xl leading-none mb-1">{char.name}</h4>
                      <p className="text-xs text-stone-500 font-bold uppercase">{char.bio}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="lg:col-span-8">
                <div className="report-card glass rounded-[2rem] border border-stone-200 dark:border-white/5 overflow-hidden shadow-2xl flex flex-col min-h-[400px]">
                  <div className="flex border-b border-stone-100 dark:border-white/5 no-print">
                    <button onClick={() => setActiveTab('script')} className={`flex-1 py-5 text-[10px] font-black uppercase tracking-widest ${activeTab === 'script' ? 'text-red-700 border-b-2 border-red-700 bg-red-700/5' : 'text-stone-400'}`}>Diálogos de Época</button>
                    <button onClick={() => setActiveTab('details')} className={`flex-1 py-5 text-[10px] font-black uppercase tracking-widest ${activeTab === 'details' ? 'text-red-700 border-b-2 border-red-700 bg-red-700/5' : 'text-stone-400'}`}>Fuentes e Historia</button>
                  </div>

                  <div className="p-10 flex-1">
                    {activeTab === 'script' || (typeof window !== 'undefined' && window.matchMedia('print').matches) ? (
                      <div className="space-y-12">
                        {scenario.script.map((line, idx) => (
                          <div key={idx} className="space-y-2">
                            <span className="text-[10px] font-black uppercase tracking-widest text-red-700/60">{line.speaker}</span>
                            <p className="font-serif text-2xl md:text-3xl font-bold leading-tight italic">"{line.text}"</p>
                            <p className="text-sm text-stone-500 pl-6 border-l-2 border-stone-100 dark:border-stone-800 mt-2">{line.translation}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    
                    {activeTab === 'details' && (
                      <div className="space-y-6 animate-in fade-in">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-stone-400">Análisis Histórico</h4>
                        <div className="grid gap-3">
                          {scenario.sources.map((s, i) => (
                            <a key={i} href={s.uri} target="_blank" rel="noreferrer" className="flex items-center justify-between p-4 bg-red-700/5 rounded-xl border border-red-700/10 hover:border-red-700 transition-all font-bold text-xs no-print">
                              <span>{s.title}</span>
                              <ExternalLinkIcon size={14} className="text-red-700" />
                            </a>
                          ))}
                        </div>
                        <div className="mt-6 p-6 bg-stone-50 dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-white/5">
                           <h5 className="text-[10px] font-black uppercase text-red-700 mb-2">Atmósfera Sonora</h5>
                           <p className="text-sm font-medium leading-relaxed italic">{scenario.accentProfile}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="no-print flex justify-center pt-12">
              <button onClick={() => { setScenario(null); setAudio(null); }} className="px-14 py-6 bg-stone-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-2xl hover:scale-105 active:scale-95 transition-all">Nueva Sintonía Temporal</button>
            </div>
          </div>
        )}

        {error && (
          <div className="max-w-md mx-auto p-10 glass border-2 border-red-700/20 rounded-[2.5rem] text-center space-y-6">
            <AlertCircleIcon className="mx-auto text-red-700" size={48} />
            <p className="text-red-700 font-bold text-lg">{error}</p>
            <button onClick={() => setError(null)} className="w-full py-4 bg-red-700 text-white rounded-xl font-black text-xs uppercase tracking-widest">Reintentar</button>
          </div>
        )}
      </main>
    </div>
  );
}
