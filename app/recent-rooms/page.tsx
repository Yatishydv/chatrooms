'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  MessageSquare, 
  ArrowLeft, 
  Clock, 
  Trash2, 
  Lock, 
  Globe, 
  Hash, 
  Moon, 
  Sun,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface JoinedRoom {
  id: string;
  name: string;
  visibility: string;
  joinedAt: string;
}

export default function RecentRoomsPage() {
  const router = useRouter();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [displayName, setDisplayName] = useState('');
  const [joinedRooms, setJoinedRooms] = useState<JoinedRoom[]>([]);
  const [showNameModal, setShowNameModal] = useState(false);
  const [selectedRoomCode, setSelectedRoomCode] = useState('');
  const [activeRoomIds, setActiveRoomIds] = useState<Record<string, boolean>>({});

  // Load cache
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

    try {
      const list = JSON.parse(localStorage.getItem('roomchat_joined_rooms') || '[]');
      setJoinedRooms(list);
    } catch (e) {
      console.error('Failed to load history', e);
    }
  }, []);

  // Load active rooms status
  useEffect(() => {
    if (joinedRooms.length === 0) return;
    
    const checkRooms = async () => {
      const statusMap: Record<string, boolean> = {};
      let listUpdated = false;
      const updatedList = [...joinedRooms];

      await Promise.all(
        updatedList.map(async (room, idx) => {
          try {
            const res = await fetch(`/api/check-room/${room.id}`);
            if (res.ok) {
              const data = await res.json();
              statusMap[room.id] = data.exists;
              
              if (data.exists) {
                const liveVisibility = data.isPublic ? 'public' : 'private';
                if (room.visibility !== liveVisibility || room.name !== data.name) {
                  updatedList[idx] = {
                    ...room,
                    visibility: liveVisibility,
                    name: data.name
                  };
                  listUpdated = true;
                }
              }
            } else {
              statusMap[room.id] = false;
            }
          } catch (e) {
            statusMap[room.id] = false;
          }
        })
      );
      
      setActiveRoomIds(statusMap);
      
      if (listUpdated) {
        setJoinedRooms(updatedList);
        localStorage.setItem('roomchat_joined_rooms', JSON.stringify(updatedList));
      }
    };

    checkRooms();
  }, [joinedRooms]);

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

  const clearHistory = () => {
    localStorage.removeItem('roomchat_joined_rooms');
    setJoinedRooms([]);
  };

  const removeRoom = (code: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = joinedRooms.filter(r => r.id !== code);
    localStorage.setItem('roomchat_joined_rooms', JSON.stringify(updated));
    setJoinedRooms(updated);
  };

  const formatDate = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString(undefined, { 
        month: 'short', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      });
    } catch {
      return 'Recently';
    }
  };

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
              <Clock size={14} />
              Access History
            </div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl" style={{ color: 'var(--text-primary)' }}>
              Recently Joined Rooms
            </h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              Quick links to rooms you have recently opened or created.
            </p>
          </div>

          {joinedRooms.length > 0 && (
            <button
              onClick={clearHistory}
              className="cursor-pointer self-center sm:self-auto flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-200 hover:bg-red-50 hover:text-red-700 text-xs font-bold text-red-600 transition-colors bg-red-50/20"
            >
              <Trash2 size={13} />
              Clear History
            </button>
          )}
        </div>

        {/* Dynamic Glassmorphic Table-List (Not cards) */}
        <div 
          className="rounded-2xl border overflow-hidden backdrop-blur-md transition-colors"
          style={{ 
            borderColor: 'var(--border-primary)',
            backgroundColor: 'var(--bg-secondary)'
          }}
        >
          {/* Desktop Table View */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b text-[10px] font-bold uppercase tracking-wider" style={{ borderColor: 'var(--border-primary)', color: 'var(--text-tertiary)' }}>
                  <th className="py-4 px-6">Room Details</th>
                  <th className="py-4 px-4">Type</th>
                  <th className="py-4 px-4">Last Visited</th>
                  <th className="py-4 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--border-primary)' }}>
                {joinedRooms.length > 0 ? (
                  joinedRooms.map((room) => (
                    <tr 
                      key={room.id}
                      className="group transition-colors hover:bg-[var(--bg-tertiary)]"
                    >
                      <td className="py-4 px-6 min-w-[200px]">
                        <div className="flex items-center gap-2.5">
                          <div className="p-1.5 rounded-lg bg-[var(--accent-muted)] text-[var(--accent)] flex items-center justify-center">
                            <MessageSquare size={13} />
                          </div>
                          <div>
                            <span className="font-bold text-xs block" style={{ color: 'var(--text-primary)' }}>
                              {room.name}
                            </span>
                            <span className="inline-flex items-center gap-0.5 font-mono text-[9px] text-[var(--text-tertiary)] mt-0.5">
                              <Hash size={8} />
                              {room.id}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        {room.visibility === 'public' ? (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                            <Globe size={9} />
                            Public
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                            <Lock size={9} />
                            Private
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <span className="text-xs text-[var(--text-secondary)]">
                          {formatDate(room.joinedAt)}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={(e) => removeRoom(room.id, e)}
                            className="cursor-pointer p-1.5 rounded-lg border border-[var(--border-primary)] hover:bg-red-50 hover:text-red-600 transition-colors text-[var(--text-tertiary)]"
                            title="Remove from list"
                          >
                            <Trash2 size={12} />
                          </button>
                          {activeRoomIds[room.id] ? (
                            <button
                              onClick={() => handleRoomClick(room.id)}
                              className="cursor-pointer inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-[10px] font-bold shadow-sm hover:bg-[var(--accent-hover)] transition-colors"
                            >
                              Rejoin
                              <ExternalLink size={10} />
                            </button>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-400 border border-gray-200 dark:border-gray-700 text-[9px] font-bold">
                              Deleted Room
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      You haven&apos;t joined any rooms yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Stack List View */}
          <div className="sm:hidden divide-y" style={{ borderColor: 'var(--border-primary)' }}>
            {joinedRooms.length > 0 ? (
              joinedRooms.map((room) => (
                <div 
                  key={room.id}
                  className="p-4 flex flex-col gap-3 hover:bg-[var(--bg-tertiary)] transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="p-1.5 rounded-lg bg-[var(--accent-muted)] text-[var(--accent)] flex items-center justify-center shrink-0">
                        <MessageSquare size={13} />
                      </div>
                      <div className="min-w-0">
                        <span className="font-bold text-xs block text-[var(--text-primary)] truncate">
                          {room.name}
                        </span>
                        <span className="inline-flex items-center gap-0.5 font-mono text-[9px] text-[var(--text-tertiary)] mt-0.5">
                          <Hash size={8} />
                          {room.id}
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] text-[var(--text-secondary)] shrink-0 mt-0.5">
                      {formatDate(room.joinedAt)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-4 pt-1">
                    <div>
                      {room.visibility === 'public' ? (
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                          <Globe size={9} />
                          Public
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                          <Lock size={9} />
                          Private
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => removeRoom(room.id, e)}
                        className="cursor-pointer p-1.5 rounded-lg border border-[var(--border-primary)] hover:bg-red-50 hover:text-red-600 transition-colors text-[var(--text-tertiary)]"
                        title="Remove from list"
                      >
                        <Trash2 size={12} />
                      </button>
                      {activeRoomIds[room.id] ? (
                        <button
                          onClick={() => handleRoomClick(room.id)}
                          className="cursor-pointer inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-[10px] font-bold shadow-sm hover:bg-[var(--accent-hover)] transition-colors"
                        >
                          Rejoin
                          <ExternalLink size={10} />
                        </button>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-gray-105 text-gray-400 border border-gray-200 text-[9px] font-bold">
                          Deleted Room
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-12 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
                You haven&apos;t joined any rooms yet.
              </div>
            )}
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
