
import React, { useState, useEffect, useRef } from 'react';
import { UserProfile, TextbookContent, QuestionEntry, AgentPersona } from '../types';
import { addQuestion, getStudentHistory, getStudentStats, getStudentTextbooks, addStudentTextbook, getPulseTasks, addOrUpdateUser } from '../services/storageService';
import { getLiveSystemInstruction, generateTextAnswer, getGeminiInstance, categorizeQuestion, generateSpeech } from '../services/geminiService';
import { decode, encode, decodeAudioData } from '../services/audioService';
import { extractTextFromPdf, ExtractionProgress } from '../services/pdfService';
import { LiveServerMessage, Modality } from '@google/genai';

interface StudentViewProps {
  user: UserProfile;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const StudentView: React.FC<StudentViewProps> = ({ user, activeTab, setActiveTab }) => {
  const [messages, setMessages] = useState<{ role: 'user' | 'bot'; text: string; grounded?: boolean; style?: string; timestamp?: number; isSimilarityHit?: boolean; source?: 'textbook' | 'general' | 'vision'; persona?: AgentPersona }[]>([]);
  const [textInput, setTextInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [textbooks, setTextbooks] = useState<TextbookContent[]>([]);
  const [showTextChat, setShowTextChat] = useState(false);
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [persona, setPersona] = useState<AgentPersona>(user.preferredPersona || 'NORMAL');
  const [pulseTasks, setPulseTasks] = useState<QuestionEntry[]>([]);
  
  const sessionStartTimeRef = useRef<number>(Date.now());
  
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const chatEndRef = useRef<HTMLDivElement>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');

  useEffect(() => {
    const tbs = getStudentTextbooks(user.id);
    setTextbooks(tbs);
    const history = getStudentHistory(user.id);
    const chatMsgs: any[] = [];
    history.forEach(h => {
      chatMsgs.push({ role: 'user', text: h.question, timestamp: h.timestamp });
      chatMsgs.push({ role: 'bot', text: h.answer, grounded: h.source === 'textbook', style: h.explanationStyle, timestamp: h.timestamp, isSimilarityHit: h.isRepetition, source: h.source, persona: h.persona });
    });
    setMessages(chatMsgs);
    setPulseTasks(getPulseTasks(user.id));
    return () => { stopLiveSession(); };
  }, [user.id, activeTab]);

  useEffect(() => {
    if (showTextChat && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, showTextChat]);

  const handlePersonaChange = (newP: AgentPersona) => {
    setPersona(newP);
    addOrUpdateUser({ ...user, preferredPersona: newP });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploadProgress("Preparing document...");
      let text = "";
      if (file.type === 'application/pdf') {
        text = await extractTextFromPdf(file, (p: ExtractionProgress) => {
          const status = p.type === 'ocr' ? 'Scanning Vision' : 'Indexing';
          setUploadProgress(`${status}: ${p.percentage}%`);
        });
      } else {
        text = await file.text();
      }
      addStudentTextbook(user.id, { id: Date.now().toString(), name: file.name, content: text });
      setTextbooks(getStudentTextbooks(user.id));
      setUploadProgress(null);
    } catch (err: any) { 
      alert("Error: " + err.message); 
      setUploadProgress(null); 
    }
  };

  const initOutputContext = () => {
    if (!outputAudioContextRef.current) {
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    if (outputAudioContextRef.current.state === 'suspended') {
      outputAudioContextRef.current.resume();
    }
    return outputAudioContextRef.current;
  };

  const clearSpeechQueue = () => {
    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setIsSpeaking(false);
  };

  const startLiveSession = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert("Microphone not supported.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = initOutputContext();
      await inputCtx.resume();
      await outputCtx.resume();
      inputAudioContextRef.current = inputCtx;

      const ai = getGeminiInstance();
      const stats = getStudentStats(user.id);
      const textbookCtxString = textbooks.map(t => t.content).join("\n").substring(0, 40000);
      const instruction = getLiveSystemInstruction(user.name, stats.strugglingTopics.map(t => t.topic), textbookCtxString, persona);

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setIsLiveActive(true);
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              if (inputCtx.state === 'closed') return;
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                int16[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
              }
              const pcmBlob = { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
              sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob })).catch(() => {});
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (m: LiveServerMessage) => {
            if (m.serverContent?.interrupted) {
              clearSpeechQueue();
              return;
            }
            if (m.serverContent?.inputTranscription) currentInputTranscriptionRef.current += m.serverContent.inputTranscription.text;
            if (m.serverContent?.outputTranscription) currentOutputTranscriptionRef.current += m.serverContent.outputTranscription.text;
            
            const b64 = m.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (b64 && outputCtx && outputCtx.state !== 'closed') {
              const buffer = await decodeAudioData(decode(b64), outputCtx, 24000, 1);
              const now = outputCtx.currentTime;
              if (nextStartTimeRef.current < now) nextStartTimeRef.current = now + 0.1;
              const source = outputCtx.createBufferSource();
              source.buffer = buffer;
              source.connect(outputCtx.destination);
              source.onended = () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) setIsSpeaking(false);
              };
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(source);
              setIsSpeaking(true);
            }
            if (m.serverContent?.turnComplete) {
              const q = currentInputTranscriptionRef.current.trim();
              const a = currentOutputTranscriptionRef.current.trim();
              if (q && a) {
                const topic = await categorizeQuestion(q);
                addQuestion({ id: Date.now().toString(), studentId: user.id, question: q, answer: a, topic, subject: 'Voice', timestamp: Date.now(), source: 'general', persona: persona });
                setMessages(prev => [...prev, { role: 'user', text: q, timestamp: Date.now() }, { role: 'bot', text: a, persona: persona, timestamp: Date.now() }]);
              }
              currentInputTranscriptionRef.current = '';
              currentOutputTranscriptionRef.current = '';
            }
          },
          onclose: () => stopLiveSession(),
          onerror: () => stopLiveSession(),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: instruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e: any) {
      alert("Voice failed.");
      stopLiveSession();
    }
  };

  const stopLiveSession = () => {
    setIsLiveActive(false); 
    if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
    if (sessionRef.current) { try { sessionRef.current.close(); } catch (e) {} sessionRef.current = null; }
    if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') { inputAudioContextRef.current.close().catch(() => {}); inputAudioContextRef.current = null; }
    clearSpeechQueue();
  };

  const handleSendText = async () => {
    if (!textInput.trim() || loading) return;
    const q = textInput; setTextInput('');
    setMessages(prev => [...prev, { role: 'user', text: q, timestamp: Date.now() }]);
    setLoading(true);
    try {
      const result = await generateTextAnswer(user, q, textbooks, persona);
      addQuestion({ 
        id: Date.now().toString(), 
        studentId: user.id, 
        question: q, 
        answer: result.text, 
        topic: result.topic, 
        subject: 'Academic', 
        timestamp: Date.now(), 
        source: result.source,
        persona: persona
      });
      setMessages(prev => [...prev, { role: 'bot', text: result.text, grounded: result.source === 'textbook', timestamp: Date.now(), source: result.source, persona: persona }]);
    } catch (err) { 
      console.error(err); 
    } finally { 
      setLoading(false); 
    }
  };

  if (activeTab === 'dash') {
    const stats = getStudentStats(user.id);
    return (
      <div className="space-y-12 animate-fadeIn pb-20 max-w-4xl mx-auto">
        <header className="flex flex-col gap-2 text-center items-center">
          <h2 className="text-6xl font-black text-slate-900 tracking-tighter uppercase">Learning Hub</h2>
        </header>

        {pulseTasks.length > 0 && (
          <div className="bg-amber-50 p-10 rounded-[60px] border-2 border-amber-200 shadow-xl">
            <div className="flex items-center gap-6 mb-8">
              <div className="w-12 h-12 bg-amber-200 rounded-2xl flex items-center justify-center text-2xl">⚡</div>
              <h3 className="text-2xl font-black text-amber-900 uppercase tracking-tight">Study Pulse</h3>
            </div>
            <div className="space-y-4">
              {pulseTasks.map((task, i) => (
                <div key={i} onClick={() => { setTextInput(`Can we review ${task.topic}?`); setActiveTab('learn'); setShowTextChat(true); }} className="bg-white p-6 rounded-3xl border border-amber-100 flex justify-between items-center cursor-pointer hover:bg-amber-50 transition-all">
                  <p className="font-bold text-slate-800">{task.topic}</p>
                  <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Review Now</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {stats.strugglingTopics.length > 0 && (
          <div className="bg-white p-16 rounded-[80px] shadow-2xl border-4 border-red-50 relative overflow-hidden">
             <div className="absolute top-0 right-0 w-64 h-64 bg-red-50 rounded-full -mr-32 -mt-32 opacity-50"></div>
             <div className="flex items-center gap-6 mb-12 relative">
                <div className="w-16 h-16 bg-red-100 text-red-600 rounded-[24px] flex items-center justify-center text-3xl">🚀</div>
                <div>
                  <h3 className="text-3xl font-black text-slate-900 tracking-tight uppercase">Improvement Roadmap</h3>
                  <p className="text-[10px] font-black text-red-400 uppercase tracking-widest mt-1">Critical Focus Areas</p>
                </div>
             </div>
             
             <div className="space-y-8 relative">
                {stats.strugglingTopics.slice(0, 3).map((t, idx) => (
                  <div key={idx} className="bg-slate-50 p-8 rounded-[40px] border border-slate-100 flex flex-col gap-4">
                    <div className="flex justify-between items-center">
                      <p className="text-xl font-black text-slate-900 uppercase">{t.topic}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-black text-slate-400 uppercase">Focus Level</span>
                        <div className="flex gap-1">
                          {[1,2,3].map(i => (
                            <div key={i} className={`w-4 h-2 rounded-full ${i <= (t.repeatCount || 1) ? 'bg-red-500' : 'bg-slate-200'}`}></div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-slate-500 font-medium leading-relaxed">
                      <span className="font-bold text-red-600 uppercase text-[10px] mr-2">Path to Mastery:</span> 
                      Try asking Murshid to explain this using the <strong>LOGIC AGENT</strong> for a clearer step-by-step breakdown.
                    </p>
                  </div>
                ))}
             </div>
          </div>
        )}

        <div className="bg-white p-16 rounded-[80px] shadow-sm border border-slate-100">
          <div className="flex items-center gap-6 mb-12">
            <div className="w-16 h-16 bg-amber-100 rounded-[24px] flex items-center justify-center text-3xl">🎯</div>
            <h3 className="text-3xl font-black text-slate-900 tracking-tight uppercase">Topic Mastery</h3>
          </div>
          <div className="space-y-6">
            {stats.strugglingTopics.length > 0 ? stats.strugglingTopics.map((t, idx) => (
              <div key={idx} className="bg-slate-50 p-10 rounded-[40px] border border-slate-100 flex justify-between items-center group transition-all">
                <p className="text-2xl font-black text-slate-900 uppercase">{t.topic}</p>
                <p className="text-sm font-bold text-slate-400 uppercase">Asked {t.repeatCount}x</p>
              </div>
            )) : <p className="text-slate-400 font-bold uppercase tracking-widest text-center py-10">Start learning to see insights!</p>}
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'learn') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[750px] bg-white rounded-[100px] p-20 shadow-2xl relative border border-slate-50 overflow-hidden">
        
        <div className="absolute top-10 left-10 right-10 flex justify-between items-center">
          <div className="flex bg-slate-100 p-1 rounded-full border border-slate-200">
            {(['NORMAL', 'SOCRATIC', 'STORYTELLER', 'SCIENTIST', 'LOGIC_HEAVY'] as AgentPersona[]).map(p => (
              <button 
                key={p} onClick={() => handlePersonaChange(p)}
                className={`px-4 py-2 rounded-full text-[9px] font-black uppercase tracking-widest transition-all ${persona === p ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                {p === 'LOGIC_HEAVY' ? 'LOGIC' : p}
              </button>
            ))}
          </div>
        </div>

        {(isLiveActive || isSpeaking) && (
          <div className="absolute top-28 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-red-600 text-white px-8 py-4 rounded-full shadow-2xl animate-pulse z-50">
            <span className="w-3 h-3 bg-white rounded-full"></span>
            <span className="text-sm font-black uppercase tracking-widest">{isSpeaking ? 'MURSHID IS SPEAKING...' : 'LISTENING...'}</span>
          </div>
        )}

        <div className="flex flex-col items-center space-y-16 w-full max-w-2xl">
          <div className={`w-80 h-80 bg-slate-50 rounded-[80px] flex items-center justify-center relative transition-all duration-700 ${isLiveActive || isSpeaking ? 'scale-110 shadow-2xl bg-white ring-8 ring-red-50' : 'shadow-inner'}`}>
             {isSpeaking ? (
               <div className="flex items-end gap-2 h-32">
                 {[1,2,3,4,5,6].map(i => <div key={i} className="w-3 bg-blue-600 rounded-full animate-bounce" style={{ height: `${40 + Math.random()*60}%`, animationDelay: `${i*0.1}s` }}></div>)}
               </div>
             ) : (
               <div className={`text-9xl transition-all duration-500 ${isLiveActive ? 'scale-125' : 'opacity-10'}`}>🎙️</div>
             )}
             {uploadProgress && (
               <div className="absolute -bottom-16 bg-slate-900 text-white text-[10px] font-black px-8 py-3 rounded-full shadow-2xl z-20 uppercase tracking-widest">{uploadProgress}</div>
             )}
          </div>
          <div className="text-center space-y-4">
             <h2 className="text-5xl font-black text-slate-900 uppercase">Study Room</h2>
             <p className="text-slate-400 font-bold uppercase text-[10px] tracking-widest italic">Active Mode: {persona}</p>
          </div>
          <div className="grid grid-cols-2 gap-8 w-full">
            <button onClick={isLiveActive ? stopLiveSession : startLiveSession} className={`w-full h-32 rounded-[45px] font-black uppercase shadow-2xl transition-all ${isLiveActive ? 'bg-red-600 text-white' : 'bg-slate-900 text-white hover:scale-[1.02]'}`}>
              {isLiveActive ? 'End Call' : 'Start Voice'}
            </button>
            <button onClick={() => { if(isLiveActive) stopLiveSession(); setShowTextChat(true); }} className="w-full h-32 bg-blue-600 text-white rounded-[45px] font-black uppercase shadow-2xl hover:scale-105 transition-all">
              Text Mode
            </button>
          </div>
          <div className="pt-8 w-full flex justify-center">
             <label className="flex items-center gap-4 px-10 py-6 bg-slate-50 border border-slate-100 text-slate-500 rounded-full font-black text-[10px] uppercase tracking-widest cursor-pointer hover:bg-slate-100 transition-all shadow-sm">
                <span>📁 Upload Textbook (PDF)</span>
                <input type="file" className="hidden" accept=".pdf,.txt" onChange={handleFileUpload} />
             </label>
          </div>
        </div>

        {showTextChat && (
          <div className="absolute inset-0 bg-white z-50 flex flex-col p-12 rounded-[100px] animate-fadeIn">
            <div className="flex justify-between items-center mb-8 px-6">
              <h3 className="text-3xl font-black text-slate-900 uppercase tracking-tighter">Knowledge Lab</h3>
              <button onClick={() => setShowTextChat(false)} className="w-14 h-14 bg-slate-50 rounded-full flex items-center justify-center text-slate-300 hover:text-red-500 transition-all font-black text-xl">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-10 px-6 no-scrollbar">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] p-10 rounded-[50px] relative shadow-lg ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-50 text-slate-900 border border-slate-100'}`}>
                    <p className="text-xl font-medium leading-relaxed">{m.text}</p>
                    {m.persona && <span className="block mt-4 text-[9px] uppercase font-black opacity-40">{m.persona} AGENT</span>}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="mt-12 flex gap-4 max-w-4xl mx-auto w-full">
              <input type="text" value={textInput} onChange={e => setTextInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendText()} placeholder={`Ask ${persona}...`} className="flex-1 h-24 px-12 bg-slate-100 rounded-[50px] text-xl font-medium outline-none focus:ring-4 focus:ring-blue-50" />
              <button onClick={handleSendText} className="w-24 h-24 bg-blue-600 text-white rounded-full flex items-center justify-center text-3xl shadow-xl hover:scale-105 transition-all">➜</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (activeTab === 'history') {
    const history = getStudentHistory(user.id);
    const sessionHistory = history.filter(h => h.timestamp >= sessionStartTimeRef.current).reverse();
    const olderHistory = history.filter(h => h.timestamp < sessionStartTimeRef.current).reverse();

    return (
      <div className="space-y-12 animate-fadeIn max-w-5xl mx-auto pb-32">
        <header className="flex flex-col gap-2">
          <h2 className="text-5xl font-black text-slate-900 tracking-tighter uppercase italic">Question Bank</h2>
          <p className="text-slate-400 font-black uppercase text-[10px] tracking-[0.4em]">History</p>
        </header>

        {sessionHistory.length > 0 && (
          <section className="space-y-8">
            <div className="flex items-center gap-4">
               <span className="w-3 h-3 bg-blue-600 rounded-full animate-pulse"></span>
               <h3 className="text-xl font-black text-blue-600 uppercase tracking-widest">Recently Asked</h3>
            </div>
            <div className="grid grid-cols-1 gap-10">
              {sessionHistory.map(entry => (
                <HistoryCard key={entry.id} entry={entry} isRecent />
              ))}
            </div>
            <div className="h-px bg-slate-200 my-16"></div>
          </section>
        )}

        <section className="space-y-8">
          {olderHistory.length > 0 && (
            <h3 className="text-xl font-black text-slate-400 uppercase tracking-widest mb-10">Previous Lessons</h3>
          )}
          <div className="space-y-10">
            {olderHistory.length > 0 ? olderHistory.map(entry => (
              <HistoryCard key={entry.id} entry={entry} />
            )) : sessionHistory.length === 0 && (
              <div className="text-center py-24 bg-white rounded-[60px] border-2 border-dashed border-slate-100">
                 <p className="text-slate-400 font-black uppercase tracking-[0.2em]">No history yet.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }

  return null;
};

const HistoryCard: React.FC<{ entry: QuestionEntry; isRecent?: boolean }> = ({ entry, isRecent }) => (
  <div className={`bg-white p-12 rounded-[60px] border border-slate-100 shadow-sm relative overflow-hidden group transition-all ${isRecent ? 'ring-4 ring-blue-50 border-blue-100' : ''}`}>
     <div className={`absolute top-0 left-0 w-2 h-full ${isRecent ? 'bg-blue-600' : 'bg-slate-300 opacity-20'} group-hover:opacity-100 transition-opacity`}></div>
     <div className="flex justify-between items-start mb-6">
       <div className="flex gap-3">
          <span className={`${isRecent ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-600'} px-6 py-2 rounded-full text-[9px] font-black uppercase tracking-widest shadow-sm`}>
            {entry.topic}
          </span>
       </div>
       <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">{new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
     </div>
     <p className="text-2xl font-bold text-slate-900 mb-8">"{entry.question}"</p>
     <div className={`p-10 rounded-[40px] border ${isRecent ? 'bg-blue-50/30 border-blue-50' : 'bg-slate-50 border-slate-50'}`}>
        <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Murshid ({entry.persona || 'NORMAL'})</p>
        <p className="text-lg text-slate-600 leading-relaxed font-medium">{entry.answer}</p>
     </div>
  </div>
);

export default StudentView;
