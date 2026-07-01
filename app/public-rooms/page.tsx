'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { 
  MessageSquare, 
  ArrowLeft, 
  Search, 
  Users, 
  Globe, 
  Hash, 
  Compass, 
  Moon, 
  Sun,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface PublicRoom {
  code: string;
  name: string;
  users: number;
}

export default function PublicRoomsPage() {
  const router = useRouter();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [displayName, setDisplayName] = useState('');
  const [search, setSearch] = useState('');
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);
  const [showNameModal, setShowNameModal] = useState(false);
  const [selectedRoomCode, setSelectedRoomCode] = useState('');

  // Load name and theme
  useEffect(() => {
    const savedName = localStorage.getItem('roomchat_display_name') || '';
    setDisplayName(savedName);

    const savedTheme = localStorage.getItem('roomchat_theme') as 'dark' | 'light' | null;
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.dataset.theme = savedTheme;
    } else {
      setTheme('light');
      document.documentElement.dataset.theme = 'light';
    }

    const savedAccent = localStorage.getItem('roomchat_accent') || 'indigo';
    document.documentElement.dataset.accent = savedAccent;
  }, []);

  // Socket connection to listen for public rooms update
  useEffect(() => {
    const socket: Socket = io({ transports: ['websocket', 'polling'] });
    socket.on('public_rooms_update', (rooms: PublicRoom[]) => {
      setPublicRooms(rooms);
    });
    return () => {
      socket.disconnect();
    };
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem('roomchat_theme', next);
  };

  const handleRoomClick = (code: string) => {
    if (!displayName.trim()) {
      setSelectedRoomCode(code);
      setShowNameModal(true);
      return;
    }
    router.push(`/chat/${code}`);
  };

  const submitName = () => {
    if (!displayName.trim()) return;
    localStorage.setItem('roomchat_display_name', displayName.trim());
    setShowNameModal(false);
    router.push(`/chat/${selectedRoomCode}`);
  };

  const filteredRooms = publicRooms.filter(room => 
    room.name.toLowerCase().includes(search.toLowerCase()) ||
    room.code.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div
      className="flex min-h-dvh flex-col relative overflow-x-hidden transition-colors duration-200"
      style={{ 
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        backgroundImage: `
          radial-gradient(var(--border-primary) 1px, transparent 1px),
          radial-gradient(circle at 50% 0%, var(--accent-muted) 0%, transparent 60%)
        `,
        backgroundSize: '24px 24px, 100% 100%'
      }}
    >
      {/* Navigation Header */}
      <header 
        className="sticky top-0 z-40 w-full backdrop-blur-md border-b transition-colors"
        style={{ 
          backgroundColor: 'var(--bg-primary)', 
          borderColor: 'var(--border-primary)',
          opacity: 0.96
        }}
      >
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-6">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => router.push('/')}>
            <div className="p-2 rounded-xl bg-[var(--accent-muted)] text-[var(--accent)] flex items-center justify-center border border-[var(--border-primary)]">
              <MessageSquare size={16} />
            </div>
            <span className="text-sm font-bold tracking-tight">RoomChat</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-xl border transition-colors hover:bg-[var(--bg-hover)] cursor-pointer"
              style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
            >
              {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
            </button>
            <button
              onClick={() => router.push('/')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold hover:bg-[var(--bg-hover)] transition-all cursor-pointer"
              style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
            >
              <ArrowLeft size={13} />
              Dashboard
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto px-6 py-12 relative z-10">
        <div className="mb-10 text-center sm:text-left flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--accent)] uppercase tracking-wider mb-2">
              <Compass size={14} className="animate-spin-slow" />
              Explore Server
            </div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl" style={{ color: 'var(--text-primary)' }}>
              Public Chat Rooms
            </h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              Join active streams on the network instantly with zero signup.
            </p>
          </div>

          {/* Search bar */}
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2" size={14} style={{ color: 'var(--text-tertiary)' }} />
            <input
              type="text"
              placeholder="Filter rooms by name or code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border pl-9 pr-4 py-2 text-xs outline-none focus:border-[var(--accent)] transition-colors"
              style={{
                borderColor: 'var(--border-primary)',
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-primary)'
              }}
            />
          </div>
        </div>

        {/* Dynamic Glassmorphic Table-List (Not cards) */}
        <div 
          className="rounded-2xl border overflow-hidden backdrop-blur-md transition-colors"
          style={{ 
            borderColor: 'var(--border-primary)',
            backgroundColor: 'var(--bg-secondary)'
          }}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b text-[10px] font-bold uppercase tracking-wider" style={{ borderColor: 'var(--border-primary)', color: 'var(--text-tertiary)' }}>
                  <th className="py-4 px-6">Room Name</th>
                  <th className="py-4 px-4">Code</th>
                  <th className="py-4 px-4 text-center">Active Members</th>
                  <th className="py-4 px-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--border-primary)' }}>
                {filteredRooms.length > 0 ? (
                  filteredRooms.map((room) => (
                    <tr 
                      key={room.code}
                      className="group transition-colors hover:bg-[var(--bg-tertiary)]"
                    >
                      <td className="py-4 px-6 min-w-[200px]">
                        <div className="flex items-center gap-2.5">
                          <div className="p-1.5 rounded-lg bg-[var(--accent-muted)] text-[var(--accent)] flex items-center justify-center">
                            <Globe size={13} />
                          </div>
                          <span className="font-bold text-xs truncate max-w-[250px]" style={{ color: 'var(--text-primary)' }}>
                            {room.name}
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <span className="inline-flex items-center gap-0.5 font-mono text-[10px] font-semibold px-2 py-0.5 rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] text-[var(--text-secondary)]">
                          <Hash size={9} />
                          {room.code}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center justify-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                          <Users size={12} className="text-[var(--accent)]" />
                          <span>{room.users} online</span>
                        </div>
                      </td>
                      <td className="py-4 px-6 text-right">
                        <button
                          onClick={() => handleRoomClick(room.code)}
                          className="cursor-pointer inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-[10px] font-bold shadow-sm hover:bg-[var(--accent-hover)] transition-colors"
                        >
                          Join
                          <ExternalLink size={10} />
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      No active public rooms found. Start one from the dashboard!
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Name Input Modal */}
      <AnimatePresence>
        {showNameModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setShowNameModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="relative max-w-sm w-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-2xl p-6 space-y-4 shadow-xl z-10"
            >
              <div>
                <h3 className="text-sm font-bold text-[var(--text-primary)]">Enter Your Display Name</h3>
                <p className="text-[10px] text-[var(--text-secondary)]">Please set a username before entering the room.</p>
              </div>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your username..."
                maxLength={25}
                className="w-full rounded-xl border px-3 py-2 text-xs outline-none focus:border-[var(--accent)]"
                style={{
                  borderColor: 'var(--border-primary)',
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)'
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitName();
                }}
              />
              <div className="flex gap-2.5 pt-2">
                <button
                  onClick={() => setShowNameModal(false)}
                  className="flex-1 py-2 rounded-xl border border-[var(--border-primary)] text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={submitName}
                  disabled={!displayName.trim()}
                  className="flex-1 py-2 rounded-xl bg-[var(--accent)] text-white text-xs font-bold hover:bg-[var(--accent-hover)] cursor-pointer disabled:opacity-50"
                >
                  Enter Room
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
