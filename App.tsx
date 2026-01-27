import React, { useState, useEffect, useRef } from 'react';
import { 
  SparklesIcon, Loader2Icon, PlayIcon, PauseIcon, 
  UserIcon, MoonIcon, SunIcon, 
  ChevronRightIcon, HistoryIcon, MapPinIcon, 
  BookmarkIcon, FileTextIcon
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
}

// --- UTILS ---
function cleanJSON(text: string): string {
  // Elimina bloques de código markdown si existen
  return text.replace(/```json/gi, '').replace(/```/g, '').trim();
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
  
  const response = await ai.models.generateContent({
    model: FLASH_MODEL,
    contents: `Eres un historiador experto. Crea una crónica histórica sobre: "${location}" ${date ? `en ${date}` : ""}.
    Requisitos:
    1. Contexto inmersivo.
    2. Intro de narrador solemne (máx 20 palabras).
    3. Perfil de acento de la época.
    4. 2 personajes históricos relevantes con nombres exactos.
    5. Diálogo de 4 líneas entre ellos en su variante lingüística original con traducción.`,
    config: { 
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          context: { type: Type.STRING },
          narratorIntro: { type: Type.STRING },
          accentProfile: { type: Type.STRING },
          characters: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                gender: { type: Type.STRING, enum: ["male", "female"] },
                voice: { type: Type.STRING, enum: ["zephyr", "kore", "puck", "charon"] },
                visualDescription: { type: Type.STRING },
                bio: { type: Type.STRING }
              },
              required: ["name", "gender", "voice", "visualDescription", "bio"]
            }
          },
          script: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                speaker: { type: Type.STRING },
                text: { type: Type.STRING },
                translation: { type: Type.STRING }
              },
              required: ["speaker", "text", "translation"]
            }
          }
        },
        required: ["context", "narratorIntro", "accentProfile", "characters", "script"]
      }
    }
  });
  
  const rawText = response.text;
  const data = JSON.parse(cleanJSON(rawText));
  
  return { 
    ...data, 
    id: crypto.randomUUID(), 
    timestamp: Date.now(), 
    locationInput: location, 
    dateInput: date 
  };
}

async function generateAudio(scenario: HistoricalScenario): Promise<AudioBuffer> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // Mapeo seguro de locutores para el TTS multi-speaker
  const speakerVoiceConfigs = [
    { speaker: 'Narrador', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'charon' } } },
    ...scenario.characters.slice(0, 2).map((char, i) => ({
      speaker: `Char${i}`,
      voiceConfig: { prebuiltVoiceConfig: { voiceName: char.voice.toLowerCase() } }
    }))
  ];
  
  let ttsText = `Narrador: ${scenario.narratorIntro}\n\n`;
  scenario.script.forEach(line => {
    const charIdx = scenario.characters.findIndex(c => c.name === line.speaker);
    ttsText += `Char${charIdx === -1 ? 0 : charIdx}: ${line.text}\n`;
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
  if (!base64) throw new Error("Audio fallido");
  
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  const buffer = await decodeAudioToBuffer(decodeBase64(base64), ctx);
  await ctx.close();
  return buffer;
}

async function generateAvatar(desc: string, ctxText: string): Promise<string | null> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: { parts: [{ text: `Historical portrait: ${desc}. Context: ${ctxText}. Mexican history style.` }] }
    });
    const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    return part ? `data:image/png;base64,${part.inlineData.data}` : null;
  } catch { return null; }
}

