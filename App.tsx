
import React, { useState, useEffect, useRef } from 'react';
import { 
  SparklesIcon, Loader2Icon, MoonIcon, SunIcon, 
  MapPinIcon, HistoryIcon, AlertCircleIcon
} from 'lucide-react';
import { researchLocationAndLanguage, generateDialogueAudio, generateCharacterAvatar } from './services/geminiService';
import { HistoricalScenario } from './types';
import { InputForm } from './components/InputForm';
import { ScenarioDisplay } from './components/ScenarioDisplay';

export default function App() {
  const [loading, setLoading] = useState<'idle' | 'busy' | 'media'>('idle');
  const [scenario, setScenario] = useState<HistoricalScenario | null>(null);
  const [audio, setAudio] = useState<AudioBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(false);

  const handleSearch = async (loc: string, language: string, withImages: boolean) => {
    setLoading('busy');
    setError(null);
    setScenario(null);
    setAudio(null);
    
    try {
      // Paso 1: Investigación por lugar e idioma
      const data = await researchLocationAndLanguage(loc, language);
      setScenario(data);
      setLoading('media');

      // Paso 2: Carga de medios
      const audioPromise = generateDialogueAudio(data).then(setAudio);
      
      const imagePromises = withImages ? data.characters.map(async (c, i) => {
        const url = await generateCharacterAvatar(c.visualDescription || c.name);
        if (url) {
          setScenario(prev => {
            if (!prev) return null;
            const newChars = [...prev.characters];
            newChars[i] = { ...newChars[i], avatarUrl: url };
            return { ...prev, characters: newChars };
          });
        }
      }) : [];

      await Promise.allSettled([audioPromise, ...imagePromises]);
      setLoading('idle');
    } catch (e: any) {
      console.error(e);
      setError("La frecuencia histórica es inestable. Asegúrate de que el lugar sea válido en México.");
      setLoading('idle');
    }
  };

  return (
    <div className={`${darkMode ? 'dark' : ''} min-h-screen bg-[#fcfaf7] dark:bg-[#060a13] text-stone-900 dark:text-stone-100 transition-colors duration-500`}>
      <header className="border-b border-stone-200 dark:border-white/5 py-4 px-6 flex justify-between items-center glass sticky top-0 z-50">
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
          <div className="flex flex-col items-center gap-12 py-12 animate-in fade-in">
            <div className="text-center space-y-4">
              <span className="text-red-700 font-black text-[10px] uppercase tracking-[0.4em]">Sintonizador de Patrimonio Nacional</span>
              <h2 className="text-4xl md:text-6xl font-serif font-black leading-tight">¿Qué lugar deseas sintonizar?</h2>
            </div>
            <InputForm onSubmit={handleSearch} isLoading={false} />
          </div>
        )}

        {loading === 'busy' && (
          <div className="flex flex-col items-center justify-center py-32 space-y-8 animate-pulse">
            <div className="w-20 h-20 border-4 border-red-700/10 border-t-red-700 animate-spin rounded-full"></div>
            <div className="text-center">
              <p className="font-serif font-black text-2xl uppercase tracking-widest">Localizando en el tiempo...</p>
              <p className="text-stone-400 text-xs mt-2 uppercase tracking-widest font-bold">Traduciendo frecuencias históricas</p>
            </div>
          </div>
        )}

        {scenario && (
          <div className="space-y-12 animate-in fade-in slide-in-from-bottom-6 duration-700">
            <ScenarioDisplay 
              scenario={scenario} 
              audioBuffer={audio} 
              isRegenerating={loading === 'media'} 
            />
            
            <div className="flex justify-center pb-20">
              <button 
                onClick={() => { setScenario(null); setAudio(null); }}
                className="px-12 py-5 bg-stone-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] shadow-2xl hover:scale-105 active:scale-95 transition-all"
              >
                Nueva Sintonía Temporal
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="max-w-md mx-auto p-12 glass border-2 border-red-700/20 rounded-[3rem] text-center space-y-6 shadow-2xl">
            <AlertCircleIcon className="mx-auto text-red-700" size={48} />
            <p className="text-stone-800 dark:text-stone-200 font-bold text-lg leading-tight">{error}</p>
            <button onClick={() => setError(null)} className="w-full py-4 bg-red-700 text-white rounded-xl font-black text-xs uppercase tracking-widest">Reintentar</button>
          </div>
        )}
      </main>
    </div>
  );
}
