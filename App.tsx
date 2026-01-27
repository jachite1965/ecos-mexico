import React, { useState, useEffect, useRef } from 'react';
import { 
  SparklesIcon, SearchIcon, CalendarIcon, Loader2Icon, 
  PlayIcon, PauseIcon, RotateCcwIcon, UserIcon, 
  RefreshCwIcon, MoonIcon, SunIcon, InfoIcon,
  ChevronRightIcon, HistoryIcon, MapPinIcon, Trash2Icon, BookmarkIcon,
  FileTextIcon, Volume2Icon, MicIcon
} from 'lucide-react';
import { GoogleGenAI, Modality } from "@google/genai";

// --- TYPES ---
type VoiceName = 
  | 'achernar' | 'achird' | 'algenib' | 'algieba' | 'alnilam' | 'aoede' 
  | 'autonoe' | 'callirrhoe' | 'charon' | 'despina' | 'enceladus' | 'erinome' 
  | 'fenrir' | 'gacrux' | 'iapetus' | 'kore' | 'laomedeia' | 'leda' 
  | 'orus' | 'puck' | 'pulcherrima' | 'rasalgethi' | 'sadachbia' | 'sadaltager' 
  | 'schedar' | 'sulafat' | 'umbriel' | 'vindemiatrix' | 'zephyr' | 'zubenelgenubi';

interface Character {
  name: string;
  gender: 'male' | 'female';
  voice: VoiceName;
  visualDescription?: string;
  avatarUrl?: string;
  bio?: string;
}

interface DialogueLine {
  speaker: string;
  text: string;
  translation: string;
  annotations?: { phrase: string; explanation: string; }[];
}

interface HistoricalScenario {
  id: string;
  timestamp: number;
  locationInput: string;
  dateInput: string;
  context: string;
  narratorIntro: string; // Nueva propiedad
  accentProfile: string;
  characters: Character[];
  script: DialogueLine[];
  sources: { title: string; uri: string; }[];
}

// --- UTILS ---
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
  const prompt = `Investiga: "${location}" ${date ? `en ${date}` : ""}. 
  Genera un escenario histórico inmersivo.
  IMPORTANTE: Incluye una "narratorIntro" de 15 palabras que introduzca la escena antes del diálogo.
  JSON SCHEMA:
  {
    "context": "Contexto rico.",
    "narratorIntro": "Introducción solemne para audio.",
    "accentProfile": "Perfil lingüístico.",
    "characters": [{"name": "N", "gender": "m|f", "voice": "zephyr|kore", "visualDescription": "V", "bio": "B"}],
    "script": [{"speaker": "N", "text": "Ori", "translation": "Esp", "annotations": [{"phrase": "p", "explanation": "e"}]}]
  }`;
  
  const response = await ai.models.generateContent({
    model: FLASH_MODEL,
    contents: prompt,
    config: { tools: [{ googleSearch: {} }] }
  });
  
  let jsonStr = response.text.trim().replace(/```json/gi, '').replace(/```/g, '');
  const data = JSON.parse(jsonStr.substring(jsonStr.indexOf('{'), jsonStr.lastIndexOf('}') + 1));
  const grounding = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const sources = grounding.filter((c: any) => c.web?.uri).map((c: any) => ({ title: c.web.title || "Fuente", uri: c.web.uri })).slice(0, 3);
  
  return { ...data, sources, id: crypto.randomUUID(), timestamp: Date.now(), locationInput: location, dateInput: date };
}

async function generateAudio(scenario: HistoricalScenario, includeNarrator: boolean): Promise<AudioBuffer> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // Configuración de múltiples voces (Narrador + Personajes)
  const speakerVoiceConfigs = [
    { speaker: 'Narrador', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'charon' } } },
    ...scenario.characters.slice(0, 2).map((char, i) => ({
      speaker: `Char${i}`,
      voiceConfig: { prebuiltVoiceConfig: { voiceName: char.voice.toLowerCase() } }
    }))
  ];
  
  let ttsText = includeNarrator ? `Narrador: ${scenario.narratorIntro}\n\n` : "";
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
      contents: { parts: [{ text: `Cinematic historical portrait, extreme detail: ${desc}. Setting: ${ctxText}.` }] }
    });
    const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    return part ? `data:image/png;base64,${part.inlineData.data}` : null;
  } catch { return null; }
}

