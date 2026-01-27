import React, { useState, useEffect, useRef } from 'react';
import { 
  SparklesIcon, SearchIcon, CalendarIcon, Loader2Icon, 
  PlayIcon, PauseIcon, RotateCcwIcon, UserIcon, 
  RefreshCwIcon, MoonIcon, SunIcon, InfoIcon,
  ChevronRightIcon, HistoryIcon, MapPinIcon
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

interface Annotation {
  phrase: string;
  explanation: string;
}

interface DialogueLine {
  speaker: string;
  text: string;
  translation: string;
  annotations?: Annotation[];
}

interface Source {
  title: string;
  uri: string;
}

interface HistoricalScenario {
  context: string;
  accentProfile: string;
  characters: Character[];
  script: DialogueLine[];
  sources: Source[];
}

// --- UTILS ---
function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioToBuffer(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// --- SERVICES ---
const FLASH_MODEL = 'gemini-3-flash-preview'; 
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const IMAGE_MODEL = 'gemini-2.5-flash-image';

function extractJSON(text: string): any {
  let jsonString = text.trim().replace(/```json/gi, '').replace(/```/g, '');
  const firstOpen = jsonString.indexOf('{');
  const lastClose = jsonString.lastIndexOf('}');
  return JSON.parse(jsonString.substring(firstOpen, lastClose + 1));
}

async function researchHistory(location: string, date: string): Promise<HistoricalScenario> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `Actúa como un historiador experto. Investiga el suceso o lugar: "${location}" ${date ? `en la fecha o época de ${date}` : ""}. 
  Genera un escenario histórico inmersivo.
  JSON SCHEMA:
  {
    "context": "Descripción rica del ambiente y momento exacto.",
    "accentProfile": "Breve descripción del lenguaje usado.",
    "characters": [
      {"name": "Nombre Realista", "gender": "male|female", "voice": "kore|puck|zephyr|callirrhoe", "visualDescription": "Ropa y rasgos físicos detallados", "bio": "Rol social"}
    ],
    "script": [
      {"speaker": "Nombre", "text": "Diálogo en idioma/variante original (ej: Náhuatl, Maya, Español de 1800)", "translation": "Traducción al español moderno", "annotations": [{"phrase": "palabra clave", "explanation": "significado cultural"}]}
    ]
  }`;
  
  const response = await ai.models.generateContent({
    model: FLASH_MODEL,
    contents: prompt,
    config: { tools: [{ googleSearch: {} }] }
  });
  
  const data = extractJSON(response.text);
  const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const sources = groundingChunks.filter((c: any) => c.web?.uri).map((c: any) => ({ title: c.web.title || "Fuente", uri: c.web.uri })).slice(0, 3);
  return { ...data, sources };
}

async function generateAudio(scenario: HistoricalScenario): Promise<AudioBuffer> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const speakerVoiceConfigs = scenario.characters.slice(0, 2).map((char, i) => ({
    speaker: `Speaker ${String.fromCharCode(65 + i)}`,
    voiceConfig: { prebuiltVoiceConfig: { voiceName: char.voice.toLowerCase() } }
  }));
  
  const charToSafeName = new Map();
  scenario.characters.forEach((c, i) => charToSafeName.set(c.name, `Speaker ${String.fromCharCode(65 + i)}`));
  
  let dialogueText = "";
  scenario.script.forEach(line => {
    const safeName = charToSafeName.get(line.speaker) || "Speaker A";
    dialogueText += `${safeName}: ${line.text}\n`;
  });

  const response = await ai.models.generateContent({
    model: TTS_MODEL, 
    contents: [{ parts: [{ text: dialogueText }] }],
    config: {
      responseModalities: [Modality.AUDIO], 
      speechConfig: { multiSpeakerVoiceConfig: { speakerVoiceConfigs } }
    }
  });
  
  const base64 = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
  if (!base64) throw new Error("Audio no generado");
  
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  const buffer = await decodeAudioToBuffer(decodeBase64(base64), ctx, 24000, 1);
  await ctx.close();
  return buffer;
}

