import type { LLMProvider } from '../services/llmService';

const SESSIONS_KEY = 'tavro_chat_sessions';
const ACTIVE_KEY = 'tavro_chat_active_session';

export interface AttachmentRef {
  id: string;
  name: string;
  mime_type: string;
  size: number;
  url: string;
}

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  attachments?: AttachmentRef[];
}

export interface ChatSession {
  id: string;
  title: string;
  selectedProvider: LLMProvider | null;
  createdAt: string;
  updatedAt: string;
  messages: StoredMessage[];
}

export function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ChatSession[];
  } catch {
    return [];
  }
}

export function saveSessions(sessions: ChatSession[]): void {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    // Storage quota exceeded — silently ignore
  }
}

export function loadActiveSessionId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function saveActiveSessionId(id: string | null): void {
  if (id) {
    localStorage.setItem(ACTIVE_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_KEY);
  }
}

export function clearAllSessions(): void {
  localStorage.removeItem(SESSIONS_KEY);
  localStorage.removeItem(ACTIVE_KEY);
}

export function createNewSession(provider: LLMProvider | null = null): ChatSession {
  return {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: 'New Chat',
    selectedProvider: provider,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
  };
}
