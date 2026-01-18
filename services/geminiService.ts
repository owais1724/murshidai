
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { QuestionEntry, TextbookContent, UserProfile, AgentPersona } from "../types";
import { getStudentHistory, getSimilarityRank } from "./storageService";

export const getGeminiInstance = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

const PERSONA_PROMPTS: Record<AgentPersona, string> = {
  NORMAL: "You are a helpful, direct academic tutor.",
  SOCRATIC: "You are a Socratic tutor. Never give answers directly. Instead, ask guided questions to help the student find the answer themselves.",
  STORYTELLER: "You are a creative storyteller. Explain every academic concept using epic analogies, characters, and narrative journeys.",
  SCIENTIST: "You are a rigorous scientist. Use technical terms, cite biological or mathematical principles, and focus on empirical data.",
  LOGIC_HEAVY: "You are a Logic and Mathematics specialist. Focus on absolute rigor. Break problems into numbered steps, define your axioms, and use formal logic. Prioritize correctness and proof over conversational fluff."
};

const cleanTextForSpeech = (text: string): string => {
  // Ultra-aggressive cleaning for fastest TTS start
  return text
    .replace(/\*\*/g, '') 
    .replace(/\*/g, '')  
    .replace(/#/g, '')   
    .replace(/`/g, '')   
    .replace(/\[.*?\]/g, '') 
    .replace(/\n\s*\n/g, '. ')
    .replace(/\n/g, ' ') 
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 500); // Shorter snippet for faster initial playback
};

export const getLiveSystemInstruction = (userName: string, weakAreas: string[], textbookContext: string, persona: AgentPersona = 'NORMAL') => `
You are "Murshid AI", a senior academic tutor for ${userName}. 

CURRENT PERSONA: ${PERSONA_PROMPTS[persona]}

### PEDAGOGICAL PROGRESSION:
- Focus areas: ${weakAreas.join(', ')}
- First Doubt: Clear explanation.
- Second Doubt: Simplified version.
- Third Doubt+: Analogy.

### CORE COMPETENCY:
Expert in Class 1-10. Textbook context is primary truth.

### VOICE:
Be very concise. Max 20 seconds. 
End with a short question.

### TEXTBOOK CONTEXT:
${textbookContext || "NO TEXTBOOK INDEXED."}
`;

export const generateSpeech = async (text: string, voiceName: string = 'Kore'): Promise<string | undefined> => {
  const cleaned = cleanTextForSpeech(text);
  if (!cleaned) return undefined;

  try {
    const ai = getGeminiInstance();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: cleaned }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  } catch (error) {
    console.error("TTS request failed:", error);
    return undefined;
  }
};

export const categorizeQuestion = async (text: string): Promise<string> => {
  const ai = getGeminiInstance();
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Categorize this: "${text}" into a 1-2 word topic. Return ONLY the words.`,
    config: { thinkingConfig: { thinkingBudget: 0 }, temperature: 0.1 }
  });
  return (response.text || "General").trim();
};

export const generateTextAnswer = async (
  user: UserProfile,
  question: string,
  textbooks: TextbookContent[],
  persona: AgentPersona = 'NORMAL'
): Promise<{ text: string; topic: string; style: 'normal' | 'simple' | 'analogy'; source: 'textbook' | 'general' }> => {
  
  const repeatCount = getSimilarityRank(user.id, question);
  let style: 'normal' | 'simple' | 'analogy' = 'normal';
  if (repeatCount === 1) style = 'simple';
  else if (repeatCount >= 2) style = 'analogy';

  const context = textbooks.map(t => `SOURCE: ${t.name}\nCONTENT: ${t.content}`).join("\n---\n").substring(0, 40000);

  const prompt = `
    ROLE: Murshid AI Tutor
    PERSONA: ${PERSONA_PROMPTS[persona]}
    STUDENT: ${user.name}
    STYLE: ${style.toUpperCase()}
    TEXTBOOKS: ${context || "NONE"}
    QUESTION: "${question}"
    
    INSTRUCTIONS:
    1. Be concise.
    2. End with: [TOPIC: YourTopic] [SOURCE: TEXTBOOK/GENERAL].
  `;

  const ai = getGeminiInstance();
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview', // Flash for 90% of cases is enough and 10x faster
    contents: prompt,
    config: { temperature: 0.2 }
  });

  const rawText = response.text || "I'm sorry, I couldn't process that.";
  let finalSource: 'textbook' | 'general' = 'general';
  let finalTopic = 'General Inquiry';
  let cleanedText = rawText;

  if (rawText.includes('[SOURCE: TEXTBOOK]')) {
    finalSource = 'textbook';
    cleanedText = cleanedText.replace('[SOURCE: TEXTBOOK]', '').trim();
  }

  const topicMatch = rawText.match(/\[TOPIC:\s*(.*?)\]/);
  if (topicMatch) {
    finalTopic = topicMatch[1].trim();
    cleanedText = cleanedText.replace(topicMatch[0], '').trim();
  } else {
    finalTopic = await categorizeQuestion(question);
  }

  return { text: cleanedText, topic: finalTopic, style, source: finalSource };
};

export const getProfileInsights = async (history: QuestionEntry[], isStudentView: boolean): Promise<string> => {
  if (history.length === 0) return "Ready to start!";
  const historyText = history.slice(-5).map(h => `Q: ${h.question} (Topic: ${h.topic})`).join("\n");
  const ai = getGeminiInstance();
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Analyze progress: ${historyText}. Give a 5-word praise or advice.`,
  });
  return response.text || "Keep learning!";
};
