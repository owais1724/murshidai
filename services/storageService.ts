
import { UserRole, UserProfile, QuestionEntry, StudentStats, TextbookContent } from '../types';

const STORAGE_KEY = 'murshid_data_v4';

interface AppData {
  users: UserProfile[];
  history: QuestionEntry[];
  textbooks: TextbookContent[];
}

const initialData: AppData = {
  users: [],
  history: [],
  textbooks: []
};

export const getAppData = (): AppData => {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) {
    saveAppData(initialData);
    return initialData;
  }
  return JSON.parse(data);
};

export const saveAppData = (data: AppData) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

const getSemanticSimilarity = (q1: string, q2: string): number => {
  const clean = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2);
  const v1 = clean(q1);
  const v2 = clean(q2);
  
  if (v1.length === 0 || v2.length === 0) return 0;
  const intersection = v1.filter(word => v2.includes(word));
  const union = Array.from(new Set([...v1, ...v2]));
  return intersection.length / union.length;
};

export const getSimilarityRank = (studentId: string, newQuestion: string): number => {
  const data = getAppData();
  const studentHistory = data.history.filter(h => h.studentId === studentId);
  const matches = studentHistory.filter(h => getSemanticSimilarity(h.question, newQuestion) > 0.45);
  return matches.length;
};

// Simple Spaced Repetition: 1 day, 3 days, 7 days...
const calculateNextReview = (repeatCount: number): number => {
  const days = repeatCount === 0 ? 1 : repeatCount === 1 ? 3 : 7;
  return Date.now() + (days * 24 * 60 * 60 * 1000);
};

export const addQuestion = (entry: Omit<QuestionEntry, 'isRepetition' | 'explanationStyle' | 'nextReviewTimestamp'>) => {
  const data = getAppData();
  const repeatCount = getSimilarityRank(entry.studentId, entry.question);
  
  let style: 'normal' | 'simple' | 'analogy' = 'normal';
  if (repeatCount === 1) style = 'simple';
  else if (repeatCount >= 2) style = 'analogy';

  const finalEntry: QuestionEntry = {
    ...entry,
    isRepetition: repeatCount > 0,
    explanationStyle: style,
    nextReviewTimestamp: calculateNextReview(repeatCount)
  };

  data.history.push(finalEntry);
  saveAppData(data);
  return finalEntry;
};

export const getPulseTasks = (studentId: string): QuestionEntry[] => {
  const data = getAppData();
  const now = Date.now();
  return data.history
    .filter(h => h.studentId === studentId && h.nextReviewTimestamp && h.nextReviewTimestamp <= now)
    .slice(0, 5); // Limit to top 5 urgent review items
};

export const getStudentHistory = (studentId: string) => {
  return getAppData().history.filter(h => h.studentId === studentId);
};

export const getStudentStats = (studentId: string): StudentStats => {
  const history = getStudentHistory(studentId);
  const topicStats: Record<string, { count: number; repeats: number }> = {};

  history.forEach(h => {
    const topic = (h.topic || 'General Inquiry').trim();
    const existingKey = Object.keys(topicStats).find(k => k.toLowerCase() === topic.toLowerCase());
    const key = existingKey || topic;

    if (!topicStats[key]) topicStats[key] = { count: 0, repeats: 0 };
    topicStats[key].count += 1;
    if (h.isRepetition) {
      topicStats[key].repeats += 1;
    }
  });

  return {
    studentId,
    masteredTopics: Object.keys(topicStats).filter(t => topicStats[t].count > 1 && topicStats[t].repeats === 0),
    strugglingTopics: Object.entries(topicStats)
      .filter(([topic, stats]) => stats.count >= 2 || stats.repeats > 0)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([topic, stats]) => ({ topic, repeatCount: stats.count })),
    totalQuestions: history.length,
    recentTrends: Array.from({length: 5}, (_, i) => ({ day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][i], count: history.length }))
  };
};

export const addOrUpdateUser = (user: UserProfile): UserProfile => {
  const data = getAppData();
  const index = data.users.findIndex(u => u.id === user.id || (u.email && u.email.toLowerCase() === user.email?.toLowerCase()));
  if (index >= 0) {
    data.users[index] = { ...data.users[index], ...user };
    saveAppData(data);
    return data.users[index];
  } else {
    data.users.push(user);
    saveAppData(data);
    return user;
  }
};

export const findUserByEmail = (email: string): UserProfile | undefined => {
  const data = getAppData();
  const lowerEmail = email.toLowerCase();
  return data.users.find(u => u.email?.toLowerCase() === lowerEmail);
};

export const findStudentByCode = (code: string): UserProfile | undefined => {
  const data = getAppData();
  return data.users.find(u => u.role === UserRole.STUDENT && u.studentCode === code);
};

export const getStudentTextbooks = (studentId: string): TextbookContent[] => {
  return getAppData().textbooks.filter(t => t.studentId === studentId);
};

export const addStudentTextbook = (studentId: string, textbook: Omit<TextbookContent, 'studentId'>) => {
  const data = getAppData();
  data.textbooks.push({ ...textbook, studentId });
  saveAppData(data);
};
