'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import {
  Send, Image as ImageIcon, Settings, Users, Copy, Check,
  ArrowLeft, Trash2, X, Download, Volume2, VolumeX,
  Search, Sun, Moon, Sparkles, Globe, Lock, CornerUpLeft, Video, Link2, Paperclip, MoreVertical, MessageSquare, Pencil,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import NextImage from 'next/image';
import { motion } from 'framer-motion';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Message {
  id: string;
  sender: string;
  content: string;
  type: 'text' | 'image' | 'voice' | 'view_once_video' | 'video' | 'view_once_image' | 'join_request';
  mediaUrl?: string;
  timestamp: string;
  delivered: boolean;
  seen: boolean;
  status?: 'pending' | 'approved' | 'declined';
  requesterName?: string;
  requesterUserKey?: string;
  requesterSocketId?: string;
  isEdited?: boolean;
  reactions?: { [username: string]: string };
  replyTo?: {
    id: string;
    sender: string;
    content: string;
    type: 'text' | 'image' | 'voice' | 'view_once_video' | 'video' | 'view_once_image' | 'join_request';
  };
}

type AccentColor = 'indigo' | 'emerald' | 'rose' | 'amber' | 'cyan';

const EMBED_BLOCKLIST = [
  'accounts.google.com',
  'mail.google.com',
  'drive.google.com',
  'docs.google.com',
  'calendar.google.com',
  'maps.google.com',
  'play.google.com',
];

function isGoogleHomePage(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const isGoogleHost = host === 'google.com' || host.endsWith('.google.com');
    const isHomePath = parsed.pathname === '/' || parsed.pathname === '';
    return isGoogleHost && isHomePath && !parsed.searchParams.has('q');
  } catch {
    return url === 'https://www.google.com' || url === 'https://google.com';
  }
}

function isGoogleSearchPage(url: string): boolean {
  return /google\.(com|co\.\w+)\/search/i.test(url);
}

function isYouTubeWatchUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    // youtube.com/watch or m.youtube.com/watch
    return (host === 'youtube.com' || host === 'youtube-nocookie.com') && u.pathname === '/watch';
  } catch {
    return false;
  }
}

function getEmbedRestriction(url: string): string | null {
  if (isGoogleHomePage(url) || isGoogleSearchPage(url)) {
    return null;
  }

  // YouTube often blocks embedding of watch pages (age-restricted / consent / X-Frame-Options)
  // so force users to open in a real new tab.
  if (isYouTubeWatchUrl(url)) {
    return 'This YouTube page cannot be embedded here (age-restricted or blocked in iframe). Open it in a new tab to watch.';
  }

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const normalized = hostname.replace(/^www\./, '');
    if (EMBED_BLOCKLIST.includes(hostname) || EMBED_BLOCKLIST.includes(normalized) || normalized.endsWith('.google.com')) {
      return 'This page cannot be embedded here because of browser security restrictions. Open it in a new tab to continue.';
    }
  } catch {
    // Ignore invalid URLs here and let the browser handle them normally.
  }
  return null;
}

const ACCENT_COLORS: { name: AccentColor; ring: string }[] = [
  { name: 'indigo', ring: '#6366f1' },
  { name: 'emerald', ring: '#10b981' },
  { name: 'rose',    ring: '#f43f5e' },
  { name: 'amber',   ring: '#f59e0b' },
  { name: 'cyan',    ring: '#06b6d4' },
];

const REACTION_EMOJIS = ['❤️', '🙌', '😂', '😮', '😢', '🔥', '👏'];

const AnimatePresence = ({ children }: { children: React.ReactNode }) => <>{children}</>;

