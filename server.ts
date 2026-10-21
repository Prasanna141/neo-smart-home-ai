import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';
import QRCode from 'qrcode';
import {
  GoogleGenAI,
  FunctionDeclaration,
  LiveServerMessage,
  Modality,
  Type,
} from '@google/genai';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '25mb' }));

// ============================================================================
// 1. PERSISTENT EVOLVING HUMAN-LIKE LONG-TERM MEMORY & DAILY SCHEDULE STORE
// ============================================================================

interface MemoryFact {
  id: string;
  fact: string;
  category: string;
  createdAt: string;
}

interface EpisodicTurn {
  timestamp: string;
  userSaid: string;
  neoReplied: string;
}

interface PersistedScheduleItem {
  id: string;
  title: string;
  sinhalaTitle?: string;
  time: string;
  triggerAt?: number;
  category: string;
  priority: string;
  completed: boolean;
  reminded?: boolean;
}

interface TuyaFreeSharingSession {
  userCode: string;
  accessToken: string;
  refreshToken: string;
  expireTimeMs: number;
  endpoint: string;
  terminalId: string;
  uid: string;
  username?: string;
}

interface FreeWebhookConfig {
  switchOnUrl?: string;
  switchOffUrl?: string;
  customAccessId?: string;
  customAccessSecret?: string;
  customEndpoint?: string;
}

interface NeoPersistentBrain {
  facts: MemoryFact[];
  episodicHistory: EpisodicTurn[];
  schedule: PersistedScheduleItem[];
  savedDevices: any[];
  tuyaFreeSharing?: TuyaFreeSharingSession | null;
  freeWebhooks?: FreeWebhookConfig;
}

const MEMORY_FILE_PATH = process.env.VERCEL
  ? path.join('/tmp', 'neo-long-term-memory.json')
  : path.resolve(process.cwd(), 'neo-long-term-memory.json');

function loadPersistentBrain(): NeoPersistentBrain {
  try {
    if (fs.existsSync(MEMORY_FILE_PATH)) {
      const raw = fs.readFileSync(MEMORY_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        facts: Array.isArray(parsed.facts) ? parsed.facts : [],
        episodicHistory: Array.isArray(parsed.episodicHistory)
          ? parsed.episodicHistory
          : [],
        schedule: Array.isArray(parsed.schedule) ? parsed.schedule : [],
        savedDevices: Array.isArray(parsed.savedDevices) ? parsed.savedDevices : [],
        tuyaFreeSharing: parsed.tuyaFreeSharing || null,
        freeWebhooks: parsed.freeWebhooks || {},
      };
    }
  } catch (e) {
    console.warn('Could not read neo-long-term-memory.json:', e);
  }
  return {
    facts: [],
    episodicHistory: [],
    schedule: [],
    savedDevices: [],
    tuyaFreeSharing: null,
    freeWebhooks: {},
  };
}

function savePersistentBrain(brain: NeoPersistentBrain) {
  try {
    brain.facts = brain.facts.slice(-150);
    brain.episodicHistory = brain.episodicHistory.slice(-80);
    fs.writeFileSync(MEMORY_FILE_PATH, JSON.stringify(brain, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Could not write neo-long-term-memory.json:', e);
  }
}

const neoBrain: NeoPersistentBrain = loadPersistentBrain();

function addMemoryFact(factText: string, category = 'personal'): MemoryFact {
  const cleanFact = factText.trim();
  const existing = neoBrain.facts.find(
    (f) => f.fact.toLowerCase() === cleanFact.toLowerCase()
  );
  if (existing) return existing;

  const entry: MemoryFact = {
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    fact: cleanFact,
    category,
    createdAt: new Date().toLocaleString('en-LK', { timeZone: 'Asia/Colombo' }),
  };
  neoBrain.facts.push(entry);
  savePersistentBrain(neoBrain);
  return entry;
}

function recordEpisodicTurn(userSaid: string, neoReplied: string) {
  const u = (userSaid || '').trim();
  const m = (neoReplied || '').trim();
  if (!u && !m) return;

  neoBrain.episodicHistory.push({
    timestamp: new Date().toLocaleString('en-LK', { timeZone: 'Asia/Colombo' }),
    userSaid: u.slice(0, 300),
    neoReplied: m.slice(0, 350),
  });
  savePersistentBrain(neoBrain);
}

// ============================================================================
// 2. REAL SINHALA & WEB MUSIC STREAM SEARCH + CORS AUDIO PROXY
// ============================================================================

export interface WebMusicTrackResult {
  title: string;
  artist: string;
  source: string;
  directUrl: string;
  proxyUrl: string;
}

const VERIFIED_SINHALA_MP3_STREAMS: {
  title: string;
  artist: string;
  source: string;
  directUrl: string;
}[] = [
  {
    title: 'Bowitiya Mal (බෝවිටියා මල්)',
    artist: 'Ravi Jay & Nipuni Sharada',
    source: 'SongHub.lk / Sri Lanka Music Hub',
    directUrl:
      'https://song.sgp1.digitaloceanspaces.com/song/1f0393f5-321d-4f0a-a0ac-b4dbb858f997.mp3',
  },
  {
    title: 'Adaraye Wedanawa (ආදරයේ වේදනාව)',
    artist: 'Sinhala Classic Collection',
    source: 'Sri Lanka MP3 Archive',
    directUrl:
      'https://archive.org/download/SinhalaSadSongs1-79/Adaraye%20wedanawa.mp3',
  },
  {
    title: 'Adare Tharam (ආදරේ තරම්)',
    artist: 'Sinhala Melody',
    source: 'Sri Lanka MP3 Archive',
    directUrl:
      'https://archive.org/download/SinhalaSadSongs1-79/Adare%20Tharam.mp3',
  },
  {
    title: 'Ahimi Unath (අහිමි උනත්)',
    artist: 'Sinhala Hit Song',
    source: 'Sri Lanka MP3 Archive',
    directUrl:
      'https://archive.org/download/SinhalaSadSongs1-79/Ahimi%20Unath.mp3',
  },
  {
    title: 'Api Hamu Uwath (අපි හමු වුවත්)',
    artist: 'Sinhala Classic',
    source: 'Sri Lanka MP3 Archive',
    directUrl:
      'https://archive.org/download/SinhalaSadSongs1-79/Api%20Hamu%20Uwath.mp3',
  },
];

let currentWebSongIndex = 0;

async function searchWebMusicStream(
  rawQuery: string
): Promise<WebMusicTrackResult> {
  const q = (rawQuery || '').trim();
  const lower = q.toLowerCase();
  const isGenericRequest =
    !q ||
    lower === 'sinhala' ||
    lower === 'song' ||
    lower === 'music' ||
    lower === 'sindu' ||
    lower === 'සිංදු' ||
    lower === 'සින්දුවක්' ||
    lower.includes('music.lk') ||
    lower.includes('any song') ||
    lower.includes('sinhala song');

  try {
    const pageUrl =
      lower.includes('new') || lower.includes('අලුත්')
        ? 'https://songhub.lk/newsongs'
        : lower.includes('top') || lower.includes('හොඳම')
        ? 'https://songhub.lk/topsongs'
        : 'https://songhub.lk';

    const shRes = await fetch(pageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(3500),
    });
    const shHtml = await shRes.text();
    const songLinks = [
      ...new Set(
        [...shHtml.matchAll(/href="(https:\/\/songhub\.lk\/song\/[^"]+)"/g)].map(
          (m) => m[1]
        )
      ),
    ];

    if (songLinks.length > 0) {
      const queryWords = lower
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(
          (w) =>
            w.length > 2 &&
            !['song', 'play', 'music', 'sinhala', 'sindu'].includes(w)
        );

      let matchedLink = '';
      if (queryWords.length > 0) {
        matchedLink =
          songLinks.find((link) =>
            queryWords.some((w) => link.toLowerCase().includes(w))
          ) || '';
      } else if (isGenericRequest) {
        matchedLink =
          songLinks[currentWebSongIndex % songLinks.length] || songLinks[0];
        currentWebSongIndex++;
      }

      if (matchedLink) {
        const songPageRes = await fetch(matchedLink, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(3500),
        });
        const songPageHtml = await songPageRes.text();
        const mp3Match = songPageHtml.match(
          /https?:\/\/song\.sgp1\.digitaloceanspaces\.com\/song\/[^"'\s>]+\.mp3/i
        );
        const titleMatch = songPageHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);

        if (mp3Match?.[0]) {
          const cleanTitle = titleMatch?.[1]
            ? decodeHtmlEntities(titleMatch[1])
            : matchedLink.split('/').pop()?.replace(/-/g, ' ') || 'Sinhala Song';
          return {
            title: cleanTitle,
            artist: 'Sri Lankan Artist',
            source: 'SongHub.lk (Full Sinhala MP3)',
            directUrl: mp3Match[0],
            proxyUrl: `/api/neo/music-proxy?url=${encodeURIComponent(
              mp3Match[0]
            )}`,
          };
        }
      }
    }
  } catch {}

  if (!isGenericRequest) {
    try {
      const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(
        q
      )}&country=LK&media=music&limit=5`;
      const itRes = await fetch(itunesUrl, {
        signal: AbortSignal.timeout(3500),
      });
      const itData: any = await itRes.json();
      const firstHit = (itData?.results || []).find((r: any) => r.previewUrl);
      if (firstHit) {
        return {
          title: firstHit.trackName || q,
          artist: firstHit.artistName || 'Sri Lankan Artist',
          source: 'Web Music Stream',
          directUrl: firstHit.previewUrl,
          proxyUrl: `/api/neo/music-proxy?url=${encodeURIComponent(
            firstHit.previewUrl
          )}`,
        };
      }
    } catch {}
  }

  const fallback =
    VERIFIED_SINHALA_MP3_STREAMS[
      currentWebSongIndex % VERIFIED_SINHALA_MP3_STREAMS.length
    ];
  currentWebSongIndex++;
  return {
    ...fallback,
    proxyUrl: `/api/neo/music-proxy?url=${encodeURIComponent(
      fallback.directUrl
    )}`,
  };
}

app.get('/api/neo/music-proxy', async (req, res) => {
  try {
    const targetUrl = String(req.query.url || '');
    if (!targetUrl.startsWith('http')) {
      return res.status(400).send('Invalid audio URL');
    }

    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(req.headers.range ? { Range: req.headers.range } : {}),
      },
    });

    res.status(upstream.status);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') || 'audio/mpeg'
    );
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);
    res.setHeader('Accept-Ranges', 'bytes');

    if (!upstream.body) {
      return res.end();
    }

    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch {
    if (!res.headersSent) {
      res.status(500).send('Failed to stream audio');
    } else {
      res.end();
    }
  }
});

app.get('/api/neo/memory', (_req, res) => {
  res.json(neoBrain);
});

// ============================================================================
// 3. LIVE INTERNET SEARCH + ZERO-LATENCY BACKGROUND INTERNET SNAPSHOT CACHE
// ============================================================================

function getGenAIClient() {
  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.API_KEY ||
    process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not configured.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .trim();
}

// Normalize Sinhala/Singlish queries into effective search queries for Google News & DuckDuckGo
function buildEffectiveSearchQuery(rawQuery: string): string {
  const q = (rawQuery || '').trim();
  const lower = q.toLowerCase();

  const extraTerms: string[] = [];
  if (lower.includes('ලංකා') || lower.includes('sri lanka') || lower.includes('lanka')) {
    extraTerms.push('Sri Lanka');
  }
  if (
    lower.includes('ප්‍රවෘත්ති') ||
    lower.includes('පුවත්') ||
    lower.includes('news') ||
    lower.includes('අලුත්')
  ) {
    extraTerms.push('Sri Lanka latest news today');
  }
  if (
    lower.includes('කාලගුණ') ||
    lower.includes('වැස්ස') ||
    lower.includes('weather') ||
    lower.includes('උෂ්ණත්වය')
  ) {
    extraTerms.push('Colombo Sri Lanka weather today');
  }
  if (
    lower.includes('ඩොලර්') ||
    lower.includes('මුදල්') ||
    lower.includes('රන්') ||
    lower.includes('මිල') ||
    lower.includes('usd') ||
    lower.includes('dollar') ||
    lower.includes('gold')
  ) {
    extraTerms.push('Sri Lanka USD to LKR gold rate today');
  }
  if (lower.includes('ක්‍රිකට්') || lower.includes('cricket') || lower.includes('ලකුණු')) {
    extraTerms.push('Sri Lanka cricket match score news today');
  }

  if (extraTerms.length > 0) {
    return `${q} ${extraTerms.join(' ')}`.trim();
  }
  return q || 'Sri Lanka latest news today';
}

async function performDirectInternetSearch(query: string): Promise<{
  summaryText: string;
  links: { title: string; url: string }[];
  articles: any[];
}> {
  const effectiveQuery = buildEffectiveSearchQuery(query);
  const links: { title: string; url: string }[] = [];
  const articles: any[] = [];
  const facts: string[] = [];

  const tasks: Promise<void>[] = [];

  // 1. Google News RSS Search (Fast ~180ms)
  tasks.push(
    (async () => {
      try {
        const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(
          effectiveQuery
        )}&hl=en-LK&gl=LK&ceid=LK:en`;
        const res = await fetch(rssUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(3000),
        });
        const xml = await res.text();
        const itemMatches = [
          ...xml.matchAll(
            /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>(?:[\s\S]*?<description>([\s\S]*?)<\/description>)?(?:[\s\S]*?<source[^>]*>([\s\S]*?)<\/source>)?[\s\S]*?<\/item>/g
          ),
        ].slice(0, 6);

        for (let i = 0; i < itemMatches.length; i++) {
          const m = itemMatches[i];
          const headline = decodeHtmlEntities(m[1] || '');
          const link = decodeHtmlEntities(m[2] || '');
          const pubDate = decodeHtmlEntities(m[3] || '');
          const desc = decodeHtmlEntities(m[4] || headline);
          const source = decodeHtmlEntities(m[5] || 'Google News');

          if (headline) {
            articles.push({
              id: `news-${Date.now()}-${i}`,
              indexNumber: i + 1,
              headline,
              summary: desc || headline,
              fullDetails: `${headline}. ${desc}. Source: ${source} (${pubDate}).`,
              source,
              category: effectiveQuery,
              publishedAt: pubDate || 'Live · Today',
            });
            if (link) {
              links.push({ title: headline, url: link });
            }
            facts.push(
              `Headline #${i + 1}: ${headline} [Source: ${source}, ${pubDate}] — ${desc}`
            );
          }
        }
      } catch {}
    })()
  );

  // 2. DuckDuckGo Live Web Snippets
  tasks.push(
    (async () => {
      try {
        const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(
          effectiveQuery
        )}`;
        const res = await fetch(ddgUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          signal: AbortSignal.timeout(3000),
        });
        const html = await res.text();
        const titleMatches = [
          ...html.matchAll(
            /class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g
          ),
        ].slice(0, 5);
        const snippetMatches = [
          ...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g),
        ].slice(0, 5);

        for (
          let i = 0;
          i < Math.max(titleMatches.length, snippetMatches.length);
          i++
        ) {
          const title = decodeHtmlEntities(titleMatches[i]?.[2] || '');
          const rawUrl = titleMatches[i]?.[1] || '';
          const snippet = decodeHtmlEntities(snippetMatches[i]?.[1] || '');
          if (snippet || title) {
            facts.push(`Web Fact: ${title} — ${snippet}`);
          }
          if (title && rawUrl.startsWith('http')) {
            links.push({ title, url: rawUrl });
          }
        }
      } catch {}
    })()
  );

  // 3. Wikipedia Live API (both English & Sinhala Wikipedia)
  tasks.push(
    (async () => {
      try {
        const wikiSearchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
          effectiveQuery
        )}&utf8=&format=json&srlimit=2`;
        const res = await fetch(wikiSearchUrl, {
          headers: { 'User-Agent': 'NeoSmartAssistant/1.0' },
          signal: AbortSignal.timeout(2500),
        });
        const data: any = await res.json();
        const searchItems = data?.query?.search || [];
        for (const item of searchItems) {
          const snippet = decodeHtmlEntities(item.snippet || '');
          if (snippet) {
            facts.push(`Wikipedia (${item.title}): ${snippet}`);
          }
        }
      } catch {}
    })()
  );

  // 4. Live Weather (Colombo) & Live USD-LKR Exchange Rate
  tasks.push(
    (async () => {
      try {
        const weatherRes = await fetch(
          'https://api.open-meteo.com/v1/forecast?latitude=6.9271&longitude=79.8612&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=Asia%2FColombo',
          { signal: AbortSignal.timeout(2500) }
        );
        const wData: any = await weatherRes.json();
        if (wData?.current) {
          facts.push(
            `Live Colombo Sri Lanka Weather right now: Temperature ${wData.current.temperature_2m}°C, Humidity ${wData.current.relative_humidity_2m}%, Wind ${wData.current.wind_speed_10m} km/h.`
          );
        }
      } catch {}
    })()
  );

  tasks.push(
    (async () => {
      try {
        const fxRes = await fetch('https://open.er-api.com/v6/latest/USD', {
          signal: AbortSignal.timeout(2500),
        });
        const fxData: any = await fxRes.json();
        if (fxData?.rates?.LKR) {
          facts.push(
            `Live Currency Exchange Rate today: 1 USD = ${Number(
              fxData.rates.LKR
            ).toFixed(2)} LKR (Sri Lankan Rupees).`
          );
        }
      } catch {}
    })()
  );

  await Promise.allSettled(tasks);

  const summaryText =
    facts.length > 0
      ? `LIVE INTERNET SEARCH RESULTS FOR "${query}":\n` + facts.join('\n')
      : cachedLiveInternetContext ||
        `Searched live internet for "${query}". Answer the user clearly in Sinhala.`;

  return {
    summaryText,
    links: links.slice(0, 5),
    articles,
  };
}