export default function App() {
  const [loading, setLoading] = useState<'idle' | 'busy'>('idle');
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
    const saved = localStorage.getItem('hist_mex_v4');
    if (saved) setHistory(JSON.parse(saved));
  }, []);

  const handleSearch = async (loc: string, date: string) => {
    setLoading('busy');
    setError(null);
    setScenario(null);
    setAudio(null);
    try {
      const data = await researchHistory(loc, date);
      const audioBuf = await generateAudio(data);
      const charsWithImgs = await Promise.all(data.characters.map(async c => ({
        ...c,
        avatarUrl: await generateAvatar(c.visualDescription || c.name, data.context) || undefined
      })));
      const finalData = { ...data, characters: charsWithImgs };
      setScenario(finalData);
      setAudio(audioBuf);
      const updatedHistory = [finalData, ...history.filter(h => h.locationInput !== loc)].slice(0, 5);
      setHistory(updatedHistory);
      localStorage.setItem('hist_mex_v4', JSON.stringify(updatedHistory));
    } catch (e: any) {
      setError("La sintonización temporal ha fallado. Por favor, intenta de nuevo.");
      console.error(e);
    } finally {
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
    <div className={`${darkMode ? 'dark' : ''} min-h-screen bg-[#fcfaf7] dark:bg-[#060a13] text-stone-900 dark:text-stone-100 font-sans transition-colors duration-500`}>
      
      <header className="border-b border-stone-200 dark:border-white/5 py-4 px-6 md:px-12 flex justify-between items-center bg-white/80 dark:bg-[#0d1321]/80 backdrop-blur sticky top-0 z-50 no-print">
        <div className="flex items-center gap-3">
          <div className="bg-red-700 text-white font-serif font-black px-2 py-0.5 rounded">ET&T</div>
          <h1 className="font-serif text-lg font-black uppercase tracking-tighter">Ecos de México</h1>
        </div>
        <button onClick={() => setDarkMode(!darkMode)} className="p-2 rounded-full hover:bg-stone-100 dark:hover:bg-white/5">
          {darkMode ? <SunIcon size={18} /> : <MoonIcon size={18} />}
        </button>
      </header>

      <main className="container mx-auto max-w-5xl px-4 py-8">
        {!scenario && loading === 'idle' && (
          <div className="flex flex-col items-center gap-10 py-12">
            <div className="text-center space-y-4">
              <span className="text-red-700 font-black text-xs uppercase tracking-[0.4em]">Archivo Histórico Nacional</span>
              <h2 className="text-4xl md:text-6xl font-serif font-black leading-tight">¿Qué momento deseas sintonizar?</h2>
            </div>

            <form onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              handleSearch(fd.get('loc') as string, fd.get('date') as string);
            }} className="w-full max-w-lg bg-white dark:bg-[#0d1321] p-10 rounded-[2.5rem] border border-stone-200 dark:border-white/5 shadow-2xl space-y-6">
              <div className="space-y-4">
                <div className="relative">
                  <MapPinIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-red-700/40" size={18} />
                  <input name="loc" required placeholder="Lugar o suceso..." className="w-full bg-stone-50 dark:bg-stone-900/50 py-4 pl-12 pr-6 rounded-xl outline-none focus:ring-2 focus:ring-red-700 transition-all font-medium" />
                </div>
                <div className="relative">
                  <HistoryIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-red-700/40" size={18} />
                  <input name="date" placeholder="Época o año..." className="w-full bg-stone-50 dark:bg-stone-900/50 py-4 pl-12 pr-6 rounded-xl outline-none focus:ring-2 focus:ring-red-700 transition-all font-medium" />
                </div>
              </div>
              <button type="submit" className="w-full py-5 rounded-xl bg-red-700 hover:bg-red-600 text-white font-black text-lg flex items-center justify-center gap-3 transition-all active:scale-95">
                <SparklesIcon size={24} /> ESCUCHAR EL PASADO
              </button>
            </form>

            {history.length > 0 && (
              <div className="w-full max-w-lg space-y-4">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-stone-400 px-2">Sintonías Recientes</h3>
                <div className="grid gap-2">
                  {history.map(h => (
                    <button key={h.id} onClick={() => setScenario(h)} className="p-4 bg-white dark:bg-[#0d1321] rounded-xl border border-stone-200 dark:border-white/5 flex items-center justify-between hover:border-red-700 transition-all">
                      <div className="text-left">
                        <p className="font-serif font-black text-lg leading-none">{h.locationInput}</p>
                        <p className="text-[10px] font-bold text-stone-400 uppercase">{h.dateInput || 'Hito Histórico'}</p>
                      </div>
                      <ChevronRightIcon size={18} className="text-stone-300" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {loading === 'busy' && (
          <div className="flex flex-col items-center justify-center py-32 space-y-6">
            <div className="w-16 h-16 border-4 border-red-700/10 border-t-red-700 animate-spin rounded-full"></div>
            <p className="font-serif font-black text-xl uppercase tracking-widest animate-pulse">Consultando el tiempo...</p>
          </div>
        )}

        {scenario && loading === 'idle' && (
          <div className="space-y-8 animate-in fade-in zoom-in-95 duration-700">
            <div className="bg-white dark:bg-[#0d1321] rounded-[2.5rem] border border-stone-200 dark:border-white/5 shadow-2xl p-8 md:p-12 relative overflow-hidden">
               <div className="absolute top-0 right-0 w-1/4 h-full bg-red-700/5 -skew-x-12"></div>
               <div className="max-w-3xl space-y-6 relative z-10">
                  <span className="text-red-700 font-black text-xs uppercase tracking-[0.4em]">Sintonización Exitosa</span>
                  <h2 className="text-4xl md:text-7xl font-serif font-black leading-none">{scenario.locationInput}</h2>
                  <p className="text-xl md:text-2xl font-medium leading-relaxed italic border-l-4 border-red-700 pl-6 text-stone-600 dark:text-stone-300">{scenario.context}</p>
                  
                  <div className="flex flex-wrap gap-4 pt-4 no-print">
                    <button onClick={togglePlay} className={`px-10 py-5 rounded-xl font-black flex items-center gap-4 shadow-xl transition-all active:scale-95 ${isPlaying ? 'bg-stone-900 text-white' : 'bg-red-700 text-white'}`}>
                      {isPlaying ? <PauseIcon size={24} fill="currentColor" /> : <PlayIcon size={24} fill="currentColor" />}
                      <span className="uppercase tracking-widest">{isPlaying ? 'Detener Eco' : 'Escuchar el Pasado'}</span>
                    </button>
                    <button onClick={() => window.print()} className="px-10 py-5 rounded-xl font-black bg-stone-100 dark:bg-white/5 border border-stone-200 dark:border-white/10 flex items-center gap-4 hover:bg-stone-200 transition-all uppercase tracking-widest text-sm">
                      <FileTextIcon size={20} /> Reporte
                    </button>
                  </div>
               </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-4 space-y-6">
                <h3 className="px-4 text-[10px] font-black uppercase tracking-widest text-stone-400">Figuras Presentes</h3>
                {scenario.characters.map((char, idx) => (
                  <div key={idx} className="bg-white dark:bg-[#0d1321] p-6 rounded-[2rem] border border-stone-200 dark:border-white/5 flex items-center gap-5 shadow-lg">
                    <div className="w-20 h-20 rounded-2xl overflow-hidden bg-stone-100 dark:bg-stone-800 ring-2 ring-red-700/20 flex-shrink-0">
                      {char.avatarUrl ? <img src={char.avatarUrl} className="w-full h-full object-cover" /> : <UserIcon className="m-auto text-stone-300 h-full" size={32} />}
                    </div>
                    <div>
                      <h4 className="font-serif font-black text-xl leading-none mb-1">{char.name}</h4>
                      <p className="text-xs text-stone-500 font-bold uppercase">{char.bio}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="lg:col-span-8">
                <div className="bg-white dark:bg-[#0d1321] rounded-[2rem] border border-stone-200 dark:border-white/5 overflow-hidden shadow-2xl">
                  <div className="flex border-b border-stone-100 dark:border-white/5 no-print">
                    <button onClick={() => setActiveTab('script')} className={`flex-1 py-5 text-[10px] font-black uppercase tracking-widest ${activeTab === 'script' ? 'text-red-700 border-b-2 border-red-700' : 'text-stone-400'}`}>Transcripción</button>
                    <button onClick={() => setActiveTab('details')} className={`flex-1 py-5 text-[10px] font-black uppercase tracking-widest ${activeTab === 'details' ? 'text-red-700 border-b-2 border-red-700' : 'text-stone-400'}`}>Detalles</button>
                  </div>

                  <div className="p-10 min-h-[400px]">
                    {activeTab === 'script' ? (
                      <div className="space-y-12">
                        {scenario.script.map((line, idx) => (
                          <div key={idx} className="space-y-2">
                            <span className="text-[10px] font-black uppercase tracking-widest text-red-700/60">{line.speaker}</span>
                            <p className="font-serif text-2xl md:text-3xl font-bold leading-tight italic">"{line.text}"</p>
                            <p className="text-sm text-stone-500 pl-6 border-l-2 border-stone-100">{line.translation}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-6">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-stone-400">Perfil Lingüístico</h4>
                        <p className="text-lg leading-relaxed">{scenario.accentProfile}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="no-print flex justify-center py-10">
              <button onClick={() => { setScenario(null); setAudio(null); }} className="px-12 py-5 bg-stone-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-2xl hover:scale-105 transition-all">Nueva Búsqueda</button>
            </div>
          </div>
        )}

        {error && (
          <div className="max-w-md mx-auto p-10 bg-white dark:bg-[#0d1321] border-2 border-red-700/20 rounded-[2.5rem] text-center space-y-6 shadow-2xl">
            <p className="text-red-700 font-bold text-lg">{error}</p>
            <button onClick={() => setError(null)} className="w-full py-4 bg-red-700 text-white rounded-xl font-black text-xs uppercase tracking-widest">Reintentar</button>
          </div>
        )}
      </main>
    </div>
  );
}
