import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import {
  ChatSession,
  StoredMessage,
  loadSessions,
  saveSessions,
  loadActiveSessionId,
  saveActiveSessionId,
  createNewSession,
} from '../store/chatSessionStore';
import { LLMProvider, getActiveProvider } from '../services/llmService';

export type { ChatSession, StoredMessage };

interface ChatSessionContextValue {
  sessions: ChatSession[];
  activeSessionId: string;
  activeSession: ChatSession | null;
  createSession: () => void;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;
  updateSessionMessages: (messages: StoredMessage[]) => void;
  updateSessionProvider: (provider: LLMProvider | null) => void;
}

const ChatSessionContext = createContext<ChatSessionContextValue | null>(null);

function bootstrap(): { sessions: ChatSession[]; activeId: string } {
  const stored = loadSessions();
  const storedActiveId = loadActiveSessionId();

  if (stored.length === 0) {
    const fresh = createNewSession(getActiveProvider());
    saveSessions([fresh]);
    saveActiveSessionId(fresh.id);
    return { sessions: [fresh], activeId: fresh.id };
  }

  const validId =
    storedActiveId && stored.find(s => s.id === storedActiveId)
      ? storedActiveId
      : stored[0].id;

  return { sessions: stored, activeId: validId };
}

export const ChatSessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const init = useRef(bootstrap()).current;
  const [sessions, setSessions] = useState<ChatSession[]>(init.sessions);
  const [activeSessionId, setActiveSessionId] = useState<string>(init.activeId);

  useEffect(() => { saveSessions(sessions); }, [sessions]);
  useEffect(() => { saveActiveSessionId(activeSessionId); }, [activeSessionId]);

  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null;

  const createSession = useCallback(() => {
    const session = createNewSession(getActiveProvider());
    setSessions(prev => [session, ...prev]);
    setActiveSessionId(session.id);
  }, []);

  const switchSession = useCallback((id: string) => {
    setActiveSessionId(id);
  }, []);

  const deleteSession = useCallback((id: string) => {
    const remaining = sessions.filter(s => s.id !== id);

    if (remaining.length === 0) {
      const fresh = createNewSession(getActiveProvider());
      setSessions([fresh]);
      setActiveSessionId(fresh.id);
      return;
    }

    setSessions(remaining);

    if (activeSessionId === id) {
      const sorted = [...remaining].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      setActiveSessionId(sorted[0].id);
    }
  }, [sessions, activeSessionId]);

  const updateSessionMessages = useCallback((messages: StoredMessage[]) => {
    setSessions(prev => prev.map(s => {
      if (s.id !== activeSessionId) return s;
      let title = s.title;
      if (title === 'New Chat' && messages.length > 0) {
        const firstUser = messages.find(m => m.role === 'user');
        if (firstUser) {
          title = firstUser.text.slice(0, 45) + (firstUser.text.length > 45 ? '…' : '');
        }
      }
      return { ...s, messages, title, updatedAt: new Date().toISOString() };
    }));
  }, [activeSessionId]);

  const updateSessionProvider = useCallback((provider: LLMProvider | null) => {
    setSessions(prev => prev.map(s =>
      s.id === activeSessionId
        ? { ...s, selectedProvider: provider, updatedAt: new Date().toISOString() }
        : s
    ));
  }, [activeSessionId]);

  return (
    <ChatSessionContext.Provider value={{
      sessions,
      activeSessionId,
      activeSession,
      createSession,
      switchSession,
      deleteSession,
      updateSessionMessages,
      updateSessionProvider,
    }}>
      {children}
    </ChatSessionContext.Provider>
  );
};

export const useChatSessions = (): ChatSessionContextValue => {
  const ctx = useContext(ChatSessionContext);
  if (!ctx) throw new Error('useChatSessions must be used inside ChatSessionProvider');
  return ctx;
};
