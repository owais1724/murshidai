
import React, { useState, useEffect } from 'react';
import { UserProfile, UserRole, StudentStats, QuestionEntry } from '../types';
import { getAppData, getStudentHistory, getStudentStats } from '../services/storageService';
import { getProfileInsights } from '../services/geminiService';

interface AdminViewProps {
  user: UserProfile;
  activeTab: string;
}

const AdminView: React.FC<AdminViewProps> = ({ user, activeTab }) => {
  const [students, setStudents] = useState<UserProfile[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<UserProfile | null>(null);
  const [profileAnalysis, setProfileAnalysis] = useState('');
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [history, setHistory] = useState<QuestionEntry[]>([]);

  useEffect(() => {
    const data = getAppData();
    if (user.role === UserRole.TEACHER) {
      setStudents(data.users.filter(u => u.role === UserRole.STUDENT));
    } else if (user.role === UserRole.PARENT) {
      const child = data.users.find(u => u.id === user.parentId);
      setStudents(child ? [child] : []);
    }
  }, [user]);

  const categorizeStudent = (stats: StudentStats) => {
    const totalQs = stats.totalQuestions;
    const struggles = stats.strugglingTopics.length;

    if (totalQs === 0) return { label: 'New', color: 'bg-slate-100 text-slate-500 border-slate-200' };
    if (struggles <= 1) return { label: 'Good', color: 'bg-green-100 text-green-700 border-green-200' };
    if (struggles >= 4) return { label: 'Needs Help', color: 'bg-red-100 text-red-700 border-red-200' };
    return { label: 'Average', color: 'bg-amber-100 text-amber-700 border-amber-200' };
  };

  const analyzeStudent = async (student: UserProfile) => {
    setSelectedStudent(student);
    setLoadingAnalysis(true);
    const studentHistory = getStudentHistory(student.id);
    setHistory(studentHistory);
    const analysis = await getProfileInsights(studentHistory, false);
    setProfileAnalysis(analysis);
    setLoadingAnalysis(false);
  };

  if (activeTab === 'dash' || activeTab === 'insights' || activeTab === 'students') {
    return (
      <div className="space-y-12 animate-fadeIn pb-32">
        <header className="flex flex-col gap-2">
          <h2 className="text-5xl font-black text-slate-900 tracking-tighter uppercase">
            {user.role === UserRole.TEACHER ? 'Educator Dashboard' : 'Parent Observation'}
          </h2>
          <p className="text-slate-400 font-bold uppercase text-[10px] tracking-[0.4em]">Individual Progress Tracking</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {students.map(s => {
            const stats = getStudentStats(s.id);
            const category = categorizeStudent(stats);
            return (
              <div key={s.id} onClick={() => analyzeStudent(s)} className="bg-white p-12 rounded-[60px] border border-slate-100 shadow-sm hover:shadow-2xl hover:scale-[1.02] cursor-pointer transition-all group overflow-hidden relative">
                <div className="flex items-center gap-6 mb-8">
                  <div className="w-16 h-16 rounded-[24px] bg-slate-900 text-white flex items-center justify-center font-black text-2xl shadow-xl">
                    {s.name.charAt(0)}
                  </div>
                  <div>
                    <h4 className="text-xl font-black text-slate-800 group-hover:text-blue-600 transition-colors">{s.name}</h4>
                    <p className="text-[10px] text-slate-300 font-black uppercase tracking-widest">{s.studentCode}</p>
                  </div>
                </div>
                
                <div className={`mb-8 px-10 py-3 rounded-full border text-sm font-black uppercase tracking-[0.2em] inline-block shadow-sm ${category.color}`}>
                  {category.label}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-50 p-6 rounded-3xl">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Activities</p>
                    <p className="text-3xl font-black text-slate-900">{stats.totalQuestions}</p>
                  </div>
                  <div className="bg-slate-50 p-6 rounded-3xl text-right">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Struggles</p>
                    <p className="text-3xl font-black text-slate-900">{stats.strugglingTopics.length}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {selectedStudent && (
          <div className="space-y-12 animate-slideUp">
            <div className="bg-white p-12 rounded-[70px] border border-slate-100 shadow-2xl space-y-12">
              <div className="flex justify-between items-start">
                <div className="flex gap-8 items-center">
                  <div className="w-24 h-24 rounded-[32px] bg-blue-600 text-white flex items-center justify-center text-4xl font-black shadow-2xl">
                    {selectedStudent.name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="text-4xl font-black text-slate-900 tracking-tighter">{selectedStudent.name}</h3>
                    <div className={`mt-3 px-8 py-2 rounded-full border text-[10px] font-black uppercase tracking-widest inline-block ${categorizeStudent(getStudentStats(selectedStudent.id)).color}`}>
                      Insight: {categorizeStudent(getStudentStats(selectedStudent.id)).label}
                    </div>
                  </div>
                </div>
                <button onClick={() => setSelectedStudent(null)} className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center text-slate-300 hover:bg-slate-100 transition-all font-black text-xl">✕</button>
              </div>

              <div className="bg-slate-900 p-12 rounded-[50px] shadow-2xl">
                <h4 className="text-[10px] font-black text-blue-400 uppercase tracking-[0.4em] mb-6 flex items-center gap-3">
                  <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></span>
                  AI Progress Summary
                </h4>
                {loadingAnalysis ? (
                  <div className="space-y-4 animate-pulse">
                    <div className="h-4 bg-slate-800 rounded-full w-3/4"></div>
                    <div className="h-4 bg-slate-800 rounded-full w-1/2"></div>
                  </div>
                ) : (
                  <p className="text-xl text-slate-300 leading-relaxed font-medium italic">"{profileAnalysis}"</p>
                )}
              </div>

              <div className="space-y-10">
                <h4 className="text-3xl font-black text-slate-900 tracking-tight border-b border-slate-50 pb-6">Question History</h4>
                <div className="space-y-12">
                  {history.length > 0 ? history.slice().reverse().map(entry => (
                    <div key={entry.id} className="border-l-8 border-slate-100 pl-12 space-y-6 relative group">
                      <div className="absolute -left-2 top-0 w-2 h-full bg-slate-100 group-hover:bg-blue-200 transition-colors"></div>
                      <div className="flex items-center gap-4">
                         <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Question • {new Date(entry.timestamp).toLocaleString()}</p>
                         {entry.isRepetition && <span className="bg-red-50 text-red-500 px-3 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest">Repeat Doubt</span>}
                         {entry.persona === 'LOGIC_HEAVY' && <span className="bg-purple-50 text-purple-600 px-3 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest">Logic Agent</span>}
                      </div>
                      <p className="text-2xl font-bold text-slate-800">"{entry.question}"</p>
                      <div className="bg-slate-50 p-10 rounded-[40px] border border-slate-100 shadow-sm">
                         <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Murshid's Answer ({entry.explanationStyle})</p>
                         <p className="text-xl text-slate-600 font-medium leading-relaxed">{entry.answer}</p>
                      </div>
                    </div>
                  )) : (
                    <p className="text-slate-400 italic py-10 text-center uppercase tracking-widest font-black text-sm">No recorded learning activity.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
};

export default AdminView;
