import React, { useState } from 'react';
import { Plus, Trash2, MessageCircle, X } from 'lucide-react';
import { useChatSessions } from '../context/ChatSessionContext';

const PROVIDER_SHORT: Record<string, string> = {
  openai: 'OpenAI',
  gemini: 'Gemini',
  anthropic: 'Claude',
};

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

const ChatSessionSidebar: React.FC = () => {
  const { sessions, activeSessionId, createSession, switchSession, deleteSession } = useChatSessions();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const sorted = [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirmDelete === id) {
      deleteSession(id);
      setConfirmDelete(null);
    } else {
      setConfirmDelete(id);
      // Auto-cancel confirmation after 3s
      setTimeout(() => setConfirmDelete(prev => (prev === id ? null : prev)), 3000);
    }
  };

  return (
    <div className="flex flex-col w-44 min-w-[176px] h-full border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex-shrink-0 overflow-hidden">
      {/* New session button */}
      <div className="px-2.5 pt-3 pb-2 flex-shrink-0">
        <button
          onClick={createSession}
          className="w-full flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold transition-colors shadow-sm"
        >
          <Plus size={12} />
          New Session
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {sorted.map(session => {
          const isActive = session.id === activeSessionId;
          const isConfirming = confirmDelete === session.id;

          return (
            <div
              key={session.id}
              onClick={() => { switchSession(session.id); setConfirmDelete(null); }}
              className={`group relative mb-1 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                isActive
                  ? 'bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800'
                  : 'hover:bg-white dark:hover:bg-slate-800 border border-transparent hover:border-slate-200 dark:hover:border-slate-700'
              }`}
            >
              <div className="flex items-start gap-1.5 pr-5 min-w-0">
                <MessageCircle
                  size={11}
                  className={`mt-0.5 flex-shrink-0 ${isActive ? 'text-blue-500' : 'text-slate-400'}`}
                />
                <div className="min-w-0 flex-1">
                  <p className={`text-[11px] font-medium truncate leading-tight ${
                    isActive ? 'text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-300'
                  }`}>
                    {session.title}
                  </p>
                  {session.selectedProvider && (
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">
                      {PROVIDER_SHORT[session.selectedProvider] ?? session.selectedProvider}
                    </p>
                  )}
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                    {relativeTime(session.updatedAt)}
                  </p>
                </div>
              </div>

              {/* Delete button */}
              <button
                onClick={(e) => handleDeleteClick(e, session.id)}
                className={`absolute right-1.5 top-1.5 p-1 rounded transition-all ${
                  isConfirming
                    ? 'text-red-500 bg-red-50 dark:bg-red-900/20 opacity-100'
                    : 'text-slate-400 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
                }`}
                title={isConfirming ? 'Click again to confirm' : 'Delete session'}
              >
                {isConfirming ? <X size={10} /> : <Trash2 size={10} />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ChatSessionSidebar;
