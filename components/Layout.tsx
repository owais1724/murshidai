
import React from 'react';
import { UserRole, UserProfile } from '../types';

interface LayoutProps {
  user: UserProfile;
  onLogout: () => void;
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const Layout: React.FC<LayoutProps> = ({ user, onLogout, children, activeTab, setActiveTab }) => {
  const navItems = {
    [UserRole.STUDENT]: [
      { id: 'dash', label: 'Dashboard', icon: '📊' },
      { id: 'learn', label: 'Study Room', icon: '📖' },
      { id: 'history', label: 'Questions', icon: '📁' },
    ],
    [UserRole.TEACHER]: [
      { id: 'dash', label: 'Overview', icon: '📈' },
      { id: 'students', label: 'Students', icon: '👥' },
    ],
    [UserRole.PARENT]: [
      { id: 'dash', label: 'Progress', icon: '🏠' },
      { id: 'insights', label: 'Insights', icon: '💡' },
    ],
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-72 bg-white flex flex-col border-r border-slate-100 shadow-sm">
        <div className="p-8">
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            <span className="text-3xl">📘</span> Murshid
          </h1>
          <p className="text-[10px] uppercase tracking-widest text-slate-400 mt-2 font-black">AI PERSONAL TUTOR</p>
        </div>

        <nav className="flex-1 px-6 py-2 space-y-2">
          {navItems[user.role].map(item => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl transition-all text-sm font-bold ${
                activeTab === item.id 
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' 
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-6 border-t border-slate-50">
          <div className="flex items-center gap-4 mb-6 px-2">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-lg shadow-inner">
              {user.name.charAt(0)}
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-bold text-slate-900 truncate">{user.name}</p>
              <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest mt-0.5">
                {user.role === UserRole.STUDENT ? (user.studentCode || 'N/A') : user.role}
              </p>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="w-full py-3 text-xs font-bold text-slate-400 hover:text-red-500 flex items-center justify-center gap-2 rounded-xl transition-colors border border-transparent hover:border-red-50"
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-[#f8fafc]">
        <div className="max-w-6xl mx-auto p-12">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
