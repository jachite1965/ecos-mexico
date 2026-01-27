import React, { useState, useEffect, useRef } from 'react';
import { 
  SparklesIcon, SearchIcon, CalendarIcon, Loader2Icon, 
  PlayIcon, PauseIcon, RotateCcwIcon, UserIcon, 
  EyeIcon, EyeOffIcon, RefreshCwIcon, MoonIcon, SunIcon 
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
  const prompt = `Investiga: "${location}" ${date ? `en ${date}` : ""}. Crea un diálogo de 4-5 líneas en el idioma original de la época (Náhuatl, Maya o Español antiguo) con traducción. JSON: {"context": "Contexto", "characters": [{"name": "N", "gender": "male|female", "voice": "puck|kore|zephyr", "visualDescription": "Desc"}], "script": [{"speaker": "N", "text": "Ori", "translation": "Esp", "annotations": [{"phrase": "p", "explanation": "e"}]}]}`;
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
  if (!base64) throw new Error("Audio fallido.");
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
      contents: { parts: [{ text: `Period portrait: ${desc}. Context: ${ctxText}.` }] }
    });
    const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    return part ? `data:image/png;base64,${part.inlineData.data}` : null;
  } catch { return null; }
}

// --- COMPONENTS ---

const AVAILABLE_VOICES: VoiceName[] = ['achernar', 'achird', 'algenib', 'algieba', 'alnilam', 'aoede', 'charon', 'despina', 'fenrir', 'kore', 'puck', 'zephyr'];

const InputForm = ({ onSubmit, isLoading }: { onSubmit: (l: string, d: string, i: boolean) => void, isLoading: boolean }) => {
  const [location, setLocation] = useState('');
  const [date, setDate] = useState('');
  const [genImg, setGenImg] = useState(true);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(location, date, genImg); }} className="space-y-6 bg-white dark:bg-slate-800/80 p-8 rounded-[2rem] border border-stone-200 dark:border-slate-700 shadow-2xl backdrop-blur-md w-full max-w-xl">
      <div className="space-y-4">
        <div className="relative">
          <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" size={20} />
          <input required value={location} onChange={e => setLocation(e.target.value)} placeholder="Ej. Mercado de Tlatelolco..." className="w-full bg-stone-50 dark:bg-slate-900 rounded-2xl py-4 pl-12 pr-4 outline-none focus:ring-2 focus:ring-red-600 dark:text-white" />
        </div>
        <div className="relative">
          <CalendarIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" size={20} />
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full bg-stone-50 dark:bg-slate-900 rounded-2xl py-4 pl-12 pr-4 outline-none focus:ring-2 focus:ring-red-600 dark:text-white" />
        </div>
        <label className="flex items-center gap-2 cursor-pointer text-sm text-stone-600 dark:text-slate-400">
          <input type="checkbox" checked={genImg} onChange={e => setGenImg(e.target.checked)} className="w-5 h-5 rounded border-stone-300 text-red-600" />
          Generar retratos de época
        </label>
      </div>
      <button type="submit" disabled={isLoading || !location} className="w-full py-4 rounded-2xl font-black bg-red-700 hover:bg-red-600 text-white flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50">
        {isLoading ? <Loader2Icon className="animate-spin" size={24} /> : <SparklesIcon size={24} />}
        {isLoading ? 'SINTONIZANDO...' : 'ESCUCHAR EL PASADO'}
      </button>
    </form>
  );
};

