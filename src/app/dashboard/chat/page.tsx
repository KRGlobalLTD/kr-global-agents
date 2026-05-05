'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { AgentAvatar } from '@/app/dashboard/components/AgentAvatar';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  id:         string;
  role:       'user' | 'agent';
  content:    string;
  agentName?: string;
  taskType?:  string;
  createdAt:  Date;
}

interface HistoryRecord {
  id:          string;
  role:        'user' | 'agent';
  agent_name?: string;
  message:     string;
  task_type?:  string;
  created_at:  string;
}

interface ChatResponse {
  agent_name?: string;
  response?:   string;
  task_type?:  string;
  error?:      string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  { icon: '📊', text: 'Rapport du jour' },
  { icon: '✍️', text: 'Génère un post LinkedIn' },
  { icon: '🤖', text: 'Statut des agents' },
  { icon: '🎯', text: 'Prospects cette semaine' },
  { icon: '💰', text: "Chiffre d'affaires ce mois" },
  { icon: '🔍', text: 'Veille concurrentielle' },
] as const;

// ── Typing indicator ──────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex gap-2.5">
      <AgentAvatar name="hashirama" size={32} className="mt-0.5" />
      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-slate-500 font-medium px-1">HASHIRAMA analyse...</span>
        <div
          className="px-4 py-3 rounded-2xl rounded-tl-sm inline-flex"
          style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.05)' }}
        >
          <div className="flex gap-1.5 items-center">
            {[0, 150, 300].map(delay => (
              <span
                key={delay}
                className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce"
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [messages,         setMessages]         = useState<Message[]>([]);
  const [input,            setInput]            = useState('');
  const [isTyping,         setIsTyping]         = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  // ── Load history ─────────────────────────────────────────────────────────

  useEffect(() => {
    fetch('/api/chat')
      .then(r => r.json())
      .then(({ messages: history }: { messages: HistoryRecord[] }) => {
        if (history?.length) {
          setMessages(history.map(m => ({
            id:        m.id,
            role:      m.role,
            content:   m.message,
            agentName: m.agent_name,
            taskType:  m.task_type,
            createdAt: new Date(m.created_at),
          })));
        }
      })
      .catch(() => {})
      .finally(() => setIsLoadingHistory(false));
  }, []);

  // ── Auto-scroll ───────────────────────────────────────────────────────────

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isTyping]);

  // ── Send message ──────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isTyping) return;

    setMessages(prev => [...prev, {
      id:        crypto.randomUUID(),
      role:      'user',
      content:   trimmed,
      createdAt: new Date(),
    }]);
    setInput('');
    setIsTyping(true);
    inputRef.current?.focus();

    try {
      const res  = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: trimmed }),
      });
      const data = (await res.json()) as ChatResponse;

      setMessages(prev => [...prev, {
        id:        crypto.randomUUID(),
        role:      'agent',
        content:   data.response ?? data.error ?? 'Erreur inattendue.',
        agentName: data.agent_name ?? 'HASHIRAMA',
        taskType:  data.task_type,
        createdAt: new Date(),
      }]);
    } catch {
      setMessages(prev => [...prev, {
        id:        crypto.randomUUID(),
        role:      'agent',
        content:   'Erreur de connexion. Réessaie dans un instant.',
        agentName: 'HASHIRAMA',
        createdAt: new Date(),
      }]);
    } finally {
      setIsTyping(false);
    }
  }, [isTyping]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  const showSuggestions = !isLoadingHistory && messages.length === 0 && !isTyping;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col"
      style={{ height: 'calc(100svh)', background: '#0a0a0a' }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 py-4 border-b flex-shrink-0"
        style={{ borderColor: 'rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}
      >
        <AgentAvatar name="hashirama" size={36} className="rounded-xl" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold text-white">Chat — HASHIRAMA</h1>
            <span
              className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0"
              style={{ boxShadow: '0 0 6px #34d399' }}
            />
          </div>
          <p className="text-xs text-slate-500 truncate">Superviseur IA · KR Global Solutions Ltd</p>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3"
        style={{ scrollBehavior: 'smooth' }}
      >
        {isLoadingHistory && (
          <div className="flex justify-center py-8">
            <div className="w-5 h-5 rounded-full border-2 border-slate-700 border-t-violet-500 animate-spin" />
          </div>
        )}

        {!isLoadingHistory && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <AgentAvatar name="hashirama" size={56} className="rounded-2xl" />
            <p className="text-sm text-slate-400 font-medium">Bonjour, je suis HASHIRAMA</p>
            <p className="text-xs text-slate-600 text-center max-w-xs leading-relaxed">
              Superviseur de tous les agents KR Global. Pose-moi une question ou choisis une suggestion ci-dessous.
            </p>
          </div>
        )}

        {messages.map(msg =>
          msg.role === 'user' ? (
            <div key={msg.id} className="flex justify-end">
              <div
                className="max-w-[78%] px-4 py-2.5 rounded-2xl rounded-br-sm text-sm text-white leading-relaxed break-words"
                style={{ background: '#7c3aed' }}
              >
                {msg.content}
              </div>
            </div>
          ) : (
            <div key={msg.id} className="flex gap-2.5">
              <AgentAvatar name={msg.agentName ?? 'hashirama'} size={32} className="mt-0.5" />
              <div className="flex flex-col gap-1 max-w-[78%]">
                <span className="text-[10px] text-slate-500 font-medium px-1">
                  {msg.agentName ?? 'HASHIRAMA'}
                  {msg.taskType && (
                    <span className="ml-1.5 opacity-60" style={{ color: '#7c3aed' }}>
                      · {msg.taskType}
                    </span>
                  )}
                </span>
                <div
                  className="px-4 py-2.5 rounded-2xl rounded-tl-sm text-sm text-slate-200 leading-relaxed whitespace-pre-wrap break-words"
                  style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.05)' }}
                >
                  {msg.content}
                </div>
              </div>
            </div>
          )
        )}

        {isTyping && <TypingIndicator />}
      </div>

      {/* Quick suggestions */}
      {showSuggestions && (
        <div className="px-4 pb-3 flex flex-wrap gap-2 flex-shrink-0">
          {SUGGESTIONS.map(s => (
            <button
              key={s.text}
              onClick={() => void sendMessage(`${s.icon} ${s.text}`)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-slate-300 hover:text-white transition-colors"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border:     '1px solid rgba(255,255,255,0.08)',
              }}
            >
              {s.icon} {s.text}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div
        className="px-4 pt-2 pb-4 border-t flex gap-2 flex-shrink-0"
        style={{
          borderColor:  'rgba(255,255,255,0.07)',
          paddingBottom: 'max(1rem, calc(env(safe-area-inset-bottom) + 0.5rem))',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Pose une question à HASHIRAMA..."
          disabled={isTyping}
          autoFocus
          className="flex-1 px-4 py-2.5 rounded-xl text-sm text-white placeholder-slate-600 outline-none"
          style={{
            background:  'rgba(255,255,255,0.05)',
            border:      '1px solid rgba(255,255,255,0.08)',
            transition:  'border-color 0.15s',
          }}
          onFocus={e => { (e.target as HTMLInputElement).style.borderColor = 'rgba(124,58,237,0.5)'; }}
          onBlur={e  => { (e.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.08)'; }}
        />
        <button
          onClick={() => void sendMessage(input)}
          disabled={!input.trim() || isTyping}
          className="px-4 py-2.5 rounded-xl text-base font-bold text-white transition-opacity disabled:opacity-30 flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
            minWidth:   '2.75rem',
          }}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