const EMOJI_CATEGORIES = [
  {
    name: 'Smileys',
    emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😋', '😛', '😜', '🤪', '😎', '🥳', '😏', '😒', '😞', '😔', '😟', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '🤫', '🤔', '😶', '😐', '😑', '😬', '🙄', '😯', '😮', '😴']
  },
  {
    name: 'Gestures',
    emojis: ['👍', '👎', '👊', '✊', '🤛', '🤜', '🤞', '✌️', '🤟', '🤘', '👌', '🤌', '🤏', '👈', '👉', '👆', '👇', '☝️', '✋', '👋', '🤙', '💪', '🙏', '👏', '🙌', '✍️', '💅', '🤝']
  },
  {
    name: 'Hearts & Fun',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '🔥', '✨', '🌟', '⭐', '🎈', '🎉', '💯', '💥', '💤']
  }
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ChatRoom() {
  const params  = useParams();
  const router  = useRouter();
  const roomId  = params.roomId as string;

  /* ---- refs ---- */
  const socketRef       = useRef<Socket | null>(null);
  const messagesEndRef  = useRef<HTMLDivElement>(null);
  const fileInputRef    = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const typingTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasJoinedRef    = useRef(false);
  const replyingToMessageRef = useRef<Message | null>(null);
  const lastTapRef      = useRef<{ [msgId: string]: number }>({});
  const touchStartRef   = useRef<{ x: number; y: number } | null>(null);
  const activeSwipeMsgIdRef = useRef<string | null>(null);
  const swipeOffsetRef  = useRef<number>(0);
  const isSwipingRef    = useRef<boolean>(false);

  /* ---- state: identity ---- */
  const [displayName, setDisplayName]   = useState('');
  const [nameInput, setNameInput]       = useState('');
  const [hasName, setHasName]           = useState(false);
  const [isMounted, setIsMounted]       = useState(false);

  /* ---- state: room ---- */
  const [roomName, setRoomName]     = useState('');
  const [isPublic, setIsPublic]     = useState(true);
  const [isCreator, setIsCreator]   = useState(false);
  const [users, setUsers]           = useState<{ name: string; online: boolean }[]>([]);
  const [messages, setMessages]     = useState<Message[]>([]);
  const [approvalStatus, setApprovalStatus] = useState<'none' | 'requesting' | 'pending' | 'approved' | 'declined'>('none');

  /* ---- state: input ---- */
  const [text, setText]             = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview]   = useState<string | null>(null);

  /* ---- state: ui ---- */
  const [showMembers, setShowMembers]     = useState(false);
  const [showSettings, setShowSettings]   = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showSearch, setShowSearch]       = useState(false);
  const [showMenu, setShowMenu]           = useState(false);
  const [searchQuery, setSearchQuery]     = useState('');
  const [copiedLink, setCopiedLink]       = useState(false);
  const [copiedCode, setCopiedCode]       = useState(false);
  const [isJoining, setIsJoining]         = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [hoveredMsg, setHoveredMsg]       = useState<string | null>(null);
  const [replyingToMessage, setReplyingToMessage] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage]   = useState<Message | null>(null);
  const [viewportHeight, setViewportHeight]   = useState<string>('100dvh');
  const [showAllReactionsForMsg, setShowAllReactionsForMsg] = useState<string | null>(null);
  const [showGoogleSearch, setShowGoogleSearch] = useState(false);
  const [googleSearchQuery, setGoogleSearchQuery] = useState('');
  const [googleSearchResults, setGoogleSearchResults] = useState<{
    title: string;
    url: string;
    snippet: string;
    imageUrl?: string;
    videoUrl?: string;
    videoDuration?: string;
    kind?: 'web' | 'image' | 'video' | 'news';
  }[]>([]);
  const [browserUrl, setBrowserUrl] = useState('https://www.google.com');
  const [addressInput, setAddressInput] = useState('https://www.google.com');
  const [browserActiveTab, setBrowserActiveTab] = useState<'all' | 'images' | 'videos' | 'news'>('all');
  const [browserHistory, setBrowserHistory] = useState<string[]>(['https://www.google.com']);
  const [browserHistoryIndex, setBrowserHistoryIndex] = useState(0);
  const [browserMode, setBrowserMode] = useState<'collaborative' | 'presenter'>('collaborative');
  const [browserSafeSearch, setBrowserSafeSearch] = useState<'off' | 'moderate' | 'strict'>('off');
  const [browserLastNavigatedBy, setBrowserLastNavigatedBy] = useState<string>('');
  const [browserPageTitle, setBrowserPageTitle] = useState<string>('Google');
  const [browserPageFavicon, setBrowserPageFavicon] = useState<string>('https://www.google.com/favicon.ico');
  const [browserZoomScale, setBrowserZoomScale] = useState<number>(1.0);
  const [browserBookmarks, setBrowserBookmarks] = useState<{ title: string; url: string }[]>([]);
  const [isIframeLoading, setIsIframeLoading] = useState<boolean>(false);
  const [browserSize, setBrowserSize] = useState<'normal' | 'wide' | 'fullscreen'>('normal');
  const [searchVideoPreviewUrl, setSearchVideoPreviewUrl] = useState<string | null>(null);
  const [searchImagePreviewUrl, setSearchImagePreviewUrl] = useState<string | null>(null);
  const [viewOnceVideoToPlay, setViewOnceVideoToPlay] = useState<string | null>(null);
  const [viewOnceVideoMessageId, setViewOnceVideoMessageId] = useState<string | null>(null);
  const [showVideoPopup, setShowVideoPopup] = useState(false);
  const [isViewOnceChecked, setIsViewOnceChecked] = useState(false);
  const [isModalViewOnce, setIsModalViewOnce] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showImagePopup, setShowImagePopup] = useState(false);
  const [viewOnceImageToPlay, setViewOnceImageToPlay] = useState<string | null>(null);
  const [browserEmbedError, setBrowserEmbedError] = useState<string | null>(null);
  const [browserFrame, setBrowserFrame] = useState<string | null>(null);
  const [browserLoading, setBrowserLoading] = useState<boolean>(false);
  const [isSocketConnected, setIsSocketConnected] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const browserInitializedRef = useRef(false);

  const onGoogleHome = isGoogleHomePage(browserUrl);
  const onGoogleSearch = isGoogleSearchPage(browserUrl);
  const shouldShowLiveSearchResults = Boolean(googleSearchQuery && onGoogleSearch);
  const embedRestrictionMessage = useMemo(() => getEmbedRestriction(browserUrl), [browserUrl]);
  const shouldRenderEmbeddedFrame = !browserEmbedError && !embedRestrictionMessage && !onGoogleHome && !onGoogleSearch;

  /* ---- state: typing ---- */
  const [typingUsers, setTypingUsers]     = useState<string[]>([]);
  const [isTyping, setIsTyping]           = useState(false);

  /* ---- state: prefs ---- */
  const [theme, setTheme]               = useState<'dark' | 'light'>('light');
  const [accent, setAccent]             = useState<AccentColor>('indigo');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [notifEnabled, setNotifEnabled] = useState(true);

  /* ---------------------------------------------------------------- */
  /*  Load saved preferences                                          */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    setIsMounted(true);
    const roomSaved = localStorage.getItem(`roomchat_display_name_${roomId}`);
    const globalSaved = localStorage.getItem('roomchat_display_name');
    const savedName = roomSaved || globalSaved;
    if (savedName) {
      setDisplayName(savedName);
      setHasName(true);
      setIsJoining(true);
    }

    const savedTheme = localStorage.getItem('roomchat_theme') as 'dark' | 'light' | null;
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.dataset.theme = savedTheme;
    } else {
      const current = document.documentElement.dataset.theme as 'dark' | 'light' | undefined;
      if (current) setTheme(current);
    }

    const savedAccent = localStorage.getItem('roomchat_accent') as AccentColor | null;
    if (savedAccent) {
      setAccent(savedAccent);
      document.documentElement.dataset.accent = savedAccent;
    } else {
      const current = document.documentElement.dataset.accent as AccentColor | undefined;
      if (current) setAccent(current);
    }

    const savedSound = localStorage.getItem('roomchat_sound');
    if (savedSound !== null) setSoundEnabled(savedSound === 'true');

    const savedNotif = localStorage.getItem('roomchat_notif');
    if (savedNotif !== null) setNotifEnabled(savedNotif === 'true');
  }, []);

  // Lock viewport on mount to prevent keyboard panning issues on mobile
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    
    const origHtmlOverflow = html.style.overflow;
    const origHtmlHeight = html.style.height;
    const origBodyOverflow = body.style.overflow;
    const origBodyPosition = body.style.position;
    const origBodyWidth = body.style.width;
    const origBodyHeight = body.style.height;
    
    html.style.overflow = 'hidden';
    html.style.height = '100%';
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.width = '100%';
    body.style.height = '100%';

    const handleResize = () => {
      if (window.visualViewport) {
        setViewportHeight(`${window.visualViewport.height}px`);
      }
      window.scrollTo(0, 0);
      document.body.scrollTop = 0;
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
      window.visualViewport.addEventListener('scroll', handleResize);
      handleResize();
    }

    return () => {
      html.style.overflow = origHtmlOverflow;
      html.style.height = origHtmlHeight;
      body.style.overflow = origBodyOverflow;
      body.style.position = origBodyPosition;
      body.style.width = origBodyWidth;
      body.style.height = origBodyHeight;

      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize);
        window.visualViewport.removeEventListener('scroll', handleResize);
      }
    };
  }, []);

  const handleInputFocus = useCallback(() => {
    setTimeout(() => {
      if (window.visualViewport) {
        setViewportHeight(`${window.visualViewport.height}px`);
      }
      window.scrollTo(0, 0);
      document.body.scrollTop = 0;
    }, 100);
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent, msgId: string) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    activeSwipeMsgIdRef.current = msgId;
    isSwipingRef.current = false;
    swipeOffsetRef.current = 0;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent, msgId: string, isOwn: boolean) => {
    if (!touchStartRef.current || activeSwipeMsgIdRef.current !== msgId) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;

    if (!isSwipingRef.current) {
      if (Math.abs(deltaX) > Math.abs(deltaY) * 1.2 && Math.abs(deltaX) > 10) {
        isSwipingRef.current = true;
      } else if (Math.abs(deltaY) > 10) {
        touchStartRef.current = null;
        activeSwipeMsgIdRef.current = null;
        return;
      }
    }

    if (isSwipingRef.current) {
      if (e.cancelable) e.preventDefault();
      
      let offset = 0;
      if (isOwn) {
        offset = Math.max(-75, Math.min(0, deltaX));
      } else {
        offset = Math.min(75, Math.max(0, deltaX));
      }
      
      swipeOffsetRef.current = offset;

      const el = document.getElementById(`bubble-container-${msgId}`);
      if (el) {
        el.style.transform = `translateX(${offset}px)`;
        el.style.transition = 'none';
      }

      const indicator = document.getElementById(`reply-indicator-${msgId}`);
      if (indicator) {
        const threshold = 40;
        const ratio = Math.min(1, Math.abs(offset) / threshold);
        indicator.style.opacity = `${ratio}`;
        indicator.style.transform = `scale(${ratio}) translateY(-50%)`;
      }
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent, msg: Message) => {
    const msgId = msg.id;
    if (activeSwipeMsgIdRef.current === msgId && isSwipingRef.current) {
      const threshold = 45;
      const offset = Math.abs(swipeOffsetRef.current);
      
      if (offset >= threshold) {
        setReplyingToMessage(msg);
        replyingToMessageRef.current = msg;
        
        if (navigator.vibrate) {
          navigator.vibrate(15);
        }
      }
    }

    const el = document.getElementById(`bubble-container-${msgId}`);
    if (el) {
      el.style.transform = 'translateX(0px)';
      el.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)';
    }

    const indicator = document.getElementById(`reply-indicator-${msgId}`);
    if (indicator) {
      indicator.style.opacity = '0';
      indicator.style.transform = 'scale(0) translateY(-50%)';
      indicator.style.transition = 'all 0.25s ease';
    }

    touchStartRef.current = null;
    activeSwipeMsgIdRef.current = null;
    isSwipingRef.current = false;
    swipeOffsetRef.current = 0;
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Theme / accent helpers                                          */
  /* ---------------------------------------------------------------- */

  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem('roomchat_theme', next);
  }, [theme]);

  const changeAccent = useCallback((color: AccentColor) => {
    setAccent(color);
    document.documentElement.dataset.accent = color;
    localStorage.setItem('roomchat_accent', color);
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Sound helper (Web Audio API beep)                               */
  /* ---------------------------------------------------------------- */

  const playBeep = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.value = 0.08;
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch { /* ignore */ }
  }, [soundEnabled]);

  /* ---------------------------------------------------------------- */
  /*  Browser notification                                            */
  /* ---------------------------------------------------------------- */

  const showNotification = useCallback((title: string, body: string) => {
    if (!notifEnabled || document.hasFocus()) return;
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(p => {
        if (p === 'granted') new Notification(title, { body });
      });
    }
  }, [notifEnabled]);

  const cleanupRoomLocalStorage = useCallback((rid: string) => {
    localStorage.removeItem(`room_creator_key_${rid}`);
    localStorage.removeItem(`room_title_${rid}`);
    localStorage.removeItem(`room_visibility_${rid}`);
    localStorage.removeItem(`room_user_key_${rid}`);
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Auto-scroll                                                     */
  /* ---------------------------------------------------------------- */

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  /* ---------------------------------------------------------------- */
  /*  Socket connection                                               */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!hasName || !displayName) return;
    if (hasJoinedRef.current) return;
    hasJoinedRef.current = true;

    const socket = io({ transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setIsSocketConnected(true);
      const storedTitle = localStorage.getItem(`room_title_${roomId}`) || '';
      const storedVisibility = localStorage.getItem(`room_visibility_${roomId}`) === 'public';
      const storedCreatorKey = localStorage.getItem(`room_creator_key_${roomId}`) || '';
      
      let userKey = localStorage.getItem(`room_user_key_${roomId}`);
      if (!userKey) {
        userKey = crypto.randomUUID();
        localStorage.setItem(`room_user_key_${roomId}`, userKey);
      }

      socket.emit('join_room', { 
        roomId, 
        name: displayName, 
        roomName: storedTitle, 
        isPublic: storedVisibility,
        creatorKey: storedCreatorKey,
        userKey
      });
    });

    socket.on('joined_info', (data: { name: string; messages: Message[]; users: { name: string; online: boolean }[]; roomName: string; isPublic: boolean; isCreator?: boolean }) => {
      setIsJoining(true);
      setTimeout(() => {
        setIsJoining(false);
        if (data.users.length <= 1) {
          confetti({ particleCount: 80, spread: 60, origin: { y: 0.7 } });
        }
      }, 1500);

      setDisplayName(data.name);
      setMessages(data.messages);
      setUsers(data.users);
      setRoomName(data.roomName);
      setIsPublic(data.isPublic);
      setIsCreator(!!data.isCreator);
      setApprovalStatus('approved');

      // Save room to local storage joined list
      try {
        const list = JSON.parse(localStorage.getItem('roomchat_joined_rooms') || '[]');
        const filtered = list.filter((r: { id: string }) => r.id !== roomId);
        filtered.unshift({
          id: roomId,
          name: data.roomName,
          visibility: data.isPublic ? 'public' : 'private',
          joinedAt: new Date().toISOString()
        });
        localStorage.setItem('roomchat_joined_rooms', JSON.stringify(filtered.slice(0, 15)));
      } catch (e) {
        console.error('Failed to save to joined list', e);
      }
    });

    socket.on('user_name_changed', (data: { oldName: string; newName: string; users: { name: string; online: boolean }[] }) => {
      setUsers(data.users);
      const changeMsg: Message = {
        id: Math.random().toString(36).substring(2),
        sender: '__system__',
        content: `"${data.oldName}" changed their display name to "${data.newName}".`,
        timestamp: new Date().toISOString(),
        type: 'text',
        delivered: true,
        seen: true
      };
      setMessages(prev => [...prev, changeMsg]);
    });

    socket.on('require_approval', (data: { roomName: string }) => {
      setRoomName(data.roomName);
      setApprovalStatus('requesting');
    });

    socket.on('join_approved', () => {
      setApprovalStatus('approved');
      const storedTitle = localStorage.getItem(`room_title_${roomId}`) || '';
      const storedVisibility = localStorage.getItem(`room_visibility_${roomId}`) === 'public';
      const storedCreatorKey = localStorage.getItem(`room_creator_key_${roomId}`) || '';
      const userKey = localStorage.getItem(`room_user_key_${roomId}`) || '';
      
      socket.emit('join_room', { 
        roomId, 
        name: displayName, 
        roomName: storedTitle, 
        isPublic: storedVisibility,
        creatorKey: storedCreatorKey,
        userKey
      });
    });

    socket.on('join_declined', () => {
      setApprovalStatus('declined');
    });

    socket.on('message_updated', (updatedMsg: Message) => {
      setMessages(prev => prev.map(m => m.id === updatedMsg.id ? updatedMsg : m));
    });

    socket.on('room_error', (data: { message: string }) => {
      window.location.href = '/?error=room_expired';
    });

    socket.on('room_details_updated', (data: { roomName: string; isPublic: boolean }) => {
      setRoomName(data.roomName);
      setIsPublic(data.isPublic);
    });

    socket.on('browser_frame', (data: { screenshot: string; url: string; title: string; loading: boolean }) => {
      setBrowserFrame(data.screenshot);
      setBrowserUrl(data.url);
      setAddressInput(data.url);
      setBrowserPageTitle(data.title);
      setBrowserLoading(data.loading);
    });

    socket.on('browser_frame_metadata', (data: { loading: boolean }) => {
      setBrowserLoading(data.loading);
    });

    socket.on('user_joined', (data: { name: string; users: { name: string; online: boolean }[] }) => {
      setUsers(data.users);
      const sysMsg: Message = {
        id: crypto.randomUUID(),
        sender: '__system__',
        content: `${data.name} joined the room`,
        type: 'text',
        timestamp: new Date().toISOString(),
        delivered: true,
        seen: true,
      };
      setMessages(prev => [...prev, sysMsg]);
    });

    socket.on('user_left', (data: { name: string; users: { name: string; online: boolean }[] }) => {
      setUsers(data.users);
      const sysMsg: Message = {
        id: crypto.randomUUID(),
        sender: '__system__',
        content: `${data.name} left the room`,
        type: 'text',
        timestamp: new Date().toISOString(),
        delivered: true,
        seen: true,
      };
      setMessages(prev => [...prev, sysMsg]);
    });

    socket.on('new_message', (msg: Message) => {
      setMessages(prev => [...prev, msg]);
      if (msg.sender !== displayName) {
        playBeep();
        showNotification(msg.sender, msg.type === 'text' ? msg.content : `Sent ${msg.type === 'image' ? 'an image' : 'a voice note'}`);
      }
    });

    socket.on('typing_update', (names: string[]) => {
      setTypingUsers(names.filter(n => n !== displayName));
    });

    socket.on('message_deleted', (messageId: string) => {
      setMessages(prev => prev.filter(m => m.id !== messageId));
    });

    socket.on('message_updated', (updated: Message) => {
      setMessages(prev => prev.map(m => m.id === updated.id ? updated : m));
    });

    socket.on('chat_cleared', () => {
      setMessages([]);
    });

    socket.on('room_deleted', () => {
      cleanupRoomLocalStorage(roomId);
      window.location.href = '/?error=room_deleted';
    });

    return () => {
      socket.disconnect();
      hasJoinedRef.current = false;
      setIsSocketConnected(false);
    };
  }, [hasName, displayName, roomId, playBeep, showNotification, cleanupRoomLocalStorage]);

  /* ---------------------------------------------------------------- */
  /*  Typing indicator                                                */
  /* ---------------------------------------------------------------- */

  const emitTyping = useCallback((typing: boolean) => {
    socketRef.current?.emit('typing_status', { roomId, isTyping: typing });
  }, [roomId]);

  const handleTextChange = useCallback((value: string) => {
    setText(value);
    if (!isTyping) {
      setIsTyping(true);
      emitTyping(true);
    }
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      setIsTyping(false);
      emitTyping(false);
    }, 2000);
  }, [isTyping, emitTyping]);

  /* ---------------------------------------------------------------- */
  /*  File handling                                                   */
  /* ---------------------------------------------------------------- */

  const handleFileSelect = useCallback((file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) return;
    setSelectedFile(file);
    if (file.type.startsWith('video/')) {
      const videoUrl = URL.createObjectURL(file);
      setFilePreview(videoUrl);
    } else {
      const reader = new FileReader();
      reader.onload = () => setFilePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  }, []);

  const clearFile = useCallback(() => {
    if (selectedFile && selectedFile.type.startsWith('video/') && filePreview) {
      URL.revokeObjectURL(filePreview);
    }
    setSelectedFile(null);
    setFilePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [selectedFile, filePreview]);

  /* Paste from clipboard */
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          handleFileSelect(item.getAsFile());
          break;
        }
      }
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [handleFileSelect]);

  /* Drag and drop */
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => e.preventDefault(), []);

  /* ---------------------------------------------------------------- */
  /*  Upload helper                                                   */
  /* ---------------------------------------------------------------- */

  const uploadFile = useCallback(async (file: File): Promise<{ url: string; name: string } | null> => {
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Send message                                                    */
  /* ---------------------------------------------------------------- */

  const sendMessage = useCallback(async () => {
    const socket = socketRef.current;
    if (!socket || isSending) return;

    if (editingMessage) {
      const trimmed = text.trim();
      if (!trimmed) return;
      setIsSending(true);
      try {
        socket.emit('message_action', { 
          roomId, 
          messageId: editingMessage.id, 
          action: 'edit', 
          reaction: trimmed 
        });
        setText('');
        setEditingMessage(null);
      } catch (err) {
        console.error('Failed to edit message:', err);
      } finally {
        setIsSending(false);
      }
      return;
    }

    const replyToPayload = replyingToMessage ? {
      id: replyingToMessage.id,
      sender: replyingToMessage.sender,
      content: replyingToMessage.content,
      type: replyingToMessage.type
    } : undefined;

    setIsSending(true);
    try {
      if (selectedFile) {
        const result = await uploadFile(selectedFile);
        if (result) {
          const isVideo = selectedFile.type.startsWith('video/');
          let msgType = isVideo ? 'video' : 'image';
          if (isViewOnceChecked) {
            msgType = isVideo ? 'view_once_video' : 'view_once_image';
          }
          socket.emit('send_message', {
            roomId,
            message: { content: text || '', type: msgType, mediaUrl: result.url, replyTo: replyToPayload },
          });
        }
        clearFile();
        setIsViewOnceChecked(false);
        setText('');
        setReplyingToMessage(null);
        replyingToMessageRef.current = null;
        if (isTyping) { setIsTyping(false); emitTyping(false); }
        return;
      }

      const trimmed = text.trim();
      if (!trimmed) return;

      socket.emit('send_message', {
        roomId,
        message: { content: trimmed, type: 'text', replyTo: replyToPayload },
      });
      setText('');
      setReplyingToMessage(null);
      replyingToMessageRef.current = null;
      if (isTyping) { setIsTyping(false); emitTyping(false); }
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setIsSending(false);
    }
  }, [text, selectedFile, roomId, uploadFile, clearFile, isTyping, emitTyping, replyingToMessage, editingMessage, isViewOnceChecked, isSending]);



  /* ---------------------------------------------------------------- */
  /*  Actions                                                         */
  /* ---------------------------------------------------------------- */

  const deleteMessage = useCallback((msgId: string) => {
    socketRef.current?.emit('message_action', { roomId, messageId: msgId, action: 'delete' });
  }, [roomId]);

  const reactToMessage = useCallback((msgId: string, emoji: string) => {
    socketRef.current?.emit('message_action', { roomId, messageId: msgId, action: 'react', reaction: emoji });
    setHoveredMsg(null);
  }, [roomId]);

  const handleBubbleClick = useCallback((msgId: string) => {
    const now = Date.now();
    const lastTap = lastTapRef.current[msgId] || 0;
    if (now - lastTap < 300) {
      reactToMessage(msgId, '❤️');
      lastTapRef.current[msgId] = 0;

      const bubble = document.getElementById(`bubble-content-${msgId}`);
      if (bubble) {
        const existing = bubble.querySelector('.heart-pop');
        if (existing) existing.remove();

        const heart = document.createElement('div');
        heart.className = 'heart-pop absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-red-500 text-4xl select-none pointer-events-none z-10 animate-heart-pop';
        heart.innerHTML = '❤️';
        bubble.appendChild(heart);
        setTimeout(() => heart.remove(), 750);
      }
    } else {
      lastTapRef.current[msgId] = now;
    }
  }, [reactToMessage]);

  const handleGoogleSearch = useCallback(async (query: string, tab: 'all' | 'images' | 'videos' | 'news' = 'all') => {
    const trimmed = query.trim();
    if (!trimmed) {
      setGoogleSearchQuery('');
      setGoogleSearchResults([]);
      setBrowserUrl('https://www.google.com');
      setBrowserActiveTab('all');
      setBrowserPageTitle('Google');
      setBrowserPageFavicon('https://www.google.com/favicon.ico');
      setBrowserLastNavigatedBy(displayName);
      socketRef.current?.emit('sync_google_search', {
        roomId,
        query: '',
        results: [],
        url: 'https://www.google.com',
        tab: 'all',
        browsingMode: browserMode,
        safeSearch: browserSafeSearch,
        lastNavigatedBy: displayName,
        pageTitle: 'Google',
        pageFavicon: 'https://www.google.com/favicon.ico'
      });
      return;
    }

    setGoogleSearchQuery(trimmed);
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
    const restriction = getEmbedRestriction(searchUrl);
    setBrowserUrl(searchUrl);
    setBrowserActiveTab(tab);
    setBrowserPageTitle(`${trimmed} - Google Search`);
    setBrowserPageFavicon('https://www.google.com/favicon.ico');
    setBrowserLastNavigatedBy(displayName);
    setBrowserEmbedError(restriction);
    setIsIframeLoading(false);

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&safe=${browserSafeSearch}`);
      const data = await res.json();
      if (data && !data.error) {
        const webItems = (data.web || []).map((w: { title: string; url: string; snippet: string }) => ({
          title: w.title,
          url: w.url,
          snippet: w.snippet,
          kind: 'web' as const
        }));
        
        const imageItems = (data.images || []).map((img: { title: string; imageUrl: string; url: string }) => ({
          title: img.title,
          url: img.url,
          snippet: 'Image search result',
          imageUrl: img.imageUrl,
          kind: 'image' as const
        }));
        
        const videoItems = (data.videos || []).map((v: { title: string; videoUrl: string; imageUrl: string; videoDuration: string; snippet: string }) => ({
          title: v.title,
          url: v.videoUrl,
          snippet: v.snippet,
          imageUrl: v.imageUrl,
          videoUrl: v.videoUrl,
          videoDuration: v.videoDuration,
          kind: 'video' as const
        }));

        const newsItems = (data.news || []).map((n: { title: string; url: string; snippet: string }) => ({
          title: n.title,
          url: n.url,
          snippet: n.snippet,
          kind: 'news' as const
        }));

        const finalResults = [...webItems, ...imageItems, ...videoItems, ...newsItems];
        setGoogleSearchResults(finalResults);

        socketRef.current?.emit('sync_google_search', {
          roomId,
          query: trimmed,
          results: finalResults,
          url: searchUrl,
          tab,
          browsingMode: browserMode,
          safeSearch: browserSafeSearch,
          lastNavigatedBy: displayName,
          pageTitle: `${trimmed} - Google Search`,
          pageFavicon: 'https://www.google.com/favicon.ico'
        });
      }
    } catch (err) {
      console.error("Search API error:", err);
    }
  }, [roomId, browserMode, browserSafeSearch, displayName]);

  const handleTabChange = useCallback((newTab: 'all' | 'images' | 'videos' | 'news') => {
    setBrowserActiveTab(newTab);
    socketRef.current?.emit('sync_google_search', {
      roomId,
      query: googleSearchQuery,
      results: googleSearchResults,
      url: googleSearchQuery ? `https://www.google.com/search?q=${encodeURIComponent(googleSearchQuery)}` : 'https://www.google.com',
      tab: newTab,
      browsingMode: browserMode,
      safeSearch: browserSafeSearch,
      lastNavigatedBy: displayName,
      pageTitle: browserPageTitle,
      pageFavicon: browserPageFavicon
    });
  }, [roomId, googleSearchQuery, googleSearchResults, browserMode, browserSafeSearch, displayName, browserPageTitle, browserPageFavicon]);

  const navigateToUrl = useCallback((url: string) => {
    if (browserMode === 'presenter' && !isCreator) return;
    socketRef.current?.emit('browser_action_navigate', { roomId, url });
  }, [browserMode, isCreator, roomId]);

  const goBack = useCallback(() => {
    if (browserMode === 'presenter' && !isCreator) return;
    socketRef.current?.emit('browser_action_back', { roomId });
  }, [browserMode, isCreator, roomId]);

  const goForward = useCallback(() => {
    if (browserMode === 'presenter' && !isCreator) return;
    socketRef.current?.emit('browser_action_forward', { roomId });
  }, [browserMode, isCreator, roomId]);

  const reloadPage = useCallback(() => {
    if (browserMode === 'presenter' && !isCreator) return;
    socketRef.current?.emit('browser_action_reload', { roomId });
  }, [browserMode, isCreator, roomId]);

  const handleModeChange = useCallback((mode: 'collaborative' | 'presenter') => {
    setBrowserMode(mode);
    socketRef.current?.emit('sync_google_search', {
      roomId,
      query: googleSearchQuery,
      results: googleSearchResults,
      url: browserUrl,
      tab: browserActiveTab,
      browsingMode: mode,
      safeSearch: browserSafeSearch,
      lastNavigatedBy: displayName,
      pageTitle: browserPageTitle,
      pageFavicon: browserPageFavicon
    });
  }, [roomId, googleSearchQuery, googleSearchResults, browserUrl, browserActiveTab, browserSafeSearch, displayName, browserPageTitle, browserPageFavicon]);

  const handleSafeSearchChange = useCallback((safe: 'off' | 'moderate' | 'strict') => {
    setBrowserSafeSearch(safe);
    socketRef.current?.emit('sync_google_search', {
      roomId,
      query: googleSearchQuery,
      results: googleSearchResults,
      url: browserUrl,
      tab: browserActiveTab,
      browsingMode: browserMode,
      safeSearch: safe,
      lastNavigatedBy: displayName,
      pageTitle: browserPageTitle,
      pageFavicon: browserPageFavicon
    });
  }, [roomId, googleSearchQuery, googleSearchResults, browserUrl, browserActiveTab, browserMode, displayName, browserPageTitle, browserPageFavicon]);

  const sendOnlineMediaLink = useCallback((urlStr: string, viewOnce: boolean) => {
    const socket = socketRef.current;
    if (!socket || !urlStr.trim()) return;

    const replyToPayload = replyingToMessage ? {
      id: replyingToMessage.id,
      sender: replyingToMessage.sender,
      content: replyingToMessage.content,
      type: replyingToMessage.type
    } : undefined;

    const cleanUrl = urlStr.trim();
    
    // Auto-detect media type
    const lowerUrl = cleanUrl.toLowerCase().split('?')[0];
    const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.quicktime', 'youtube.com', 'youtu.be', 'embed'];
    const isVideo = videoExtensions.some(ext => lowerUrl.includes(ext));
    
    let msgType = isVideo ? 'video' : 'image';
    if (viewOnce) {
      msgType = isVideo ? 'view_once_video' : 'view_once_image';
    }

    socket.emit('send_message', {
      roomId,
      message: { 
        content: cleanUrl, 
        type: msgType,
        mediaUrl: cleanUrl,
        replyTo: replyToPayload
      },
    });

    setReplyingToMessage(null);
    replyingToMessageRef.current = null;
  }, [roomId, replyingToMessage]);

  const clearChat = useCallback(() => {
    const creatorKey = localStorage.getItem(`room_creator_key_${roomId}`) || '';
    socketRef.current?.emit('clear_chat', { roomId, creatorKey });
  }, [roomId]);

  const deleteRoom = useCallback(() => {
    const creatorKey = localStorage.getItem(`room_creator_key_${roomId}`) || '';
    cleanupRoomLocalStorage(roomId);
    socketRef.current?.emit('delete_room', { roomId, creatorKey });
  }, [roomId, cleanupRoomLocalStorage]);

  const updateRoomDetails = useCallback((newName: string, newVisibility: 'public' | 'private') => {
    const creatorKey = localStorage.getItem(`room_creator_key_${roomId}`) || '';
    socketRef.current?.emit('update_room_details', { 
      roomId, 
      roomName: newName, 
      isPublic: newVisibility === 'public', 
      creatorKey 
    });
  }, [roomId]);

  const leaveRoom = useCallback(() => {
    socketRef.current?.disconnect();
    router.push('/');
  }, [router]);

  const copyLink = useCallback(async () => {
    const url = `${window.location.origin}/chat/${roomId}`;
    await navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }, [roomId]);

  const copyCode = useCallback(async () => {
    await navigator.clipboard.writeText(roomId);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  }, [roomId]);

  const handleBrowserClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (browserMode === 'presenter' && !isCreator) return;
    if (!containerRef.current || !socketRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);
    
    socketRef.current.emit('browser_action_click', { roomId, x, y });
  };

  const handleBrowserWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (browserMode === 'presenter' && !isCreator) return;
    if (!socketRef.current) return;
    e.preventDefault();
    socketRef.current.emit('browser_action_scroll', { roomId, deltaY: Math.round(e.deltaY) });
  };

  const handleBrowserKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (browserMode === 'presenter' && !isCreator) return;
    if (!socketRef.current) return;
    
    e.preventDefault();
    
    const key = e.key;
    let text = '';
    if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      text = key;
    }
    
    socketRef.current.emit('browser_action_keypress', { roomId, key, text });
  };

  useEffect(() => {
    if (!socketRef.current || !containerRef.current) return;
    
    const socket = socketRef.current;

    const handleResize = (entries: ResizeObserverEntry[]) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width <= 0 || height <= 0) continue;
        
        const w = Math.round(width);
        const h = Math.round(height);
        
        if (!browserInitializedRef.current) {
          socket.emit('browser_init', { roomId, width: w, height: h });
          browserInitializedRef.current = true;
        } else {
          socket.emit('browser_resize', { roomId, width: w, height: h });
        }
      }
    };

    const observer = new ResizeObserver(handleResize);
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
    };
  }, [roomId, isSocketConnected, showGoogleSearch]);

  /* ---------------------------------------------------------------- */
  /*  Filtered messages                                               */
  /* ---------------------------------------------------------------- */

  const filteredMessages = useMemo(() => {
    if (!searchQuery.trim()) return messages;
    const q = searchQuery.toLowerCase();
    return messages.filter(m => m.content.toLowerCase().includes(q) || m.sender.toLowerCase().includes(q));
  }, [messages, searchQuery]);

  /* ---------------------------------------------------------------- */
  /*  Name prompt                                                     */
  /* ---------------------------------------------------------------- */

  const handleSetName = useCallback(() => {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    localStorage.setItem(`roomchat_display_name_${roomId}`, trimmed);
    localStorage.setItem('roomchat_display_name', trimmed);
    setDisplayName(trimmed);
    setHasName(true);
    setIsJoining(true);
  }, [nameInput, roomId]);

  /* ---------------------------------------------------------------- */
  /*  Pref toggles                                                    */
  /* ---------------------------------------------------------------- */

  const toggleSound = useCallback(() => {
    setSoundEnabled(p => {
      localStorage.setItem('roomchat_sound', String(!p));
      return !p;
    });
  }, []);

  const toggleNotif = useCallback(() => {
    setNotifEnabled(p => {
      localStorage.setItem('roomchat_notif', String(!p));
      return !p;
    });
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Time formatter                                                  */
  /* ---------------------------------------------------------------- */

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  };

  /* ---------------------------------------------------------------- */
  /*  Keyboard shortcut                                               */
  /* ---------------------------------------------------------------- */

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }, [sendMessage]);

  /* ================================================================ */
  const sendJoinRequest = useCallback(() => {
    const userKey = localStorage.getItem(`room_user_key_${roomId}`) || '';
    socketRef.current?.emit('request_join', { roomId, name: displayName, userKey });
    setApprovalStatus('pending');
  }, [roomId, displayName]);

  /* ================================================================ */
  /*  RENDER: Name prompt                                             */
  /* ================================================================ */

  if (!isMounted) {
    return (
      <div 
        className="min-h-screen flex flex-col items-center justify-center relative selection:bg-indigo-100 selection:text-indigo-900 bg-white"
        style={{
          backgroundImage: `
            radial-gradient(#e5e7eb 1px, transparent 1px),
            radial-gradient(circle at 50% 0%, rgba(99, 102, 241, 0.05) 0%, transparent 60%)
          `,
          backgroundSize: '24px 24px, 100% 100%'
        }}
      >
        <div className="flex flex-col items-center space-y-4">
          <div className="p-3.5 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100 shadow-sm animate-bounce">
            <MessageSquare size={36} />
          </div>
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-black tracking-tight text-gray-900">
              RoomChat
            </h1>
            <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider animate-pulse">
              Loading RoomChat...
            </p>
          </div>
          <div className="pt-4">
            <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  if (!hasName) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] p-4">
        <div className="w-full max-w-sm bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-2xl p-6 space-y-4">
          <h2 className="text-xl font-semibold text-[var(--text-primary)] text-center">
            Enter your display name
          </h2>
          <p className="text-sm text-[var(--text-secondary)] text-center">
            Choose a name to use in this chat room
          </p>
          <input
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSetName()}
            placeholder="Your name"
            autoFocus
            className="w-full px-4 py-2.5 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--accent)] transition-colors"
          />
          <button
            onClick={handleSetName}
            disabled={!nameInput.trim()}
            className="w-full py-2.5 rounded-xl bg-[var(--accent)] text-[var(--accent-text)] font-medium hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-40"
          >
            Join Room
          </button>
        </div>
      </div>
    );
  }

  if (approvalStatus === 'requesting' || approvalStatus === 'pending' || approvalStatus === 'declined') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] p-4">
        <div className="w-full max-w-sm bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-2xl p-6 text-center space-y-5">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-muted)] text-[var(--accent)] border border-[var(--border-primary)]">
            <Lock size={20} />
          </div>
          
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)] mb-1">
              {approvalStatus === 'requesting' && 'Private Room Access'}
              {approvalStatus === 'pending' && 'Awaiting Approval'}
              {approvalStatus === 'declined' && 'Access Denied'}
            </h2>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              {approvalStatus === 'requesting' && `"${roomName || 'Unnamed Room'}" is private. You must request approval from the host to join.`}
              {approvalStatus === 'pending' && 'Your request has been sent. Please wait while the administrator decides to accept or decline your access.'}
              {approvalStatus === 'declined' && 'The administrator declined your request to join this private room.'}
            </p>
          </div>

          {approvalStatus === 'pending' && (
            <div className="flex justify-center py-2">
              <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          <div className="flex flex-col gap-2 pt-2">
            {approvalStatus === 'requesting' && (
              <button
                onClick={sendJoinRequest}
                className="w-full py-2.5 rounded-xl bg-[var(--accent)] text-white font-medium hover:bg-[var(--accent-hover)] transition-colors cursor-pointer"
              >
                Request Access
              </button>
            )}
            <button
              onClick={() => window.location.href = '/'}
              className="w-full py-2.5 rounded-xl border border-[var(--border-primary)] text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            >
              Return to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isJoining) {
    return (
      <div 
        className="min-h-screen flex flex-col items-center justify-center relative selection:bg-indigo-100 selection:text-indigo-900 bg-white"
        style={{
          backgroundImage: `
            radial-gradient(#e5e7eb 1px, transparent 1px),
            radial-gradient(circle at 50% 0%, rgba(99, 102, 241, 0.05) 0%, transparent 60%)
          `,
          backgroundSize: '24px 24px, 100% 100%'
        }}
      >
        <div className="flex flex-col items-center space-y-4">
          <div className="p-3.5 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100 shadow-sm animate-bounce">
            <MessageSquare size={36} />
          </div>
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-black tracking-tight text-gray-900">
              RoomChat
            </h1>
            <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider animate-pulse">
              Entering Chat Room...
            </p>
          </div>
          <div className="pt-4">
            <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  /* ================================================================ */
  /*  RENDER: Canx disabled check                                     */
  /* ================================================================ */

  const canSend = (text.trim().length > 0 || selectedFile !== null) && !isSending;

  /* ================================================================ */
  /*  RENDER: Main chat                                               */
  /* ================================================================ */

  const isControlDisabled = browserMode === 'presenter' && !isCreator;

  return (
    <div
      style={{ height: viewportHeight }}
      className="fixed top-0 left-0 right-0 flex flex-col bg-[var(--bg-primary)] overflow-hidden"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* =========================================================== */}
      {/*  HEADER                                                      */}
      {/* =========================================================== */}
      {/* Navigation Header */}
      <header className="flex items-center gap-3 px-3 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border-primary)] shrink-0 z-20">
        <button onClick={leaveRoom} className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors">
          <ArrowLeft size={18} />
        </button>

        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="flex items-center gap-1.5 min-w-0">
            <h1 className="text-sm font-bold text-[var(--text-primary)] truncate">
              {roomName || 'Chat Room'}
            </h1>
            <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
              isPublic 
                ? 'bg-emerald-50 border border-emerald-100 text-emerald-700' 
                : 'bg-indigo-50 border border-indigo-100 text-indigo-700'
            }`}>
              {isPublic ? 'Public' : 'Private'}
            </span>
          </div>
          <button 
            onClick={copyCode}
            className="self-start text-[10px] text-[var(--text-tertiary)] hover:text-[var(--accent)] font-mono flex items-center gap-1 transition-colors mt-0.5 cursor-pointer"
          >
            <span>Code: <b>{roomId}</b></span>
            {copiedCode ? (
              <span className="text-[var(--success)] text-[9px] font-bold">✓ Copied!</span>
            ) : (
              <Copy size={9} />
            )}
          </button>
        </div>

        <button 
          onClick={() => setShowMenu(m => !m)} 
          className={`p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors cursor-pointer relative ${
            showMenu ? 'text-[var(--accent)] bg-[var(--bg-hover)]' : ''
          }`}
        >
          <MoreVertical size={18} />
        </button>
      </header>

      {/* Dropdown Options Menu */}
      <AnimatePresence>
        {showMenu && (
          <>
            {/* Backdrop click closer */}
            <div 
              className="fixed inset-0 z-30" 
              onClick={() => setShowMenu(false)} 
            />
            
            {/* Dropdown Container */}
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute right-3 top-14 w-64 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-xl z-40 p-2 flex flex-col gap-1"
            >
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--border-secondary)] mb-1">
                Room Details & Actions
              </div>

              {/* Live Count / Members List Button */}
              <button 
                onClick={() => {
                  setShowMembers(true);
                  setShowMenu(false);
                }} 
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-[var(--bg-hover)] text-sm text-[var(--text-primary)] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <Users size={16} className="text-[var(--text-secondary)]" />
                  <span>See Details & Members</span>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] font-semibold text-[var(--text-secondary)]">
                  {users.length}
                </span>
              </button>

              {/* Message Search Button */}
              <button 
                onClick={() => {
                  setShowSearch(s => !s);
                  setShowMenu(false);
                }} 
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[var(--bg-hover)] text-sm text-[var(--text-primary)] transition-colors cursor-pointer"
              >
                <Search size={16} className="text-[var(--text-secondary)]" />
                <span>Search Messages</span>
              </button>

              {/* Share & Invite Option */}
              <div className="border-t border-[var(--border-secondary)] my-1" />
              
              <div className="px-3 py-1.5 space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">
                  Invite Link
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    readOnly
                    value={typeof window !== 'undefined' ? `${window.location.origin}/chat/${roomId}` : ''}
                    className="flex-1 text-[11px] font-mono px-2 py-1.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] outline-none"
                  />
                  <button
                    onClick={copyLink}
                    className="p-2 rounded-lg border border-[var(--border-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer shrink-0"
                  >
                    {copiedLink ? <Check size={13} className="text-[var(--success)]" /> : <Copy size={13} />}
                  </button>
                </div>
              </div>

              <div className="border-t border-[var(--border-secondary)] my-1" />

              {/* Settings Action Button */}
              <button 
                onClick={() => {
                  setShowSettings(true);
                  setShowMenu(false);
                }} 
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[var(--bg-hover)] text-sm text-[var(--text-primary)] transition-colors cursor-pointer"
              >
                <Settings size={16} className="text-[var(--text-secondary)]" />
                <span>Room Settings</span>
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* =========================================================== */}
      {/*  SEARCH BAR                                                  */}
      {/* =========================================================== */}
      <AnimatePresence>
        {showSearch && (
          <div
            className="bg-[var(--bg-secondary)] border-b border-[var(--border-primary)] overflow-hidden shrink-0 z-10"
          >
            <div className="px-3 py-2">
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search messages…"
                autoFocus
                className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--accent)] transition-colors"
              />
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* =========================================================== */}
      {/*  MAIN CHAT / SPLIT PANEL                                    */}
      {/* =========================================================== */}
      <div className={`flex-1 flex min-h-0 relative overflow-hidden ${showGoogleSearch ? 'flex-col md:flex-row' : 'flex-row'}`}>
        {/* Messages List */}
        <div 
          ref={chatContainerRef} 
          onClick={() => {
            if (showSearch) {
              setShowSearch(false);
              setSearchQuery('');
            }
          }}
          className="flex-1 overflow-y-auto px-3 pt-10 pb-3 space-y-1.5 min-w-0"
        >
          {/* Inactivity deletion warning banner */}
          <div className="flex justify-center pb-2">
            <div className="max-w-md w-full bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-center space-y-1">
              <p className="text-xs font-semibold text-amber-600 flex items-center justify-center gap-1.5">
                <span>⚠️</span>
                <span>Active Lifetime Notice</span>
              </p>
              <p className="text-[10px] text-[var(--text-secondary)] font-medium leading-relaxed">
                This room and all of its message history will be permanently deleted after 30 hours of inactivity.
              </p>
            </div>
          </div>

          {filteredMessages.map(msg => {
          const isOwn    = msg.sender === displayName;
          const isSystem = msg.sender === '__system__';

          /* ---- join request message ---- */
          if (msg.type === 'join_request') {
            const isPending = msg.status === 'pending';
            return (
              <div key={msg.id} className="flex justify-center py-2">
                <div className="max-w-sm w-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl p-4 shadow-sm text-center space-y-3">
                  <div className="flex items-center justify-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                    <Users size={14} className="text-[var(--accent)]" />
                    <span>Join Request</span>
                  </div>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {msg.content}
                  </p>
                  {isCreator && isPending && (
                    <div className="flex gap-2 justify-center">
                      <button
                        onClick={() => {
                          socketRef.current?.emit('decline_join', {
                            roomId,
                            messageId: msg.id,
                            requesterSocketId: msg.requesterSocketId,
                            requesterName: msg.requesterName
                          });
                        }}
                        className="px-3 py-1.5 rounded-lg border border-[var(--border-primary)] text-[10px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                      >
                        Decline
                      </button>
                      <button
                        onClick={() => {
                          socketRef.current?.emit('approve_join', {
                            roomId,
                            messageId: msg.id,
                            requesterUserKey: msg.requesterUserKey,
                            requesterSocketId: msg.requesterSocketId
                          });
                        }}
                        className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-[10px] font-semibold hover:bg-[var(--accent-hover)] transition-colors cursor-pointer"
                      >
                        Accept
                      </button>
                    </div>
                  )}
                  {!isPending && (
                    <span className={`inline-block text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                      msg.status === 'approved' 
                        ? 'bg-green-50 border border-green-100 text-green-700' 
                        : 'bg-red-50 border border-red-100 text-red-700'
                    }`}>
                      {msg.status}
                    </span>
                  )}
                </div>
              </div>
            );
          }

          /* ---- system message ---- */
          if (isSystem) {
            return (
              <div key={msg.id} className="flex justify-center py-1">
                <span className="text-[11px] px-3 py-1 rounded-full bg-[var(--system-bg)] text-[var(--system-text)]">
                  {msg.content}
                </span>
              </div>
            );
          }

          /* ---- chat bubble ---- */
          return (
            <div
              key={msg.id}
              id={`msg-${msg.id}`}
              className={`flex ${isOwn ? 'justify-end' : 'justify-start'} transition-colors duration-500 relative touch-pan-y`}
              onMouseEnter={() => setHoveredMsg(msg.id)}
              onMouseLeave={() => setHoveredMsg(null)}
              onTouchStart={(e) => handleTouchStart(e, msg.id)}
              onTouchMove={(e) => handleTouchMove(e, msg.id, isOwn)}
              onTouchEnd={(e) => handleTouchEnd(e, msg)}
            >
              {/* Swipe Reply Indicator */}
              <div 
                id={`reply-indicator-${msg.id}`}
                className="absolute top-1/2 -translate-y-1/2 opacity-0 scale-0 pointer-events-none transition-all flex items-center justify-center p-1.5 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--accent)] z-10"
                style={{
                  [isOwn ? 'right' : 'left']: '4px'
                }}
              >
                <CornerUpLeft size={12} className={isOwn ? 'rotate-0' : 'scale-x-[-1]'} />
              </div>

              <div 
                id={`bubble-container-${msg.id}`}
                className="relative max-w-[75%] sm:max-w-[65%] group"
              >
                {/* sender name */}
                {!isOwn && (
                  <p className="text-[11px] font-medium text-[var(--accent)] mb-0.5 ml-1">{msg.sender}</p>
                )}

                <div
                  id={`bubble-content-${msg.id}`}
                  onClick={() => handleBubbleClick(msg.id)}
                  className={`relative px-3 py-2 cursor-pointer select-none ${
                    isOwn
                      ? 'bg-[var(--bubble-own)] text-[var(--bubble-own-text)] rounded-2xl rounded-tr-sm'
                      : 'bg-[var(--bubble-other)] text-[var(--bubble-other-text)] rounded-2xl rounded-tl-sm'
                  }`}
                >
                  {/* replied-to preview */}
                  {msg.replyTo && (
                    <div 
                      onClick={() => {
                        const target = document.getElementById(`msg-${msg.replyTo?.id}`);
                        if (target) {
                          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          target.classList.add('bg-[var(--accent-muted)]');
                          setTimeout(() => target.classList.remove('bg-[var(--accent-muted)]'), 1500);
                        }
                      }}
                      className={`cursor-pointer mb-1.5 p-1.5 rounded-lg border-l-2 text-xs flex flex-col gap-0.5 ${
                        isOwn 
                          ? 'bg-black/10 border-[var(--bubble-own-text)] text-[var(--bubble-own-text)]/80' 
                          : 'bg-black/[0.04] border-[var(--accent)] text-[var(--text-secondary)]'
                      }`}
                    >
                      <span className="font-semibold text-[10px]">
                        {msg.replyTo.sender === displayName ? 'You' : msg.replyTo.sender}
                      </span>
                      <span className="truncate max-w-[200px]">
                        {msg.replyTo.type === 'image' ? '📷 Photo' : msg.replyTo.type === 'voice' ? '🎵 Voice Note' : msg.replyTo.content}
                      </span>
                    </div>
                  )}

                  {/* text */}
                  {msg.type === 'text' && (
                    <p className="text-sm break-words whitespace-pre-wrap">{msg.content}</p>
                  )}

                  {/* image */}
                  {msg.type === 'image' && msg.mediaUrl && (
                    <div className="space-y-1">
                      <button onClick={() => setFullscreenImage(msg.mediaUrl!)} className="block rounded-lg overflow-hidden">
                        <NextImage
                          src={msg.mediaUrl}
                          alt="shared image"
                          width={300}
                          height={200}
                          className="max-w-xs w-full h-auto object-cover rounded-lg"
                          unoptimized
                        />
                      </button>
                      {msg.content && <p className="text-sm break-words">{msg.content}</p>}
                    </div>
                  )}

                  {/* video */}
                  {msg.type === 'video' && msg.mediaUrl && (
                    <div className="space-y-1">
                      <video
                        src={msg.mediaUrl}
                        controls
                        playsInline
                        className="max-w-xs w-full h-auto rounded-lg"
                      />
                      {msg.content && <p className="text-sm break-words">{msg.content}</p>}
                    </div>
                  )}

                  {/* view_once_image */}
                  {msg.type === 'view_once_image' && msg.mediaUrl && (
                    <div className="space-y-2 py-1 flex flex-col items-center">
                      <div className="flex items-center gap-2 text-xs bg-black/10 rounded-lg px-2.5 py-1.5 font-medium select-none">
                        <span>🕵️‍♂️</span>
                        <span>Disappearing Photo Preview</span>
                      </div>
                      
                      <button
                        onClick={() => {
                          setViewOnceImageToPlay(msg.mediaUrl!);
                          setViewOnceVideoMessageId(msg.id);
                          setShowImagePopup(true);
                        }}
                        className="w-full flex items-center justify-center gap-2 cursor-pointer bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-semibold py-2 px-3 rounded-lg transition-colors shadow-sm"
                      >
                        <span>👁️</span>
                        <span>Open & View Photo</span>
                      </button>

                      {isOwn && (
                        <button
                          onClick={() => deleteMessage(msg.id)}
                          className="text-[10px] underline opacity-70 hover:opacity-100 cursor-pointer"
                        >
                          Burn Photo Now
                        </button>
                      )}
                    </div>
                  )}

                  {/* view_once_video */}
                  {msg.type === 'view_once_video' && (msg.mediaUrl || msg.content) && (
                    <div className="space-y-2 py-1 flex flex-col items-center">
                      <div className="flex items-center gap-2 text-xs bg-black/10 rounded-lg px-2.5 py-1.5 font-medium select-none">
                        <span>🕵️‍♂️</span>
                        <span>Disappearing Video Preview</span>
                      </div>
                      
                      <button
                        onClick={() => {
                          setViewOnceVideoToPlay(msg.mediaUrl || msg.content!);
                          setViewOnceVideoMessageId(msg.id);
                          setShowVideoPopup(true);
                        }}
                        className="w-full flex items-center justify-center gap-2 cursor-pointer bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-semibold py-2 px-3 rounded-lg transition-colors shadow-sm"
                      >
                        <span>▶️</span>
                        <span>Open & Play Video</span>
                      </button>

                      {isOwn && (
                        <button
                          onClick={() => deleteMessage(msg.id)}
                          className="text-[10px] underline opacity-70 hover:opacity-100 cursor-pointer"
                        >
                          Burn Video Now
                        </button>
                      )}
                    </div>
                  )}

                  {/* timestamp */}
                  <p className={`text-[10px] mt-1 ${isOwn ? 'text-[var(--bubble-own-text)]/60' : 'text-[var(--bubble-other-text)]/60'} text-right space-x-1`}>
                    {msg.isEdited && <span className="text-[9px] opacity-75 font-semibold italic">(edited)</span>}
                    <span>{formatTime(msg.timestamp)}</span>
                  </p>
                </div>

                {/* reactions display */}
                {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                  <div className={`flex gap-1 mt-0.5 flex-wrap ${isOwn ? 'justify-end' : 'justify-start'}`}>
                    {Object.entries(
                      Object.values(msg.reactions).reduce<Record<string, number>>((acc, emoji) => {
                        acc[emoji] = (acc[emoji] || 0) + 1;
                        return acc;
                      }, {}),
                    ).map(([emoji, count]) => (
                      <span key={emoji} className="text-xs bg-[var(--bg-tertiary)] rounded-full px-1.5 py-0.5 border border-[var(--border-secondary)]">
                        {emoji} {count > 1 && count}
                      </span>
                    ))}
                  </div>
                )}

                {/* hover actions */}
                {hoveredMsg === msg.id && (
                  <div className={`absolute -top-9 ${isOwn ? 'right-0' : 'left-0'} flex items-center gap-1 bg-[var(--bg-elevated)] border border-[var(--border-primary)] rounded-full px-2 py-1 shadow-[var(--shadow)] z-30 animate-in fade-in zoom-in-95 duration-100`}>
                    {/* Reactions */}
                    <div className="flex items-center border-r border-[var(--border-primary)] pr-1 mr-1">
                      {REACTION_EMOJIS.map(emoji => (
                        <button
                          key={emoji}
                          onClick={() => reactToMessage(msg.id, emoji)}
                          className="hover:scale-125 hover:bg-[var(--bg-hover)] rounded-full p-1 text-sm transition-all cursor-pointer"
                        >
                          {emoji}
                        </button>
                      ))}
                      {/* Plus button for more reactions */}
                      <button
                        onClick={() => setShowAllReactionsForMsg(msg.id)}
                        className="hover:scale-125 hover:bg-[var(--bg-hover)] rounded-full p-1 text-xs text-[var(--text-secondary)] transition-all cursor-pointer"
                      >
                        ➕
                      </button>
                    </div>

                    {/* Reply button */}
                    <button
                      onClick={() => {
                        setReplyingToMessage(msg);
                        replyingToMessageRef.current = msg;
                      }}
                      title="Reply"
                      className="hover:bg-[var(--bg-hover)] rounded-full p-1.5 text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors cursor-pointer"
                    >
                      <CornerUpLeft size={14} />
                    </button>

                    {/* Edit button (Own only) */}
                    {isOwn && msg.type === 'text' && (
                      <button
                        onClick={() => {
                          setEditingMessage(msg);
                          setText(msg.content);
                        }}
                        title="Edit"
                        className="hover:bg-[var(--bg-hover)] rounded-full p-1.5 text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors cursor-pointer"
                      >
                        <Pencil size={14} />
                      </button>
                    )}

                    {/* Delete button (Own only) */}
                    {isOwn && (
                      <button
                        onClick={() => deleteMessage(msg.id)}
                        title="Delete"
                        className="hover:bg-[var(--danger-muted)] rounded-full p-1.5 text-[var(--danger)] transition-colors cursor-pointer"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                )}

                {/* Full Emoji Picker Popover */}
                {showAllReactionsForMsg === msg.id && (
                  <>
                    <div 
                      className="fixed inset-0 z-40" 
                      onClick={() => setShowAllReactionsForMsg(null)}
                    />
                    <div 
                      className={`absolute bottom-10 ${isOwn ? 'right-0' : 'left-0'} w-64 z-50 bg-[var(--bg-elevated)] border border-[var(--border-primary)] rounded-2xl shadow-xl p-3 flex flex-col gap-2 max-h-60 overflow-y-auto animate-in slide-in-from-bottom-2 duration-150`}
                    >
                      <div className="flex items-center justify-between pb-1 border-b border-[var(--border-primary)]">
                        <span className="text-xs font-semibold text-[var(--text-secondary)]">Reactions</span>
                        <button 
                          onClick={() => setShowAllReactionsForMsg(null)}
                          className="p-0.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)]"
                        >
                          <X size={12} />
                        </button>
                      </div>
                      
                      <div className="space-y-3">
                        {EMOJI_CATEGORIES.map(cat => (
                          <div key={cat.name} className="space-y-1">
                            <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-tertiary)]">{cat.name}</span>
                            <div className="grid grid-cols-6 gap-1">
                              {cat.emojis.map(emoji => (
                                <button
                                  key={emoji}
                                  onClick={() => {
                                    reactToMessage(msg.id, emoji);
                                    setShowAllReactionsForMsg(null);
                                  }}
                                  className="text-lg hover:bg-[var(--bg-hover)] rounded p-1 transition-colors cursor-pointer text-center"
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}

        {/* typing indicator */}
        {typingUsers.length > 0 && (
          <div className="flex justify-start">
            <div className="bg-[var(--bubble-other)] rounded-2xl rounded-tl-sm px-4 py-2.5">
              <div className="flex items-center gap-1.5">
                <p className="text-[11px] text-[var(--bubble-other-text)]/70 mr-1">
                  {typingUsers.length === 1 ? typingUsers[0] : `${typingUsers.length} people`}
                </p>
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--bubble-other-text)]/50 animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--bubble-other-text)]/50 animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--bubble-other-text)]/50 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
        </div>

        {/* Live Shared Google Search Panel / Simulated Browser */}
        <AnimatePresence>
          {showGoogleSearch && (
            <div
              className={`w-full h-[45vh] md:h-auto bg-[var(--bg-secondary)] border-t md:border-t-0 md:border-l border-[var(--border-primary)] z-30 flex flex-col shadow-2xl md:shadow-none shrink-0 transition-all duration-300 ${
                browserSize === 'wide' 
                  ? 'md:w-[500px]' 
                  : browserSize === 'fullscreen' 
                    ? 'md:flex-1' 
                    : 'md:w-96'
              }`}
            >
              {/* Browser Header Panel */}
              <div className="flex flex-col bg-[var(--bg-secondary)] border-b border-[var(--border-primary)] shrink-0 select-none">
                {/* Browser top title bar */}
                <div className="flex items-center justify-between px-3 py-2 bg-[var(--bg-tertiary)]/60 text-[var(--text-secondary)] border-b border-[var(--border-primary)] text-[10px]">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <img 
                      src={browserPageFavicon || 'https://www.google.com/favicon.ico'} 
                      alt="" 
                      className="w-3.5 h-3.5 object-contain rounded"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = 'https://www.google.com/favicon.ico';
                      }}
                    />
                    <span className="truncate font-semibold text-[var(--text-primary)] text-[11px]">
                      {browserPageTitle}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Size controls */}
                    <button 
                      onClick={() => setBrowserSize('normal')} 
                      className={`p-1 rounded text-xs transition-colors hover:bg-[var(--bg-hover)] cursor-pointer ${browserSize === 'normal' ? 'text-[var(--accent)] font-bold' : 'opacity-60'}`}
                      title="Normal Size"
                    >
                      🗖
                    </button>
                    <button 
                      onClick={() => setBrowserSize('wide')} 
                      className={`p-1 rounded text-xs transition-colors hover:bg-[var(--bg-hover)] cursor-pointer ${browserSize === 'wide' ? 'text-[var(--accent)] font-bold' : 'opacity-60'}`}
                      title="Wide View"
                    >
                      🗕
                    </button>
                    <button 
                      onClick={() => setBrowserSize('fullscreen')} 
                      className={`p-1 rounded text-xs transition-colors hover:bg-[var(--bg-hover)] cursor-pointer ${browserSize === 'fullscreen' ? 'text-[var(--accent)] font-bold' : 'opacity-60'}`}
                      title="Fullscreen / Split"
                    >
                      ⛶
                    </button>
                    
                    <span className="h-3 w-[1px] bg-[var(--border-primary)] mx-0.5" />
                    
                    <button 
                      onClick={() => setShowGoogleSearch(false)}
                      className="p-1 rounded hover:bg-[var(--danger-muted)] text-[var(--danger)] cursor-pointer"
                      title="Close Browser"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>

                {/* Collaboration & SafeSearch Settings Row (Visible to creator, synced for others) */}
                <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-tertiary)]/20 border-b border-[var(--border-primary)] text-[10px] text-[var(--text-secondary)]">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[var(--text-tertiary)]">Mode:</span>
                    {isCreator ? (
                      <select 
                        value={browserMode}
                        onChange={(e) => handleModeChange(e.target.value as 'collaborative' | 'presenter')}
                        className="bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[10px] rounded px-1 py-0.5 text-[var(--text-primary)] outline-none cursor-pointer"
                      >
                        <option value="collaborative">Collaborative (All Browse)</option>
                        <option value="presenter">Presenter (Creator Only)</option>
                      </select>
                    ) : (
                      <span className="font-bold text-[var(--accent)] capitalize">
                        {browserMode} Mode
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[var(--text-tertiary)]">SafeSearch:</span>
                    <select 
                      value={browserSafeSearch}
                      onChange={(e) => handleSafeSearchChange(e.target.value as 'off' | 'moderate' | 'strict')}
                      className="bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[10px] rounded px-1 py-0.5 text-[var(--text-primary)] outline-none cursor-pointer"
                    >
                      <option value="off">Off (Unfiltered)</option>
                      <option value="moderate">Moderate</option>
                      <option value="strict">Strict</option>
                    </select>
                  </div>
                </div>

                {/* Attribution banner if navigated by someone */}
                {browserLastNavigatedBy && (
                  <div className="px-3 py-1 bg-[var(--accent)]/5 text-[var(--accent)] text-[9px] font-semibold border-b border-[var(--border-primary)] text-center flex items-center justify-center gap-1.5 animate-fadeIn">
                    <span>👤</span>
                    <span>{browserLastNavigatedBy === displayName ? 'You' : browserLastNavigatedBy} navigated to this page</span>
                  </div>
                )}
                
                {/* Browser Address Bar & controls */}
                <div className="flex flex-col bg-[var(--bg-secondary)] shrink-0">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-primary)]">
                    <div className="flex items-center gap-1 text-[var(--text-secondary)] shrink-0">
                      <button 
                        onClick={goBack} 
                        disabled={isControlDisabled}
                        className="p-1 rounded hover:bg-[var(--bg-hover)] disabled:opacity-30 cursor-pointer"
                        title="Back"
                      >
                        <span className="text-xs">◀</span>
                      </button>
                      <button 
                        onClick={goForward} 
                        disabled={isControlDisabled}
                        className="p-1 rounded hover:bg-[var(--bg-hover)] disabled:opacity-30 cursor-pointer"
                        title="Forward"
                      >
                        <span className="text-xs">▶</span>
                      </button>
                      <button 
                        onClick={() => navigateToUrl('https://www.google.com')} 
                        disabled={isControlDisabled}
                        className="p-1 rounded hover:bg-[var(--bg-hover)] disabled:opacity-30 cursor-pointer"
                        title="Back to Google Home"
                      >
                        <span className="text-xs">🏠</span>
                      </button>
                      <button 
                        onClick={reloadPage} 
                        disabled={isControlDisabled}
                        className="p-1 rounded hover:bg-[var(--bg-hover)] disabled:opacity-30 cursor-pointer"
                        title="Reload"
                      >
                        <span className="text-xs">🔄</span>
                      </button>
                    </div>

                    <div className="flex-1 flex items-center gap-1.5 px-3 py-1 rounded-full border border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[11px] text-[var(--text-primary)] relative">
                      <span className="text-[var(--success)] text-[10px] shrink-0">🔒</span>
                      <input 
                        type="text" 
                        value={addressInput}
                        disabled={isControlDisabled}
                        onChange={(e) => setAddressInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const val = addressInput.trim();
                            if (val) navigateToUrl(val);
                          }
                        }}
                        className="w-full bg-transparent outline-none py-0.5 disabled:opacity-75"
                        placeholder={isControlDisabled ? 'Presenter controls enabled...' : 'Type web URL or search Google...'}
                      />
                      
                      {/* Bookmark star */}
                      <button
                        onClick={() => {
                          if (isControlDisabled) return;
                          const isBookmarked = browserBookmarks.some(b => b.url === browserUrl);
                          if (isBookmarked) {
                            setBrowserBookmarks(prev => prev.filter(b => b.url !== browserUrl));
                          } else {
                            setBrowserBookmarks(prev => [...prev, { title: browserPageTitle || browserUrl, url: browserUrl }]);
                          }
                        }}
                        className={`text-xs focus:outline-none shrink-0 cursor-pointer ${isControlDisabled ? 'opacity-30' : 'hover:scale-110 transition-transform'}`}
                        title={browserBookmarks.some(b => b.url === browserUrl) ? 'Remove Bookmark' : 'Bookmark Page'}
                      >
                        {browserBookmarks.some(b => b.url === browserUrl) ? '★' : '☆'}
                      </button>
                    </div>

                    {/* Quick actions */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <a 
                        href={browserUrl} 
                        target="_blank" 
                        rel="noreferrer"
                        className="p-1 rounded hover:bg-[var(--bg-hover)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                        title="Open in new tab"
                      >
                        ↗
                      </a>
                    </div>
                  </div>

                  {/* Bookmarks Bar & Zoom Bar Row */}
                  <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-tertiary)]/30 border-b border-[var(--border-primary)] text-[10px] text-[var(--text-secondary)]">
                    {/* Bookmarks bar */}
                    <div className="flex-1 flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
                      <span className="shrink-0 text-[9px] uppercase tracking-wider text-[var(--text-tertiary)] font-bold">Bookmarks:</span>
                      {browserBookmarks.length === 0 ? (
                        <span className="text-[9px] italic text-[var(--text-tertiary)]">No bookmarks</span>
                      ) : (
                        browserBookmarks.map((bookmark, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              if (!isControlDisabled) {
                                navigateToUrl(bookmark.url);
                              }
                            }}
                            disabled={isControlDisabled}
                            className="shrink-0 px-2 py-0.5 rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-primary)] text-[9px] max-w-[80px] truncate text-[var(--text-primary)] cursor-pointer disabled:opacity-50"
                            title={bookmark.title}
                          >
                            {bookmark.title}
                          </button>
                        ))
                      )}
                    </div>

                    <span className="h-3 w-[1px] bg-[var(--border-primary)] mx-2 shrink-0" />

                    {/* Zoom bar */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button 
                        onClick={() => setBrowserZoomScale(prev => Math.max(0.5, prev - 0.1))} 
                        className="w-4 h-4 rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-primary)] flex items-center justify-center font-bold cursor-pointer"
                        title="Zoom Out"
                      >
                        -
                      </button>
                      <button 
                        onClick={() => setBrowserZoomScale(1.0)} 
                        className="px-1 py-0.5 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-primary)] rounded text-[9px] font-medium cursor-pointer"
                        title="Reset Zoom"
                      >
                        {Math.round(browserZoomScale * 100)}%
                      </button>
                      <button 
                        onClick={() => setBrowserZoomScale(prev => Math.min(2.0, prev + 0.1))} 
                        className="w-4 h-4 rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-primary)] flex items-center justify-center font-bold cursor-pointer"
                        title="Zoom In"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Loading progress bar style rules */}
                  <style>{`
                    @keyframes browserProgress {
                      0% { width: 0%; left: 0%; }
                      50% { width: 40%; left: 30%; }
                      100% { width: 30%; left: 100%; }
                    }
                  `}</style>
                  
                  {/* Loading progress bar */}
                  {isIframeLoading && (
                    <div className="w-full h-0.5 bg-[var(--bg-tertiary)] overflow-hidden shrink-0 relative">
                      <div 
                        className="absolute top-0 bottom-0 bg-[var(--accent)]"
                        style={{
                          animation: 'browserProgress 1.8s infinite linear',
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Browser Body / Page content */}
              <div className="flex-1 flex min-h-0 flex-col bg-[var(--bg-primary)]">
                <div className="flex-1 relative min-h-0 bg-slate-950">
                  <div
                    ref={containerRef}
                    tabIndex={0}
                    onMouseDown={handleBrowserClick}
                    onWheel={handleBrowserWheel}
                    onKeyDown={handleBrowserKeyDown}
                    className="absolute inset-0 outline-none cursor-crosshair overflow-hidden flex items-center justify-center select-none"
                  >
                    {browserFrame ? (
                      <img 
                        src={browserFrame} 
                        alt="Remote Chromium Browser Screen" 
                        className="w-full h-full object-contain pointer-events-none" 
                        draggable={false}
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-3 text-slate-400">
                        <span className="animate-spin text-3xl">⏳</span>
                        <span className="text-xs font-semibold">Connecting to remote Chromium browser...</span>
                      </div>
                    )}
                    {browserLoading && (
                      <div className="absolute top-2 right-2 bg-black/75 text-white text-[10px] px-2 py-1 rounded backdrop-blur font-semibold">
                        Loading...
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* =========================================================== */}
      {/*  IMAGE PREVIEW                                               */}
      {/* =========================================================== */}
      {filePreview && (
        <div className="px-3 py-2 bg-[var(--bg-secondary)] border-t border-[var(--border-primary)] shrink-0 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="relative inline-block">
              {selectedFile?.type.startsWith('video/') ? (
                <video src={filePreview} className="rounded-lg object-cover h-20 w-auto bg-black" muted autoPlay loop />
              ) : (
                <NextImage src={filePreview} alt="preview" width={120} height={80} className="rounded-lg object-cover h-20 w-auto" unoptimized />
              )}
              <button
                onClick={clearFile}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[var(--danger)] text-white flex items-center justify-center cursor-pointer"
              >
                <X size={12} />
              </button>
            </div>
            
            <label className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-secondary)] cursor-pointer select-none">
              <input 
                type="checkbox" 
                checked={isViewOnceChecked} 
                onChange={(e) => setIsViewOnceChecked(e.target.checked)}
                className="accent-[var(--accent)] w-3.5 h-3.5" 
              />
              <span>🕵️‍♂️ View Once</span>
            </label>
          </div>
        </div>
      )}

      {/* =========================================================== */}
      {/*  INPUT BAR                                                   */}
      {/* =========================================================== */}
      <footer className="flex flex-col px-3 py-2 bg-[var(--bg-secondary)] border-t border-[var(--border-primary)] shrink-0 z-20 gap-2">
        {/* Reply Preview */}
        {replyingToMessage && (
          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-xs animate-in slide-in-from-bottom-2 duration-150">
            <div className="flex flex-col gap-0.5 border-l-2 border-[var(--accent)] pl-2 min-w-0">
              <span className="font-semibold text-[var(--accent)] text-[10px]">
                Replying to {replyingToMessage.sender === displayName ? 'yourself' : replyingToMessage.sender}
              </span>
              <span className="truncate text-[var(--text-secondary)] text-[11px] max-w-[280px]">
                {replyingToMessage.type === 'image' ? '📷 Photo' : replyingToMessage.type === 'voice' ? '🎵 Voice Note' : replyingToMessage.content}
              </span>
            </div>
            <button 
              onClick={() => {
                setReplyingToMessage(null);
                replyingToMessageRef.current = null;
              }}
              className="p-1 rounded-full hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] shrink-0 cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Edit Preview */}
        {editingMessage && (
          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-xs animate-in slide-in-from-bottom-2 duration-150">
            <div className="flex flex-col gap-0.5 border-l-2 border-[var(--accent)] pl-2 min-w-0">
              <span className="font-semibold text-[var(--accent)] text-[10px] uppercase tracking-wider">
                Editing Message
              </span>
              <span className="truncate text-[var(--text-secondary)] text-[11px] max-w-[280px]">
                {editingMessage.content}
              </span>
            </div>
            <button 
              onClick={() => {
                setEditingMessage(null);
                setText('');
              }}
              className="p-1 rounded-full hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] shrink-0 cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={e => handleFileSelect(e.target.files?.[0] ?? null)}
          />
          <button 
            onClick={() => fileInputRef.current?.click()} 
            className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors shrink-0 cursor-pointer"
            title="Upload Photo or Video"
          >
            <Paperclip size={20} />
          </button>

          <div className="flex-1 relative">
            <input
              value={text}
              onChange={e => handleTextChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={handleInputFocus}
              placeholder="Type a message…"
              className="w-full px-3.5 py-2 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>

          {/* Google Search Live */}
          <button
            onClick={() => setShowGoogleSearch(prev => !prev)}
            className={`p-2 rounded-lg transition-colors shrink-0 cursor-pointer ${showGoogleSearch ? 'bg-[var(--accent)] text-white' : 'hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]'}`}
            title="Live Google Search"
          >
            <Search size={20} />
          </button>

          {/* Send Online Media Link */}
          <button
            onClick={() => {
              setViewOnceVideoToPlay(null);
              setViewOnceVideoMessageId(null);
              setShowVideoPopup(true);
            }}
            className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors shrink-0 cursor-pointer"
            title="Send Online Media Link"
          >
            <Link2 size={20} />
          </button>

          {/* send */}
          <button
            onClick={sendMessage}
            disabled={!canSend}
            className="p-2 rounded-lg bg-[var(--accent)] text-[var(--accent-text)] hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-30 shrink-0 cursor-pointer"
          >
            <Send size={20} />
          </button>
        </div>
      </footer>

      {/* =========================================================== */}
      {/*  FULLSCREEN IMAGE VIEWER                                     */}
      {/* =========================================================== */}
      <AnimatePresence>
        {fullscreenImage && (
          <div
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
            onClick={() => setFullscreenImage(null)}
          >
            <div className="absolute top-4 right-4 flex gap-2 z-10">
              <a
                href={fullscreenImage}
                download
                onClick={e => e.stopPropagation()}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              >
                <Download size={20} />
              </a>
              <button onClick={() => setFullscreenImage(null)} className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            <NextImage
              src={fullscreenImage}
              alt="full view"
              width={1200}
              height={800}
              className="max-w-[90vw] max-h-[90vh] object-contain"
              onClick={e => e.stopPropagation()}
              unoptimized
            />
          </div>
        )}
      </AnimatePresence>

      {/* =========================================================== */}
      {/*  MEMBERS DRAWER                                              */}
      {/* =========================================================== */}
      <AnimatePresence>
        {showMembers && (
          <>
            <div
              className="fixed inset-0 z-30 bg-black/40"
              onClick={() => setShowMembers(false)}
            />
            <aside
              className="fixed top-0 right-0 bottom-0 w-72 z-40 bg-[var(--bg-secondary)] border-l border-[var(--border-primary)] flex flex-col"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)]">
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Members ({users.length})</h2>
                <button onClick={() => setShowMembers(false)} className="p-1 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]">
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-4">
                {/* Online members */}
                <div>
                  <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] px-3 mb-1">
                    Online — {users.filter(u => u.online).length}
                  </h3>
                  <div className="space-y-0.5">
                    {users.filter(u => u.online).map(user => (
                      <div key={user.name} className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-[var(--bg-hover)] transition-colors">
                        <div className="relative">
                          <div className="w-8 h-8 rounded-full bg-[var(--accent-muted)] flex items-center justify-center text-xs font-semibold text-[var(--accent)]">
                            {user.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-[var(--bg-secondary)]" />
                        </div>
                        <span className="text-sm text-[var(--text-primary)] truncate">
                          {user.name}{user.name === displayName && <span className="text-[var(--text-tertiary)]"> (you)</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Offline members */}
                {users.some(u => !u.online) && (
                  <div>
                    <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] px-3 mb-1">
                      Offline — {users.filter(u => !u.online).length}
                    </h3>
                    <div className="space-y-0.5">
                      {users.filter(u => !u.online).map(user => (
                        <div key={user.name} className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-[var(--bg-hover)] transition-colors opacity-60">
                          <div className="relative">
                            <div className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] flex items-center justify-center text-xs font-semibold text-[var(--text-secondary)]">
                              {user.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-gray-300 rounded-full border-2 border-[var(--bg-secondary)]" />
                          </div>
                          <span className="text-sm text-[var(--text-primary)] truncate">
                            {user.name}{user.name === displayName && <span className="text-[var(--text-tertiary)]"> (you)</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </aside>
          </>
        )}
      </AnimatePresence>

      {/* =========================================================== */}
      {/*  SETTINGS DRAWER                                             */}
      {/* =========================================================== */}
      <AnimatePresence>
        {showSettings && (
          <>
            <div
              className="fixed inset-0 z-30 bg-black/40"
              onClick={() => setShowSettings(false)}
            />
            <aside
              className="fixed top-0 right-0 bottom-0 w-80 z-40 bg-[var(--bg-secondary)] border-l border-[var(--border-primary)] flex flex-col"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)]">
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Settings</h2>
                <button onClick={() => setShowSettings(false)} className="p-1 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]">
                  <X size={18} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-5">
                {/* Nickname */}
                <div className="px-3 py-1 space-y-1.5">
                  <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Your Nickname</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => {
                        const newName = e.target.value;
                        setDisplayName(newName);
                        localStorage.setItem(`roomchat_display_name_${roomId}`, newName);
                        localStorage.setItem('roomchat_display_name', newName);
                        socketRef.current?.emit('change_name', { roomId, newName, userKey: localStorage.getItem(`room_user_key_${roomId}`) || '' });
                      }}
                      placeholder="Your name"
                      maxLength={30}
                      className="w-full text-sm px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors"
                    />
                  </div>
                </div>
                {/* Sound */}
                <button onClick={toggleSound} className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-[var(--bg-hover)] transition-colors">
                  <div className="flex items-center gap-3">
                    {soundEnabled ? <Volume2 size={18} className="text-[var(--text-secondary)]" /> : <VolumeX size={18} className="text-[var(--text-secondary)]" />}
                    <span className="text-sm text-[var(--text-primary)]">Sound</span>
                  </div>
                  <div className={`w-9 h-5 rounded-full transition-colors relative ${soundEnabled ? 'bg-[var(--accent)]' : 'bg-[var(--bg-tertiary)]'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${soundEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </div>
                </button>

                {/* Theme */}
                <button onClick={toggleTheme} className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-[var(--bg-hover)] transition-colors">
                  <div className="flex items-center gap-3">
                    {theme === 'dark' ? <Moon size={18} className="text-[var(--text-secondary)]" /> : <Sun size={18} className="text-[var(--text-secondary)]" />}
                    <span className="text-sm text-[var(--text-primary)]">{theme === 'dark' ? 'Dark' : 'Light'} Mode</span>
                  </div>
                  <div className={`w-9 h-5 rounded-full transition-colors relative ${theme === 'light' ? 'bg-[var(--accent)]' : 'bg-[var(--bg-tertiary)]'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${theme === 'light' ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </div>
                </button>

                {/* Notifications */}
                <button onClick={toggleNotif} className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-[var(--bg-hover)] transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">🔔</span>
                    <span className="text-sm text-[var(--text-primary)]">Notifications</span>
                  </div>
                  <div className={`w-9 h-5 rounded-full transition-colors relative ${notifEnabled ? 'bg-[var(--accent)]' : 'bg-[var(--bg-tertiary)]'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${notifEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </div>
                </button>

                {/* Accent color */}
                <div className="px-3 space-y-2.5">
                  <span className="text-sm text-[var(--text-secondary)]">Accent Color</span>
                  <div className="flex gap-3">
                    {ACCENT_COLORS.map(c => (
                      <button
                        key={c.name}
                        onClick={() => changeAccent(c.name)}
                        className="relative w-8 h-8 rounded-full transition-transform hover:scale-110"
                        style={{ backgroundColor: c.ring }}
                      >
                        {accent === c.name && (
                          <Check size={14} className="absolute inset-0 m-auto text-white" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Creator Settings */}
                {isCreator && (
                  <div className="px-3 py-3 space-y-4 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-tertiary)]/50">
                    <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
                      <Sparkles size={12} className="text-[var(--accent)]" />
                      Creator Controls
                    </div>
                    
                    {/* Room Name Input */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-[var(--text-secondary)]">Room Name</label>
                      <input 
                        type="text" 
                        value={roomName}
                        onChange={(e) => {
                          setRoomName(e.target.value);
                          updateRoomDetails(e.target.value, isPublic ? 'public' : 'private');
                        }}
                        className="w-full text-sm px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors"
                        maxLength={40}
                        placeholder="Unnamed Room"
                      />
                    </div>

                    {/* Room Visibility Toggle */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--text-secondary)]">Visibility</label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setIsPublic(true);
                            updateRoomDetails(roomName, 'public');
                          }}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                            isPublic 
                              ? 'bg-[var(--accent-muted)] border-[var(--accent)] text-[var(--accent)]' 
                              : 'bg-[var(--bg-secondary)] border-[var(--border-primary)] text-[var(--text-secondary)]'
                          }`}
                        >
                          <Globe size={12} />
                          Public
                        </button>
                        <button
                          onClick={() => {
                            setIsPublic(false);
                            updateRoomDetails(roomName, 'private');
                          }}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                            !isPublic 
                              ? 'bg-[var(--accent-muted)] border-[var(--accent)] text-[var(--accent)]' 
                              : 'bg-[var(--bg-secondary)] border-[var(--border-primary)] text-[var(--text-secondary)]'
                          }`}
                        >
                          <Lock size={12} />
                          Private
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Divider */}
                <div className="border-t border-[var(--border-primary)]" />

                {/* Clear chat */}
                {isCreator && (
                  <button
                    onClick={() => { clearChat(); setShowSettings(false); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--danger-muted)] transition-colors cursor-pointer"
                  >
                    <Trash2 size={18} className="text-[var(--danger)]" />
                    <span className="text-sm text-[var(--danger)]">Clear Chat</span>
                  </button>
                )}

                {/* Delete room */}
                {isCreator && (
                  <button
                    onClick={() => {
                      setShowDeleteConfirm(true);
                      setShowSettings(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--danger-muted)] transition-colors cursor-pointer"
                  >
                    <Trash2 size={18} className="text-[var(--danger)]" />
                    <span className="text-sm text-[var(--danger)]">Delete Room</span>
                  </button>
                )}

                {/* Leave room */}
                <button
                  onClick={leaveRoom}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--danger-muted)] transition-colors cursor-pointer"
                >
                  <ArrowLeft size={18} className="text-[var(--danger)]" />
                  <span className="text-sm text-[var(--danger)]">Leave Room</span>
                </button>
              </div>
            </aside>
          </>
        )}
      </AnimatePresence>

      {/* =========================================================== */}
      {/*  DISAPPEARING VIDEO VIEW / SEND MODAL                        */}
      {/* =========================================================== */}
      <AnimatePresence>
        {showVideoPopup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/80"
              onClick={() => {
                if (viewOnceVideoMessageId) {
                  deleteMessage(viewOnceVideoMessageId);
                }
                setShowVideoPopup(false);
                setViewOnceVideoToPlay(null);
                setViewOnceVideoMessageId(null);
              }}
            />
            
            <div
              className="relative w-full max-w-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-2xl overflow-hidden shadow-2xl z-10 flex flex-col p-4 gap-4"
            >
              {viewOnceVideoToPlay ? (
                /* Player view */
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">🕵️‍♂️</span>
                      <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Disappearing Video Preview</span>
                    </div>
                  </div>

                  <div className="rounded-lg overflow-hidden border border-[var(--border-primary)] bg-black aspect-video flex items-center justify-center">
                    {viewOnceVideoToPlay.includes('youtube.com/embed') ? (
                      <iframe 
                        src={viewOnceVideoToPlay} 
                        title="Disappearing Video Player"
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <video 
                        src={viewOnceVideoToPlay} 
                        controls 
                        autoPlay
                        className="w-full h-full object-contain"
                      />
                    )}
                  </div>

                  <p className="text-[11px] text-[var(--text-tertiary)] text-center">
                    Closing or leaving this video player will instantly delete it for everyone in the room.
                  </p>

                  <button
                    onClick={() => {
                      if (viewOnceVideoMessageId) {
                        deleteMessage(viewOnceVideoMessageId);
                      }
                      setShowVideoPopup(false);
                      setViewOnceVideoToPlay(null);
                      setViewOnceVideoMessageId(null);
                    }}
                    className="w-full cursor-pointer py-2 px-4 rounded-xl text-xs font-semibold bg-[var(--danger)] text-white hover:bg-[var(--danger)]/90 transition-colors text-center"
                  >
                    Close & Burn Video
                  </button>
                </div>
              ) : (
                /* Sender entry view */
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-2">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">Send Online Media Link</span>
                    <button 
                      onClick={() => setShowVideoPopup(false)}
                      className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] cursor-pointer"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div className="space-y-3">
                    <label className="text-xs font-medium text-[var(--text-secondary)] block">Paste Video or Photo URL</label>
                    <input 
                      type="text" 
                      id="video-url-input"
                      placeholder="e.g. https://example.com/media.mp4 or photo.jpg"
                      className="w-full text-xs px-3 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                    />

                    <label className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-secondary)] cursor-pointer select-none py-1">
                      <input 
                        type="checkbox" 
                        checked={isModalViewOnce} 
                        onChange={(e) => setIsModalViewOnce(e.target.checked)}
                        className="accent-[var(--accent)] w-3.5 h-3.5" 
                      />
                      <span>🕵️‍♂️ Send as View Once (Disappearing)</span>
                    </label>

                    <div className="space-y-1">
                      <span className="text-[10px] text-[var(--text-tertiary)] font-semibold uppercase tracking-wider block">Or Choose Mock Previews:</span>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => {
                            const input = document.getElementById('video-url-input') as HTMLInputElement;
                            if (input) input.value = 'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
                          }}
                          className="text-left text-[11px] p-2 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-primary)] transition-colors cursor-pointer block truncate"
                        >
                          🐰 Bunny (Video)
                        </button>
                        <button
                          onClick={() => {
                            const input = document.getElementById('video-url-input') as HTMLInputElement;
                            if (input) input.value = 'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4';
                          }}
                          className="text-left text-[11px] p-2 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-primary)] transition-colors cursor-pointer block truncate"
                        >
                          🐘 Elephants (Video)
                        </button>
                        <button
                          onClick={() => {
                            const input = document.getElementById('video-url-input') as HTMLInputElement;
                            if (input) input.value = 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=800';
                          }}
                          className="text-left text-[11px] p-2 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-primary)] transition-colors cursor-pointer block truncate"
                        >
                          🎨 Art (Photo)
                        </button>
                        <button
                          onClick={() => {
                            const input = document.getElementById('video-url-input') as HTMLInputElement;
                            if (input) input.value = 'https://images.unsplash.com/photo-1472214222541-d510753a8707?w=800';
                          }}
                          className="text-left text-[11px] p-2 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-primary)] transition-colors cursor-pointer block truncate"
                        >
                          🏞️ Nature (Photo)
                        </button>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      const input = document.getElementById('video-url-input') as HTMLInputElement;
                      if (input && input.value.trim()) {
                        sendOnlineMediaLink(input.value.trim(), isModalViewOnce);
                        setShowVideoPopup(false);
                        setIsModalViewOnce(false);
                      }
                    }}
                    className="w-full cursor-pointer py-2 px-4 rounded-xl text-xs font-semibold bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors text-center"
                  >
                    Send Media Link
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* =========================================================== */}
      {/*  DISAPPEARING IMAGE VIEW MODAL                              */}
      {/* =========================================================== */}
      <AnimatePresence>
        {showImagePopup && viewOnceImageToPlay && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/80"
              onClick={() => {
                if (viewOnceVideoMessageId) {
                  deleteMessage(viewOnceVideoMessageId);
                }
                setShowImagePopup(false);
                setViewOnceImageToPlay(null);
                setViewOnceVideoMessageId(null);
              }}
            />
            
            <div
              className="relative w-full max-w-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-2xl overflow-hidden shadow-2xl z-10 flex flex-col p-4 gap-4"
            >
              <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm">🕵️‍♂️</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Disappearing Photo Preview</span>
                </div>
              </div>

              <div className="rounded-lg overflow-hidden border border-[var(--border-primary)] bg-black max-h-[60vh] flex items-center justify-center">
                <img 
                  src={viewOnceImageToPlay} 
                  alt="Disappearing View Once"
                  className="w-full h-auto max-h-[50vh] object-contain"
                />
              </div>

              <p className="text-[11px] text-[var(--text-tertiary)] text-center">
                Closing or leaving this photo will instantly delete it for everyone in the room.
              </p>

              <button
                onClick={() => {
                  if (viewOnceVideoMessageId) {
                    deleteMessage(viewOnceVideoMessageId);
                  }
                  setShowImagePopup(false);
                  setViewOnceImageToPlay(null);
                  setViewOnceVideoMessageId(null);
                }}
                className="w-full cursor-pointer py-2 px-4 rounded-xl text-xs font-semibold bg-[var(--danger)] text-white hover:bg-[var(--danger)]/90 transition-colors text-center"
              >
                Close & Burn Photo
              </button>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* =========================================================== */}
      {/*  SEARCH IMAGE PREVIEW MODAL                                */}
      {/* =========================================================== */}
      <AnimatePresence>
        {searchImagePreviewUrl && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/80"
              onClick={() => setSearchImagePreviewUrl(null)}
            />
            <div
              className="relative max-w-lg w-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-2xl overflow-hidden shadow-2xl z-10 flex flex-col p-4 gap-4"
            >
              <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-2">
                <span className="text-xs font-semibold text-[var(--text-primary)]">Google Search Image Preview</span>
                <button 
                  onClick={() => setSearchImagePreviewUrl(null)}
                  className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="relative w-full overflow-hidden flex items-center justify-center bg-black rounded-lg aspect-square">
                <img 
                  src={searchImagePreviewUrl} 
                  alt="Search Preview" 
                  className="w-full h-full object-contain rounded-lg"
                />
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* =========================================================== */}
      {/*  SEARCH VIDEO PREVIEW MODAL                                */}
      {/* =========================================================== */}
      <AnimatePresence>
        {searchVideoPreviewUrl && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/80"
              onClick={() => setSearchVideoPreviewUrl(null)}
            />
            <div
              className="relative max-w-2xl w-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-2xl overflow-hidden shadow-2xl z-10 flex flex-col p-4 gap-4"
            >
              <div className="flex items-center justify-between border-b border-[var(--border-primary)] pb-2">
                <span className="text-xs font-semibold text-[var(--text-primary)]">Google Search Video Preview</span>
                <button 
                  onClick={() => setSearchVideoPreviewUrl(null)}
                  className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="rounded-lg overflow-hidden border border-[var(--border-primary)] bg-black aspect-video flex items-center justify-center">
                {searchVideoPreviewUrl.includes('youtube.com/embed') ? (
                  <iframe 
                    src={searchVideoPreviewUrl} 
                    title="Search Video Preview"
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <video 
                    src={searchVideoPreviewUrl} 
                    controls 
                    autoPlay
                    className="w-full h-full object-contain"
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* =========================================================== */}
      {/*  DELETE CONFIRMATION MODAL                                  */}
      {/* =========================================================== */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setShowDeleteConfirm(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="relative max-w-sm w-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-2xl overflow-hidden shadow-2xl z-10 flex flex-col p-6 gap-4 text-center"
            >
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600 border border-red-100">
                <Trash2 size={22} />
              </div>
              <div>
                <h3 className="text-base font-bold text-[var(--text-primary)] mb-1">Delete Chat Room?</h3>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  This will immediately disconnect all active participants and permanently clear all messages. This action cannot be undone.
                </p>
              </div>
              <div className="flex gap-3 mt-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl border border-[var(--border-primary)] text-xs font-semibold text-[var(--text-secondary)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    deleteRoom();
                    setShowDeleteConfirm(false);
                  }}
                  className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors shadow-sm cursor-pointer"
                >
                  Delete Room
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