// --- COMPONENTS ---

const ScenarioDisplay = ({ scenario, audioBuffer, onRegenerateAudio }: { scenario: HistoricalScenario, audioBuffer: AudioBuffer | null, onRegenerateAudio: (includeNarrator: boolean) => void }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [includeNarrator, setIncludeNarrator] = useState(true);
  const [activeTab, setActiveTab] = useState<'script' | 'details'>('script');
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef(0);
  const pauseTimeRef = useRef(0);

  const togglePlay = () => {
    if (isPlaying) {
      sourceNodeRef.current?.stop();
      if (audioContextRef.current) pauseTimeRef.current = audioContextRef.current.currentTime - startTimeRef.current;
      setIsPlaying(false);
    } else {
      if (!audioBuffer) return;
      if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      const offset = pauseTimeRef.current % audioBuffer.duration;
      source.start(0, offset);
      startTimeRef.current = audioContextRef.current.currentTime - offset;
      sourceNodeRef.current = source;
      source.onended = () => { if (audioContextRef.current && audioContextRef.current.currentTime - startTimeRef.current >= audioBuffer.duration - 0.1) { setIsPlaying(false); pauseTimeRef.current = 0; } };
      setIsPlaying(true);
    }
  };

  const exportReport = () => window.print();

  return (
    <div className="w-full max-w-5xl px-4 py-8 animate-in fade-in zoom-in-[0.98] duration-1000">
      {/* Hero Section */}
      <div className="relative mb-8 rounded-[3rem] overflow-hidden bg-stone-900 text-white p-8 md:p-16 border border-white/10 shadow-2xl print:bg-white print:text-black print:p-0 print:shadow-none print:border-none">
        <div className="relative z-10 max-w-2xl">
          <span className="text-red-500 font-black text-[10px] tracking-[0.4em] uppercase mb-4 block print:hidden">Bitácora Temporal</span>
          <h2 className="text-3xl md:text-6xl font-serif-display font-black leading-none mb-6 text-white drop-shadow-lg print:text-black print:text-4xl">
            {scenario.locationInput}
          </h2>
          <p className="text-stone-300 text-base md:text-xl font-medium leading-relaxed italic border-l-4 border-red-700 pl-6 py-2 print:text-stone-700 print:border-black">
            {scenario.context}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: Controls & Characters */}
        <div className="lg:col-span-5 space-y-6 print:hidden">
          <div className="bg-white/80 dark:bg-[#0d1321]/80 backdrop-blur-xl p-8 rounded-[2.5rem] border border-stone-200 dark:border-white/5 shadow-xl flex flex-col items-center">
            <h3 className="text-stone-400 font-black text-[10px] uppercase tracking-widest mb-6">Reproductor de Frecuencia</h3>
            <button 
              onClick={togglePlay} 
              className={`w-24 h-24 md:w-32 md:h-32 rounded-full flex items-center justify-center transition-all shadow-2xl ${isPlaying ? 'bg-stone-900 text-white scale-95' : 'bg-red-700 text-white hover:scale-105 active:scale-95'}`}
            >
              {isPlaying ? <PauseIcon size={40} fill="currentColor" /> : <PlayIcon size={40} fill="currentColor" className="ml-2" />}
            </button>
            
            <div className="mt-8 flex flex-col items-center gap-4 w-full pt-6 border-t border-stone-100 dark:border-white/5">
              <label className="flex items-center gap-3 cursor-pointer group">
                <div 
                  onClick={() => {
                    const newVal = !includeNarrator;
                    setIncludeNarrator(newVal);
                    onRegenerateAudio(newVal);
                  }}
                  className={`w-12 h-6 rounded-full p-1 transition-colors ${includeNarrator ? 'bg-red-700' : 'bg-stone-300 dark:bg-stone-800'}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white transition-transform ${includeNarrator ? 'translate-x-6' : ''}`}></div>
                </div>
                <span className="text-[10px] font-black uppercase text-stone-500 flex items-center gap-1.5">
                  <MicIcon size={12}/> Modo Narrador
                </span>
              </label>
              <button 
                onClick={exportReport}
                className="w-full py-4 rounded-xl border border-stone-200 dark:border-white/10 flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-white/5 transition-all"
              >
                <FileTextIcon size={14}/> Generar Reporte PDF
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="px-4 text-stone-400 font-black text-[10px] uppercase tracking-widest">Figuras Históricas</h3>
            {scenario.characters.map((char, idx) => (
              <div key={idx} className="bg-white dark:bg-[#0d1321] p-4 rounded-3xl border border-stone-200 dark:border-white/5 flex items-center gap-5 shadow-sm group">
                <div className="w-16 h-16 rounded-2xl overflow-hidden bg-stone-100 dark:bg-stone-800 ring-2 ring-red-700/20 relative">
                  {char.avatarUrl && <img src={char.avatarUrl} alt={char.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-[10s]" />}
                </div>
                <div className="flex-1">
                  <h4 className="font-serif-display font-black text-base text-stone-900 dark:text-white leading-none mb-1">{char.name}</h4>
                  <p className="text-[10px] text-stone-500 font-bold uppercase tracking-tighter">{char.bio}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Dialogue Script (The part that prints nicely) */}
        <div className="lg:col-span-7 print:col-span-12">
          <div className="bg-white dark:bg-[#0d1321] rounded-[2rem] md:rounded-[2.5rem] border border-stone-200 dark:border-white/5 overflow-hidden shadow-2xl flex flex-col print:shadow-none print:border-none">
            <div className="flex border-b border-stone-100 dark:border-white/5 print:hidden">
              <button onClick={() => setActiveTab('script')} className={`flex-1 py-5 text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'script' ? 'text-red-700 border-b-2 border-red-700 bg-red-700/5' : 'text-stone-400'}`}>Transcripción</button>
              <button onClick={() => setActiveTab('details')} className={`flex-1 py-5 text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'details' ? 'text-red-700 border-b-2 border-red-700 bg-red-700/5' : 'text-stone-400'}`}>Detalles Históricos</button>
            </div>

            <div className="p-8 md:p-12 flex-1 overflow-y-auto">
              <div className="hidden print:block mb-10 text-center border-b pb-8">
                <p className="text-[10px] font-black uppercase tracking-widest text-red-700">ET&T Historical Experience • Patrimonio Nacional</p>
                <h1 className="text-4xl font-serif-display font-black mt-2">REPORTE DE INVESTIGACIÓN TEMPORAL</h1>
              </div>

              {activeTab === 'script' || true ? (
                <div className="space-y-12">
                  <div className="hidden print:block mb-8">
                    <h3 className="text-sm font-black uppercase tracking-widest border-b pb-2 mb-4">I. Contexto del Suceso</h3>
                    <p className="italic text-lg text-stone-700">{scenario.context}</p>
                  </div>

                  <div className="space-y-10">
                    <h3 className="hidden print:block text-sm font-black uppercase tracking-widest border-b pb-2 mb-4">II. Diálogo Reconstruido</h3>
                    {scenario.script.map((line, idx) => (
                      <div key={idx} className="space-y-2">
                        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-red-700/60">{line.speaker}</span>
                        <p className="font-serif-display text-xl md:text-2xl text-stone-900 dark:text-white leading-tight italic">"{line.text}"</p>
                        <p className="text-xs md:text-sm text-stone-500 dark:text-stone-400 font-medium pl-4 border-l-2 border-stone-100 dark:border-white/5">{line.translation}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      
      <style>{`
        @media print {
          body { background: white !important; color: black !important; }
          .print\\:hidden { display: none !important; }
          .print\\:block { display: block !important; }
          header, footer { display: none !important; }
          @page { margin: 2cm; }
        }
      `}</style>
    </div>
  );
};

// --- MAIN APP ---

const App = () => {
  const [loading, setLoading] = useState<'idle' | 'busy'>('idle');
  const [scenario, setScenario] = useState<HistoricalScenario | null>(null);
  const [audio, setAudio] = useState<AudioBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(false);

  const handleSubmit = async (loc: string, date: string, genImg: boolean) => {
    setLoading('busy');
    setError(null);
    try {
      const data = await researchHistory(loc, date);
      const audioBuf = await generateAudio(data, true);
      let dataWithImgs = data;
      if (genImg) {
        const chars = await Promise.all(data.characters.map(async c => ({ 
          ...c, 
          avatarUrl: await generateAvatar(c.visualDescription || c.name, data.context) || undefined 
        })));
        dataWithImgs = { ...data, characters: chars };
      }
      setScenario(dataWithImgs);
      setAudio(audioBuf);
    } catch (e: any) {
      setError("Falla en la sintonización temporal: " + e.message);
    } finally {
      setLoading('idle');
    }
  };

  const regenerateWithNarrator = async (include: boolean) => {
    if (!scenario) return;
    setLoading('busy');
    try {
      const audioBuf = await generateAudio(scenario, include);
      setAudio(audioBuf);
    } catch (e) { setError("Error al actualizar audio"); }
    finally { setLoading('idle'); }
  };

  return (
    <div className={`min-h-screen ${darkMode ? 'dark bg-[#060a13]' : 'bg-[#fcfaf7]'} transition-colors duration-700 font-sans print:bg-white`}>
      <header className="py-6 px-8 flex justify-between items-center border-b border-stone-200/60 dark:border-white/5 backdrop-blur print:hidden">
        <div className="flex items-center gap-3">
          <div className="bg-red-700 text-white font-mono font-black px-2 py-0.5 rounded shadow-lg">ET&T</div>
          <h1 className="font-serif-display text-xl md:text-2xl font-black text-stone-900 dark:text-white uppercase tracking-tighter">Ecos de México</h1>
        </div>
        <button onClick={() => setDarkMode(!darkMode)} className="p-2 rounded-full border border-stone-200 dark:border-white/10 text-stone-600 dark:text-stone-400">
          {darkMode ? <SunIcon size={20}/> : <MoonIcon size={20}/>}
        </button>
      </header>

      <main className="container mx-auto py-12 flex flex-col items-center">
        {!scenario && loading === 'idle' && (
          <div className="w-full max-w-xl px-4 animate-in fade-in slide-in-from-top-6">
            <h2 className="text-center font-serif-display text-4xl md:text-5xl font-black mb-12 dark:text-white">¿Qué momento deseas sintonizar?</h2>
            <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); handleSubmit(fd.get('loc') as string, fd.get('date') as string, true); }} className="bg-white/90 dark:bg-[#0d1321]/90 p-8 rounded-[2.5rem] border border-stone-200 dark:border-white/5 shadow-2xl space-y-8">
              <div className="space-y-4">
                <input name="loc" required placeholder="Lugar o suceso histórico..." className="w-full bg-stone-50 dark:bg-stone-900 py-5 px-6 rounded-2xl outline-none focus:ring-2 focus:ring-red-700 dark:text-white" />
                <input name="date" placeholder="Año o época (opcional)..." className="w-full bg-stone-50 dark:bg-stone-900 py-5 px-6 rounded-2xl outline-none focus:ring-2 focus:ring-red-700 dark:text-white" />
              </div>
              <button type="submit" className="w-full py-5 rounded-2xl bg-red-700 text-white font-black text-xl hover:bg-red-600 transition-all flex items-center justify-center gap-3">
                <SparklesIcon size={24}/> ESCUCHAR EL PASADO
              </button>
            </form>
          </div>
        )}

        {loading === 'busy' && (
          <div className="flex flex-col items-center gap-4 py-20 print:hidden">
            <Loader2Icon size={48} className="text-red-700 animate-spin" />
            <p className="font-serif-display text-xl dark:text-stone-300">Consultando anales históricos...</p>
          </div>
        )}

        {scenario && loading === 'idle' && (
          <div className="flex flex-col items-center w-full">
            <ScenarioDisplay scenario={scenario} audioBuffer={audio} onRegenerateAudio={regenerateWithNarrator} />
            <button onClick={() => { setScenario(null); setAudio(null); }} className="mt-12 px-8 py-4 bg-stone-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all print:hidden">Nueva Búsqueda</button>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
