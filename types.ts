
export enum UserRole {
  STUDENT = 'STUDENT',
  TEACHER = 'TEACHER',
  PARENT = 'PARENT'
}

export type AgentPersona = 'SOCRATIC' | 'STORYTELLER' | 'SCIENTIST' | 'NORMAL' | 'LOGIC_HEAVY';

export interface UserProfile {
  id: string;
  name: string;
  role: UserRole;
  grade: number;
  email?: string;
  studentCode?: string;
  parentId?: string;
  teacherId?: string;
  preferredPersona?: AgentPersona;
}

export interface QuestionEntry {
  id: string;
  studentId: string;
  question: string;
  answer: string;
  topic: string;
  subject: string;
  timestamp: number;
  explanationStyle: 'normal' | 'simple' | 'analogy';
  isRepetition: boolean;
  source: 'textbook' | 'general' | 'vision';
  persona?: AgentPersona;
  nextReviewTimestamp?: number; // For Spaced Repetition (Study Pulse)
}

export interface StudentStats {
  studentId: string;
  masteredTopics: string[];
  strugglingTopics: { topic: string; repeatCount: number }[];
  totalQuestions: number;
  recentTrends: { day: string; count: number }[];
}

export interface TextbookContent {
  id: string;
  studentId: string;
  name: string;
  content: string;
}
