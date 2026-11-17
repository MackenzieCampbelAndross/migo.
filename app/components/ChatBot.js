// app/components/ChatBot.js
'use client';
import { useState } from 'react';
import { usePathname } from 'next/navigation';

export default function ChatBot() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'bot', text: 'Hi! I\'m Migo Assistant. Ask me anything about sending money internationally.' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // Hide on landing page
  if (pathname === '/') return null;

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: userMsg }]);
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg }),
      });
      const data = await res.json();
      setMessages((m) => [...m, { role: 'bot', text: data.reply }]);
    } catch {
      setMessages((m) => [...m, { role: 'bot', text: 'Sorry, something went wrong.' }]);
    }
    setLoading(false);
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-20 right-4 z-50 w-11 h-11 rounded-full flex items-center justify-center transition-transform active:scale-95 shadow-md bg-[#000000] text-white"
        aria-label="Open Assistant"
      >
        {open ? (
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-32 right-3 left-3 z-50 h-[26rem] max-h-[65vh] rounded-3xl flex flex-col overflow-hidden bg-[#FFFFFF] border border-[#E5E5EA] shadow-xl">
          <div className="px-4 py-3 text-sm font-semibold text-[#1C1C1E] bg-[#F8F8FA] border-b border-[#E5E5EA]">
            Migo Assistant
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.map((m, i) => (
              <div key={i} className={`text-sm ${m.role === 'user' ? 'text-right' : ''}`}>
                <span className={`inline-block px-3.5 py-2.5 rounded-2xl max-w-[85%] ${
                  m.role === 'user'
                    ? 'bg-[#000000] text-white'
                    : 'bg-[#F2F2F7] text-[#1C1C1E]'
                }`}>
                  {m.text}
                </span>
              </div>
            ))}
            {loading && (
              <div className="text-sm text-[#8E8E93] animate-pulse">Thinking...</div>
            )}
          </div>
          <div className="p-2.5 flex gap-2 border-t border-[#E5E5EA] bg-[#F8F8FA]">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="Ask anything..."
              className="flex-1 px-3.5 py-2 rounded-xl text-sm input-field"
            />
            <button
              onClick={send}
              disabled={loading}
              className="px-3.5 py-2 rounded-xl text-sm font-medium disabled:opacity-50 bg-[#000000] text-white"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
