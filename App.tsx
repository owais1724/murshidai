
import React, { useState, useEffect } from 'react';
import { UserRole, UserProfile } from './types';
import { getAppData, addOrUpdateUser, findStudentByCode, findUserByEmail } from './services/storageService';
import Layout from './components/Layout';
import StudentView from './components/StudentView';
import AdminView from './components/AdminView';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [activeTab, setActiveTab] = useState('dash');
  const [loginRole, setLoginRole] = useState<UserRole>(UserRole.STUDENT);
  
  // Login form states
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [childCode, setChildCode] = useState('');

  useEffect(() => {
    const loggedInId = localStorage.getItem('murshid_session');
    if (loggedInId) {
      const data = getAppData();
      const user = data.users.find(u => u.id === loggedInId);
      if (user) setCurrentUser(user);
    }
  }, []);

  const handleAuthenticate = () => {
    if (!email) {
      alert("Please provide an email address.");
      return;
    }

    // Check if user already exists
    const existingUser = findUserByEmail(email);

    if (existingUser) {
      // Return user identified!
      localStorage.setItem('murshid_session', existingUser.id);
      setCurrentUser(existingUser);
      setActiveTab('dash');
      return;
    }

    if (!fullName) {
      alert("Welcome! Please provide your name to create an account.");
      return;
    }

    if (loginRole === UserRole.PARENT && !childCode) {
      alert("Parents must provide a Child ID to link accounts.");
      return;
    }

    let linkedStudentId = '';
    if (loginRole === UserRole.PARENT) {
      const student = findStudentByCode(childCode);
      if (!student) {
        alert("Student ID not found. Please verify the code with your child.");
        return;
      }
      linkedStudentId = student.id;
    }

    const userId = fullName.toLowerCase().replace(/\s/g, '_') + '_' + Date.now();
    
    // Generate unique Murshid ID
    const randomSuffix = Math.floor(100000 + Math.random() * 900000);
    const studentCode = loginRole === UserRole.STUDENT 
      ? `M-${randomSuffix}` 
      : undefined;

    const newUser: UserProfile = {
      id: userId,
      name: fullName,
      email: email,
      role: loginRole,
      grade: 0,
      studentCode: studentCode,
      parentId: loginRole === UserRole.PARENT ? linkedStudentId : undefined,
    };

    const user = addOrUpdateUser(newUser);

    localStorage.setItem('murshid_session', user.id);
    setCurrentUser(user);
    setActiveTab('dash');
  };

  const handleLogout = () => {
    localStorage.removeItem('murshid_session');
    setCurrentUser(null);
    setFullName('');
    setEmail('');
    setChildCode('');
  };

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#f3f4f6] flex items-center justify-center p-6 font-sans">
        <div className="bg-white w-full max-w-[440px] rounded-[60px] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] p-12 flex flex-col items-center">
          
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="w-24 h-24 bg-gradient-to-br from-[#4f46e5] to-[#3b82f6] rounded-[32px] flex items-center justify-center shadow-lg shadow-blue-200 mb-8">
              <svg className="w-12 h-12 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3L1 9L12 15L21 10.09V17H23V9M5 13.18V17.18L12 21L19 17.18V13.18L12 17L5 13.18Z" />
              </svg>
            </div>
            <h1 className="text-[36px] font-bold text-[#111827] tracking-tight">Murshid AI</h1>
            <p className="text-slate-400 text-xs mt-2 font-black uppercase tracking-widest">Personalized Education</p>
          </div>

          <div className="w-full bg-[#f3f4f6] p-1 rounded-full flex mb-8">
            {(Object.values(UserRole) as UserRole[]).map((role) => (
              <button
                key={role}
                onClick={() => setLoginRole(role)}
                className={`flex-1 py-3 text-[10px] font-black tracking-widest rounded-full transition-all duration-300 ${
                  loginRole === role
                    ? 'bg-white text-[#3b82f6] shadow-sm'
                    : 'text-[#9ca3af]'
                }`}
              >
                {role}
              </button>
            ))}
          </div>

          <div className="w-full space-y-4 mb-8">
            <input
              type="email"
              placeholder="Email Address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-16 px-8 bg-[#f9fafb] rounded-3xl text-[#1f2937] placeholder-[#9ca3af] outline-none border-none focus:ring-2 focus:ring-blue-100 transition-all"
            />
            {!findUserByEmail(email) && (
              <input
                type="text"
                placeholder="Full Name (for new users)"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full h-16 px-8 bg-[#f9fafb] rounded-3xl text-[#1f2937] placeholder-[#9ca3af] outline-none border-none focus:ring-2 focus:ring-blue-100 transition-all animate-fadeIn"
              />
            )}
            {loginRole === UserRole.PARENT && (
              <input
                type="text"
                placeholder="Child's Student ID (M-XXXXXX)"
                value={childCode}
                onChange={(e) => setChildCode(e.target.value)}
                className="w-full h-16 px-8 bg-[#eff6ff] border border-blue-100 rounded-3xl text-[#1e40af] placeholder-[#93c5fd] outline-none focus:ring-2 focus:ring-blue-200 transition-all"
              />
            )}
          </div>

          <button
            onClick={handleAuthenticate}
            className="w-full h-20 bg-[#0f172a] text-white text-lg font-bold rounded-full tracking-widest hover:bg-[#1e293b] active:scale-[0.98] transition-all shadow-xl shadow-slate-200"
          >
            {findUserByEmail(email) ? 'SIGN IN' : 'SIGN UP'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <Layout user={currentUser} onLogout={handleLogout} activeTab={activeTab} setActiveTab={setActiveTab}>
      {currentUser.role === UserRole.STUDENT ? (
        <StudentView user={currentUser} activeTab={activeTab} setActiveTab={setActiveTab} />
      ) : (
        <AdminView user={currentUser} activeTab={activeTab} />
      )}
    </Layout>
  );
};

export default App;
