const express = require('express');
const next = require('next');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const puppeteer = require('puppeteer');


const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const port = process.env.PORT || 3000;

const rooms = new Map();

// Cleanup inactive rooms (no activity for more than 3 days)
setInterval(() => {
  const now = Date.now();
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  for (const [roomId, room] of rooms.entries()) {
    if (room.lastActivity && (now - room.lastActivity > threeDaysMs)) {
      rooms.delete(roomId);
      console.log(`> Cleaned up inactive room: ${roomId}`);
    }
  }
}, 60 * 60 * 1000); // Check hourly

app.prepare().then(() => {
  const expressApp = express();
  const server = http.createServer(expressApp);
  const io = new Server(server, {
    maxHttpBufferSize: 20 * 1024 * 1024, // 20 MB max file size matching image limit
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Share active public rooms list
  function getPublicRooms() {
    const list = [];
    for (const [roomId, room] of rooms.entries()) {
      if (room.isPublic) {
        list.push({
          code: room.code,
          name: room.name,
          users: Object.keys(room.users).length
        });
      }
    }
    return list;
  }

  function broadcastPublicRooms() {
    io.emit('public_rooms_update', getPublicRooms());
  }

  const activeBrowsers = new Map();

  function triggerActiveStreaming(roomId) {
    const session = activeBrowsers.get(roomId);
    if (!session) return;
    
    session.lastActive = Date.now();
    session.activeUntil = Date.now() + 3000;
    
    if (session.activeLoopId) return; // Loop already running
    
    console.log(`[Puppeteer] Starting active streaming loop for room ${roomId}`);
    
    const runLoop = async () => {
      if (!activeBrowsers.has(roomId)) return;
      const s = activeBrowsers.get(roomId);
      if (Date.now() > s.activeUntil) {
        console.log(`[Puppeteer] Active streaming loop finished for room ${roomId}`);
        s.activeLoopId = null;
        return;
      }
      
      try {
        const screenshot = await s.page.screenshot({ type: 'jpeg', quality: 40, encoding: 'base64' });
        io.to(roomId).emit('browser_frame', {
          screenshot: `data:image/jpeg;base64,${screenshot}`,
          url: s.page.url(),
          title: await s.page.title(),
          loading: false
        });
      } catch (e) {}
      
      s.activeLoopId = setTimeout(runLoop, 200);
    };
    
    runLoop();
  }

  const pendingBrowsers = new Map();

  async function getOrCreateBrowser(roomId, width = 1024, height = 768) {
    if (activeBrowsers.has(roomId)) {
      const session = activeBrowsers.get(roomId);
      if (width && height) {
        try {
          await session.page.setViewport({ width, height });
        } catch (e) {}
      }
      return session;
    }

    if (pendingBrowsers.has(roomId)) {
      return pendingBrowsers.get(roomId);
    }

    const launchPromise = (async () => {
      console.log(`[Puppeteer] Launching browser for room ${roomId} (${width}x${height})`);
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: { width, height }
      });

      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.goto('https://www.google.com', { timeout: 8000, waitUntil: 'domcontentloaded' }).catch(err => {
        console.warn(`[Puppeteer] Initial navigation to google.com failed or timed out:`, err.message);
      });

      const session = { 
        browser, 
        page, 
        lastActive: Date.now(),
        activeUntil: 0,
        activeLoopId: null
      };

      const triggerScreenshot = async () => {
        try {
          if (!activeBrowsers.has(roomId)) return;
          const screenshot = await page.screenshot({ type: 'jpeg', quality: 40, encoding: 'base64' });
          const url = page.url();
          const title = await page.title();
          
          io.to(roomId).emit('browser_frame', {
            screenshot: `data:image/jpeg;base64,${screenshot}`,
            url,
            title,
            loading: false
          });
        } catch (err) {
          // Silent catch
        }
      };

      page.on('load', triggerScreenshot);
      page.on('domcontentloaded', triggerScreenshot);
      
      const intervalId = setInterval(async () => {
        if (!activeBrowsers.has(roomId)) {
          clearInterval(intervalId);
          return;
        }
        if (!session.activeLoopId) {
          try {
            await triggerScreenshot();
          } catch (e) {}
        }
      }, 5000);

      session.intervalId = intervalId;

      activeBrowsers.set(roomId, session);
      pendingBrowsers.delete(roomId);
      return session;
    })().catch(err => {
      pendingBrowsers.delete(roomId);
      console.error(`[Puppeteer] Failed to launch browser for room ${roomId}:`, err);
      throw err;
    });

    pendingBrowsers.set(roomId, launchPromise);
    return launchPromise;
  }

  // Cleanup inactive room browsers (no activity for more than 10 minutes)
  setInterval(async () => {
    const now = Date.now();
    const tenMinsMs = 10 * 60 * 1000;
    for (const [roomId, session] of activeBrowsers.entries()) {
      if (now - session.lastActive > tenMinsMs) {
        console.log(`[Puppeteer] Closing inactive browser for room ${roomId}`);
        if (session.intervalId) clearInterval(session.intervalId);
        if (session.activeLoopId) clearTimeout(session.activeLoopId);
        try {
          await session.browser.close();
        } catch (e) {}
        activeBrowsers.delete(roomId);
      }
    }
  }, 60 * 1000);

  io.on('connection', (socket) => {
    // Send list of public rooms to new connections
    socket.emit('public_rooms_update', getPublicRooms());

    socket.on('join_room', ({ roomId, name, isPublic, roomName, creatorKey }) => {
      socket.join(roomId);
      
      let room = rooms.get(roomId);
      if (!room) {
        room = {
          code: roomId,
          name: roomName || 'Unnamed Room',
          isPublic: !!isPublic,
          users: {},
          messages: [],
          typingUsers: [],
          creatorKey: creatorKey || crypto.randomUUID(),
          lastActivity: Date.now()
        };
        rooms.set(roomId, room);
      }
      room.lastActivity = Date.now();

      // Handle duplicate names (rename automatically)
      let finalName = name;
      let counter = 2;
      const existingNames = Object.values(room.users).map(u => u.name);
      while (existingNames.includes(finalName)) {
        finalName = `${name} (${counter})`;
        counter++;
      }

      // Add user to room
      room.users[socket.id] = { name: finalName };
      
      // Let current client know their final resolved name and historical messages
      socket.emit('joined_info', { 
        name: finalName, 
        messages: room.messages, 
        users: Object.values(room.users).map(u => u.name),
        roomName: room.name,
        isPublic: room.isPublic,
        isCreator: room.creatorKey === creatorKey
      });

      // Notify others in room
      socket.to(roomId).emit('user_joined', { name: finalName, users: Object.values(room.users).map(u => u.name) });
      
      // Update public rooms listing if visibility is public
      if (room.isPublic) {
        broadcastPublicRooms();
      }
    });

    socket.on('send_message', ({ roomId, message }) => {
      const room = rooms.get(roomId);
      if (!room) return;

      const user = room.users[socket.id];
      if (!user) return;

      const fullMessage = {
        id: crypto.randomUUID(),
        sender: user.name,
        content: message.content, // text
        type: message.type || 'text', // 'text', 'image', 'voice'
        mediaUrl: message.mediaUrl, // image or voice url
        replyTo: message.replyTo,
        timestamp: new Date().toISOString(),
        delivered: true,
        seen: false
      };

      room.messages.push(fullMessage);
      room.lastActivity = Date.now();
      
      // Broadcast to room
      io.to(roomId).emit('new_message', fullMessage);
    });

    socket.on('typing_status', ({ roomId, isTyping }) => {
      const room = rooms.get(roomId);
      if (!room) return;

      const user = room.users[socket.id];
      if (!user) return;

      if (isTyping) {
        if (!room.typingUsers.includes(user.name)) {
          room.typingUsers.push(user.name);
        }
      } else {
        room.typingUsers = room.typingUsers.filter(u => u !== user.name);
      }

      io.to(roomId).emit('typing_update', room.typingUsers);
    });

    socket.on('message_action', ({ roomId, messageId, action, reaction }) => {
      const room = rooms.get(roomId);
      if (!room) return;

      const user = room.users[socket.id];
      if (!user) return;

      // Find the message
      const msgIndex = room.messages.findIndex(m => m.id === messageId);
      if (msgIndex === -1) return;

      const msg = room.messages[msgIndex];

      if (action === 'delete') {
        // Only allow deleting own messages, OR any view_once_video message
        if (msg.sender === user.name || msg.type === 'view_once_video') {
          room.messages.splice(msgIndex, 1);
          room.lastActivity = Date.now();
          io.to(roomId).emit('message_deleted', messageId);
        }
      } else if (action === 'react') {
        if (!msg.reactions) msg.reactions = {};
        // React / toggle reaction
        if (msg.reactions[user.name] === reaction) {
          delete msg.reactions[user.name];
        } else {
          msg.reactions[user.name] = reaction;
        }
        room.lastActivity = Date.now();
        io.to(roomId).emit('message_updated', msg);
      }
    });

    socket.on('update_room_details', ({ roomId, roomName, isPublic, creatorKey }) => {
      const room = rooms.get(roomId);
      if (!room) return;
      if (room.creatorKey !== creatorKey) return;

      if (roomName !== undefined && roomName.trim()) {
        room.name = roomName.trim();
      }
      if (isPublic !== undefined) {
        room.isPublic = !!isPublic;
      }

      io.to(roomId).emit('room_details_updated', {
        roomName: room.name,
        isPublic: room.isPublic
      });

      broadcastPublicRooms();
    });

    socket.on('clear_chat', ({ roomId, creatorKey }) => {
      const room = rooms.get(roomId);
      if (!room) return;
      if (room.creatorKey !== creatorKey) return;
      room.messages = [];
      room.lastActivity = Date.now();
      io.to(roomId).emit('chat_cleared');
    });

    socket.on('browser_init', async ({ roomId, width, height }) => {
      try {
        await getOrCreateBrowser(roomId, width, height);
        triggerActiveStreaming(roomId);
      } catch (err) {
        console.error(err);
      }
    });

    socket.on('browser_resize', async ({ roomId, width, height }) => {
      try {
        if (!width || !height) return;
        await getOrCreateBrowser(roomId, width, height);
        triggerActiveStreaming(roomId);
      } catch (err) {
        console.error(err);
      }
    });

    socket.on('browser_action_navigate', async ({ roomId, url }) => {
      try {
        const session = await getOrCreateBrowser(roomId);
        io.to(roomId).emit('browser_frame_metadata', { loading: true });
        
        let targetUrl = url.trim();
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
          if (targetUrl.includes('.') && !targetUrl.includes(' ')) {
            targetUrl = 'https://' + targetUrl;
          } else {
            targetUrl = 'https://www.google.com/search?q=' + encodeURIComponent(targetUrl);
          }
        }
        await session.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        triggerActiveStreaming(roomId);
      } catch (err) {
        console.error(err);
      }
    });

    socket.on('browser_action_click', async ({ roomId, x, y }) => {
      try {
        const session = await getOrCreateBrowser(roomId);
        await session.page.mouse.click(x, y);
        triggerActiveStreaming(roomId);
      } catch (err) {
        console.error(err);
      }
    });

    socket.on('browser_action_scroll', async ({ roomId, deltaY }) => {
      try {
        const session = await getOrCreateBrowser(roomId);
        await session.page.evaluate((dy) => {
          window.scrollBy(0, dy);
        }, deltaY);
        triggerActiveStreaming(roomId);
      } catch (err) {
        console.error(err);
      }
    });

    socket.on('browser_action_keypress', async ({ roomId, key, text }) => {
      try {
        const session = await getOrCreateBrowser(roomId);
        if (key === 'Backspace') {
          await session.page.keyboard.press('Backspace');
        } else if (key === 'Enter') {
          await session.page.keyboard.press('Enter');
        } else if (text) {
          await session.page.keyboard.type(text);
        } else {
          await session.page.keyboard.press(key);
        }
        triggerActiveStreaming(roomId);
      } catch (err) {
        console.error(err);
      }
    });

    socket.on('browser_action_back', async ({ roomId }) => {
      try {
        const session = await getOrCreateBrowser(roomId);
        await session.page.goBack().catch(() => {});
        triggerActiveStreaming(roomId);
      } catch (err) {
        console.error(err);
      }
    });

    socket.on('browser_action_forward', async ({ roomId }) => {
      try {
        const session = await getOrCreateBrowser(roomId);
        await session.page.goForward().catch(() => {});
        triggerActiveStreaming(roomId);
      } catch (err) {
        console.error(err);
      }
    });

    socket.on('browser_action_reload', async ({ roomId }) => {
      try {
        const session = await getOrCreateBrowser(roomId);
        await session.page.reload().catch(() => {});
        triggerActiveStreaming(roomId);
      } catch (err) {
        console.error(err);
      }
    });

    socket.on('disconnecting', () => {
      for (const roomId of socket.rooms) {
        if (roomId === socket.id) continue;
        const room = rooms.get(roomId);
        if (room) {
          const user = room.users[socket.id];
          if (user) {
            delete room.users[socket.id];
            
            // Remove from typing list
            room.typingUsers = room.typingUsers.filter(u => u !== user.name);
            io.to(roomId).emit('typing_update', room.typingUsers);

            // Notify remaining users
            socket.to(roomId).emit('user_left', { name: user.name, users: Object.values(room.users).map(u => u.name) });
          }
        }
      }
      broadcastPublicRooms();
    });
  });

  const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  function safeToAdlt(safe) {
    if (safe === 'strict') return 'strict';
    if (safe === 'moderate') return 'moderate';
    return 'off';
  }

  function safeToKp(safe) {
    if (safe === 'strict') return '1';
    if (safe === 'moderate') return '-1';
    return '-2';
  }

  function decodeHtmlEntities(value) {
    return value
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  function proxyErrorPage(targetUrl, message) {
    const safeUrl = String(targetUrl).replace(/"/g, '&quot;');
    return `<!doctype html><html><head><meta charset="utf-8"><title>Could not load page</title></head><body style="font-family:system-ui;padding:24px;line-height:1.5;background:#0f172a;color:#f8fafc"><h2 style="margin-bottom:8px">Could not load this page</h2><p>${message}</p><p><a href="${safeUrl}" target="_blank" rel="noreferrer" style="color:#38bdf8">Open ${safeUrl} in a new tab</a></p></body></html>`;
  }

  // Live web search endpoint (Google-style UI, multi-source backend)
  expressApp.get('/api/search', async (req, res) => {
    try {
      const q = req.query.q || '';
      const safe = req.query.safe || 'off';
      if (!q.trim()) {
        return res.json({ web: [], images: [], videos: [], news: [] });
      }

      const kp = safeToKp(safe);

      const [web, images, videos, news] = await Promise.all([
        fetchWebResults(q, safe, kp).catch(() => []),
        fetchImageResults(q, safe).catch(() => []),
        fetchVideoResults(q, safe, kp).catch(() => []),
        fetchNewsResults(q).catch(() => [])
      ]);

      res.json({ web, images, videos, news });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Search failed' });
    }
  });

  async function fetchGoogleCse(q, safe, searchType) {
    const key = process.env.GOOGLE_CSE_API_KEY;
    const cx = process.env.GOOGLE_CSE_ID;
    if (!key || !cx) return null;

    let url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(q)}&num=10`;
    if (searchType) url += `&searchType=${searchType}`;
    if (safe === 'strict') url += '&safe=active';
    else if (safe === 'moderate') url += '&safe=medium';
    else url += '&safe=off';

    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.items || [];
  }

  async function fetchWebResults(q, safe, kp = '-2') {
    const cseItems = await fetchGoogleCse(q, safe);
    if (cseItems) {
      return cseItems.slice(0, 10).map((item) => ({
        title: item.title || q,
        url: item.link,
        snippet: item.snippet || 'Click to open this result.'
      }));
    }

    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kp=${kp}`, {
      headers: { 'User-Agent': BROWSER_UA }
    });
    const html = await res.text();
    const resultBlocks = html.split('<div class="result results_links results_links_deep web-result ">');
    const results = [];
    for (let i = 1; i < Math.min(resultBlocks.length, 10); i++) {
      const block = resultBlocks[i];
      const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
      const hrefMatch = block.match(/class="result__a"[^>]*href="([^"]+)"/) || block.match(/href="([^"]+)"/);
      if (titleMatch && hrefMatch) {
        let rawUrl = hrefMatch[1];
        let decodedUrl = rawUrl;
        if (rawUrl.includes('uddg=')) {
          const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
          if (uddgMatch) {
            decodedUrl = decodeURIComponent(uddgMatch[1]);
          }
        }
        results.push({
          title: titleMatch[1].replace(/<[^>]+>/g, '').trim(),
          url: decodedUrl,
          snippet: snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : 'Click link to explore result.'
        });
      }
    }
    return results;
  }

  async function fetchImageResults(q, safe) {
    const cseItems = await fetchGoogleCse(q, safe, 'image');
    if (cseItems) {
      return cseItems.slice(0, 24).map((item) => ({
        title: item.title || q,
        imageUrl: item.link,
        url: item.image?.contextLink || item.link
      }));
    }

    const adlt = safeToAdlt(safe);
    const res = await fetch(`https://www.bing.com/images/search?q=${encodeURIComponent(q)}&adlt=${adlt}&first=1&form=HDRSC2`, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    const html = await res.text();
    const results = [];
    const seen = new Set();

    for (const block of html.split('class="iusc"')) {
      if (results.length >= 24) break;
      const murlMatch = block.match(/murl&quot;:&quot;(.*?)&quot;/);
      if (!murlMatch) continue;
      const imageUrl = decodeHtmlEntities(murlMatch[1]);
      if (!imageUrl.startsWith('http') || seen.has(imageUrl)) continue;
      seen.add(imageUrl);
      const purlMatch = block.match(/purl&quot;:&quot;(.*?)&quot;/);
      const pageUrl = purlMatch ? decodeHtmlEntities(purlMatch[1]) : imageUrl;
      const titleMatch = block.match(/t&quot;:&quot;(.*?)&quot;/);
      results.push({
        title: titleMatch ? decodeHtmlEntities(titleMatch[1]) : q,
        imageUrl,
        url: pageUrl.startsWith('http') ? pageUrl : imageUrl
      });
    }

    if (results.length > 0) return results;

    // Fallback to DuckDuckGo images if Bing layout changes
    return fetchDdgImageResults(q, safeToKp(safe));
  }

  async function fetchDdgImageResults(q, kp) {
    const htmlRes = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=images&ia=images&kp=${kp}`, {
      headers: { 'User-Agent': BROWSER_UA }
    });
    const html = await htmlRes.text();
    const vqdMatch = html.match(/vqd=([^&'"]+)/) || html.match(/vqd\s*=\s*['"]([^'"]+)['"]/);
    if (!vqdMatch) return [];

    const jsonRes = await fetch(`https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(q)}&vqd=${vqdMatch[1]}&f=,,,&kp=${kp}&p=${kp === '-2' ? '-2' : kp === '-1' ? '-1' : '1'}`, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Referer': 'https://duckduckgo.com/'
      }
    });
    const data = await jsonRes.json();
    return (data.results || []).slice(0, 24).map((img) => ({
      title: img.title || q,
      imageUrl: img.image,
      url: img.url
    }));
  }

  async function fetchDdgVideoResults(q, kp) {
    const htmlRes = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=videos&ia=videos&kp=${kp}`, {
      headers: { 'User-Agent': BROWSER_UA }
    });
    const html = await htmlRes.text();
    const vqdMatch = html.match(/vqd=([^&'"]+)/) || html.match(/vqd\s*=\s*['"]([^'"]+)['"]/);
    if (!vqdMatch) return [];

    const jsonRes = await fetch(`https://duckduckgo.com/v.js?l=us-en&o=json&q=${encodeURIComponent(q)}&vqd=${vqdMatch[1]}&kp=${kp}`, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Referer': 'https://duckduckgo.com/'
      }
    });
    const data = await jsonRes.json();
    return (data.results || []).slice(0, 12).map((video) => {
      const watchUrl = video.content || video.embed_url || '';
      const embedUrl = video.embed_url || (watchUrl.includes('youtube.com/watch') ? watchUrl.replace('watch?v=', 'embed/') : watchUrl);
      return {
        title: video.title || 'Video result',
        url: watchUrl,
        videoUrl: embedUrl,
        imageUrl: video.images?.large || video.images?.medium || video.images?.small || '',
        videoDuration: video.duration || '',
        snippet: video.description || (video.uploader ? `From ${video.uploader}` : 'Watch this video'),
        source: video.uploader || 'Web'
      };
    }).filter((video) => video.url.startsWith('http'));
  }

  async function fetchYoutubeVideoResults(q) {
    const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    const html = await res.text();
    const match = html.match(/var ytInitialData\s*=\s*({[\s\S]*?});/);
    if (!match) return [];
    const data = JSON.parse(match[1]);
    const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents;
    const videos = [];
    if (contents) {
      for (const item of contents) {
        const v = item.videoRenderer;
        if (v && v.videoId) {
          videos.push({
            title: v.title?.runs?.[0]?.text || 'YouTube Video',
            url: `https://www.youtube.com/watch?v=${v.videoId}`,
            videoUrl: `https://www.youtube.com/embed/${v.videoId}`,
            imageUrl: v.thumbnail?.thumbnails?.[0]?.url || '',
            videoDuration: v.lengthText?.simpleText || '0:00',
            snippet: v.detailedMetadataSnippets?.[0]?.snippetText?.runs?.[0]?.text || v.descriptionSnippet?.runs?.[0]?.text || 'Watch on YouTube.',
            source: 'YouTube'
          });
        }
      }
    }
    return videos;
  }

  async function fetchVideoResults(q, safe, kp) {
    const [ddgVideos, youtubeVideos] = await Promise.all([
      fetchDdgVideoResults(q, kp).catch(() => []),
      fetchYoutubeVideoResults(q).catch(() => [])
    ]);

    const merged = [];
    const seen = new Set();
    for (const video of [...ddgVideos, ...youtubeVideos]) {
      const key = video.url || video.videoUrl;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(video);
      if (merged.length >= 16) break;
    }
    return merged;
  }

  async function fetchNewsResults(q) {
    try {
      const res = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      const xml = await res.text();
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
      return items.slice(0, 8).map((item) => {
        const block = item[1];
        const title = (block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || block.match(/<title>([\s\S]*?)<\/title>/))?.[1] || 'News story';
        const link = (block.match(/<link>([\s\S]*?)<\/link>/))?.[1] || '';
        const desc = (block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || block.match(/<description>([\s\S]*?)<\/description>/))?.[1] || 'Read the latest news story.';
        return {
          title: title.replace(/<[^>]+>/g, '').trim(),
          url: link,
          snippet: desc.replace(/<[^>]+>/g, '').trim()
        };
      });
    } catch (err) {
      console.error('News Search Error:', err);
      return [];
    }
  }

  expressApp.get('/api/proxy', async (req, res) => {
    let targetUrl = req.query.url;
    if (Array.isArray(targetUrl)) targetUrl = targetUrl[0];

    try {
      if (!targetUrl) return res.status(400).send('No URL provided');

      try {
        targetUrl = decodeURIComponent(String(targetUrl));
      } catch (err) {
        targetUrl = String(targetUrl);
      }

      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        return res.status(400).send(proxyErrorPage(targetUrl, 'Only http and https links can be opened in the room browser.'));
      }

      const blockedEmbedHosts = new Set([
        'accounts.google.com',
        'mail.google.com',
        'drive.google.com',
        'docs.google.com',
        'calendar.google.com',
        'maps.google.com',
        'play.google.com',
      ]);

      let parsedUrl;
      try {
        parsedUrl = new URL(targetUrl);
      } catch (err) {
        return res.status(400).send(proxyErrorPage(targetUrl, 'That address is not a valid URL.'));
      }

      const hostname = parsedUrl.hostname.toLowerCase();
      const normalizedHost = hostname.replace(/^www\./, '');
      const isGoogleSearch = normalizedHost.endsWith('google.com') && parsedUrl.pathname === '/search';
      const isGoogleHome = normalizedHost.endsWith('google.com') && (parsedUrl.pathname === '/' || parsedUrl.pathname === '');

      if (!isGoogleSearch && !isGoogleHome) {
        if (blockedEmbedHosts.has(hostname) || blockedEmbedHosts.has(normalizedHost) ||
            normalizedHost.endsWith('.google.com') || normalizedHost === 'google.com') {
          return res.status(200).send(proxyErrorPage(targetUrl, 'Google apps cannot be embedded here. Open this page in a new tab instead.'));
        }
      }

      // Use https module directly for proper TLS bypass with self-signed certs
      const https = require('https');
      const http = require('http');
      const UrlUtil = require('url');
      const MyURL = UrlUtil.URL;

      // Helper function to fetch with redirect support
      async function fetchWithRedirects(url, redirectCount = 0) {
        if (redirectCount > 10) throw new Error('Too many redirects');

        const u = new MyURL(url);
        const proxyProtocol = u.protocol === 'https:' ? https : http;
        const agent = new proxyProtocol.Agent({ rejectUnauthorized: false });

        return new Promise((resolve, reject) => {
          const req = proxyProtocol.request(url, {
            method: 'GET',
            headers: {
              'User-Agent': BROWSER_UA,
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9',
            },
            agent,
          }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 || res.statusCode === 307 || res.statusCode === 308) {
              const location = res.headers.location;
              if (location) {
                const newUrl = new URL(location, url).href;
                resolve(fetchWithRedirects(newUrl, redirectCount + 1));
                return;
              }
            }
            resolve({ res, url });
          });
          req.setTimeout(20000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
          });
          req.on('error', reject);
          req.end();
        });
      }

      let { res: response, url: finalUrl } = await fetchWithRedirects(targetUrl);
      const contentType = response.headers['content-type'] || '';

      if (contentType.includes('text/html')) {
        let html = await new Promise((resolve, reject) => {
          const chunks = [];
          response.on('data', chunk => chunks.push(chunk));
          response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          response.on('error', reject);
        });
        const origin = new URL(finalUrl).origin;

        html = html
          .replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '')
          .replace(/<meta[^>]+http-equiv=["']X-Frame-Options["'][^>]*>/gi, '');

        const baseTag = `<base href="${origin}/">`;
        const scriptTag = `
<script>
(function() {
  function proxify(url) {
    try {
      var parsed = new URL(url, document.baseURI);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return url;
      if (parsed.origin === window.location.origin) return url;
      return '/api/proxy?url=' + encodeURIComponent(parsed.href);
    } catch (err) {
      return url;
    }
  }

  window.open = function(url) {
    if (url) window.location.href = proxify(url);
    return window;
  };

  document.addEventListener('click', function(e) {
    var link = e.target.closest('a');
    if (!link || !link.href) return;
    try {
      var url = new URL(link.href, document.baseURI);
      if (url.hash && url.pathname === new URL(document.baseURI).pathname && url.search === new URL(document.baseURI).search) {
        return;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      e.preventDefault();
      window.location.href = proxify(link.href);
    } catch (err) {
      console.error('Proxy intercept error:', err);
    }
  }, true);

  document.addEventListener('submit', function(e) {
    var form = e.target;
    var action = form.getAttribute('action') || '';
    var method = (form.getAttribute('method') || 'get').toLowerCase();
    var targetUrl = action;
    try {
      targetUrl = new URL(action, document.baseURI).href;
    } catch (err) {}

    if (method === 'get') {
      e.preventDefault();
      var formData = new FormData(form);
      var params = new URLSearchParams();
      for (var pair of formData.entries()) params.append(pair[0], pair[1]);
      var separator = targetUrl.includes('?') ? '&' : '?';
      window.location.href = proxify(targetUrl + separator + params.toString());
    }
  }, true);

  setInterval(function() {
    document.querySelectorAll('a[target]').forEach(function(a) {
      if (a.getAttribute('target') !== '_self') a.setAttribute('target', '_self');
    });
    document.querySelectorAll('form[target]').forEach(function(form) {
      if (form.getAttribute('target') !== '_self') form.setAttribute('target', '_self');
    });
  }, 1000);
})();
</script>
        `;

        if (html.toLowerCase().includes('<head>')) {
          html = html.replace(/<head>/i, `<head>${baseTag}${scriptTag}`);
        } else {
          html = baseTag + scriptTag + html;
        }

        res.setHeader('content-type', 'text/html; charset=utf-8');
        return res.status(response.ok ? 200 : 200).send(html);
      }

      const buffer = await response.arrayBuffer();
      res.setHeader('content-type', contentType || 'application/octet-stream');
      return res.status(response.ok ? 200 : 200).send(Buffer.from(buffer));
    } catch (err) {
      console.error('Proxy error for', targetUrl, err);

      const msg = (err && err.cause && (err.cause.message || err.cause.name))
        ? String(err.cause.message || err.cause.name)
        : (err && err.message ? String(err.message) : 'Unknown error');

      // If TLS/certificate validation fails, embedded fetch will never work.
      if (msg.includes('SELF_SIGNED_CERT_IN_CHAIN') || msg.includes('self-signed') || msg.includes('CERT')) {
        return res.status(200).send(
          proxyErrorPage(
            targetUrl || '',
            'This site’s HTTPS certificate could not be verified in the room browser (TLS error). Open it in a new tab.'
          )
        );
      }

      return res.status(200).send(proxyErrorPage(targetUrl || '', 'The site could not be reached from the room browser. Try opening it in a new tab.'));
    }
  });

  // Handle API and Next.js page requests
  expressApp.use((req, res) => {
    return handle(req, res);
  });

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://localhost:${port}`);
  });
});