async function generateAvatar(desc: string, ctxText: string): Promise<string | null> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: { parts: [{ text: `Cinematic period portrait, extreme detail, oil painting style: ${desc}. Historical setting: ${ctxText}. 4k resolution.` }] }
    });
    const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    return part ? `data:image/png;base64,${part.inlineData.data}` : null;
  } catch { return null; }
}

// --- COMPONENTS ---

const Header = ({ darkMode, setDarkMode }: { darkMode: boolean, setDarkMode: (d: boolean) => void }) => (
  <header className="w-full py-6 px-8 flex justify-between items-center z-50 relative border-b border-stone-200/60 dark:border-white/5 backdrop-blur-md">
    <div className="flex items-center gap-4">
      <div className="bg-red-700 text-white font-mono font-black px-3 py-1 text-xl rounded shadow-lg shadow-red-900/20">ET&T</div>
      <div className="hidden sm:block">
        <p className="text-[10px] uppercase font-black tracking-[0.2em] text-red-700/60 dark:text-red-500/60 leading-none">Historical</p>
        <p className="text-[10px] uppercase font-black tracking-[0.2em] text-stone-400 dark:text-stone-500 leading-none mt-1">Experience</p>
      </div>
    </div>
    <div className="flex-1 text-center">
      <h1 className="font-serif-display text-2xl md:text-3xl font-black text-stone-900 dark:text-white tracking-tighter uppercase">
        Ecos de México
      </h1>
    </div>
    <button 
      onClick={() => setDarkMode(!darkMode)}
      className="w-10 h-10 rounded-full flex items-center justify-center border border-stone-200 dark:border-white/10 text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-white/5 transition-all shadow-sm"
    >
      {darkMode ? <SunIcon size={20}/> : <MoonIcon size={20}/>}
    </button>
  </header>
);

const InputForm = ({ onSubmit, isLoading }: { onSubmit: (l: string, d: string, i: boolean) => void, isLoading: boolean }) => {
  const [location, setLocation] = useState('');
  const [date, setDate] = useState('');
  const [genImg, setGenImg] = useState(true);

  return (
    <div className="w-full max-w-2xl px-4 animate-in fade-in slide-in-from-top-6 duration-1000">
      <div className="mb-8 text-center space-y-2">
        <span className="text-red-700 dark:text-red-500 font-black text-[10px] tracking-[0.4em] uppercase">Iniciando protocolo de inmersión</span>
        <h2 className="text-stone-900 dark:text-white text-3xl md:text-5xl font-serif-display font-black leading-tight">¿Qué momento deseas sintonizar?</h2>
      </div>

      <form 
        onSubmit={(e) => { e.preventDefault(); onSubmit(location, date, genImg); }}
        className="bg-white/90 dark:bg-[#0d1321]/90 backdrop-blur-xl p-8 md:p-12 rounded-[2.5rem] border border-stone-200 dark:border-white/5 shadow-[0_20px_50px_rgba(0,0,0,0.1)] space-y-8"
      >
        <div className="space-y-6">
          <div className="relative group">
            <label className="text-[10px] font-black uppercase tracking-widest text-stone-400 dark:text-stone-500 mb-2 block px-2">Lugar o Evento</label>
            <div className="relative">
              <MapPinIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-red-700/40 group-focus-within:text-red-700 transition-colors" size={20} />
              <input 
                required 
                value={location} 
                onChange={e => setLocation(e.target.value)} 
                placeholder="Ej. Grito de Dolores, Palacio Nacional..." 
                className="w-full bg-stone-50 dark:bg-stone-900/50 rounded-2xl py-5 pl-12 pr-6 border-none outline-none focus:ring-2 focus:ring-red-700/50 transition-all text-lg font-medium dark:text-white placeholder:text-stone-300 dark:placeholder:text-stone-600 shadow-inner"
              />
            </div>
          </div>

          <div className="relative group">
            <label className="text-[10px] font-black uppercase tracking-widest text-stone-400 dark:text-stone-500 mb-2 block px-2">Época (Opcional)</label>
            <div className="relative">
              <HistoryIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-red-700/40 group-focus-within:text-red-700 transition-colors" size={20} />
              <input 
                value={date} 
                onChange={e => setDate(e.target.value)} 
                placeholder="Ej. Septiembre de 1810..." 
                className="w-full bg-stone-50 dark:bg-stone-900/50 rounded-2xl py-5 pl-12 pr-6 border-none outline-none focus:ring-2 focus:ring-red-700/50 transition-all text-lg font-medium dark:text-white placeholder:text-stone-300 dark:placeholder:text-stone-600 shadow-inner"
              />
            </div>
          </div>

          <label className="flex items-center gap-3 cursor-pointer group py-2">
            <input 
              type="checkbox" 
              checked={genImg} 
              onChange={e => setGenImg(e.target.checked)} 
              className="w-6 h-6 rounded-lg border-stone-200 dark:border-stone-800 text-red-700 focus:ring-red-700 cursor-pointer bg-white dark:bg-stone-900" 
            />
            <span className="text-sm font-bold text-stone-500 dark:text-stone-400 group-hover:text-red-700 transition-colors">Visualizar protagonistas (Retratos de IA)</span>
          </label>
        </div>

        <button 
          type="submit" 
          disabled={isLoading || !location} 
          className="w-full py-6 rounded-2xl font-black text-xl bg-red-700 hover:bg-red-600 text-white flex items-center justify-center gap-4 transition-all active:scale-[0.98] disabled:opacity-50 shadow-2xl shadow-red-900/30 group overflow-hidden relative"
        >
          <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-500"></div>
          {isLoading ? <Loader2Icon className="animate-spin" size={28} /> : <SparklesIcon size={28} />}
          <span className="relative z-10 uppercase tracking-tighter">Sintonizar Pasado</span>
        </button>
      </form>
    </div>
  );
};