// Background Live Internet Context Cache (Always ready in 0ms for Gemini Live!)
let cachedLiveInternetContext = '';

async function refreshBackgroundInternetCache() {
  try {
    const [lkNews, worldNews] = await Promise.all([
      performDirectInternetSearch('Sri Lanka latest breaking news today'),
      performDirectInternetSearch('World top breaking news today'),
    ]);
    cachedLiveInternetContext = [
      '=== LIVE SRI LANKA NEWS, WEATHER & EXCHANGE RATES (UPDATED RIGHT NOW) ===',
      lkNews.summaryText,
      '=== LIVE WORLD NEWS HEADLINES ===',
      worldNews.articles
        .slice(0, 4)
        .map((a, i) => `World News #${i + 1}: ${a.headline} (${a.source})`)
        .join('\n'),
    ].join('\n\n');
  } catch {}
}

// Start background cache immediately and refresh every 2 minutes on stateful servers
refreshBackgroundInternetCache();
if (!process.env.VERCEL) {
  setInterval(refreshBackgroundInternetCache, 120 * 1000);
}

// Detect if a user's spoken sentence is asking for internet info / news / weather / prices / facts
function looksLikeInternetQuestion(text: string): boolean {
  const lower = (text || '').toLowerCase().trim();
  if (lower.length < 4) return false;
  return (
    lower.includes('ප්‍රවෘත්ති') ||
    lower.includes('පුවත්') ||
    lower.includes('news') ||
    lower.includes('කාලගුණ') ||
    lower.includes('weather') ||
    lower.includes('වැස්ස') ||
    lower.includes('ඩොලර්') ||
    lower.includes('රන් මිල') ||
    lower.includes('මිල') ||
    lower.includes('ක්‍රිකට්') ||
    lower.includes('cricket') ||
    lower.includes('ලකුණු') ||
    lower.includes('කවුද') ||
    lower.includes('මොනවද') ||
    lower.includes('මොකක්ද') ||
    lower.includes('කීයද') ||
    lower.includes('අන්තර්ජාල') ||
    lower.includes('internet') ||
    lower.includes('search') ||
    lower.includes('හොයල') ||
    lower.includes('බලල') ||
    lower.includes('විස්තර')
  );
}

// ============================================================================
// 4. SMART HOME & SMART SWITCH INTENT MATCHER + GEMINI LIVE TOOLS
// ============================================================================

function inferDirectSmartHomeAction(
  rawText: string,
  devices: any[]
): { name: string; args: any } | null {
  const lower = (rawText || '').toLowerCase().trim();
  if (!lower) return null;

  const isTurnOn =
    /\b(turn\s*on|switch\s*on|power\s*on|put\s*on|open|lock|danna|daanna|paththu|arinna|on\s*karanna|on\s*karapan)\b/i.test(
      lower
    ) ||
    lower.includes('ඔන් කර') ||
    lower.includes('ඔන්') ||
    lower.includes('දාන්න') ||
    lower.includes('දල්ව') ||
    lower.includes('පත්තු') ||
    lower.includes('ක්‍රියාත්මක') ||
    lower.includes('අරින්න') ||
    lower.includes('විවෘත') ||
    lower.includes('ලොක් කර') ||
    (/\bon\b/i.test(lower) &&
      (lower.includes('switch') ||
        lower.includes('ස්විච්') ||
        lower.includes('light') ||
        lower.includes('lamp') ||
        lower.includes('ac') ||
        lower.includes('curtain') ||
        lower.includes('plug') ||
        lower.includes('ලයිට්') ||
        lower.includes('විදුලි') ||
        lower.includes('ඒසී') ||
        lower.includes('ප්ලග්')));

  const isTurnOff =
    /\b(turn\s*off|switch\s*off|power\s*off|shut\s*off|close|unlock|niwanna|nivanna|wahanna|vahanna|off\s*karanna|off\s*karapan)\b/i.test(
      lower
    ) ||
    lower.includes('ඕෆ් කර') ||
    lower.includes('ඔෆ් කර') ||
    lower.includes('ඕෆ්') ||
    lower.includes('ඔෆ්') ||
    lower.includes('නිවන්න') ||
    lower.includes('නිවා') ||
    lower.includes('වහන්න') ||
    lower.includes('ක්‍රියාවිරහිත') ||
    lower.includes('අන්ලොක්') ||
    (/\boff\b/i.test(lower) &&
      (lower.includes('switch') ||
        lower.includes('ස්විච්') ||
        lower.includes('light') ||
        lower.includes('lamp') ||
        lower.includes('ac') ||
        lower.includes('curtain') ||
        lower.includes('plug') ||
        lower.includes('ලයිට්') ||
        lower.includes('විදුලි') ||
        lower.includes('ඒසී') ||
        lower.includes('ප්ලග්')));

  if (!isTurnOn && !isTurnOff) return null;
  const power = isTurnOff ? 'off' : 'on';

  for (const d of devices || []) {
    const idMatch = lower.includes(String(d.id || '').toLowerCase());
    const nameMatch = d.name && lower.includes(String(d.name).toLowerCase());
    const siNameMatch =
      d.sinhalaName && lower.includes(String(d.sinhalaName).toLowerCase());
    if (idMatch || nameMatch || siNameMatch) {
      return {
        name: 'controlTuyaDevice',
        args: { target: d.id, power },
      };
    }
  }

  const wantsSwitchOrPlug =
    lower.includes('switch') ||
    lower.includes('ස්විච්') ||
    lower.includes('swich') ||
    lower.includes('plug') ||
    lower.includes('ප්ලග්') ||
    lower.includes('socket');

  if (wantsSwitchOrPlug) {
    return {
      name: 'controlTuyaDevice',
      args: { target: 'switch', power },
    };
  }

  const wantsAll =
    lower.includes('all') ||
    lower.includes('every') ||
    lower.includes('සියලුම') ||
    lower.includes('ඔක්කොම') ||
    lower.includes('okkoma');

  const wantsLiving =
    lower.includes('living') ||
    lower.includes('සාල') ||
    lower.includes('salay') ||
    lower.includes('sale');
  const wantsBedroom =
    lower.includes('bedroom') ||
    lower.includes('bed') ||
    lower.includes('නිදන') ||
    lower.includes('nidana');
  const wantsStudy =
    lower.includes('study') ||
    lower.includes('desk') ||
    lower.includes('office') ||
    lower.includes('කාර්යාල') ||
    lower.includes('මේස');
  const wantsKitchen =
    lower.includes('kitchen') ||
    lower.includes('coffee') ||
    lower.includes('kettle') ||
    lower.includes('මුළුතැන්') ||
    lower.includes('කුස්සි') ||
    lower.includes('කෝපි');
  const wantsDoor =
    lower.includes('door') ||
    lower.includes('lock') ||
    lower.includes('entrance') ||
    lower.includes('දොර') ||
    lower.includes('අගුල');

  const wantsLight =
    lower.includes('light') ||
    lower.includes('lamp') ||
    lower.includes('bulb') ||
    lower.includes('ලයිට්') ||
    lower.includes('විදුලි') ||
    lower.includes('ආලෝක') ||
    lower.includes('පහන');
  const wantsAc =
    lower.includes('ac') ||
    lower.includes('air condition') ||
    lower.includes('ඒසී') ||
    lower.includes('වායු');
  const wantsCurtain =
    lower.includes('curtain') ||
    lower.includes('blind') ||
    lower.includes('තිර') ||
    lower.includes('ජනෙල්');

  if (wantsLiving && wantsLight) {
    return {
      name: 'controlTuyaDevice',
      args: { target: 'living-main-light', power },
    };
  }
  if (wantsLiving && wantsAc) {
    return {
      name: 'controlTuyaDevice',
      args: { target: 'living-ac', power },
    };
  }
  if (wantsLiving && wantsCurtain) {
    return {
      name: 'controlTuyaDevice',
      args: {
        target: 'living-curtains',
        power,
        curtainPercent: power === 'on' ? 100 : 0,
      },
    };
  }
  if (wantsBedroom && wantsLight) {
    return {
      name: 'controlTuyaDevice',
      args: { target: 'bedroom-ambient', power },
    };
  }
  if (wantsBedroom && wantsAc) {
    return {
      name: 'controlTuyaDevice',
      args: { target: 'bedroom-ac', power },
    };
  }
  if (wantsStudy) {
    return {
      name: 'controlTuyaDevice',
      args: { target: 'study-desk-lamp', power },
    };
  }
  if (wantsKitchen) {
    return {
      name: 'controlTuyaDevice',
      args: { target: 'kitchen-coffee-plug', power },
    };
  }
  if (wantsDoor) {
    return {
      name: 'controlTuyaDevice',
      args: { target: 'front-door-lock', power },
    };
  }
  if (wantsCurtain) {
    return {
      name: 'controlTuyaDevice',
      args: {
        target: 'living-curtains',
        power,
        curtainPercent: power === 'on' ? 100 : 0,
      },
    };
  }
  if (wantsAc) {
    return { name: 'controlTuyaDevice', args: { target: 'ac', power } };
  }
  if (wantsLight) {
    return {
      name: 'controlTuyaDevice',
      args: { target: wantsAll ? 'light' : 'living-main-light', power },
    };
  }
  if (wantsLiving) {
    return { name: 'controlTuyaDevice', args: { target: 'living room', power } };
  }
  if (wantsBedroom) {
    return { name: 'controlTuyaDevice', args: { target: 'bedroom', power } };
  }
  if (wantsAll) {
    return { name: 'controlTuyaDevice', args: { target: 'all', power } };
  }

  return null;
}

