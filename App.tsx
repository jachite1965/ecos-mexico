
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useEffect } from 'react';
import { InputForm } from './components/InputForm';
import { ScenarioDisplay } from './components/ScenarioDisplay';
import { researchLocationAndDate, generateDialogueAudio, generateCharacterAvatar } from './services/geminiService';
import { HistoricalScenario } from './types';
import { Loader2Icon, MoonIcon, SunIcon } from 'lucide-react';

const LogoETT = () => (
  <div className="flex flex-col items-start md:items-center scale-[0.75] md:scale-100 origin-left">
    <span className="text-xl md:text-3xl font-mono font-black tracking-tighter text-red-700 dark:text-red-500">
      ET&T
    </span>
    <span className="text-[7px] md:text-[9px] font-bold tracking-[0.1em] text-stone-500 dark:text-slate-400 uppercase text-center -mt-1 leading-tight">
      Estrategias Turísticas y Tecnológicas S.C
    </span>
  </div>
);

const App: React.FC = () => {
  const [loadingStep, setLoadingStep] = useState<'idle' | 'researching' | 'generating_media' | 'regenerating_audio'>('idle');
  const [scenario, setScenario] = useState<HistoricalScenario | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') setIsDarkMode(true);
  }, []);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  const handleSubmit = async (location: string, date: string, generateImages: boolean) => {
    setLoadingStep('researching');
    setError(null);
    setScenario(null);
    setAudioBuffer(null);

    try {
      const scenarioData = await researchLocationAndDate(location, date);
      setLoadingStep('generating_media');

      const audioPromise = generateDialogueAudio(scenarioData);
      const imagesPromise = (async () => {
         if (!generateImages) return scenarioData;
         const updatedChars = await Promise.all(scenarioData.characters.map(async (char) => {
             if (char.visualDescription) {
                 const url = await generateCharacterAvatar(char.visualDescription, scenarioData.context);
                 return { ...char, avatarUrl: url || undefined };
             }
             return char;
         }));
         return { ...scenarioData, characters: updatedChars };
      })();

      const [buffer, scenarioWithImages] = await Promise.all([audioPromise, imagesPromise]);
      setAudioBuffer(buffer);
      setScenario(scenarioWithImages);
      setLoadingStep('idle');
    } catch (err: any) {
      setError(err.message || "No pudimos conectar con la época seleccionada. Intente de nuevo.");
      setLoadingStep('idle');
    }
  };

  return (
    <div className="min-h-screen bg-[#fcfaf7] dark:bg-[#060a13] text-stone-900 dark:text-slate-200 flex flex-col transition-colors duration-500 font-sans overflow-x-hidden">
      
      <div className="mist-container">
        <div className="mist-layer"></div>
        <div className="mist-layer"></div>
      </div>

      <header className="py-2 md:py-6 px-4 md:px-6 border-b border-stone-200 dark:border-slate-800 bg-white/90 dark:bg-[#060a13]/90 sticky top-0 z-50 backdrop-blur-xl">
        <div className="container mx-auto flex justify-between items-center max-w-5xl">
            <LogoETT />
            
            <h1 className="hidden sm:block font-serif-display text-xl md:text-3xl font-black text-red-800 dark:text-red-600 tracking-tighter">
              ECOS DE MÉXICO
            </h1>

            <div className="flex items-center gap-2">
              <h1 className="sm:hidden font-serif-display text-xs font-black text-red-800 dark:text-red-600 tracking-tighter mr-1 uppercase">
                ECOS DE MÉXICO
              </h1>
              <button 
                  onClick={() => setIsDarkMode(!isDarkMode)}
                  className="p-1.5 md:p-2 rounded-full hover:bg-stone-100 dark:hover:bg-slate-800 text-stone-500 border border-stone-200 dark:border-slate-700 transition-all active:scale-90"
                  aria-label="Cambiar tema"
              >
                  {isDarkMode ? <SunIcon size={16} /> : <MoonIcon size={16} />}
              </button>
            </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 md:py-12 flex flex-col items-center flex-grow relative z-10 max-w-5xl">
        {!scenario || loadingStep !== 'idle' ? (
            <div className="w-full max-w-xl mx-auto space-y-8 animate-in fade-in slide-in-from-top-4 duration-1000">
              <div className="text-center space-y-2">
                <p className="text-stone-500 dark:text-slate-400 text-[9px] md:text-xs font-black tracking-[0.3em] uppercase">Audioguía de Inmersión Histórica</p>
                <div className="h-1 w-12 bg-red-700 mx-auto rounded-full"></div>
              </div>
              <InputForm onSubmit={handleSubmit} isLoading={loadingStep !== 'idle'} />
            </div>
        ) : (
          <div className="w-full animate-in fade-in zoom-in-[0.98] duration-700 pb-24">
             <ScenarioDisplay 
                scenario={scenario} 
                audioBuffer={audioBuffer} 
                onRegenerateAudio={(s) => handleSubmit(s.context, "", false)}
                isRegenerating={loadingStep === 'regenerating_audio'}
             />
             <button 
                onClick={() => { setScenario(null); setAudioBuffer(null); }}
                className="fixed bottom-6 right-6 bg-red-700 text-white w-14 h-14 md:w-16 md:h-16 rounded-full shadow-2xl flex items-center justify-center hover:scale-110 active:scale-90 transition-all z-50 group border-4 border-white dark:border-slate-900"
             >
                <span className="text-2xl group-hover:rotate-12 transition-transform">🔎</span>
             </button>
          </div>
        )}

        {loadingStep !== 'idle' && (
          <div className="fixed inset-0 bg-stone-100/95 dark:bg-black/95 backdrop-blur-md z-[100] flex flex-col items-center justify-center text-center p-6">
            <Loader2Icon size={64} className="text-red-700 animate-spin mb-6" />
            <p className="text-xl md:text-3xl font-serif-display text-red-900 dark:text-red-100 animate-pulse font-bold">
                {loadingStep === 'researching' ? 'Consultando los anales del tiempo...' : 'Recreando la atmósfera sonora...'}
            </p>
            <p className="mt-4 text-stone-500 text-sm italic font-medium">Experiencia ET&T Historical</p>
          </div>
        )}

        {error && (
          <div className="mt-8 bg-white dark:bg-red-950/20 border-2 border-red-200 p-8 rounded-[2rem] text-center max-w-md w-full shadow-2xl">
            <div className="text-4xl mb-4">📜</div>
            <p className="text-red-800 dark:text-red-200 font-bold mb-6 text-lg">{error}</p>
            <button 
              onClick={() => setError(null)} 
              className="w-full bg-red-700 hover:bg-red-800 text-white py-4 rounded-xl font-bold shadow-lg transition-all active:scale-95"
            >
              Intentar de nuevo
            </button>
          </div>
        )}
      </main>

      <footer className="w-full py-8 border-t border-stone-200 dark:border-slate-800 bg-white/50 dark:bg-[#03060c] mt-auto">
        <div className="container mx-auto text-center px-4">
          <p className="text-[8px] md:text-[11px] text-stone-400 dark:text-slate-600 uppercase tracking-[0.3em] font-black">
            © 2025 ET&T • Estrategias Turísticas y Tecnológicas S.C
          </p>
        </div>
      </footer>
    </div>
  );
};

export default App;
