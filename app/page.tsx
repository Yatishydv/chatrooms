'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare,
  Plus,
  LogIn,
  ArrowLeft,
  Copy,
  Check,
  Share2,
  Users,
  Globe,
  Lock,
  Sparkles,
} from 'lucide-react';

type View = 'main' | 'create' | 'join' | 'created_success';
type Visibility = 'public' | 'private';

interface PublicRoom {
  code: string;
  name: string;
  users: number;
}

const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.15 },
};

function generateCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function extractCode(input: string): string {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split('/').filter(Boolean);
    const chatIndex = segments.indexOf('chat');
    if (chatIndex !== -1 && segments[chatIndex + 1]) {
      return segments[chatIndex + 1];
    }
    return segments[segments.length - 1] || trimmed;
  } catch {
    return trimmed;
  }
}

export default function HomePage() {
  const router = useRouter();

  const [view, setView] = useState<View>('main');
  const [displayName, setDisplayName] = useState('');
  const [roomName, setRoomName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);
  const [error, setError] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [generatedLink, setGeneratedLink] = useState('');

  // Load display name, theme, and accent from localStorage + query params
  useEffect(() => {
    const saved = localStorage.getItem('roomchat_display_name');
    if (saved) setDisplayName(saved);

    const savedTheme = localStorage.getItem('roomchat_theme') as 'dark' | 'light' | null;
    if (savedTheme) {
      document.documentElement.dataset.theme = savedTheme;
    } else {
      document.documentElement.dataset.theme = 'light';
    }

    const savedAccent = localStorage.getItem('roomchat_accent') || 'indigo';
    document.documentElement.dataset.accent = savedAccent;

    // Check for room error redirect
    const params = new URLSearchParams(window.location.search);
    if (params.get('error') === 'room_expired') {
      setError('This room does not exist or has expired. Please create a new room.');
      // Clean query parameters from URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Save display name to localStorage
  useEffect(() => {
    if (displayName.trim()) {
      localStorage.setItem('roomchat_display_name', displayName.trim());
    }
  }, [displayName]);

  // Socket.IO for public rooms
  useEffect(() => {
    const socket: Socket = io({ transports: ['websocket', 'polling'] });

    socket.on('public_rooms_update', (rooms: PublicRoom[]) => {
      setPublicRooms(rooms);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const handleCreate = useCallback(() => {
    setError('');
    if (!displayName.trim()) {
      setError('Please enter a display name.');
      return;
    }
    if (!roomName.trim()) {
      setError('Please enter a room name.');
      return;
    }
    const code = generateCode();
    const link = `${window.location.origin}/chat/${code}`;
    const creatorKey = typeof window !== 'undefined' && window.crypto?.randomUUID ? window.crypto.randomUUID() : Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
    
    setGeneratedCode(code);
    setGeneratedLink(link);
    localStorage.setItem(`room_creator_key_${code}`, creatorKey);
    localStorage.setItem(`room_title_${code}`, roomName.trim());
    localStorage.setItem(`room_visibility_${code}`, visibility);
    setView('created_success');
  }, [displayName, roomName, visibility]);

  const handleJoin = useCallback(() => {
    setError('');
    if (!displayName.trim()) {
      setError('Please enter a display name.');
      return;
    }
    if (!roomCode.trim()) {
      setError('Please enter a room code or invite link.');
      return;
    }
    const code = extractCode(roomCode);
    if (!code) {
      setError('Invalid room code or link.');
      return;
    }
    localStorage.setItem('roomchat_display_name', displayName.trim());
    router.push(`/chat/${code}`);
  }, [displayName, roomCode, router]);

  const handleShare = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join my RoomChat',
          text: `Join my chat room! Code: ${generatedCode}`,
          url: generatedLink,
        });
      } catch {
        // User cancelled share
      }
    } else {
      await navigator.clipboard.writeText(generatedLink);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  }, [generatedCode, generatedLink]);

  const copyCode = useCallback(async () => {
    await navigator.clipboard.writeText(generatedCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  }, [generatedCode]);

  const copyLink = useCallback(async () => {
    await navigator.clipboard.writeText(generatedLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }, [generatedLink]);

  const navigateToView = (v: View) => {
    setError('');
    setView(v);
  };

  const enterRoom = () => {
    localStorage.setItem('roomchat_display_name', displayName.trim());
    router.push(`/chat/${generatedCode}`);
  };

  const joinPublicRoom = (code: string) => {
    if (!displayName.trim()) {
      setError('Please enter a display name first.');
      return;
    }
    localStorage.setItem('roomchat_display_name', displayName.trim());
    router.push(`/chat/${code}`);
  };

  return (
    <div
      className="flex min-h-dvh flex-col relative overflow-hidden"
      style={{ 
        backgroundColor: 'var(--bg-primary)',
        backgroundImage: 'radial-gradient(circle at 50% 0%, var(--accent-muted) 0%, transparent 60%)'
      }}
    >
      {/* Ambient glowing orb */}
      <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[350px] h-[350px] md:w-[500px] md:h-[500px] bg-[var(--accent)]/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 relative z-10">
        <div className="w-full max-w-md">
          {/* Header */}
          <motion.div 
            initial={{ opacity: 0, y: -15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="mb-8 text-center"
          >
            <div className="mb-3 flex items-center justify-center gap-2">
              <div className="p-2.5 rounded-2xl bg-[var(--accent-muted)] text-[var(--accent)] flex items-center justify-center shadow-sm">
                <MessageSquare size={26} />
              </div>
              <h1
                className="text-3xl font-bold tracking-tight"
                style={{ color: 'var(--text-primary)' }}
              >
                RoomChat
              </h1>
            </div>
            <p
              className="text-sm font-medium"
              style={{ color: 'var(--text-secondary)' }}
            >
              Anonymous instant chat rooms • No registration
            </p>
          </motion.div>

          {/* Card */}
          <div
            className="rounded-2xl border p-6 shadow-xl backdrop-blur-md"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              borderColor: 'var(--border-primary)',
              boxShadow: 'var(--shadow)',
            }}
          >
            <AnimatePresence mode="wait">
              {/* ── Main View ── */}
              {view === 'main' && (
                <motion.div key="main" {...fade}>
                  {/* Display Name */}
                  <div className="mb-6">
                    <label
                      className="mb-1.5 block text-sm font-medium"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      Display Name
                    </label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Enter your name"
                      maxLength={30}
                      className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-[var(--accent)]"
                      style={{
                        backgroundColor: 'var(--bg-tertiary)',
                        borderColor: 'var(--border-primary)',
                        color: 'var(--text-primary)',
                      }}
                    />
                  </div>

                  {/* Action Buttons */}
                  <div className="mb-6 flex gap-3">
                    <button
                      onClick={() => navigateToView('create')}
                      className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
                      style={{
                        backgroundColor: 'var(--accent)',
                        color: '#fff',
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor =
                          'var(--accent-hover)')
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor =
                          'var(--accent)')
                      }
                    >
                      <Plus size={16} />
                      Create Room
                    </button>
                    <button
                      onClick={() => navigateToView('join')}
                      className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
                      style={{
                        backgroundColor: 'var(--bg-tertiary)',
                        color: 'var(--text-primary)',
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor =
                          'var(--bg-hover)')
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor =
                          'var(--bg-tertiary)')
                      }
                    >
                      <LogIn size={16} />
                      Join Room
                    </button>
                  </div>

                  {/* Error */}
                  {error && (
                    <p
                      className="mb-4 text-center text-sm"
                      style={{ color: '#ef4444' }}
                    >
                      {error}
                    </p>
                  )}

                  {/* Public Rooms */}
                  {publicRooms.length > 0 && (
                    <div>
                      <div
                        className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        <Globe size={12} />
                        Public Rooms
                      </div>
                      <div className="space-y-2">
                        {publicRooms.map((room) => (
                          <div
                            key={room.code}
                            className="flex items-center justify-between rounded-lg border px-3 py-2.5"
                            style={{
                              backgroundColor: 'var(--bg-tertiary)',
                              borderColor: 'var(--border-secondary)',
                            }}
                          >
                            <div className="min-w-0 flex-1">
                              <p
                                className="truncate text-sm font-medium"
                                style={{ color: 'var(--text-primary)' }}
                              >
                                {room.name}
                              </p>
                              <p
                                className="flex items-center gap-1 text-xs"
                                style={{ color: 'var(--text-tertiary)' }}
                              >
                                <Users size={10} />
                                {room.users}{' '}
                                {room.users === 1 ? 'user' : 'users'}
                              </p>
                            </div>
                            <button
                              onClick={() => joinPublicRoom(room.code)}
                              className="ml-3 cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                              style={{
                                backgroundColor: 'var(--accent-muted)',
                                color: 'var(--accent)',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor =
                                  'var(--accent)';
                                e.currentTarget.style.color = '#fff';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor =
                                  'var(--accent-muted)';
                                e.currentTarget.style.color = 'var(--accent)';
                              }}
                            >
                              Join
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {/* ── Create View ── */}
              {view === 'create' && (
                <motion.div key="create" {...fade}>
                  <button
                    onClick={() => navigateToView('main')}
                    className="mb-4 flex cursor-pointer items-center gap-1 text-sm"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <ArrowLeft size={14} />
                    Back
                  </button>

                  <h2
                    className="mb-5 text-lg font-semibold"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    Create a Room
                  </h2>

                  <div className="space-y-4">
                    {/* Display Name */}
                    <div>
                      <label
                        className="mb-1.5 block text-sm font-medium"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        Display Name
                      </label>
                      <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Enter your name"
                        maxLength={30}
                        className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-[var(--accent)]"
                        style={{
                          backgroundColor: 'var(--bg-tertiary)',
                          borderColor: 'var(--border-primary)',
                          color: 'var(--text-primary)',
                        }}
                      />
                    </div>

                    {/* Room Name */}
                    <div>
                      <label
                        className="mb-1.5 block text-sm font-medium"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        Room Name
                      </label>
                      <input
                        type="text"
                        value={roomName}
                        onChange={(e) => setRoomName(e.target.value)}
                        placeholder="e.g. Study Group"
                        maxLength={40}
                        className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-[var(--accent)]"
                        style={{
                          backgroundColor: 'var(--bg-tertiary)',
                          borderColor: 'var(--border-primary)',
                          color: 'var(--text-primary)',
                        }}
                      />
                    </div>

                    {/* Visibility */}
                    <div>
                      <label
                        className="mb-1.5 block text-sm font-medium"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        Visibility
                      </label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setVisibility('public')}
                          className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors"
                          style={{
                            backgroundColor:
                              visibility === 'public'
                                ? 'var(--accent-muted)'
                                : 'var(--bg-tertiary)',
                            borderColor:
                              visibility === 'public'
                                ? 'var(--accent)'
                                : 'var(--border-primary)',
                            color:
                              visibility === 'public'
                                ? 'var(--accent)'
                                : 'var(--text-secondary)',
                          }}
                        >
                          <Globe size={14} />
                          Public
                        </button>
                        <button
                          onClick={() => setVisibility('private')}
                          className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors"
                          style={{
                            backgroundColor:
                              visibility === 'private'
                                ? 'var(--accent-muted)'
                                : 'var(--bg-tertiary)',
                            borderColor:
                              visibility === 'private'
                                ? 'var(--accent)'
                                : 'var(--border-primary)',
                            color:
                              visibility === 'private'
                                ? 'var(--accent)'
                                : 'var(--text-secondary)',
                          }}
                        >
                          <Lock size={14} />
                          Private
                        </button>
                      </div>
                    </div>

                    {/* Error */}
                    {error && (
                      <p className="text-sm" style={{ color: '#ef4444' }}>
                        {error}
                      </p>
                    )}

                    {/* Create Button */}
                    <button
                      onClick={handleCreate}
                      className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
                      style={{
                        backgroundColor: 'var(--accent)',
                        color: '#fff',
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor =
                          'var(--accent-hover)')
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor =
                          'var(--accent)')
                      }
                    >
                      <Sparkles size={16} />
                      Create Room
                    </button>
                  </div>
                </motion.div>
              )}

              {/* ── Join View ── */}
              {view === 'join' && (
                <motion.div key="join" {...fade}>
                  <button
                    onClick={() => navigateToView('main')}
                    className="mb-4 flex cursor-pointer items-center gap-1 text-sm"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <ArrowLeft size={14} />
                    Back
                  </button>

                  <h2
                    className="mb-5 text-lg font-semibold"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    Join a Room
                  </h2>

                  <div className="space-y-4">
                    {/* Display Name */}
                    <div>
                      <label
                        className="mb-1.5 block text-sm font-medium"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        Display Name
                      </label>
                      <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Enter your name"
                        maxLength={30}
                        className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-[var(--accent)]"
                        style={{
                          backgroundColor: 'var(--bg-tertiary)',
                          borderColor: 'var(--border-primary)',
                          color: 'var(--text-primary)',
                        }}
                      />
                    </div>

                    {/* Room Code */}
                    <div>
                      <label
                        className="mb-1.5 block text-sm font-medium"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        Room Code or Invite Link
                      </label>
                      <input
                        type="text"
                        value={roomCode}
                        onChange={(e) => setRoomCode(e.target.value)}
                        placeholder="e.g. Abc123 or https://..."
                        className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-[var(--accent)]"
                        style={{
                          backgroundColor: 'var(--bg-tertiary)',
                          borderColor: 'var(--border-primary)',
                          color: 'var(--text-primary)',
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleJoin();
                        }}
                      />
                    </div>

                    {/* Error */}
                    {error && (
                      <p className="text-sm" style={{ color: '#ef4444' }}>
                        {error}
                      </p>
                    )}

                    {/* Join Button */}
                    <button
                      onClick={handleJoin}
                      className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
                      style={{
                        backgroundColor: 'var(--accent)',
                        color: '#fff',
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor =
                          'var(--accent-hover)')
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor =
                          'var(--accent)')
                      }
                    >
                      <LogIn size={16} />
                      Join Room
                    </button>
                  </div>
                </motion.div>
              )}

              {/* ── Created Success View ── */}
              {view === 'created_success' && (
                <motion.div key="created_success" {...fade}>
                  <div className="text-center">
                    <div
                      className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
                      style={{ backgroundColor: 'var(--accent-muted)' }}
                    >
                      <Check size={24} style={{ color: 'var(--accent)' }} />
                    </div>
                    <h2
                      className="mb-1 text-lg font-semibold"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      Room Created
                    </h2>
                    <p
                      className="mb-6 text-sm"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {roomName}
                      <span
                        className="ml-2 inline-flex items-center gap-1 text-xs"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        {visibility === 'public' ? (
                          <Globe size={10} />
                        ) : (
                          <Lock size={10} />
                        )}
                        {visibility}
                      </span>
                    </p>

                    {/* Room Code */}
                    <div
                      className="mb-4 rounded-lg border px-4 py-3"
                      style={{
                        backgroundColor: 'var(--bg-tertiary)',
                        borderColor: 'var(--border-secondary)',
                      }}
                    >
                      <p
                        className="mb-1 text-xs font-medium uppercase tracking-wide"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        Room Code
                      </p>
                      <div className="flex items-center justify-center gap-2">
                        <span
                          className="font-mono text-xl font-bold tracking-widest"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {generatedCode}
                        </span>
                        <button
                          onClick={copyCode}
                          className="cursor-pointer rounded-md p-1.5 transition-colors"
                          style={{ color: 'var(--text-tertiary)' }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.backgroundColor =
                              'var(--bg-hover)')
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.backgroundColor =
                              'transparent')
                          }
                        >
                          {copiedCode ? (
                            <Check size={14} />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Invite Link */}
                    <div
                      className="mb-5 rounded-lg border px-4 py-3"
                      style={{
                        backgroundColor: 'var(--bg-tertiary)',
                        borderColor: 'var(--border-secondary)',
                      }}
                    >
                      <p
                        className="mb-1 text-xs font-medium uppercase tracking-wide"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        Invite Link
                      </p>
                      <div className="flex items-center justify-center gap-2">
                        <span
                          className="max-w-[200px] truncate text-sm"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {generatedLink}
                        </span>
                        <button
                          onClick={copyLink}
                          className="cursor-pointer rounded-md p-1.5 transition-colors"
                          style={{ color: 'var(--text-tertiary)' }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.backgroundColor =
                              'var(--bg-hover)')
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.backgroundColor =
                              'transparent')
                          }
                        >
                          {copiedLink ? (
                            <Check size={14} />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3">
                      <button
                        onClick={handleShare}
                        className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
                        style={{
                          backgroundColor: 'var(--bg-tertiary)',
                          color: 'var(--text-primary)',
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.backgroundColor =
                            'var(--bg-hover)')
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.backgroundColor =
                            'var(--bg-tertiary)')
                        }
                      >
                        <Share2 size={14} />
                        Share
                      </button>
                      <button
                        onClick={enterRoom}
                        className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
                        style={{
                          backgroundColor: 'var(--accent)',
                          color: '#fff',
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.backgroundColor =
                            'var(--accent-hover)')
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.backgroundColor =
                            'var(--accent)')
                        }
                      >
                        <MessageSquare size={14} />
                        Enter Room
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer */}
          <p
            className="mt-6 text-center text-xs"
            style={{ color: 'var(--text-tertiary)' }}
          >
            &copy; {new Date().getFullYear()} RoomChat. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