const ScenarioDisplay = ({ scenario, audioBuffer }: { scenario: HistoricalScenario, audioBuffer: AudioBuffer | null }) => {
  const [isPlaying, setIsPlaying] = useState(false);
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

  return (
    <div className="w-full max-w-5xl px-4 py-8 animate-in fade-in zoom-in-[0.98] duration-1000">
      {/* Hero Section */}
      <div className="relative mb-12 rounded-[3rem] overflow-hidden bg-stone-900 text-white p-8 md:p-16 border border-white/10 shadow-2xl">
        <div className="absolute top-0 right-0 w-1/3 h-full bg-gradient-to-l from-red-700/20 to-transparent"></div>
        <div className="relative z-10 max-w-2xl">
          <span className="text-red-500 font-black text-xs tracking-[0.4em] uppercase mb-4 block">Coordenada Temporal Sintonizada</span>
          <h2 className="text-4xl md:text-6xl font-serif-display font-black leading-none mb-6 text-white drop-shadow-lg">
            {scenario.context.split('.')[0]}
          </h2>
          <p className="text-stone-300 text-lg md:text-xl font-medium leading-relaxed italic border-l-4 border-red-700 pl-6 py-2">
            {scenario.context.split('.').slice(1).join('.')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        {/* Left: Characters & Controls */}
        <div className="lg:col-span-5 space-y-8">
          <div className="bg-white/80 dark:bg-[#0d1321]/80 backdrop-blur-xl p-8 rounded-[2.5rem] border border-stone-200 dark:border-white/5 shadow-xl flex flex-col items-center">
            <h3 className="text-stone-400 font-black text-[10px] uppercase tracking-widest mb-6">Frecuencia de Audio</h3>
            <button 
              onClick={togglePlay} 
              className={`w-32 h-32 rounded-full flex items-center justify-center transition-all shadow-2xl ${isPlaying ? 'bg-stone-900 text-white scale-95' : 'bg-red-700 text-white hover:scale-105 active:scale-95'}`}
            >
              {isPlaying ? <PauseIcon size={50} fill="currentColor" /> : <PlayIcon size={50} fill="currentColor" className="ml-2" />}
            </button>
            <div className="mt-6 text-center">
              <p className="text-red-700 dark:text-red-500 font-black text-xs uppercase tracking-widest animate-pulse">
                {isPlaying ? 'Transmitiendo desde el tiempo...' : 'Señal estable'}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="px-4 text-stone-400 font-black text-[10px] uppercase tracking-widest">Protagonistas</h3>
            {scenario.characters.map((char, idx) => (
              <div key={idx} className="bg-white dark:bg-[#0d1321] p-5 rounded-3xl border border-stone-200 dark:border-white/5 flex items-center gap-5 shadow-md hover:shadow-lg transition-shadow">
                <div className="w-20 h-20 rounded-2xl overflow-hidden bg-stone-100 dark:bg-stone-800 ring-2 ring-red-700/20">
                  {char.avatarUrl ? <img src={char.avatarUrl} alt={char.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-stone-300"><UserIcon size={32}/></div>}
                </div>
                <div className="flex-1">
                  <h4 className="font-serif-display font-black text-lg text-stone-900 dark:text-white leading-none mb-1">{char.name}</h4>
                  <p className="text-xs text-stone-500 font-bold uppercase tracking-tighter mb-2">{char.bio}</p>
                  <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-700/10 text-red-700 text-[9px] font-black uppercase">
                    Voz: {char.voice}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Dialogue Script */}
        <div className="lg:col-span-7">
          <div className="bg-white dark:bg-[#0d1321] rounded-[2.5rem] border border-stone-200 dark:border-white/5 overflow-hidden shadow-2xl min-h-[500px] flex flex-col">
            <div className="flex border-b border-stone-100 dark:border-white/5">
              <button 
                onClick={() => setActiveTab('script')} 
                className={`flex-1 py-6 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'script' ? 'text-red-700 border-b-2 border-red-700 bg-red-700/5' : 'text-stone-400 hover:text-stone-600 dark:hover:text-stone-200'}`}
              >
                Transcripción
              </button>
              <button 
                onClick={() => setActiveTab('details')} 
                className={`flex-1 py-6 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'details' ? 'text-red-700 border-b-2 border-red-700 bg-red-700/5' : 'text-stone-400 hover:text-stone-600 dark:hover:text-stone-200'}`}
              >
                Glosario y Fuentes
              </button>
            </div>

            <div className="p-8 flex-1 overflow-y-auto">
              {activeTab === 'script' ? (
                <div className="space-y-12">
                  {scenario.script.map((line, idx) => (
                    <div key={idx} className="space-y-3">
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-px bg-red-700/30"></span>
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-red-700">{line.speaker}</span>
                      </div>
                      <p className="font-serif-display text-2xl md:text-3xl text-stone-900 dark:text-white leading-tight italic">
                        "{line.text}"
                      </p>
                      <p className="text-sm md:text-base text-stone-500 dark:text-stone-400 font-medium pl-6 border-l-2 border-stone-100 dark:border-white/5">
                        {line.translation}
                      </p>
                      {line.annotations && line.annotations.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-2">
                          {line.annotations.map((a, i) => (
                            <div key={i} className="group relative">
                              <span className="text-[10px] font-bold bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 px-3 py-1 rounded-full cursor-help flex items-center gap-1">
                                <InfoIcon size={12}/> {a.phrase}
                              </span>
                              <div className="absolute bottom-full mb-2 left-0 w-48 p-3 bg-stone-900 text-white text-[10px] rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 shadow-2xl border border-white/10">
                                {a.explanation}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-8">
                  <div>
                    <h4 className="text-stone-400 font-black text-[10px] uppercase tracking-widest mb-4">Perfil Lingüístico</h4>
                    <p className="text-stone-700 dark:text-stone-300 text-lg font-medium bg-stone-50 dark:bg-stone-800/50 p-6 rounded-3xl border border-stone-100 dark:border-white/5">
                      {scenario.accentProfile}
                    </p>
                  </div>
                  <div>
                    <h4 className="text-stone-400 font-black text-[10px] uppercase tracking-widest mb-4">Fuentes Consultadas</h4>
                    <div className="space-y-3">
                      {scenario.sources.map((s, i) => (
                        <a 
                          key={i} 
                          href={s.uri} 
                          target="_blank" 
                          rel="noreferrer" 
                          className="flex items-center justify-between p-4 rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-100 dark:border-white/5 hover:border-red-700/30 transition-all group"
                        >
                          <span className="text-sm font-bold text-stone-800 dark:text-stone-200">{s.title}</span>
                          <ChevronRightIcon size={16} className="text-stone-300 group-hover:text-red-700 group-hover:translate-x-1 transition-all" />
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
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

  useEffect(() => {
    if (darkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [darkMode]);

  const handleSubmit = async (loc: string, date: string, genImg: boolean) => {
    setLoading('busy');
    setError(null);
    setScenario(null);
    setAudio(null);

    try {
      const data = await researchHistory(loc, date);
      const audioBuf = await generateAudio(data);
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
      setError("Falla en la sintonización temporal. Verifique su conexión con el presente: " + e.message);
    } finally {
      setLoading('idle');
    }
  };

  return (
    <div className="min-h-screen bg-[#fcfaf7] dark:bg-[#060a13] flex flex-col transition-colors duration-700 font-sans selection:bg-red-200 selection:text-red-900 relative overflow-x-hidden">
      
      {/* Background Ambience */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-red-700/5 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-red-700/5 rounded-full blur-[120px]"></div>
      </div>

      <Header darkMode={darkMode} setDarkMode={setDarkMode} />

      <main className="flex-1 flex flex-col items-center justify-center py-12 relative z-10">
        {!scenario && loading === 'idle' && (
          <InputForm onSubmit={handleSubmit} isLoading={false} />
        )}

        {loading === 'busy' && (
          <div className="flex flex-col items-center justify-center text-center p-8 space-y-8 animate-in fade-in zoom-in duration-700">
            <div className="relative">
              <div className="w-32 h-32 rounded-full border-4 border-red-700/10 border-t-red-700 animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <HistoryIcon className="text-red-700" size={40} />
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-3xl md:text-4xl font-serif-display font-black text-stone-900 dark:text-white uppercase tracking-tighter">Buscando eco en el tiempo</h3>
              <p className="text-stone-400 dark:text-stone-500 font-black text-xs uppercase tracking-[0.3em] animate-pulse">Sintonizando frecuencia histórica...</p>
            </div>
          </div>
        )}

        {scenario && loading === 'idle' && (
          <div className="w-full flex flex-col items-center">
            <ScenarioDisplay scenario={scenario} audioBuffer={audio} />
            <button 
              onClick={() => { setScenario(null); setAudio(null); }} 
              className="mt-12 mb-20 px-10 py-4 bg-stone-900 dark:bg-white text-white dark:text-stone-900 rounded-2xl text-xs font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-2xl"
            >
              Nueva Búsqueda Temporal
            </button>
          </div>
        )}

        {error && (
          <div className="mt-8 max-w-md w-full p-8 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-[2rem] text-center space-y-4">
            <p className="text-red-700 dark:text-red-400 font-bold">{error}</p>
            <button onClick={() => setError(null)} className="w-full py-3 bg-red-700 text-white rounded-xl font-black uppercase tracking-widest text-xs">Reintentar</button>
          </div>
        )}
      </main>

      <footer className="py-12 border-t border-stone-200 dark:border-white/5 relative z-10">
        <div className="container mx-auto px-4 text-center">
          <p className="text-[10px] font-black text-stone-400 dark:text-stone-600 uppercase tracking-[0.4em]">
            © 2025 ET&T Strategies • Tecnologías Turísticas para la Inmersión Histórica
          </p>
        </div>
      </footer>
    </div>
  );
};

export default App;