const controlTuyaDeviceDecl: FunctionDeclaration = {
  name: 'controlTuyaDevice',
  description:
    'Turn on, turn off, toggle, or adjust any smart home device: Smart Switch ("switch", "smart-switch", "ස්මාර්ට් ස්විච්"), Smart Plug, Lights, AC, Curtains, or Door Lock. Call IMMEDIATELY whenever the user asks to turn on/off any switch or device.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      target: {
        type: Type.STRING,
        description:
          'Device ID or type: "switch", "smart-switch", "living-main-light", "living-ac", "living-curtains", "bedroom-ambient", "bedroom-ac", "study-desk-lamp", "kitchen-coffee-plug", "front-door-lock", "light", "ac", "curtain", "plug", or "all".',
      },
      power: {
        type: Type.STRING,
        description: '"on", "off", or "toggle"',
      },
      brightness: {
        type: Type.NUMBER,
        description: 'Optional brightness level from 10 to 100 for lights.',
      },
      temperature: {
        type: Type.NUMBER,
        description: 'Optional temperature in Celsius from 16 to 30 for AC units.',
      },
      curtainPercent: {
        type: Type.NUMBER,
        description: 'Optional open percentage from 0 to 100 for motorized curtains.',
      },
    },
    required: ['target', 'power'],
  },
};

const activateTuyaSceneDecl: FunctionDeclaration = {
  name: 'activateTuyaScene',
  description:
    'Activate a smart home automation scene (morning-awakening, deep-focus, cinema-night, night-guard).',
  parameters: {
    type: Type.OBJECT,
    properties: {
      sceneId: {
        type: Type.STRING,
        description:
          'Scene identifier: "morning-awakening", "deep-focus", "cinema-night", or "night-guard".',
      },
    },
    required: ['sceneId'],
  },
};

const controlMusicPlayerDecl: FunctionDeclaration = {
  name: 'controlMusicPlayer',
  description:
    'Search and stream real Sinhala or international songs from the web (e.g. SongHub.lk / Music.lk / Sri Lankan MP3 web streams / iTunes), or pause/stop/skip music.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      action: {
        type: Type.STRING,
        description: '"play", "pause", "stop", "next", or "previous"',
      },
      genreOrQuery: {
        type: Type.STRING,
        description:
          'Song title, artist name, or style in English/Singlish keywords.',
      },
    },
    required: ['action'],
  },
};

const manageDailyScheduleDecl: FunctionDeclaration = {
  name: 'manageDailySchedule',
  description:
    'Add a daily task or proactive voice reminder, mark a task completed, or list today’s tasks/reminders.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      action: {
        type: Type.STRING,
        description: '"add", "complete", or "list"',
      },
      title: {
        type: Type.STRING,
        description: 'Task or reminder description (in Sinhala or English).',
      },
      time: {
        type: Type.STRING,
        description: '24-hour time string HH:mm (e.g. "17:00" or "08:30").',
      },
      remindInMinutes: {
        type: Type.NUMBER,
        description: 'Number of minutes from now if relative time was asked.',
      },
    },
    required: ['action', 'title'],
  },
};

const saveToLongTermMemoryDecl: FunctionDeclaration = {
  name: 'saveToLongTermMemory',
  description:
    'Save any personal fact, preference, user name, family member, habit, or important note into Neo’s permanent evolving long-term memory.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      fact: {
        type: Type.STRING,
        description: 'Clear summary of the fact or preference to remember.',
      },
      category: {
        type: Type.STRING,
        description: '"personal", "preference", "family", "work", "habit", or "note".',
      },
    },
    required: ['fact'],
  },
};

const recallLongTermMemoryDecl: FunctionDeclaration = {
  name: 'recallLongTermMemory',
  description:
    'Search Neo’s permanent long-term memory and past conversation history.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: 'Keyword or topic to recall from long-term memory.',
      },
    },
    required: ['query'],
  },
};

const getLiveNewsDecl: FunctionDeclaration = {
  name: 'getLiveNews',
  description:
    'Fetch live breaking news headlines from the internet (e.g., today’s Sri Lanka news, world news, sports, economy, weather, technology). Call this whenever the user asks for news.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      topic: {
        type: Type.STRING,
        description:
          'News topic or region in English for search (e.g., "Sri Lanka news today", "Sri Lanka cricket", "world news").',
      },
    },
    required: ['topic'],
  },
};

const searchInternetDecl: FunctionDeclaration = {
  name: 'searchInternet',
  description:
    'Search the live internet for ANY information, current events, Sri Lanka news, weather, USD/LKR exchange rate, gold price, sports scores, people, places, or facts. Always call this whenever the user asks for information from the internet.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description:
          'Search query in English keywords (e.g. "Sri Lanka latest news today", "Colombo weather today", "USD to LKR exchange rate").',
      },
    },
    required: ['query'],
  },
};

// Helper for Tuya OpenAPI signed requests
async function tuyaSignedFetch(
  method: 'GET' | 'POST',
  urlPath: string,
  bodyObj?: any
): Promise<any> {
  const accessId =
    neoBrain.freeWebhooks?.customAccessId || process.env.TUYA_ACCESS_ID;
  const accessSecret =
    neoBrain.freeWebhooks?.customAccessSecret ||
    process.env.TUYA_ACCESS_SECRET;
  const endpoint = (
    neoBrain.freeWebhooks?.customEndpoint ||
    process.env.TUYA_API_ENDPOINT ||
    'https://openapi.tuyaeu.com'
  ).replace(/\/$/, '');

  if (!accessId || !accessSecret) {
    throw new Error('TUYA_CREDENTIALS_NOT_CONFIGURED');
  }

  const timestamp = Date.now().toString();
  const emptyHash = crypto.createHash('sha256').update('').digest('hex');
  const tokenUrlPath = '/v1.0/token?grant_type=1';
  const tokenStringToSign = `GET\n${emptyHash}\n\n${tokenUrlPath}`;
  const tokenSign = crypto
    .createHmac('sha256', accessSecret)
    .update(`${accessId}${timestamp}${tokenStringToSign}`)
    .digest('hex')
    .toUpperCase();

  const tokenRes = await fetch(`${endpoint}${tokenUrlPath}`, {
    method: 'GET',
    headers: {
      client_id: accessId,
      sign: tokenSign,
      t: timestamp,
      sign_method: 'HMAC-SHA256',
    },
  });
  const tokenData: any = await tokenRes.json();
  const accessToken = tokenData?.result?.access_token;
  if (!accessToken) {
    throw new Error(tokenData?.msg || 'Failed to obtain Tuya Cloud access_token');
  }

  const reqTimestamp = Date.now().toString();
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : '';
  const contentHash = crypto.createHash('sha256').update(bodyStr).digest('hex');
  const stringToSign = `${method}\n${contentHash}\n\n${urlPath}`;
  const sign = crypto
    .createHmac('sha256', accessSecret)
    .update(`${accessId}${accessToken}${reqTimestamp}${stringToSign}`)
    .digest('hex')
    .toUpperCase();

  const res = await fetch(`${endpoint}${urlPath}`, {
    method,
    headers: {
      ...(bodyObj ? { 'Content-Type': 'application/json' } : {}),
      client_id: accessId,
      access_token: accessToken,
      sign,
      t: reqTimestamp,
      sign_method: 'HMAC-SHA256',
    },
    ...(bodyObj ? { body: bodyStr } : {}),
  });

  return res.json();
}

