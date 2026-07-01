'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare,
  LogIn,
  Copy,
  Check,
  Share2,
  Users,
  Globe,
  Lock,
  Sparkles,
  Shield,
  Zap,
  ArrowRight,
  Clock,
  Menu,
  X,
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
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
    const failedRoomId = params.get('roomId');
    if (failedRoomId) {
      try {
        const list = JSON.parse(localStorage.getItem('roomchat_joined_rooms') || '[]');
        const filtered = list.filter((r: { id: string }) => r.id !== failedRoomId);
        localStorage.setItem('roomchat_joined_rooms', JSON.stringify(filtered));
      } catch (e) {
        console.error(e);
      }
    }
    if (params.get('error') === 'room_expired') {
      setDashboardError('This room does not exist, has been deleted, or has expired due to inactivity.');
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get('error') === 'room_deleted') {
      setDashboardError('This room has been deleted by its creator.');
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
      className="flex min-h-dvh flex-col relative overflow-x-hidden selection:bg-[var(--accent-muted)] selection:text-[var(--accent-text)]"
      style={{ 
        backgroundColor: '#ffffff',
        color: '#1f2937',
        backgroundImage: `
          radial-gradient(#e5e7eb 1px, transparent 1px),
          radial-gradient(circle at 50% 0%, rgba(99, 102, 241, 0.05) 0%, transparent 60%)
        `,
        backgroundSize: '24px 24px, 100% 100%'
      }}
    >
      {/* Decorative accent gradients */}
      <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-indigo-500/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute top-[30%] left-[-100px] w-[500px] h-[500px] bg-emerald-500/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Navigation Header */}
      <header 
        className="sticky top-0 z-40 w-full backdrop-blur-md border-b border-gray-100 transition-all"
        style={{ backgroundColor: 'rgba(255, 255, 255, 0.8)' }}
      >
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigateToView('main')}>
            <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100/50">
              <MessageSquare size={18} />
            </div>
            <span className="text-lg font-bold tracking-tight text-gray-900">
              RoomChat
            </span>
          </div>

          {/* Desktop Nav menu */}
          <nav className="hidden sm:flex items-center gap-6">
            <a href="#features" className="text-xs font-semibold text-gray-500 hover:text-indigo-600 transition-colors">
              Features
            </a>
            <a href="#how-it-works" className="text-xs font-semibold text-gray-500 hover:text-indigo-600 transition-colors">
              How It Works
            </a>
            <Link href="/public-rooms" className="text-xs font-semibold text-gray-500 hover:text-indigo-600 transition-colors">
              Public Rooms
            </Link>
            <Link href="/recent-rooms" className="text-xs font-semibold text-gray-500 hover:text-indigo-600 transition-colors">
              Recently Joined
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <span className="hidden xs:flex text-[10px] px-2 py-0.5 rounded-full border border-green-100 font-semibold items-center gap-1.5 bg-green-50 text-green-700">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Active
            </span>
            
            {/* Mobile Hamburger menu toggle button */}
            <button 
              onClick={() => setMobileMenuOpen(o => !o)} 
              className="sm:hidden p-2 rounded-lg hover:bg-gray-50 text-gray-500 border border-gray-100 flex items-center justify-center transition-colors cursor-pointer"
            >
              {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Menu Drawer */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="sm:hidden overflow-hidden border-t border-gray-100 bg-white"
            >
              <div className="flex flex-col p-4 gap-2">
                <Link 
                  href="/public-rooms" 
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full text-left py-2.5 px-4 rounded-xl text-sm font-semibold text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                >
                  Explore Public Rooms
                </Link>
                <Link 
                  href="/recent-rooms" 
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full text-left py-2.5 px-4 rounded-xl text-sm font-semibold text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                >
                  Recently Joined Rooms
                </Link>
                <a 
                  href="#features" 
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full text-left py-2.5 px-4 rounded-xl text-sm font-semibold text-gray-500 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                >
                  Features
                </a>
                <a 
                  href="#how-it-works" 
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full text-left py-2.5 px-4 rounded-xl text-sm font-semibold text-gray-500 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                >
                  How It Works
                </a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Main Content Area */}
      <main className="flex-1">
        {/* Hero Section */}
        <section className="mx-auto max-w-5xl px-6 py-12 md:py-20 lg:py-24">
          <div className="grid gap-12 lg:grid-cols-12 lg:items-center">
            
            {/* Hero Text */}
            <div className="lg:col-span-7 flex flex-col justify-center text-left">
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
              >
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-indigo-100/60 bg-indigo-50/30 mb-6">
                  <Shield size={12} className="text-indigo-600" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                    No Signups • No Persisted Data
                  </span>
                </div>
                
                <h1 
                  className="text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl mb-6 leading-[1.08] text-gray-900"
                >
                  Ephemeral spaces <br />
                  for <span className="text-indigo-600">instant</span> chat.
                </h1>
                
                <p 
                  className="text-base md:text-lg font-normal leading-relaxed mb-8 max-w-xl text-gray-500"
                >
                  Create clean, browser-based chat rooms with zero installation or setup. Invite anyone via link, speak freely, and close the tab to delete everything.
                </p>

                {/* Micro-Features Quick List */}
                <div className="grid grid-cols-2 gap-4 max-w-md border-t border-gray-100 pt-6">
                  <div className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                    Clean & Minimalist
                  </div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                    WebSockets Sync
                  </div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                    No Databases Used
                  </div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                    Instant Destruction
                  </div>
                </div>
              </motion.div>
            </div>

            {/* Interactive Tabbed Form Card */}
            <div className="lg:col-span-5">
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.35, delay: 0.05 }}
                className="rounded-2xl border border-gray-100 p-6 sm:p-8 bg-white shadow-xl shadow-gray-200/50"
              >
                <AnimatePresence mode="wait">
                  {view === 'created_success' ? (
                    /* ── Room Created Success View ── */
                    <motion.div key="created_success" {...fade} className="text-center">
                      <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100">
                        <Check size={20} />
                      </div>
                      <h2 className="text-lg font-bold text-gray-900 mb-1">
                        Room Ready
                      </h2>
                      <p className="text-xs text-gray-500 mb-5">
                        {roomName}
                        <span className="ml-2 inline-flex items-center gap-1 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-gray-50 border border-gray-100 text-gray-600">
                          {visibility}
                        </span>
                      </p>

                      {/* Code Block */}
                      <div className="mb-4 rounded-xl border border-gray-100 px-4 py-3 bg-gray-50/50">
                        <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-gray-400">
                          Room Code
                        </p>
                        <div className="flex items-center justify-center gap-2">
                          <span className="font-mono text-lg font-bold tracking-widest text-gray-900">
                            {generatedCode}
                          </span>
                          <button
                            onClick={copyCode}
                            className="cursor-pointer rounded-md p-1.5 hover:bg-gray-100 transition-colors text-gray-500"
                          >
                            {copiedCode ? <Check size={13} /> : <Copy size={13} />}
                          </button>
                        </div>
                      </div>

                      {/* Link Block */}
                      <div className="mb-6 rounded-xl border border-gray-100 px-4 py-3 bg-gray-50/50">
                        <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-gray-400">
                          Invite Link
                        </p>
                        <div className="flex items-center justify-center gap-2">
                          <span className="max-w-[170px] truncate text-xs text-gray-600">
                            {generatedLink}
                          </span>
                          <button
                            onClick={copyLink}
                            className="cursor-pointer rounded-md p-1.5 hover:bg-gray-100 transition-colors text-gray-500"
                          >
                            {copiedLink ? <Check size={13} /> : <Copy size={13} />}
                          </button>
                        </div>
                      </div>

                      <div className="flex gap-3">
                        <button
                          onClick={handleShare}
                          className="flex-1 flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-gray-200 py-2.5 text-xs font-bold bg-white text-gray-700 hover:bg-gray-50 active:scale-[0.98] transition-all"
                        >
                          <Share2 size={13} />
                          Share Link
                        </button>
                        <button
                          onClick={enterRoom}
                          className="flex-1 flex cursor-pointer items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm active:scale-[0.98] transition-all"
                        >
                          Enter Room
                          <ArrowRight size={13} />
                        </button>
                      </div>
                    </motion.div>
                  ) : (
                    /* ── Default Tabbed Main View ── */
                    <motion.div key="tabs" {...fade} className="flex flex-col">
                      {/* Shared Display Name at Top */}
                      <div className="mb-6">
                        <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-gray-400">
                          Your Display Name
                        </label>
                        <input
                          type="text"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder="What should people call you?"
                          maxLength={30}
                          className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none transition-all focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-gray-900 bg-white"
                        />
                      </div>

                      {/* View selector tabs */}
                      <div className="flex rounded-xl p-1 bg-gray-50 border border-gray-100 mb-6">
                        <button
                          onClick={() => navigateToView('main')}
                          className={`flex-1 text-center py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                            view === 'main' || view === 'create'
                              ? 'bg-white text-indigo-600 shadow-sm'
                              : 'text-gray-500 hover:text-gray-800'
                          }`}
                        >
                          Create Room
                        </button>
                        <button
                          onClick={() => navigateToView('join')}
                          className={`flex-1 text-center py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                            view === 'join'
                              ? 'bg-white text-indigo-600 shadow-sm'
                              : 'text-gray-500 hover:text-gray-800'
                          }`}
                        >
                          Join Room
                        </button>
                      </div>

                      {/* Active Tab Panel */}
                      {view === 'join' ? (
                        /* Join Room Panel */
                        <div className="space-y-4">
                          <div>
                            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-gray-400">
                              Room Code or Link
                            </label>
                            <input
                              type="text"
                              value={roomCode}
                              onChange={(e) => setRoomCode(e.target.value)}
                              placeholder="e.g. Code or URL"
                              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none transition-all focus:border-indigo-600 text-gray-900 bg-white"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleJoin();
                              }}
                            />
                          </div>

                          {error && (
                            <p className="text-xs font-semibold text-red-600 text-center">{error}</p>
                          )}

                          <button
                            onClick={handleJoin}
                            className="w-full flex cursor-pointer items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm active:scale-[0.98] transition-all"
                          >
                            <LogIn size={14} />
                            Join Room
                          </button>
                        </div>
                      ) : (
                        /* Create Room Panel */
                        <div className="space-y-4">
                          <div>
                            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-gray-400">
                              Room Name
                            </label>
                            <input
                              type="text"
                              value={roomName}
                              onChange={(e) => setRoomName(e.target.value)}
                              placeholder="e.g. Brainstorming"
                              maxLength={40}
                              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none transition-all focus:border-indigo-600 text-gray-900 bg-white"
                            />
                          </div>

                          <div>
                            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-gray-400">
                              Visibility
                            </label>
                            <div className="flex gap-2">
                              <button
                                onClick={() => setVisibility('public')}
                                className="flex-1 flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-bold transition-all"
                                style={{
                                  backgroundColor: visibility === 'public' ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
                                  borderColor: visibility === 'public' ? 'var(--accent)' : '#e5e7eb',
                                  color: visibility === 'public' ? 'var(--accent)' : '#6b7280',
                                }}
                              >
                                <Globe size={13} />
                                Public
                              </button>
                              <button
                                onClick={() => setVisibility('private')}
                                className="flex-1 flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-bold transition-all"
                                style={{
                                  backgroundColor: visibility === 'private' ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
                                  borderColor: visibility === 'private' ? 'var(--accent)' : '#e5e7eb',
                                  color: visibility === 'private' ? 'var(--accent)' : '#6b7280',
                                }}
                              >
                                <Lock size={13} />
                                Private
                              </button>
                            </div>
                          </div>

                          {error && (
                            <p className="text-xs font-semibold text-red-600 text-center">{error}</p>
                          )}

                          <button
                            onClick={handleCreate}
                            className="w-full flex cursor-pointer items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm active:scale-[0.98] transition-all"
                          >
                            <Sparkles size={14} />
                            Create Room
                          </button>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </div>

          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="py-20 border-t border-b border-gray-100 bg-gray-50/50">
          <div className="mx-auto max-w-5xl px-6">
            <div className="text-center max-w-xl mx-auto mb-16">
              <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl mb-3">
                Modern chat architecture
              </h2>
              <p className="text-sm text-gray-500">
                A simple application engineered for clean, rapid communication without compromising browser performance or safety.
              </p>
            </div>

            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {/* Feature 1 */}
              <div className="p-6 rounded-2xl border border-gray-100 bg-white shadow-sm transition-transform hover:-translate-y-0.5 duration-255">
                <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600 inline-flex items-center justify-center mb-4 border border-indigo-100/50">
                  <Shield size={18} />
                </div>
                <h3 className="text-sm font-bold text-gray-900 mb-1.5">
                  100% Anonymous
                </h3>
                <p className="text-xs leading-relaxed text-gray-500">
                  We don&apos;t collect cookies, log ip addresses, or require accounts. Enter a display name, and start typing.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="p-6 rounded-2xl border border-gray-100 bg-white shadow-sm transition-transform hover:-translate-y-0.5 duration-255">
                <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600 inline-flex items-center justify-center mb-4 border border-indigo-100/50">
                  <Clock size={18} />
                </div>
                <h3 className="text-sm font-bold text-gray-900 mb-1.5">
                  Ephemeral System
                </h3>
                <p className="text-xs leading-relaxed text-gray-500">
                  All messages stay within server memory variables. As soon as a room is abandoned, all traces are instantly deleted.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="p-6 rounded-2xl border border-gray-100 bg-white shadow-sm transition-transform hover:-translate-y-0.5 duration-255">
                <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600 inline-flex items-center justify-center mb-4 border border-indigo-100/50">
                  <Zap size={18} />
                </div>
                <h3 className="text-sm font-bold text-gray-900 mb-1.5">
                  Real-time WebSockets
                </h3>
                <p className="text-xs leading-relaxed text-gray-500">
                  Engineered using Socket.io to deliver real-time messages, user indicators, and image/media uploads in milliseconds.
                </p>
              </div>

              {/* Feature 4 */}
              <div className="p-6 rounded-2xl border border-gray-100 bg-white shadow-sm transition-transform hover:-translate-y-0.5 duration-255">
                <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600 inline-flex items-center justify-center mb-4 border border-indigo-100/50">
                  <Globe size={18} />
                </div>
                <h3 className="text-sm font-bold text-gray-900 mb-1.5">
                  Visibility Choice
                </h3>
                <p className="text-xs leading-relaxed text-gray-500">
                  Set rooms to Public to receive users from the home page index, or Private to lock entry behind custom link invites.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section id="how-it-works" className="py-20">
          <div className="mx-auto max-w-5xl px-6">
            <div className="text-center max-w-xl mx-auto mb-16">
              <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl mb-3">
                How It Works
              </h2>
              <p className="text-sm text-gray-500">
                Get started in under ten seconds. The simple workflow is designed for frictionless messaging.
              </p>
            </div>

            <div className="grid gap-8 md:grid-cols-3 relative">
              <div className="flex flex-col items-center text-center p-4">
                <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-xs mb-4">
                  1
                </div>
                <h3 className="text-sm font-bold text-gray-900 mb-1.5">Pick Nickname</h3>
                <p className="text-xs leading-relaxed text-gray-500">
                  Type a display name. This helps users identify your messages in active channels.
                </p>
              </div>

              <div className="flex flex-col items-center text-center p-4">
                <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-xs mb-4">
                  2
                </div>
                <h3 className="text-sm font-bold text-gray-900 mb-1.5">Create or Share</h3>
                <p className="text-xs leading-relaxed text-gray-500">
                  Create a public or private room, or paste an existing invitation link.
                </p>
              </div>

              <div className="flex flex-col items-center text-center p-4">
                <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-xs mb-4">
                  3
                </div>
                <h3 className="text-sm font-bold text-gray-900 mb-1.5">Message & Discard</h3>
                <p className="text-xs leading-relaxed text-gray-500">
                  Send texts, images, and links. Close the tab to end the socket and clear history.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Public Rooms Section */}
        <section id="public-rooms" className="py-20 border-t border-gray-100 bg-gray-50/50">
          <div className="mx-auto max-w-5xl px-6">
            <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-4">
              <div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-indigo-100 bg-white text-indigo-600 font-semibold text-[10px] uppercase tracking-wider mb-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
                  Live Room Index
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
                  Public Rooms on Server
                </h2>
                <p className="text-xs text-gray-500 mt-1">
                  Active rooms hosted on the server right now. Select a room below to join the chat directly.
                </p>
              </div>
            </div>

            {publicRooms.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {publicRooms.map((room) => (
                  <div
                    key={room.code}
                    className="flex flex-col justify-between rounded-xl border border-gray-100 p-5 bg-white shadow-sm transition-transform hover:-translate-y-0.5"
                  >
                    <div className="mb-4">
                      <h3 className="font-bold text-sm text-gray-900 truncate mb-1">
                        {room.name}
                      </h3>
                      <div className="flex items-center gap-1.5 text-xs text-gray-400">
                        <Users size={11} />
                        <span>
                          {room.users} {room.users === 1 ? 'member' : 'members'} online
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => joinPublicRoom(room.code)}
                      className="cursor-pointer w-full rounded-lg py-2 text-xs font-bold text-center transition-colors flex items-center justify-center gap-1 bg-indigo-50 hover:bg-indigo-600 text-indigo-600 hover:text-white border border-indigo-100/50"
                    >
                      Join Room
                      <ArrowRight size={11} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-gray-200 p-12 text-center bg-white shadow-sm">
                <Users size={28} className="mx-auto mb-3 text-gray-300" />
                <h3 className="font-bold text-sm text-gray-900 mb-1">
                  No Public Rooms Active
                </h3>
                <p className="text-xs max-w-sm mx-auto mb-6 text-gray-400">
                  There are currently no public rooms online. Create a new room with Public visibility to see it appear here.
                </p>
                <button
                  onClick={() => {
                    setView('main');
                    setVisibility('public');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold border border-gray-200 cursor-pointer bg-white text-gray-700 hover:bg-gray-50 active:scale-[0.98] transition-all"
                >
                  Start First Public Room
                  <ArrowRight size={11} />
                </button>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-12 bg-white">
        <div className="mx-auto max-w-5xl px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <MessageSquare size={13} />
            </div>
            <span className="text-sm font-semibold tracking-tight text-gray-800">
              RoomChat
            </span>
          </div>

          <p className="text-xs text-gray-400">
            &copy; {new Date().getFullYear()} RoomChat. Clean WebSockets instance.
          </p>
        </div>
      </footer>
    
      {/* Dashboard Error Overlay Modal */}
      <AnimatePresence>
        {dashboardError && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setDashboardError(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="relative max-w-sm w-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-2xl overflow-hidden shadow-2xl z-10 flex flex-col p-6 gap-4 text-center"
            >
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600 border border-red-100">
                <Shield size={22} className="text-red-500" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[var(--text-primary)] mb-1">
                  Access Notification
                </h3>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  {dashboardError}
                </p>
              </div>
              <div className="pt-2">
                <button
                  onClick={() => setDashboardError(null)}
                  className="w-full py-2.5 rounded-xl bg-[var(--accent)] text-white text-xs font-semibold hover:bg-[var(--accent-hover)] transition-colors shadow-sm cursor-pointer"
                >
                  Close Message
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
</div>
  );
}