'use client';

export default function ChatPage() {
  return (
    <div className="px-6 py-6 flex flex-col gap-8 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">Chat</h1>
        <p className="text-sm text-slate-500 mt-0.5">Interface de chat avec les agents KR Global</p>
      </div>

      <div
        className="rounded-xl border py-16 text-center text-sm text-slate-600"
        style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}
      >
        Interface chat — à venir
      </div>
    </div>
  );
}