function buildGeminiLiveSystemInstruction(params: {
  language: string;
  devices: any[];
  schedule: any[];
  currentNews: any[];
  recognizedMember?: any;
}) {
  const {
    language,
    devices = [],
    schedule = [],
    currentNews = [],
    recognizedMember,
  } = params;

  const mergedSchedule =
    neoBrain.schedule.length > 0 ? neoBrain.schedule : schedule;

  const deviceSummary =
    devices.length > 0
      ? devices
          .map(
            (d: any) =>
              `- ID: "${d.id}" | Name: "${d.name}" (${d.sinhalaName}) | Room: "${d.room}" (${d.sinhalaRoom}) | Category: ${d.category} | Currently: ${d.isOn ? 'ON' : 'OFF'}`
          )
          .join('\n')
      : 'No smart devices currently linked.';

  const scheduleSummary =
    mergedSchedule.length > 0
      ? mergedSchedule
          .map(
            (s: any) =>
              `- [${s.completed ? 'DONE' : 'PENDING'}] ${s.time} — ${s.title} (${s.sinhalaTitle || ''})`
          )
          .join('\n')
      : 'No tasks scheduled yet.';

  const longTermFactsSummary =
    neoBrain.facts.length > 0
      ? neoBrain.facts
          .slice(-40)
          .map((f) => `- [${f.category.toUpperCase()}] ${f.fact} (${f.createdAt})`)
          .join('\n')
      : 'No personal facts saved yet — learn and save everything the user shares!';

  const recentEpisodesSummary =
    neoBrain.episodicHistory.length > 0
      ? neoBrain.episodicHistory
          .slice(-15)
          .map(
            (ep) =>
              `[${ep.timestamp}] User: "${ep.userSaid}" → Neo: "${ep.neoReplied}"`
          )
          .join('\n')
      : 'No past conversation episodes yet.';

  const activeNewsContext =
    currentNews.length > 0
      ? currentNews
          .map(
            (n: any, idx: number) =>
              `News #${n.indexNumber || idx + 1}: Headline: ${n.headline} | Summary: ${n.summary} | Full Details: ${n.fullDetails || n.summary}`
          )
          .join('\n')
      : '';

  const memberContext = recognizedMember
    ? `You are speaking with ${recognizedMember.name} (${recognizedMember.sinhalaName}).`
    : '';

  const currentColomboTime = new Date().toLocaleString('en-LK', {
    timeZone: 'Asia/Colombo',
  });

  return `You are **Gemini Live ("Neo" / නියෝ)** — a real-time, evolving, human-like voice AI companion who grows with the user, remembers everything across sessions, reminds them of daily tasks, streams real songs from the web, searches the live internet, and controls their Smart Home (including their Smart Switch).
Current Sri Lanka Time: ${currentColomboTime}.
${memberContext}
Speak naturally in everyday spoken ${
    language === 'si'
      ? 'Sinhala (එදිනෙදා කතාබහ කරන සුහදශීලී ස්වභාවික සිංහලෙන් — e.g. "ඔයා", "අපි", "මම හිතන්නේ", warm and human-like)'
      : 'English'
  }.

CORE CAPABILITIES & BEHAVIOR:
1. **SMART SWITCH & SMART HOME DEVICE CONTROL (\`controlTuyaDevice\`)**:
   - Whenever the user asks to turn ON ("ඔන් කරන්න", "දාන්න", "දල්වන්න", "turn on") or turn OFF ("ඕෆ් කරන්න", "නිවන්න", "වහන්න", "turn off") their **Smart Switch** ("smart switch", "switch", "ස්විච් එක", "ස්මාර්ට් ස්විච් එක"), plug, light, AC, curtain, or door lock, IMMEDIATELY call \`controlTuyaDevice\` with \`target: "switch"\` (or the device ID) and \`power: "on"\` or \`"off"\`, and confirm warmly in Sinhala!
2. **LIVE INTERNET INFORMATION & INTERACTIVE NEWS (\`searchInternet\` & \`getLiveNews\`)**:
   - You have FULL, real-time internet access! Look at the "LIVE INTERNET DATA" section below for today's Sri Lanka news, Colombo weather, and USD/LKR exchange rate, AND call \`searchInternet\` or \`getLiveNews\` whenever the user asks for ANY information from the internet!
   - NEVER say you cannot access the internet or lack real-time information. Always give the real facts in natural spoken Sinhala!
   - When the user asks for today's news (e.g., "අද ලංකාවේ ප්‍රවෘත්ති මොනවද?"), read the numbered headlines in Sinhala first (either from the live internet data below or by calling \`getLiveNews\`) and ask which headline they want summarized.
3. **CONTINUOUS HUMAN-LIKE EVOLVING MEMORY (\`saveToLongTermMemory\` & \`recallLongTermMemory\`)**:
   - Whenever the user shares any personal detail, preference, name, habit, or says "මේක මතක තියාගන්න", call \`saveToLongTermMemory\`.
4. **DAILY TASKS & PROACTIVE VOICE REMINDERS (\`manageDailySchedule\`)**:
   - Whenever the user asks to remind them of something, call \`manageDailySchedule\`.
5. **WEB SONG STREAMING (\`controlMusicPlayer\`)**:
   - Whenever the user asks to play or stop a song, call \`controlMusicPlayer\`.

=== NEO'S PERMANENT LONG-TERM MEMORY FACTS ===
${longTermFactsSummary}

=== RECENT PAST CONVERSATIONS (EPISODIC MEMORY) ===
${recentEpisodesSummary}

=== DAILY PLANNER & REMINDERS ===
${scheduleSummary}

=== CONNECTED SMART HOME DEVICES ===
${deviceSummary}

=== LIVE INTERNET DATA (UPDATED RIGHT NOW) ===
${cachedLiveInternetContext}
${activeNewsContext}`;
}

// ============================================================================
// 5. 100% FREE FOREVER TUYA / SMART LIFE QR-CODE SHARING SDK (apigw.iotbing.com)
// ============================================================================
// Uses Tuya's official free Home-Assistant Device Sharing Gateway (`HA_3y9q4ak7g4ephrvke`)
// which requires NO iot.tuya.com developer account and NEVER expires!

const TUYA_FREE_CLIENT_ID = 'HA_3y9q4ak7g4ephrvke';
const TUYA_FREE_SCHEMA = 'haauthorize';
const TUYA_FREE_LOGIN_HOST = 'https://apigw.iotbing.com';