const ScenarioDisplay = ({ scenario, audioBuffer, onRegen }: { scenario: HistoricalScenario, audioBuffer: AudioBuffer | null, onRegen: (s: HistoricalScenario) => void }) => {
  const [isPlaying, setIsPlaying] = useState(false);
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
    <div className="w-full max-w-3xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="bg-white dark:bg-slate-800/80 p-8 rounded-3xl border border-stone-200 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-red-700"></div>
        <h2 className="font-serif-display text-2xl text-red-900 dark:text-red-100 mb-4">📜 Escena Histórica</h2>
        <p className="text-stone-700 dark:text-slate-300 italic mb-8">{scenario.context}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {scenario.characters.map((char, idx) => (
            <div key={idx} className="flex items-center gap-4 bg-stone-50 dark:bg-slate-900/50 p-4 rounded-2xl border border-stone-100 dark:border-slate-800">
              <div className="w-16 h-16 rounded-full bg-stone-200 dark:bg-slate-700 overflow-hidden ring-2 ring-red-700/20">
                {char.avatarUrl ? <img src={char.avatarUrl} alt={char.name} className="w-full h-full object-cover" /> : <UserIcon className="m-auto mt-4 text-stone-400" size={32} />}
              </div>
              <div>
                <p className="font-serif-display font-bold text-red-800 dark:text-red-200">{char.name}</p>
                <p className="text-[10px] text-stone-500 uppercase tracking-tighter">Voz: {char.voice}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col items-center gap-4">
        <button onClick={togglePlay} className="w-24 h-24 rounded-full bg-red-700 text-white shadow-2xl flex items-center justify-center hover:scale-105 active:scale-95 transition-all">
          {isPlaying ? <PauseIcon size={40} fill="currentColor" /> : <PlayIcon size={40} fill="currentColor" className="ml-1" />}
        </button>
        <p className="text-[10px] font-black text-red-700 uppercase tracking-widest">{isPlaying ? 'Escuchando el pasado...' : 'Listo para reproducir'}</p>
      </div>
      <div className="space-y-6">
        {scenario.script.map((line, idx) => (
          <div key={idx} className={`flex flex-col ${idx % 2 === 0 ? 'items-start' : 'items-end'}`}>
            <div className={`bg-white dark:bg-slate-800/50 p-6 rounded-2xl border border-stone-100 dark:border-slate-700 max-w-[85%] shadow-sm ${idx % 2 === 0 ? 'rounded-bl-none' : 'rounded-br-none text-right'}`}>
              <p className="text-[10px] font-bold text-red-700 mb-1">{line.speaker}</p>
              <p className="font-serif-display text-xl leading-tight mb-1">"{line.text}"</p>
              <p className="text-xs text-stone-500 italic">{line.translation}</p>
            </div>
          </div>
        ))}
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

  const handleSubmit = async (loc: string, date: string, genImg: boolean, updated?: HistoricalScenario) => {
    setLoading('busy');
    setError(null);
    if (!updated) setScenario(null);
    setAudio(null);

    try {
      const data = updated || await researchHistory(loc, date);
      const audioBuf = await generateAudio(data);
      let dataWithImgs = data;
      if (genImg && !updated) {
        const chars = await Promise.all(data.characters.map(async c => ({ ...c, avatarUrl: await generateAvatar(c.visualDescription || c.name, data.context) || undefined })));
        dataWithImgs = { ...data, characters: chars };
      }
      setScenario(dataWithImgs);
      setAudio(audioBuf);
    } catch (e: any) {
      setError("Error al conectar con la época: " + e.message);
    } finally {
      setLoading('idle');
    }
  };

  return (
    <div className="min-h-screen bg-[#fcfaf7] dark:bg-[#060a13] flex flex-col transition-colors duration-500">
      <header className="p-4 border-b border-stone-200 dark:border-slate-800 flex justify-between items-center bg-white/80 dark:bg-black/80 backdrop-blur sticky top-0 z-50">
        <div className="flex flex-col"><span className="text-xl font-mono font-black text-red-700">ET&T</span><span className="text-[8px] uppercase font-bold text-stone-500">Historical Experience</span></div>
        <h1 className="font-serif-display text-lg md:text-2xl font-black text-red-800 tracking-tighter">ECOS DE MÉXICO</h1>
        <button onClick={() => setDarkMode(!darkMode)} className="p-2 rounded-full border border-stone-200 dark:border-slate-700 text-stone-500">{darkMode ? <SunIcon size={18}/> : <MoonIcon size={18}/>}</button>
      </header>

      <main className="container mx-auto px-4 py-12 flex flex-col items-center">
        {!scenario || loading === 'busy' ? (
          <InputForm onSubmit={handleSubmit} isLoading={loading === 'busy'} />
        ) : (
          <div className="w-full flex flex-col items-center">
            <ScenarioDisplay scenario={scenario} audioBuffer={audio} onRegen={(s) => handleSubmit("", "", false, s)} />
            <button onClick={() => setScenario(null)} className="mt-12 bg-stone-200 dark:bg-slate-800 px-6 py-2 rounded-full text-xs font-bold hover:bg-red-700 hover:text-white transition-all">NUEVA BÚSQUEDA</button>
          </div>
        )}
        {error && <p className="mt-8 text-red-600 font-bold bg-red-50 p-4 rounded-xl border border-red-200">{error}</p>}
      </main>

      {loading === 'busy' && (
        <div className="fixed inset-0 bg-white/90 dark:bg-black/90 z-[100] flex flex-col items-center justify-center text-center">
          <Loader2Icon size={48} className="text-red-700 animate-spin mb-4" />
          <p className="font-serif-display text-2xl text-red-900 dark:text-red-100">Consultando los anales del tiempo...</p>
        </div>
      )}
    </div>
  );
};

export default App;