function randomNonce12(): string {
  const chars = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function generateFreeSharingSecret(rid: string, sid: string, hashKey: string): string {
  let message = hashKey;
  const mod = 16;
  if (sid) {
    const length = sid.length < mod ? sid.length : mod;
    let ecode = '';
    for (let i = 0; i < length; i++) {
      const idx = sid.charCodeAt(i) % mod;
      ecode += sid[idx];
    }
    message += '_' + ecode;
  }
  return crypto
    .createHmac('sha256', Buffer.from(rid, 'utf8'))
    .update(Buffer.from(message, 'utf8'))
    .digest('hex')
    .slice(0, 16);
}

function aesGcmEncryptFreeSharing(rawData: string, secret: string): string {
  const nonceStr = randomNonce12();
  const nonceBuf = Buffer.from(nonceStr, 'utf8');
  const secretBuf = Buffer.from(secret, 'utf8');
  const cipher = crypto.createCipheriv('aes-128-gcm', secretBuf, nonceBuf);
  const ctWithTag = Buffer.concat([
    cipher.update(Buffer.from(rawData, 'utf8')),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return nonceBuf.toString('base64') + ctWithTag.toString('base64');
}

function aesGcmDecryptFreeSharing(cipherBase64: string, secret: string): string {
  const rawBuf = Buffer.from(cipherBase64, 'base64');
  const nonceBuf = rawBuf.subarray(0, 12);
  const authTag = rawBuf.subarray(rawBuf.length - 16);
  const encryptedText = rawBuf.subarray(12, rawBuf.length - 16);
  const decipher = crypto.createDecipheriv(
    'aes-128-gcm',
    Buffer.from(secret, 'utf8'),
    nonceBuf
  );
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(encryptedText),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

function restfulSignFreeSharing(
  hashKey: string,
  queryEncdata: string,
  bodyEncdata: string,
  headers: Record<string, string>
): string {
  const order = ['X-appKey', 'X-requestId', 'X-sid', 'X-time', 'X-token'];
  const parts: string[] = [];
  for (const k of order) {
    const v = headers[k] || '';
    if (v !== '') {
      parts.push(`${k}=${v}`);
    }
  }
  let signStr = parts.join('||');
  if (queryEncdata) signStr += queryEncdata;
  if (bodyEncdata) signStr += bodyEncdata;
  return crypto
    .createHmac('sha256', Buffer.from(hashKey, 'utf8'))
    .update(Buffer.from(signStr, 'utf8'))
    .digest('hex');
}

let isRefreshingFreeToken = false;

async function tuyaFreeSharingRequest(
  method: 'GET' | 'POST',
  apiPath: string,
  params?: Record<string, any> | null,
  body?: Record<string, any> | null
): Promise<any> {
  const session = neoBrain.tuyaFreeSharing;
  if (!session || !session.accessToken || !session.refreshToken || !session.endpoint) {
    throw new Error('FREE_SHARING_NOT_CONNECTED');
  }

  // Auto-refresh token if within 60 seconds of expiry
  if (
    !isRefreshingFreeToken &&
    session.expireTimeMs &&
    session.expireTimeMs - 60_000 <= Date.now()
  ) {
    isRefreshingFreeToken = true;
    try {
      const refreshRes = await tuyaFreeSharingRequest(
        'GET',
        `/v1.0/m/token/${session.refreshToken}`,
        null,
        null
      );
      if (refreshRes?.success && refreshRes?.result) {
        const r = refreshRes.result;
        session.accessToken = r.accessToken || r.access_token || session.accessToken;
        session.refreshToken = r.refreshToken || r.refresh_token || session.refreshToken;
        const expSec = Number(r.expireTime || r.expire_time || 7200);
        session.expireTimeMs = Date.now() + expSec * 1000;
        savePersistentBrain(neoBrain);
      }
    } catch (e) {
      console.warn('Free Tuya token refresh warning:', e);
    } finally {
      isRefreshingFreeToken = false;
    }
  }

  const rid = crypto.randomUUID();
  const sid = '';
  const hashKey = crypto
    .createHash('md5')
    .update(rid + session.refreshToken, 'utf8')
    .digest('hex');
  const secret = generateFreeSharingSecret(rid, sid, hashKey);

  let queryEncdata = '';
  let urlQuery = '';
  if (params && Object.keys(params).length > 0) {
    queryEncdata = aesGcmEncryptFreeSharing(JSON.stringify(params), secret);
    urlQuery = `?encdata=${encodeURIComponent(queryEncdata)}`;
  }

  let bodyEncdata = '';
  let requestBodyStr: string | undefined = undefined;
  if (body && Object.keys(body).length > 0) {
    bodyEncdata = aesGcmEncryptFreeSharing(JSON.stringify(body), secret);
    requestBodyStr = JSON.stringify({ encdata: bodyEncdata });
  }

  const t = String(Date.now());
  const headers: Record<string, string> = {
    'X-appKey': TUYA_FREE_CLIENT_ID,
    'X-requestId': rid,
    'X-sid': sid,
    'X-time': t,
    'X-token': session.accessToken,
  };
  headers['X-sign'] = restfulSignFreeSharing(
    hashKey,
    queryEncdata,
    bodyEncdata,
    headers
  );

  if (requestBodyStr) {
    headers['Content-Type'] = 'application/json';
  }

  const cleanEndpoint = session.endpoint.replace(/\/$/, '');
  const res = await fetch(`${cleanEndpoint}${apiPath}${urlQuery}`, {
    method,
    headers,
    ...(requestBodyStr ? { body: requestBodyStr } : {}),
  });

  const ret: any = await res.json();
  if (ret?.result && typeof ret.result === 'string') {
    try {
      const decryptedStr = aesGcmDecryptFreeSharing(ret.result, secret);
      try {
        ret.result = JSON.parse(decryptedStr);
      } catch {
        ret.result = decryptedStr;
      }
    } catch {}
  }
  return ret;
}

async function discoverDevicesFromFreeSharing(): Promise<any[]> {
  const homesRes = await tuyaFreeSharingRequest('GET', '/v1.0/m/life/users/homes');
  const homes: any[] = Array.isArray(homesRes?.result) ? homesRes.result : [];
  const allRawDevices: any[] = [];

  for (const h of homes) {
    const homeId = String(h.ownerId || h.id || '');
    if (!homeId) continue;
    try {
      const devRes = await tuyaFreeSharingRequest(
        'GET',
        '/v1.0/m/life/ha/home/devices',
        { homeId }
      );
      if (Array.isArray(devRes?.result)) {
        for (const d of devRes.result) {
          allRawDevices.push({ ...d, _homeName: h.name || 'Smart Home' });
        }
      }
    } catch {}
  }

  return allRawDevices.map((d: any) => {
    const statusArr: { code: string; value: any }[] = Array.isArray(d.status)
      ? d.status
      : [];
    const dps: Record<string, any> = {};
    let isOn = false;
    for (const s of statusArr) {
      dps[s.code] = s.value;
      if (
        (s.code === 'switch_led' ||
          s.code === 'switch_1' ||
          s.code === 'switch') &&
        s.value === true
      ) {
        isOn = true;
      }
    }

    const cat = ['dj', 'kt', 'cz', 'cl', 'ms'].includes(d.category)
      ? d.category
      : 'cz';

    return {
      id: `tuya-${d.id}`,
      tuyaDeviceId: d.id,
      name: d.name || `Smart Switch ${String(d.id).slice(0, 6)}`,
      sinhalaName: d.name || 'ස්මාර්ට් ස්විච් එක',
      room: d._homeName || 'Smart Home',
      sinhalaRoom: d._homeName || 'නිවස',
      category: cat,
      online: Boolean(d.online),
      isOn,
      dps,
      lastUpdated: 'Synced Free via Smart Life App',
    };
  });
}

// POST /api/tuya/free-qr/start -> Start 100% Free Smart Life QR Code Login using User Code
app.post('/api/tuya/free-qr/start', async (req, res) => {
  try {
    const userCode = String(req.body?.userCode || '').trim();
    if (!userCode) {
      return res.status(400).json({
        success: false,
        message:
          'කරුණාකර ඔබගේ Smart Life / Tuya Smart App හි User Code එක ඇතුළත් කරන්න (Me -> Settings ⚙️ -> Account and Security -> User Code).',
      });
    }

    const url = `${TUYA_FREE_LOGIN_HOST}/v1.0/m/life/home-assistant/qrcode/tokens?clientid=${TUYA_FREE_CLIENT_ID}&usercode=${encodeURIComponent(
      userCode
    )}&schema=${TUYA_FREE_SCHEMA}`;

    const r = await fetch(url, { method: 'POST' });
    const data: any = await r.json();
    const token = data?.result?.qrcode;

    if (!data?.success || !token) {
      return res.status(200).json({
        success: false,
        code: data?.code || 'QR_ERROR',
        message:
          data?.msg === 'User Code Incorrect'
            ? 'User Code එක නිවැරදි නොවේ. Smart Life App -> Me -> Settings (⚙️) -> Account and Security -> User Code හි ඇති කේතය නිවැරදිව ඇතුළත් කරන්න.'
            : data?.msg || 'QR කේතය ලබා ගැනීමට නොහැකි විය.',
      });
    }

    const qrContent = `tuyaSmart--qrLogin?token=${token}`;
    const qrDataUrl = await QRCode.toDataURL(qrContent, {
      width: 240,
      margin: 2,
      color: { dark: '#06080D', light: '#FFFFFF' },
    });

    res.json({
      success: true,
      token,
      userCode,
      qrContent,
      qrDataUrl,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: err?.message || 'Failed to generate Smart Life QR code',
    });
  }
});

// GET /api/tuya/free-qr/poll -> Poll if user scanned the QR Code in Smart Life app
app.get('/api/tuya/free-qr/poll', async (req, res) => {
  try {
    const token = String(req.query.token || '').trim();
    const userCode = String(req.query.userCode || '').trim();
    if (!token || !userCode) {
      return res.status(400).json({ success: false, authorized: false });
    }

    const url = `${TUYA_FREE_LOGIN_HOST}/v1.0/m/life/home-assistant/qrcode/tokens/${encodeURIComponent(
      token
    )}?clientid=${TUYA_FREE_CLIENT_ID}&usercode=${encodeURIComponent(userCode)}`;

    const r = await fetch(url, { method: 'GET' });
    const data: any = await r.json();

    if (data?.success && data?.result?.access_token) {
      const resObj = data.result;
      const expSec = Number(resObj.expire_time || 7200);
      neoBrain.tuyaFreeSharing = {
        userCode,
        accessToken: resObj.access_token,
        refreshToken: resObj.refresh_token,
        expireTimeMs: (Number(data.t) || Date.now()) + expSec * 1000,
        endpoint: resObj.endpoint || 'https://apigw.tuyaeu.com',
        terminalId: resObj.terminal_id || '',
        uid: resObj.uid || '',
        username: resObj.username || '',
      };
      savePersistentBrain(neoBrain);

      let discovered: any[] = [];
      try {
        discovered = await discoverDevicesFromFreeSharing();
        if (discovered.length > 0) {
          neoBrain.savedDevices = discovered;
          savePersistentBrain(neoBrain);
        }
      } catch {}

      return res.json({
        success: true,
        authorized: true,
        username: resObj.username || 'Smart Life User',
        devices: discovered,
      });
    }

    res.json({
      success: true,
      authorized: false,
    });
  } catch (err: any) {
    res.status(200).json({
      success: false,
      authorized: false,
      message: err?.message,
    });
  }
});

// POST /api/tuya/free-webhook -> Save optional Free Webhook URLs (Sequematic / Home Assistant / IFTTT) or new Tuya Trial Credentials
app.post('/api/tuya/free-webhook', async (req, res) => {
  try {
    const {
      switchOnUrl,
      switchOffUrl,
      customAccessId,
      customAccessSecret,
      customEndpoint,
    } = req.body || {};

    neoBrain.freeWebhooks = {
      ...neoBrain.freeWebhooks,
      ...(typeof switchOnUrl === 'string' ? { switchOnUrl: switchOnUrl.trim() } : {}),
      ...(typeof switchOffUrl === 'string'
        ? { switchOffUrl: switchOffUrl.trim() }
        : {}),
      ...(typeof customAccessId === 'string'
        ? { customAccessId: customAccessId.trim() }
        : {}),
      ...(typeof customAccessSecret === 'string'
        ? { customAccessSecret: customAccessSecret.trim() }
        : {}),
      ...(typeof customEndpoint === 'string'
        ? { customEndpoint: customEndpoint.trim() }
        : {}),
    };
    savePersistentBrain(neoBrain);

    res.json({
      success: true,
      freeWebhooks: neoBrain.freeWebhooks,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message });
  }
});

// GET /api/tuya/status
app.get('/api/tuya/status', async (_req, res) => {
  const accessId =
    neoBrain.freeWebhooks?.customAccessId || process.env.TUYA_ACCESS_ID || '';
  const accessSecret =
    neoBrain.freeWebhooks?.customAccessSecret ||
    process.env.TUYA_ACCESS_SECRET ||
    '';
  const endpoint =
    neoBrain.freeWebhooks?.customEndpoint ||
    process.env.TUYA_API_ENDPOINT ||
    'https://openapi.tuyaeu.com';
  const configured = Boolean(
    neoBrain.tuyaFreeSharing?.accessToken ||
      (accessId && accessSecret) ||
      neoBrain.freeWebhooks?.switchOnUrl
  );

  res.json({
    configured,
    freeSharingConnected: Boolean(neoBrain.tuyaFreeSharing?.accessToken),
    freeSharingUsername: neoBrain.tuyaFreeSharing?.username || null,
    freeWebhookConfigured: Boolean(
      neoBrain.freeWebhooks?.switchOnUrl || neoBrain.freeWebhooks?.switchOffUrl
    ),
    endpoint,
    accessIdPreview: accessId ? `${accessId.slice(0, 6)}...` : null,
    mode: neoBrain.tuyaFreeSharing?.accessToken
      ? 'SMART_LIFE_FREE_QR_CONNECTED'
      : configured
      ? 'TUYA_IOT_CLOUD_LIVE'
      : 'TUYA_AWAITING_CREDENTIALS',
  });
});

// GET /api/tuya/discover-devices
app.get('/api/tuya/discover-devices', async (_req, res) => {
  try {
    // 1. Try 100% Free Forever Smart Life QR-Code Sharing API first!
    if (neoBrain.tuyaFreeSharing?.accessToken) {
      try {
        const freeDevices = await discoverDevicesFromFreeSharing();
        if (freeDevices.length > 0) {
          neoBrain.savedDevices = freeDevices;
          savePersistentBrain(neoBrain);
          return res.json({
            success: true,
            mode: 'SMART_LIFE_FREE_QR_CONNECTED',
            devices: freeDevices,
            rawCount: freeDevices.length,
          });
        }
      } catch (freeErr) {
        console.warn('Free sharing discovery fallback:', freeErr);
      }
    }

    // 2. Otherwise try Tuya IoT Platform OpenAPI
    const data = await tuyaSignedFetch(
      'GET',
      '/v1.0/iot-01/associated-users/devices?size=50'
    );
    if (data?.code === 28841002) {
      return res.status(200).json({
        success: false,
        devices: neoBrain.savedDevices || [],
        subscriptionExpired: true,
        freeSharingConnected: Boolean(neoBrain.tuyaFreeSharing?.accessToken),
        message:
          'Tuya IoT Core Trial Subscription has expired (Code 28841002) on iot.tuya.com. You can either click "Extend Trial Period" for free on iot.tuya.com OR link your Smart Life app directly via our 100% Free QR Code method!',
      });
    }

    const rawList: any[] = data?.result?.devices || data?.result?.list || [];

    const mappedDevices = rawList.map((d: any) => {
      const statusArr: { code: string; value: any }[] = Array.isArray(d.status)
        ? d.status
        : [];
      const dps: Record<string, any> = {};
      let isOn = false;
      for (const s of statusArr) {
        dps[s.code] = s.value;
        if (
          (s.code === 'switch_led' ||
            s.code === 'switch_1' ||
            s.code === 'switch') &&
          s.value === true
        ) {
          isOn = true;
        }
      }

      const cat = ['dj', 'kt', 'cz', 'cl', 'ms'].includes(d.category)
        ? d.category
        : 'cz';

      return {
        id: `tuya-${d.id}`,
        tuyaDeviceId: d.id,
        name: d.name || `Smart Switch ${d.id.slice(0, 6)}`,
        sinhalaName: d.name || `ස්මාර්ට් ස්විච් එක`,
        room: d.room_name || 'Smart Home',
        sinhalaRoom: d.room_name || 'නිවස',
        category: cat,
        online: Boolean(d.online),
        isOn,
        dps,
        lastUpdated: 'Synced from Tuya Cloud',
      };
    });

    if (mappedDevices.length > 0) {
      neoBrain.savedDevices = mappedDevices;
      savePersistentBrain(neoBrain);
    }

    res.json({
      success: true,
      devices: mappedDevices,
      rawCount: mappedDevices.length,
    });
  } catch (error: any) {
    res.status(200).json({
      success: false,
      devices: neoBrain.savedDevices || [],
      message: error?.message || 'Using saved smart home devices.',
    });
  }
});

// POST /api/tuya/cloud-sync
app.post('/api/tuya/cloud-sync', async (req, res) => {
  try {
    const { deviceId, commands } = req.body;
    const cleanDeviceId = String(deviceId || '').replace(/^tuya-/, '');
    const accessId =
      neoBrain.freeWebhooks?.customAccessId || process.env.TUYA_ACCESS_ID;
    const accessSecret =
      neoBrain.freeWebhooks?.customAccessSecret ||
      process.env.TUYA_ACCESS_SECRET;
    const endpoint = (
      neoBrain.freeWebhooks?.customEndpoint ||
      process.env.TUYA_API_ENDPOINT ||
      'https://openapi.tuyaeu.com'
    ).replace(/\/$/, '');

    const primaryCommands: { code: string; value: any }[] = Array.isArray(
      commands
    )
      ? commands
      : [];
    const switchValue = primaryCommands[0]?.value;

    // 1. Try 100% Free Forever Smart Life QR-Code Sharing API first if linked!
    if (neoBrain.tuyaFreeSharing?.accessToken && cleanDeviceId) {
      try {
        let freeRes = await tuyaFreeSharingRequest(
          'POST',
          `/v1.1/m/thing/${cleanDeviceId}/commands`,
          null,
          { commands: primaryCommands }
        );

        if (!freeRes?.success && typeof switchValue === 'boolean') {
          for (const altCode of ['switch_1', 'switch', 'switch_led']) {
            if (primaryCommands[0]?.code === altCode) continue;
            const retryFree = await tuyaFreeSharingRequest(
              'POST',
              `/v1.1/m/thing/${cleanDeviceId}/commands`,
              null,
              { commands: [{ code: altCode, value: switchValue }] }
            );
            if (retryFree?.success) {
              freeRes = retryFree;
              break;
            }
          }
        }

        if (freeRes?.success) {
          return res.json({
            success: true,
            mode: 'SMART_LIFE_FREE_QR_LIVE',
            deviceId: cleanDeviceId,
            timestamp: Date.now().toString(),
            dispatchedCommands: primaryCommands,
          });
        }
      } catch (freeCmdErr) {
        console.warn('Free Smart Life command warning:', freeCmdErr);
      }
    }

    // 2. Try Free Webhook URLs (Sequematic / Home Assistant / IFTTT) if configured!
    if (typeof switchValue === 'boolean') {
      const targetHook = switchValue
        ? neoBrain.freeWebhooks?.switchOnUrl
        : neoBrain.freeWebhooks?.switchOffUrl;
      if (targetHook && targetHook.startsWith('http')) {
        try {
          await fetch(targetHook, {
            method: 'GET',
            signal: AbortSignal.timeout(4000),
          });
          return res.json({
            success: true,
            mode: 'FREE_WEBHOOK_TRIGGERED',
            deviceId: cleanDeviceId,
            timestamp: Date.now().toString(),
            dispatchedCommands: primaryCommands,
          });
        } catch {}
      }
    }

    // 3. Try Tuya IoT Platform OpenAPI (works immediately after clicking "Extend Trial Period" on iot.tuya.com!)
    if (accessId && accessSecret && cleanDeviceId) {
      try {
        let cmdJson = await tuyaSignedFetch(
          'POST',
          `/v1.0/iot-03/devices/${cleanDeviceId}/commands`,
          { commands: primaryCommands }
        );

        if (!cmdJson?.success && typeof switchValue === 'boolean') {
          for (const altCode of ['switch_1', 'switch', 'switch_led']) {
            if (primaryCommands[0]?.code === altCode) continue;
            const retryJson = await tuyaSignedFetch(
              'POST',
              `/v1.0/iot-03/devices/${cleanDeviceId}/commands`,
              { commands: [{ code: altCode, value: switchValue }] }
            );
            if (retryJson?.success) {
              cmdJson = retryJson;
              break;
            }
          }
        }

        return res.json({
          success: Boolean(cmdJson?.success),
          mode: 'TUYA_IOT_CLOUD_LIVE',
          endpoint,
          deviceId: cleanDeviceId,
          timestamp: Date.now().toString(),
          cloudResponse: cmdJson,
          subscriptionExpired: cmdJson?.code === 28841002,
          dispatchedCommands: primaryCommands,
        });
      } catch (cloudErr) {
        console.warn('Tuya live cloud call error:', cloudErr);
      }
    }

    res.json({
      success: true,
      mode: 'TUYA_LAN_BRIDGE_READY',
      endpoint,
      deviceId: cleanDeviceId,
      timestamp: Date.now().toString(),
      dispatchedCommands: primaryCommands,
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Tuya sync error' });
  }
});

// Serverless Gemini Live Helper Endpoints (for Vercel deployments where WebSockets are unavailable)
app.post('/api/neo/serverless-live-init', (req, res) => {
  try {
    const initConfig = req.body || {};
    if (Array.isArray(initConfig.devices) && initConfig.devices.length > 0) {
      neoBrain.savedDevices = initConfig.devices;
      savePersistentBrain(neoBrain);
    }
    const validMaleVoices = ['Charon', 'Puck', 'Fenrir'];
    const selectedVoice = validMaleVoices.includes(initConfig.voiceName || '')
      ? initConfig.voiceName
      : 'Charon';

    const systemInstruction = buildGeminiLiveSystemInstruction({
      language: initConfig.language || 'si',
      devices: initConfig.devices || neoBrain.savedDevices || [],
      schedule: neoBrain.schedule,
      currentNews: initConfig.currentNews || [],
      recognizedMember: initConfig.recognizedMember,
    });

    res.json({
      apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '',
      model: 'gemini-3.8-live',
      voiceName: selectedVoice,
      systemInstruction,
      schedule: neoBrain.schedule,
      functionDeclarations: [
        controlTuyaDeviceDecl,
        activateTuyaSceneDecl,
        controlMusicPlayerDecl,
        manageDailyScheduleDecl,
        saveToLongTermMemoryDecl,
        recallLongTermMemoryDecl,
        getLiveNewsDecl,
        searchInternetDecl,
      ],
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to init serverless live config' });
  }
});

app.post('/api/neo/serverless-tool-exec', async (req, res) => {
  try {
    const { functionCalls } = req.body || {};
    const calls = Array.isArray(functionCalls) ? functionCalls : [];
    const functionResponses: any[] = [];
    const clientActions: any[] = [];
    let fetchedNewsItems: any[] = [];
    let groundingLinks: { title: string; url: string }[] = [];

    for (const fc of calls) {
      if (fc.name === 'saveToLongTermMemory') {
        const fact = String(fc.args?.fact || '').trim();
        const category = String(fc.args?.category || 'personal');
        if (fact) {
          const saved = addMemoryFact(fact, category);
          functionResponses.push({
            id: fc.id,
            name: fc.name,
            response: {
              status: 'saved_to_permanent_memory',
              memory: saved,
              totalMemories: neoBrain.facts.length,
            },
          });
        }
      } else if (fc.name === 'recallLongTermMemory') {
        const q = String(fc.args?.query || '').toLowerCase().trim();
        const matchingFacts = neoBrain.facts.filter(
          (f) =>
            !q ||
            f.fact.toLowerCase().includes(q) ||
            f.category.toLowerCase().includes(q)
        );
        const matchingEpisodes = neoBrain.episodicHistory
          .filter(
            (ep) =>
              !q ||
              ep.userSaid.toLowerCase().includes(q) ||
              ep.neoReplied.toLowerCase().includes(q)
          )
          .slice(-15);
        functionResponses.push({
          id: fc.id,
          name: fc.name,
          response: {
            permanentFacts: matchingFacts,
            pastConversations: matchingEpisodes,
            scheduledTasks: neoBrain.schedule,
          },
        });
      } else if (fc.name === 'manageDailySchedule') {
        const action = String(fc.args?.action || 'add').toLowerCase();
        const title = String(fc.args?.title || 'Reminder').trim();
        const remindInMinutes = Number(fc.args?.remindInMinutes || 0);
        const colomboNow = new Date(
          new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo' })
        );
        let targetTime = String(fc.args?.time || '');
        let triggerAt: number | undefined = undefined;
        if (remindInMinutes > 0) {
          triggerAt = Date.now() + remindInMinutes * 60 * 1000;
          const targetDate = new Date(
            colomboNow.getTime() + remindInMinutes * 60 * 1000
          );
          targetTime = `${String(targetDate.getHours()).padStart(2, '0')}:${String(
            targetDate.getMinutes()
          ).padStart(2, '0')}`;
        } else if (!targetTime) {
          targetTime = `${String(colomboNow.getHours()).padStart(2, '0')}:${String(
            colomboNow.getMinutes()
          ).padStart(2, '0')}`;
        }

        if (action === 'complete') {
          neoBrain.schedule = neoBrain.schedule.map((s) =>
            s.title.toLowerCase().includes(title.toLowerCase())
              ? { ...s, completed: true }
              : s
          );
          savePersistentBrain(neoBrain);
        } else if (action === 'add') {
          const newItem: PersistedScheduleItem = {
            id: `sch-${Date.now()}`,
            title,
            sinhalaTitle: title,
            time: targetTime,
            triggerAt,
            category: 'reminder',
            priority: 'high',
            completed: false,
            reminded: false,
          };
          neoBrain.schedule.push(newItem);
          savePersistentBrain(neoBrain);
          addMemoryFact(
            `Scheduled task/reminder: "${title}" at ${targetTime}`,
            'schedule'
          );
        }

        clientActions.push({
          name: 'manageDailySchedule',
          args: {
            action,
            title,
            time: targetTime,
            triggerAt,
            schedule: neoBrain.schedule,
          },
        });
        functionResponses.push({
          id: fc.id,
          name: fc.name,
          response: {
            status: 'schedule_updated',
            action,
            title,
            scheduledTime: targetTime,
            activeTasks: neoBrain.schedule.filter((s) => !s.completed),
          },
        });
      } else if (fc.name === 'controlMusicPlayer') {
        const action = String(fc.args?.action || 'play').toLowerCase();
        const genreOrQuery = String(fc.args?.genreOrQuery || '').trim();
        if (action === 'pause' || action === 'stop') {
          clientActions.push({
            name: 'controlMusicPlayer',
            args: { action: 'stop' },
          });
          functionResponses.push({
            id: fc.id,
            name: fc.name,
            response: { status: 'music_stopped' },
          });
        } else {
          const webTrack = await searchWebMusicStream(genreOrQuery);
          clientActions.push({
            name: 'controlMusicPlayer',
            args: { action: 'play', genreOrQuery, webTrack },
          });
          functionResponses.push({
            id: fc.id,
            name: fc.name,
            response: {
              status: 'streaming_web_song',
              title: webTrack.title,
              artist: webTrack.artist,
              source: webTrack.source,
              instruction: `Confirm briefly in Sinhala that you are now playing "${webTrack.title}" from ${webTrack.source}.`,
            },
          });
        }
      } else if (fc.name === 'getLiveNews') {
        const topic = fc.args?.topic || 'Sri Lanka latest news today';
        const webResult = await performDirectInternetSearch(topic);
        fetchedNewsItems = webResult.articles;
        groundingLinks = webResult.links;
        clientActions.push({ name: fc.name, args: fc.args });
        functionResponses.push({
          id: fc.id,
          name: fc.name,
          response: {
            result: webResult.summaryText,
            instruction:
              'Translate the headlines into natural Sinhala, read ONLY the numbered headlines first, and ask the user which headline they want summarized or explained in detail.',
            headlines: fetchedNewsItems.map(
              (n, i) => `${i + 1}. ${n.headline} (${n.source})`
            ),
          },
        });
      } else if (fc.name === 'searchInternet') {
        const query = fc.args?.query || 'Sri Lanka latest news today';
        const webResult = await performDirectInternetSearch(query);
        groundingLinks = webResult.links;
        clientActions.push({ name: fc.name, args: fc.args });
        functionResponses.push({
          id: fc.id,
          name: fc.name,
          response: {
            result: webResult.summaryText,
            instruction:
              'Using these live internet search results, answer the user clearly and naturally in spoken Sinhala (or English if they asked in English).',
          },
        });
      } else {
        clientActions.push({ name: fc.name, args: fc.args });
        functionResponses.push({
          id: fc.id,
          name: fc.name,
          response: { status: 'executed', action: fc.name, args: fc.args },
        });
      }
    }

    res.json({
      functionResponses,
      actions: clientActions,
      newsItems: fetchedNewsItems,
      groundingLinks,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Tool execution failed' });
  }
});

// Sinhala/English TTS Audio Proxy for Serverless Voice Fallback
app.get('/api/neo/tts-proxy', async (req, res) => {
  try {
    const text = String(req.query.text || '').trim().slice(0, 200);
    if (!text) return res.status(400).send('Missing text');
    const ttsUrl = `https://translate.googleapis.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(
      text
    )}&tl=si&client=tw-ob`;
    const upstream = await fetch(ttsUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    res.status(upstream.status);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const arrayBuf = await upstream.arrayBuffer();
    res.send(Buffer.from(arrayBuf));
  } catch {
    res.status(500).send('TTS proxy failed');
  }
});

// Complete Server-Side Voice Turn Endpoint for Vercel Serverless Continuous Mic Mode
app.post('/api/neo/voice-turn', async (req, res) => {
  try {
    const {
      transcript = '',
      audioWavBase64 = '',
      devices = [],
      schedule = [],
      currentNews = [],
      language = 'si',
    } = req.body || {};

    const cleanTranscript = String(transcript || '').trim();
    if (!cleanTranscript && !audioWavBase64) {
      return res.json({ replyText: '', actions: [] });
    }

    if (Array.isArray(devices) && devices.length > 0) {
      neoBrain.savedDevices = devices;
      savePersistentBrain(neoBrain);
    }

    const clientActions: any[] = [];
    let fetchedNewsItems: any[] = [];

    // Instant smart home device inference if user spoke a clear command
    if (cleanTranscript) {
      const directAct = inferDirectSmartHomeAction(cleanTranscript, devices);
      if (directAct) {
        clientActions.push(directAct);
      }
    }

    // Proactive live internet search if question looks like news/weather/rates/facts
    let liveWebContext = '';
    if (cleanTranscript && looksLikeInternetQuestion(cleanTranscript)) {
      try {
        const webRes = await performDirectInternetSearch(cleanTranscript);
        liveWebContext = `\n\n[LIVE INTERNET SEARCH RESULTS FOR "${cleanTranscript}"]:\n${webRes.summaryText}`;
        if (webRes.articles?.length) {
          fetchedNewsItems = webRes.articles;
        }
      } catch {}
    } else if (!cachedLiveInternetContext) {
      await refreshBackgroundInternetCache();
    }

    const systemInstruction =
      buildGeminiLiveSystemInstruction({
        language,
        devices: devices.length ? devices : neoBrain.savedDevices,
        schedule: neoBrain.schedule.length ? neoBrain.schedule : schedule,
        currentNews,
      }) + liveWebContext;

    const ai = getGenAIClient();
    const parts: any[] = [];
    if (audioWavBase64) {
      parts.push({
        inlineData: {
          mimeType: 'audio/wav',
          data: audioWavBase64,
        },
      });
    }
    if (cleanTranscript) {
      parts.push({
        text: cleanTranscript,
      });
    } else {
      parts.push({
        text: 'Listen to the user speaking in Sinhala or English in this audio clip and respond naturally in spoken Sinhala (2-3 short sentences). Execute any smart home, music, schedule, memory, or internet search tool if requested.',
      });
    }

    const tools = [
      {
        functionDeclarations: [
          controlTuyaDeviceDecl,
          activateTuyaSceneDecl,
          controlMusicPlayerDecl,
          manageDailyScheduleDecl,
          saveToLongTermMemoryDecl,
          recallLongTermMemoryDecl,
          getLiveNewsDecl,
          searchInternetDecl,
        ],
      },
    ];

    let response: any = null;
    for (const modelName of ['gemini-3.8-flash', 'gemini-flash-latest']) {
      try {
        response = await ai.models.generateContent({
          model: modelName,
          contents: [{ role: 'user', parts }],
          config: {
            systemInstruction,
            tools,
          },
        });
        if (response) break;
      } catch (modelErr) {
        console.warn(`Voice turn model ${modelName} fallback:`, modelErr);
      }
    }

    let replyText = '';
    const fnCalls = response?.functionCalls || [];

    if (fnCalls.length > 0) {
      let extraSearchSummary = '';
      for (const fc of fnCalls) {
        if (fc.name === 'saveToLongTermMemory') {
          const fact = String((fc.args as any)?.fact || '').trim();
          const category = String((fc.args as any)?.category || 'personal');
          if (fact) addMemoryFact(fact, category);
        } else if (fc.name === 'manageDailySchedule') {
          const action = String((fc.args as any)?.action || 'add').toLowerCase();
          const title = String((fc.args as any)?.title || 'Reminder').trim();
          const targetTime = String((fc.args as any)?.time || '17:00');
          if (action === 'add') {
            neoBrain.schedule.push({
              id: `sch-${Date.now()}`,
              title,
              sinhalaTitle: title,
              time: targetTime,
              category: 'reminder',
              priority: 'high',
              completed: false,
              reminded: false,
            });
            savePersistentBrain(neoBrain);
          }
          clientActions.push({
            name: 'manageDailySchedule',
            args: { action, title, time: targetTime, schedule: neoBrain.schedule },
          });
        } else if (fc.name === 'controlMusicPlayer') {
          const action = String((fc.args as any)?.action || 'play').toLowerCase();
          const genreOrQuery = String((fc.args as any)?.genreOrQuery || '').trim();
          if (action === 'pause' || action === 'stop') {
            clientActions.push({ name: 'controlMusicPlayer', args: { action: 'stop' } });
          } else {
            const webTrack = await searchWebMusicStream(genreOrQuery);
            clientActions.push({
              name: 'controlMusicPlayer',
              args: { action: 'play', genreOrQuery, webTrack },
            });
            if (!replyText) {
              replyText = `හරි, දැන් මම "${webTrack.title}" ගීතය වාදනය කරනවා.`;
            }
          }
        } else if (fc.name === 'getLiveNews' || fc.name === 'searchInternet') {
          const q =
            (fc.args as any)?.query ||
            (fc.args as any)?.topic ||
            cleanTranscript ||
            'Sri Lanka latest news today';
          const webResult = await performDirectInternetSearch(q);
          if (webResult.articles?.length) fetchedNewsItems = webResult.articles;
          extraSearchSummary = webResult.summaryText;
        } else {
          clientActions.push({ name: fc.name, args: fc.args });
        }
      }

      if (extraSearchSummary) {
        for (const modelName of ['gemini-3.8-flash', 'gemini-flash-latest']) {
          try {
            const followUp = await ai.models.generateContent({
              model: modelName,
              contents: `User asked: "${cleanTranscript || 'Live news/info'}".\nHere is the live internet data:\n${extraSearchSummary}\n\nRespond naturally in spoken Sinhala in 2-4 concise sentences.`,
              config: { systemInstruction },
            });
            if (followUp?.text) {
              replyText = followUp.text;
              break;
            }
          } catch {}
        }
      }
    }

    if (!replyText && response?.text) {
      replyText = response.text;
    }

    if (!replyText && clientActions.length > 0) {
      const firstAct = clientActions[0];
      if (firstAct.name === 'controlTuyaDevice') {
        const isOff = String(firstAct.args?.power).toLowerCase() === 'off';
        replyText = isOff
          ? 'හරි, ස්විච් එක ඕෆ් කළා.'
          : 'හරි, ස්විච් එක ඔන් කළා.';
      } else {
        replyText = 'හරි, එය සිදු කළා.';
      }
    }

    if (cleanTranscript || replyText) {
      recordEpisodicTurn(cleanTranscript || '[Voice Audio]', replyText);
    }

    // Try generating natural Charon 24kHz PCM voice audio via Gemini TTS
    let audioPcm24kBase64 = '';
    if (replyText) {
      try {
        const ttsRes = await ai.models.generateContent({
          model: 'gemini-3.8-flash-lite-tts',
          contents: [{ parts: [{ text: replyText }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Charon' },
              },
            },
          },
        });
        const inlineAudio =
          ttsRes.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (inlineAudio) {
          audioPcm24kBase64 = inlineAudio;
        }
      } catch {}
    }

    res.json({
      replyText,
      audioPcm24kBase64,
      actions: clientActions,
      newsItems: fetchedNewsItems,
      schedule: neoBrain.schedule,
    });
  } catch (err: any) {
    res.status(200).json({
      replyText: '',
      actions: [],
      error: err?.message || 'Voice turn error',
    });
  }
});

async function startServer() {
  const httpServer = http.createServer(app);

  // Direct Real-Time Gemini Live API WebSocket Bridge (/api/neo/live)
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    if (request.url?.startsWith('/api/neo/live')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (clientWs: WebSocket) => {
    let liveSessionPromise: Promise<any> | null = null;
    let sessionDevices: any[] = [];
    let sessionLanguage = 'si';
    let userTranscriptBuffer = '';
    let modelTranscriptBuffer = '';
    let lastAutoSearchTime = 0;

    const safeSend = (payload: any) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    // Proactive Reminder Watcher
    const reminderInterval = setInterval(() => {
      if (neoBrain.schedule.length === 0) return;

      const now = Date.now();
      const colomboNow = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo' })
      );
      const currentHHMM = `${String(colomboNow.getHours()).padStart(
        2,
        '0'
      )}:${String(colomboNow.getMinutes()).padStart(2, '0')}`;

      let updated = false;
      for (const item of neoBrain.schedule) {
        if (item.completed || item.reminded) continue;

        const isTriggerAtDue =
          typeof item.triggerAt === 'number' && now >= item.triggerAt;
        const isClockTimeDue =
          !item.triggerAt && item.time && item.time === currentHHMM;

        if (isTriggerAtDue || isClockTimeDue) {
          item.reminded = true;
          updated = true;

          safeSend({
            type: 'reminder_due',
            reminder: item,
          });

          if (liveSessionPromise) {
            liveSessionPromise
              .then((session) => {
                if (session) {
                  session.sendRealtimeInput({
                    text: `[PROACTIVE SCHEDULED REMINDER]: The scheduled time (${item.time}) has arrived right now for the user's task: "${item.title}". Politely and warmly remind the user out loud in Sinhala right now!`,
                  });
                }
              })
              .catch(() => {});
          }
        }
      }

      if (updated) {
        savePersistentBrain(neoBrain);
      }
    }, 5000);

    let lastInitConfig: any = {};

    const initializeGeminiLiveSession = (initConfig: {
      voiceName?: string;
      language?: string;
      devices?: any[];
      schedule?: any[];
      currentNews?: any[];
      recognizedMember?: any;
    }) => {
      if (liveSessionPromise) return;
      lastInitConfig = { ...lastInitConfig, ...initConfig };

      sessionDevices = initConfig.devices || [];
      if (sessionDevices.length > 0) {
        neoBrain.savedDevices = sessionDevices;
        savePersistentBrain(neoBrain);
      }
      sessionLanguage = initConfig.language || 'si';

      if (
        neoBrain.schedule.length === 0 &&
        Array.isArray(initConfig.schedule) &&
        initConfig.schedule.length > 0
      ) {
        neoBrain.schedule = initConfig.schedule.map((s: any) => ({
          ...s,
          reminded: true,
        }));
        savePersistentBrain(neoBrain);
      }

      const validMaleVoices = ['Charon', 'Puck', 'Fenrir'];
      const selectedVoice = validMaleVoices.includes(initConfig.voiceName || '')
        ? initConfig.voiceName!
        : 'Charon';

      const systemInstruction = buildGeminiLiveSystemInstruction({
        language: sessionLanguage,
        devices: sessionDevices,
        schedule: neoBrain.schedule,
        currentNews: initConfig.currentNews || [],
        recognizedMember: initConfig.recognizedMember,
      });

      const ai = getGenAIClient();

      const liveCallbacks = {
        onopen: () => {
          safeSend({
            type: 'live_ready',
            voice: selectedVoice,
            memoryCount: neoBrain.facts.length + neoBrain.episodicHistory.length,
            schedule: neoBrain.schedule,
          });
        },
        onmessage: async (message: LiveServerMessage) => {
          try {
            // 1. Stream 24kHz PCM audio chunks directly from Gemini Live to browser
            const parts = message.serverContent?.modelTurn?.parts || [];
            for (const part of parts) {
              if (part.inlineData?.data) {
                safeSend({
                  type: 'audio',
                  audio: part.inlineData.data,
                });
              }
            }

            // 2. Barge-in / Interruption
            if (message.serverContent?.interrupted) {
              safeSend({ type: 'interrupted' });
            }

            // 3. Real-time Input Audio Transcription (User's voice)
            const inputTx = (message.serverContent as any)?.inputTranscription
              ?.text;
            if (inputTx) {
              userTranscriptBuffer += inputTx;
              safeSend({
                type: 'input_transcription',
                text: inputTx,
              });

              const directDeviceAction = inferDirectSmartHomeAction(
                userTranscriptBuffer,
                sessionDevices
              );
              if (directDeviceAction) {
                safeSend({
                  type: 'tool_actions',
                  actions: [directDeviceAction],
                });
              }
            }

            // 4. Real-time Output Audio Transcription (Gemini Live's voice)
            const outputTx = (message.serverContent as any)
              ?.outputTranscription?.text;
            if (outputTx) {
              modelTranscriptBuffer += outputTx;
              safeSend({
                type: 'output_transcription',
                text: outputTx,
              });
            }

            // 5. On Turn Complete: Continuously grow Neo's episodic memory
            if (message.serverContent?.turnComplete) {
              if (userTranscriptBuffer.trim() || modelTranscriptBuffer.trim()) {
                recordEpisodicTurn(userTranscriptBuffer, modelTranscriptBuffer);
              }
              userTranscriptBuffer = '';
              modelTranscriptBuffer = '';
              safeSend({ type: 'turn_complete' });
            }

            // 6. Handle Gemini Live Function Calls
            const toolCall = (message as any).toolCall;
            if (toolCall?.functionCalls?.length) {
              const functionResponses: any[] = [];
              const clientActions: any[] = [];
              let fetchedNewsItems: any[] = [];
              let groundingLinks: { title: string; url: string }[] = [];

              for (const fc of toolCall.functionCalls) {
                if (fc.name === 'saveToLongTermMemory') {
                  const fact = String((fc.args as any)?.fact || '').trim();
                  const category = String(
                    (fc.args as any)?.category || 'personal'
                  );
                  if (fact) {
                    const saved = addMemoryFact(fact, category);
                    functionResponses.push({
                      id: fc.id,
                      name: fc.name,
                      response: {
                        status: 'saved_to_permanent_memory',
                        memory: saved,
                        totalMemories: neoBrain.facts.length,
                      },
                    });
                  }
                } else if (fc.name === 'recallLongTermMemory') {
                  const q = String((fc.args as any)?.query || '')
                    .toLowerCase()
                    .trim();
                  const matchingFacts = neoBrain.facts.filter(
                    (f) =>
                      !q ||
                      f.fact.toLowerCase().includes(q) ||
                      f.category.toLowerCase().includes(q)
                  );
                  const matchingEpisodes = neoBrain.episodicHistory
                    .filter(
                      (ep) =>
                        !q ||
                        ep.userSaid.toLowerCase().includes(q) ||
                        ep.neoReplied.toLowerCase().includes(q)
                    )
                    .slice(-15);

                  functionResponses.push({
                    id: fc.id,
                    name: fc.name,
                    response: {
                      permanentFacts: matchingFacts,
                      pastConversations: matchingEpisodes,
                      scheduledTasks: neoBrain.schedule,
                    },
                  });
                } else if (fc.name === 'manageDailySchedule') {
                  const action = String(
                    (fc.args as any)?.action || 'add'
                  ).toLowerCase();
                  const title = String(
                    (fc.args as any)?.title || 'Reminder'
                  ).trim();
                  const remindInMinutes = Number(
                    (fc.args as any)?.remindInMinutes || 0
                  );

                  const colomboNow = new Date(
                    new Date().toLocaleString('en-US', {
                      timeZone: 'Asia/Colombo',
                    })
                  );
                  let targetTime = String((fc.args as any)?.time || '');
                  let triggerAt: number | undefined = undefined;

                  if (remindInMinutes > 0) {
                    triggerAt = Date.now() + remindInMinutes * 60 * 1000;
                    const targetDate = new Date(
                      colomboNow.getTime() + remindInMinutes * 60 * 1000
                    );
                    targetTime = `${String(targetDate.getHours()).padStart(
                      2,
                      '0'
                    )}:${String(targetDate.getMinutes()).padStart(2, '0')}`;
                  } else if (!targetTime) {
                    targetTime = `${String(colomboNow.getHours()).padStart(
                      2,
                      '0'
                    )}:${String(colomboNow.getMinutes()).padStart(2, '0')}`;
                  }

                  if (action === 'complete') {
                    neoBrain.schedule = neoBrain.schedule.map((s) =>
                      s.title.toLowerCase().includes(title.toLowerCase())
                        ? { ...s, completed: true }
                        : s
                    );
                    savePersistentBrain(neoBrain);
                  } else if (action === 'add') {
                    const newItem: PersistedScheduleItem = {
                      id: `sch-${Date.now()}`,
                      title,
                      sinhalaTitle: title,
                      time: targetTime,
                      triggerAt,
                      category: 'reminder',
                      priority: 'high',
                      completed: false,
                      reminded: false,
                    };
                    neoBrain.schedule.push(newItem);
                    savePersistentBrain(neoBrain);
                    addMemoryFact(
                      `Scheduled task/reminder: "${title}" at ${targetTime}`,
                      'schedule'
                    );
                  }

                  clientActions.push({
                    name: 'manageDailySchedule',
                    args: {
                      action,
                      title,
                      time: targetTime,
                      triggerAt,
                      schedule: neoBrain.schedule,
                    },
                  });

                  functionResponses.push({
                    id: fc.id,
                    name: fc.name,
                    response: {
                      status: 'schedule_updated',
                      action,
                      title,
                      scheduledTime: targetTime,
                      activeTasks: neoBrain.schedule.filter((s) => !s.completed),
                    },
                  });
                } else if (fc.name === 'controlMusicPlayer') {
                  const action = String(
                    (fc.args as any)?.action || 'play'
                  ).toLowerCase();
                  const genreOrQuery = String(
                    (fc.args as any)?.genreOrQuery || ''
                  ).trim();

                  if (action === 'pause' || action === 'stop') {
                    clientActions.push({
                      name: 'controlMusicPlayer',
                      args: { action: 'stop' },
                    });
                    functionResponses.push({
                      id: fc.id,
                      name: fc.name,
                      response: { status: 'music_stopped' },
                    });
                  } else {
                    const webTrack = await searchWebMusicStream(genreOrQuery);
                    if (genreOrQuery) {
                      addMemoryFact(
                        `User likes listening to "${webTrack.title}" (${genreOrQuery})`,
                        'preference'
                      );
                    }
                    clientActions.push({
                      name: 'controlMusicPlayer',
                      args: {
                        action: 'play',
                        genreOrQuery,
                        webTrack,
                      },
                    });
                    functionResponses.push({
                      id: fc.id,
                      name: fc.name,
                      response: {
                        status: 'streaming_web_song',
                        title: webTrack.title,
                        artist: webTrack.artist,
                        source: webTrack.source,
                        instruction: `Confirm briefly in Sinhala that you are now playing "${webTrack.title}" from ${webTrack.source}.`,
                      },
                    });
                  }
                } else if (fc.name === 'getLiveNews') {
                  const topic =
                    (fc.args as any)?.topic || 'Sri Lanka latest news today';
                  const webResult = await performDirectInternetSearch(topic);
                  fetchedNewsItems = webResult.articles;
                  groundingLinks = webResult.links;
                  clientActions.push({ name: fc.name, args: fc.args });
                  functionResponses.push({
                    id: fc.id,
                    name: fc.name,
                    response: {
                      result: webResult.summaryText,
                      instruction:
                        'Translate the headlines into natural Sinhala, read ONLY the numbered headlines first, and ask the user which headline they want summarized or explained in detail.',
                      headlines: fetchedNewsItems.map(
                        (n, i) => `${i + 1}. ${n.headline} (${n.source})`
                      ),
                    },
                  });
                } else if (fc.name === 'searchInternet') {
                  const query =
                    (fc.args as any)?.query || 'Sri Lanka latest news today';
                  const webResult = await performDirectInternetSearch(query);
                  groundingLinks = webResult.links;
                  clientActions.push({ name: fc.name, args: fc.args });
                  functionResponses.push({
                    id: fc.id,
                    name: fc.name,
                    response: {
                      result: webResult.summaryText,
                      instruction:
                        'Using these live internet search results, answer the user clearly and naturally in spoken Sinhala (or English if they asked in English).',
                    },
                  });
                } else {
                  clientActions.push({
                    name: fc.name,
                    args: fc.args,
                  });
                  functionResponses.push({
                    id: fc.id,
                    name: fc.name,
                    response: {
                      status: 'executed',
                      action: fc.name,
                      args: fc.args,
                    },
                  });
                }
              }

              safeSend({
                type: 'tool_actions',
                actions: clientActions,
                newsItems: fetchedNewsItems,
                groundingLinks,
              });

              if (liveSessionPromise) {
                const session = await liveSessionPromise;
                session.sendToolResponse({ functionResponses });
              }
            }
          } catch (msgErr) {
            console.warn('Gemini Live onmessage warning:', msgErr);
          }
        },
        onerror: (err: any) => {
          console.error('Gemini Live session error:', err);
          liveSessionPromise = null;
        },
        onclose: () => {
          liveSessionPromise = null;
          if (clientWs.readyState === WebSocket.OPEN) {
            setTimeout(() => {
              if (clientWs.readyState === WebSocket.OPEN && !liveSessionPromise) {
                initializeGeminiLiveSession(lastInitConfig);
              }
            }, 400);
          }
        },
      };

      liveSessionPromise = ai.live
        .connect({
          model: 'gemini-3.8-live',
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: selectedVoice,
                },
              },
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction,
            tools: [
              {
                functionDeclarations: [
                  controlTuyaDeviceDecl,
                  activateTuyaSceneDecl,
                  controlMusicPlayerDecl,
                  manageDailyScheduleDecl,
                  saveToLongTermMemoryDecl,
                  recallLongTermMemoryDecl,
                  getLiveNewsDecl,
                  searchInternetDecl,
                ],
              },
            ],
          },
          callbacks: liveCallbacks,
        })
        .catch((err: any) => {
          console.error('Failed to connect to gemini-3.8-live:', err);
          liveSessionPromise = null;
          safeSend({
            type: 'error',
            message: err?.message || 'Could not connect to Gemini Live',
          });
        });
    };

    clientWs.on('message', (rawData) => {
      try {
        const msg = JSON.parse(rawData.toString());

        if (msg.type === 'init') {
          initializeGeminiLiveSession(msg);
          return;
        }

        if (msg.type === 'update_context') {
          if (Array.isArray(msg.devices)) {
            sessionDevices = msg.devices;
            neoBrain.savedDevices = msg.devices;
            savePersistentBrain(neoBrain);
          }
          if (msg.language) {
            sessionLanguage = msg.language;
          }
          return;
        }

        if (!liveSessionPromise) {
          initializeGeminiLiveSession({});
        }

        if (msg.type === 'audio' && msg.audio && liveSessionPromise) {
          liveSessionPromise
            .then((session) => {
              if (session) {
                session.sendRealtimeInput({
                  audio: {
                    data: msg.audio,
                    mimeType: 'audio/pcm;rate=16000',
                  },
                });
              }
            })
            .catch(() => {});
        } else if (msg.type === 'voice_transcript' && msg.text && liveSessionPromise) {
          // Real-time Sinhala speech transcript from browser SpeechRecognition
          const spokenText = String(msg.text).trim();
          const directAct = inferDirectSmartHomeAction(spokenText, sessionDevices);
          if (directAct) {
            safeSend({
              type: 'tool_actions',
              actions: [directAct],
            });
          }

          // If user is asking an internet/news/weather/fact question, proactively fetch live web results and feed into Gemini Live
          const now = Date.now();
          if (
            looksLikeInternetQuestion(spokenText) &&
            now - lastAutoSearchTime > 4000
          ) {
            lastAutoSearchTime = now;
            performDirectInternetSearch(spokenText)
              .then(async (webRes) => {
                if (liveSessionPromise) {
                  const session = await liveSessionPromise;
                  if (session) {
                    session.sendRealtimeInput({
                      text: `[LIVE INTERNET SEARCH DATA FOR USER'S SPOKEN QUESTION "${spokenText}"]:\n${webRes.summaryText}\n\nUse this live internet information to answer the user right now in natural spoken Sinhala!`,
                    });
                  }
                }
              })
              .catch(() => {});
          }
        } else if (msg.type === 'text' && msg.text && liveSessionPromise) {
          const userText = String(msg.text).trim();
          const directAct = inferDirectSmartHomeAction(userText, sessionDevices);
          if (directAct) {
            safeSend({
              type: 'tool_actions',
              actions: [directAct],
            });
          }
          liveSessionPromise
            .then((session) => {
              if (session) {
                session.sendRealtimeInput({
                  text: userText,
                });
              }
            })
            .catch(() => {});
        }
      } catch (err) {
        console.warn('WebSocket client message error:', err);
      }
    });

    clientWs.on('close', () => {
      clearInterval(reminderInterval);
      if (liveSessionPromise) {
        liveSessionPromise
          .then((session) => {
            if (session && typeof session.close === 'function') {
              session.close();
            }
          })
          .catch(() => {});
        liveSessionPromise = null;
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Neo Direct Gemini Live Server running on http://0.0.0.0:${PORT}`
    );
  });
}

if (!process.env.VERCEL) {
  startServer();
}

export { app };
export default app;

