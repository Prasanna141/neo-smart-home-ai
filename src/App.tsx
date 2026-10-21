import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  MusicTrack,
  NewsItem,
  ScheduleItem,
  TuyaDevice,
} from './types';
import {
  INITIAL_NEWS,
  INITIAL_SCHEDULE,
  INITIAL_TUYA_DEVICES,
  MUSIC_TRACKS,
} from './data/initialState';
import { soundEngine } from './services/soundEngine';
import {
  NeoAgentState,
  NeoVoiceVisualizer,
} from './components/NeoVoiceVisualizer';

const REAL_DEVICES_STORAGE_KEY = 'neo_real_tuya_devices_v2';
const LEGACY_DEVICES_STORAGE_KEY = 'neo_real_tuya_devices_v1';
const SCHEDULE_STORAGE_KEY = 'neo_persistent_schedule_v2';

export function App() {
  // Core Agent State
  const [agentState, setAgentState] = useState<NeoAgentState>('standby');
  const [isLiveConnected, setIsLiveConnected] = useState<boolean>(false);

  // Tuya Smart Home Devices State (restores any saved Smart Switch from v2 or v1 localStorage)
  const [devices, setDevices] = useState<TuyaDevice[]>(() => {
    try {
      const savedV2 = localStorage.getItem(REAL_DEVICES_STORAGE_KEY);
      const savedV1 = localStorage.getItem(LEGACY_DEVICES_STORAGE_KEY);
      const listV2: TuyaDevice[] = savedV2 ? JSON.parse(savedV2) : [];
      const listV1: TuyaDevice[] = savedV1 ? JSON.parse(savedV1) : [];

      const mergedMap = new Map<string, TuyaDevice>();
      for (const d of INITIAL_TUYA_DEVICES) {
        mergedMap.set(d.id, d);
      }
      for (const d of listV1) {
        if (d && d.id) mergedMap.set(d.id, d);
      }
      for (const d of listV2) {
        if (d && d.id) mergedMap.set(d.id, d);
      }
      return Array.from(mergedMap.values());
    } catch {}
    return INITIAL_TUYA_DEVICES;
  });

  useEffect(() => {
    try {
      localStorage.setItem(REAL_DEVICES_STORAGE_KEY, JSON.stringify(devices));
    } catch {}
  }, [devices]);

  // Persistent Daily Schedule & Reminders
  const [schedule, setSchedule] = useState<ScheduleItem[]>(() => {
    try {
      const saved = localStorage.getItem(SCHEDULE_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return INITIAL_SCHEDULE;
  });

  useEffect(() => {
    try {
      localStorage.setItem(SCHEDULE_STORAGE_KEY, JSON.stringify(schedule));
    } catch {}
  }, [schedule]);

  // Load persisted brain schedule & saved devices from server on startup
  useEffect(() => {
    fetch('/api/neo/memory')
      .then((r) => r.json())
      .then((brain) => {
        if (Array.isArray(brain?.schedule) && brain.schedule.length > 0) {
          setSchedule(brain.schedule);
        }
        if (Array.isArray(brain?.savedDevices) && brain.savedDevices.length > 0) {
          setDevices((prev) => {
            const map = new Map<string, TuyaDevice>();
            for (const d of prev) map.set(d.id, d);
            for (const d of brain.savedDevices) {
              if (d && d.id) map.set(d.id, d);
            }
            return Array.from(map.values());
          });
        }
      })
      .catch(() => {});
  }, []);

  const [news, setNews] = useState<NewsItem[]>(INITIAL_NEWS);
  const [currentTrack, setCurrentTrack] = useState<MusicTrack>(MUSIC_TRACKS[0]);
  const [isPlayingMusic, setIsPlayingMusic] = useState<boolean>(false);

  // Refs for real-time callbacks
  const devicesRef = useRef(devices);
  devicesRef.current = devices;
  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;
  const newsRef = useRef(news);
  newsRef.current = news;
  const isPlayingMusicRef = useRef(isPlayingMusic);
  isPlayingMusicRef.current = isPlayingMusic;
  const currentTrackRef = useRef(currentTrack);
  currentTrackRef.current = currentTrack;
  const isLiveConnectedRef = useRef(isLiveConnected);
  isLiveConnectedRef.current = isLiveConnected;

  // WebSocket & Speech Recognition Refs
  const liveWsRef = useRef<WebSocket | null>(null);
  const liveSpeechHelperRef = useRef<any>(null);
  const wakeRecognitionRef = useRef<any>(null);
  const userTurnBufferRef = useRef<string>('');
  const lastLocalCmdTimeRef = useRef<number>(0);

  // Keep soundEngine speaking callback synced with UI state
  useEffect(() => {
    soundEngine.setLiveSpeakingCallback((isSpeaking) => {
      if (isLiveConnectedRef.current) {
        setAgentState(isSpeaking ? 'speaking' : 'listening');
      }
    });
    return () => {
      soundEngine.setLiveSpeakingCallback(null);
    };
  }, []);

  // Push updated smart device state into active Gemini Live session
  useEffect(() => {
    if (
      liveWsRef.current &&
      liveWsRef.current.readyState === WebSocket.OPEN
    ) {
      liveWsRef.current.send(
        JSON.stringify({
          type: 'update_context',
          devices,
          language: 'si',
        })
      );
    }
  }, [devices]);

  // Sync Real Tuya Devices from Cloud automatically on load if configured
  const handleSyncFromTuyaCloud = useCallback(async () => {
    try {
      const res = await fetch('/api/tuya/discover-devices');
      const data = await res.json();
      if (data.success && Array.isArray(data.devices) && data.devices.length > 0) {
        setDevices((prev) => {
          const map = new Map<string, TuyaDevice>();
          for (const d of prev) map.set(d.id, d);
          for (const d of data.devices) map.set(d.id, d);
          return Array.from(map.values());
        });
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetch('/api/tuya/status')
      .then((r) => r.json())
      .then((st) => {
        if (st?.configured) {
          handleSyncFromTuyaCloud();
        }
      })
      .catch(() => {});
  }, [handleSyncFromTuyaCloud]);

  // Tuya Cloud / LAN Bridge Sync helper
  const syncTuyaDeviceToCloud = useCallback(
    async (deviceId: string, commands: { code: string; value: any }[]) => {
      try {
        await fetch('/api/tuya/cloud-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId, commands }),
        });
      } catch {}
    },
    []
  );

  const handleActivateScene = useCallback((sceneId: string) => {
    soundEngine.playDeviceSwitchChime(true);
    setDevices((prev) =>
      prev.map((d) => {
        if (sceneId === 'morning-awakening') {
          return { ...d, isOn: true };
        } else if (sceneId === 'deep-focus') {
          return {
            ...d,
            isOn: true,
            dps: {
              ...d.dps,
              ...(d.category === 'dj' ? { bright_value: 100 } : {}),
              ...(d.category === 'kt' ? { temp_set: 24 } : {}),
            },
          };
        } else if (sceneId === 'cinema-night') {
          return {
            ...d,
            isOn: true,
            dps: {
              ...d.dps,
              ...(d.category === 'dj' ? { bright_value: 20 } : {}),
            },
          };
        } else if (sceneId === 'night-guard') {
          return {
            ...d,
            isOn: d.category === 'ms' ? true : false,
          };
        }
        return d;
      })
    );
  }, []);

  // Music Handlers
  const handleSelectTrack = useCallback((track: MusicTrack) => {
    setCurrentTrack(track);
    setIsPlayingMusic(true);
    soundEngine.startMusic(track);
  }, []);

  const handleNextTrack = useCallback(() => {
    const idx = MUSIC_TRACKS.findIndex((t) => t.id === currentTrackRef.current.id);
    const next = MUSIC_TRACKS[(idx + 1) % MUSIC_TRACKS.length];
    handleSelectTrack(next);
  }, [handleSelectTrack]);

  const handlePrevTrack = useCallback(() => {
    const idx = MUSIC_TRACKS.findIndex((t) => t.id === currentTrackRef.current.id);
    const prev =
      MUSIC_TRACKS[(idx - 1 + MUSIC_TRACKS.length) % MUSIC_TRACKS.length];
    handleSelectTrack(prev);
  }, [handleSelectTrack]);

  // Smart Sinhala/Singlish/English target matching helper (including Smart Switch!)
  const doesDeviceMatchTarget = (d: TuyaDevice, rawTarget: string): boolean => {
    const t = rawTarget.toLowerCase().trim();
    if (
      !t ||
      t === 'all' ||
      t.includes('සියලුම') ||
      t.includes('ඔක්කොම') ||
      t.includes('okkoma')
    ) {
      return true;
    }
    if (
      d.id.toLowerCase().includes(t) ||
      d.tuyaDeviceId.toLowerCase().includes(t) ||
      d.name.toLowerCase().includes(t) ||
      d.room.toLowerCase().includes(t) ||
      d.sinhalaName.toLowerCase().includes(t) ||
      d.sinhalaRoom.toLowerCase().includes(t)
    ) {
      return true;
    }

    const wantsSwitchOrPlug =
      t.includes('switch') ||
      t.includes('ස්විච්') ||
      t.includes('swich') ||
      t.includes('plug') ||
      t.includes('ප්ලග්') ||
      t.includes('socket');

    if (wantsSwitchOrPlug) {
      if (
        d.category === 'cz' ||
        d.id.toLowerCase().includes('switch') ||
        d.id.toLowerCase().includes('plug') ||
        d.id.toLowerCase().startsWith('tuya-') ||
        d.id.toLowerCase().startsWith('custom-') ||
        d.name.toLowerCase().includes('switch') ||
        d.name.toLowerCase().includes('plug') ||
        d.sinhalaName.includes('ස්විච්') ||
        d.sinhalaName.includes('ප්ලග්')
      ) {
        return true;
      }
    }

    const wantsLiving =
      t.includes('living') ||
      t.includes('සාල') ||
      t.includes('salay') ||
      t.includes('sale');
    const wantsBedroom =
      t.includes('bed') || t.includes('නිදන') || t.includes('nidana');
    const wantsStudy =
      t.includes('study') ||
      t.includes('office') ||
      t.includes('desk') ||
      t.includes('කාර්යාල') ||
      t.includes('මේස');
    const wantsKitchen =
      t.includes('kitchen') ||
      t.includes('coffee') ||
      t.includes('kettle') ||
      t.includes('මුළුතැන්') ||
      t.includes('කුස්සි') ||
      t.includes('කෝපි');
    const wantsDoor =
      t.includes('door') ||
      t.includes('lock') ||
      t.includes('entrance') ||
      t.includes('දොර') ||
      t.includes('අගුල') ||
      t.includes('dora');

    const wantsLight =
      t.includes('light') ||
      t.includes('lamp') ||
      t.includes('bulb') ||
      t.includes('ලයිට්') ||
      t.includes('විදුලි') ||
      t.includes('ආලෝක') ||
      t.includes('පහන');
    const wantsAc =
      t.includes('ac') ||
      t.includes('air') ||
      t.includes('ඒසී') ||
      t.includes('වායු');
    const wantsCurtain =
      t.includes('curtain') ||
      t.includes('blind') ||
      t.includes('තිර') ||
      t.includes('ජනෙල්');

    const hasRoomFilter =
      wantsLiving || wantsBedroom || wantsStudy || wantsKitchen || wantsDoor;
    const hasCategoryFilter = wantsLight || wantsAc || wantsCurtain;

    const roomMatches =
      !hasRoomFilter ||
      (wantsLiving &&
        (d.room.toLowerCase().includes('living') ||
          d.sinhalaRoom.includes('සාල'))) ||
      (wantsBedroom &&
        (d.room.toLowerCase().includes('bedroom') ||
          d.sinhalaRoom.includes('නිදන'))) ||
      (wantsStudy &&
        (d.room.toLowerCase().includes('study') ||
          d.sinhalaRoom.includes('කාර්යාල'))) ||
      (wantsKitchen &&
        (d.room.toLowerCase().includes('kitchen') ||
          d.sinhalaRoom.includes('මුළුතැන්'))) ||
      (wantsDoor &&
        (d.room.toLowerCase().includes('entrance') ||
          d.sinhalaRoom.includes('දොර')));

    const categoryMatches =
      !hasCategoryFilter ||
      (wantsLight && d.category === 'dj') ||
      (wantsAc && d.category === 'kt') ||
      (wantsCurtain && d.category === 'cl');

    if (hasRoomFilter || hasCategoryFilter) {
      return roomMatches && categoryMatches;
    }

    return false;
  };

  // Client-side local smart device & Smart Switch command detector
  const detectLocalDeviceCommand = useCallback(
    (rawText: string): { name: string; args: any } | null => {
      const lower = rawText.toLowerCase().trim();
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
            lower.includes('plug') ||
            lower.includes('ලයිට්') ||
            lower.includes('විදුලි') ||
            lower.includes('ඒසී') ||
            lower.includes('ප්ලග්')));

      if (!isTurnOn && !isTurnOff) return null;
      const power = isTurnOff ? 'off' : 'on';

      if (
        lower.includes('switch') ||
        lower.includes('ස්විච්') ||
        lower.includes('swich') ||
        lower.includes('plug') ||
        lower.includes('ප්ලග්')
      ) {
        return { name: 'controlTuyaDevice', args: { target: 'switch', power } };
      }

      for (const d of devicesRef.current) {
        if (
          lower.includes(d.name.toLowerCase()) ||
          lower.includes(d.sinhalaName.toLowerCase())
        ) {
          return { name: 'controlTuyaDevice', args: { target: d.id, power } };
        }
      }

      const matchedAny = devicesRef.current.some((d) =>
        doesDeviceMatchTarget(d, lower)
      );
      if (matchedAny) {
        return { name: 'controlTuyaDevice', args: { target: lower, power } };
      }

      return null;
    },
    []
  );

  // Execute tool calls returned by Gemini Live
  const applyNeoToolActions = useCallback(
    (actions: { name: string; args: any }[]) => {
      for (const act of actions) {
        const { name, args } = act;

        if (name === 'controlTuyaDevice') {
          const target = String(args?.target || 'all');
          const power = String(args?.power || 'toggle').toLowerCase();
          const brightness = args?.brightness;
          const temperature = args?.temperature;
          const curtainPercent = args?.curtainPercent;

          soundEngine.playDeviceSwitchChime(power !== 'off');

          setDevices((prev) =>
            prev.map((d) => {
              if (!doesDeviceMatchTarget(d, target)) return d;

              const nextOn =
                power === 'on' ? true : power === 'off' ? false : !d.isOn;
              const nextDps = {
                ...d.dps,
                switch_1: nextOn,
                switch: nextOn,
                switch_led: nextOn,
              };
              if (typeof brightness === 'number') nextDps.bright_value = brightness;
              if (typeof temperature === 'number') nextDps.temp_set = temperature;
              if (typeof curtainPercent === 'number')
                nextDps.percent_control = curtainPercent;
              nextDps.cur_power = nextOn ? d.dps.cur_power || 18 : 0;

              syncTuyaDeviceToCloud(d.tuyaDeviceId, [
                {
                  code: d.category === 'dj' ? 'switch_led' : 'switch_1',
                  value: nextOn,
                },
              ]);

              return {
                ...d,
                isOn: nextOn,
                dps: nextDps,
                lastUpdated: 'Via Gemini Live',
              };
            })
          );
        } else if (name === 'activateTuyaScene') {
          const sceneId = String(args?.sceneId || 'morning-awakening');
          handleActivateScene(sceneId);
        } else if (name === 'controlMusicPlayer') {
          const action = String(args?.action || 'play').toLowerCase();
          const q = String(args?.genreOrQuery || '').toLowerCase();
          const webTrack = args?.webTrack;

          if (action === 'pause' || action === 'stop') {
            soundEngine.stopMusic();
            setIsPlayingMusic(false);
          } else if (webTrack?.proxyUrl) {
            setIsPlayingMusic(true);
            soundEngine
              .playWebStream(webTrack.proxyUrl, () => {
                setIsPlayingMusic(false);
              })
              .then((ok) => {
                if (!ok) {
                  handleSelectTrack(currentTrackRef.current);
                }
              });
          } else if (action === 'next') {
            handleNextTrack();
          } else if (action === 'previous') {
            handlePrevTrack();
          } else {
            const matchedTrack =
              MUSIC_TRACKS.find(
                (t) =>
                  t.title.toLowerCase().includes(q) ||
                  t.genre.toLowerCase().includes(q) ||
                  t.sinhalaTitle.includes(q)
              ) || currentTrackRef.current;
            handleSelectTrack(matchedTrack);
          }
        } else if (name === 'manageDailySchedule') {
          if (Array.isArray(args?.schedule)) {
            setSchedule(args.schedule);
          } else {
            const action = String(args?.action || 'add').toLowerCase();
            const title = String(args?.title || 'Scheduled Reminder');
            if (action === 'complete') {
              setSchedule((prev) =>
                prev.map((s) =>
                  s.title.toLowerCase().includes(title.toLowerCase()) ||
                  (s.sinhalaTitle && s.sinhalaTitle.includes(title))
                    ? { ...s, completed: true }
                    : s
                )
              );
            } else if (action === 'add') {
              const newItem: ScheduleItem = {
                id: `sch-${Date.now()}`,
                title,
                sinhalaTitle: args?.sinhalaTitle || title,
                time: args?.time || '17:00',
                category: (args?.category as any) || 'reminder',
                priority: (args?.priority as any) || 'high',
                completed: false,
              };
              setSchedule((prev) => [...prev, newItem]);
            }
          }
        }
      }
    },
    [
      handleActivateScene,
      handleNextTrack,
      handlePrevTrack,
      handleSelectTrack,
      syncTuyaDeviceToCloud,
    ]
  );

  const isServerlessModeRef = useRef<boolean>(false);
  const isProcessingTurnRef = useRef<boolean>(false);
  const lastServerlessTurnTimeRef = useRef<number>(0);
  const pendingTranscriptRef = useRef<string>('');
  const vadChunksRef = useRef<string[]>([]);
  const vadSpeakingRef = useRef<boolean>(false);
  const vadSilenceStartRef = useRef<number>(0);

  // Stop Direct Gemini Live Session (ONLY called when user explicitly clicks Mic button to turn OFF)
  const stopDirectGeminiLiveSession = useCallback(() => {
    setIsLiveConnected(false);
    isLiveConnectedRef.current = false;
    isServerlessModeRef.current = false;
    isProcessingTurnRef.current = false;
    vadChunksRef.current = [];
    vadSpeakingRef.current = false;
    pendingTranscriptRef.current = '';

    if (liveSpeechHelperRef.current) {
      try {
        liveSpeechHelperRef.current.onend = null;
        liveSpeechHelperRef.current.stop();
      } catch {}
      liveSpeechHelperRef.current = null;
    }
    if (liveWsRef.current) {
      try {
        liveWsRef.current.onclose = null;
        liveWsRef.current.onerror = null;
        liveWsRef.current.close();
      } catch {}
      liveWsRef.current = null;
    }
    soundEngine.stopLiveMicStream();
    soundEngine.stopSpeaking();
    soundEngine.setDucking(false);
    setAgentState('standby');
  }, []);

  // Send a voice turn (audio WAV + optional transcript) to server-side /api/neo/voice-turn on Vercel
  const sendServerlessVoiceTurn = useCallback(
    async (transcriptText: string, audioWavBase64: string) => {
      if (!isLiveConnectedRef.current || isProcessingTurnRef.current) return;
      const now = Date.now();
      if (now - lastServerlessTurnTimeRef.current < 1200) return;

      const cleanTx = (transcriptText || '').trim();
      if (!cleanTx && !audioWavBase64) return;

      isProcessingTurnRef.current = true;
      lastServerlessTurnTimeRef.current = now;
      setAgentState('processing');

      try {
        const res = await fetch('/api/neo/voice-turn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript: cleanTx,
            audioWavBase64,
            devices: devicesRef.current,
            schedule: scheduleRef.current,
            currentNews: newsRef.current,
            language: 'si',
          }),
        });
        const data = await res.json();

        if (!isLiveConnectedRef.current) return;

        if (Array.isArray(data?.newsItems) && data.newsItems.length > 0) {
          setNews(data.newsItems);
          newsRef.current = data.newsItems;
        }
        if (Array.isArray(data?.schedule) && data.schedule.length > 0) {
          setSchedule(data.schedule);
        }
        if (Array.isArray(data?.actions) && data.actions.length > 0) {
          lastLocalCmdTimeRef.current = Date.now();
          applyNeoToolActions(data.actions);
        }

        if (data?.audioPcm24kBase64) {
          soundEngine.enqueueLivePcm24kChunk(data.audioPcm24kBase64);
        } else if (data?.replyText) {
          await soundEngine.speakFallbackText(data.replyText);
        } else if (isLiveConnectedRef.current) {
          setAgentState('listening');
        }
      } catch {
        if (isLiveConnectedRef.current) {
          setAgentState('listening');
        }
      } finally {
        isProcessingTurnRef.current = false;
        if (isLiveConnectedRef.current && !soundEngine.isLiveSpeaking()) {
          setAgentState('listening');
        }
      }
    },
    [applyNeoToolActions]
  );

  const lastSessionStartTimeRef = useRef<number>(0);

  // Connect to Real-Time Gemini Live over WebSocket (or stay continuously active in Vercel Serverless Voice Mode)
  const startDirectGeminiLiveSession = useCallback(async () => {
    // Never turn off inside startDirectGeminiLiveSession!
    if (isLiveConnectedRef.current) {
      return;
    }

    lastSessionStartTimeRef.current = Date.now();

    if (wakeRecognitionRef.current) {
      try {
        wakeRecognitionRef.current.onend = null;
        wakeRecognitionRef.current.stop();
      } catch {}
      wakeRecognitionRef.current = null;
    }

    const isVercelHost =
      typeof window !== 'undefined' &&
      window.location.hostname.includes('vercel.app');

    soundEngine.playWakeChime();
    setIsLiveConnected(true);
    isLiveConnectedRef.current = true;
    isServerlessModeRef.current = isVercelHost;
    setAgentState('listening');
    userTurnBufferRef.current = '';
    vadChunksRef.current = [];
    vadSpeakingRef.current = false;
    pendingTranscriptRef.current = '';

    // 1. Start Browser SpeechRecognition SYNCHRONOUSLY inside user gesture before any await!
    const SpeechRec =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (SpeechRec) {
      try {
        const sr = new SpeechRec();
        sr.continuous = true;
        sr.interimResults = true;
        sr.lang = 'si-LK';
        sr.onresult = (ev: any) => {
          let latest = '';
          let isFinal = false;
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            latest += ev.results[i][0].transcript + ' ';
            if (ev.results[i].isFinal) isFinal = true;
          }
          const cleaned = latest.trim();
          if (cleaned) {
            pendingTranscriptRef.current = cleaned;
            const now = Date.now();
            if (now - lastLocalCmdTimeRef.current > 1800) {
              const localAct = detectLocalDeviceCommand(cleaned);
              if (localAct) {
                lastLocalCmdTimeRef.current = now;
                applyNeoToolActions([localAct]);
              }
            }
            if (isFinal) {
              const activeWs = liveWsRef.current;
              if (
                activeWs &&
                activeWs.readyState === WebSocket.OPEN &&
                !isServerlessModeRef.current
              ) {
                activeWs.send(
                  JSON.stringify({
                    type: 'voice_transcript',
                    text: cleaned,
                  })
                );
              } else {
                const recordedChunks = vadChunksRef.current.slice();
                vadChunksRef.current = [];
                vadSpeakingRef.current = false;
                vadSilenceStartRef.current = 0;
                pendingTranscriptRef.current = '';
                const wavB64 =
                  recordedChunks.length >= 2
                    ? soundEngine.buildWavBase64FromPcm16kChunks(recordedChunks)
                    : '';
                sendServerlessVoiceTurn(cleaned, wavB64);
              }
            }
          }
        };
        sr.onerror = () => {
          // Never turn off Mic on SpeechRecognition transient errors
        };
        sr.onend = () => {
          if (isLiveConnectedRef.current) {
            try {
              sr.start();
            } catch {
              setTimeout(() => {
                if (isLiveConnectedRef.current) {
                  try {
                    sr.start();
                  } catch {}
                }
              }, 300);
            }
          }
        };
        liveSpeechHelperRef.current = sr;
        sr.start();
      } catch {}
    }

    // 2. Connect WebSocket when running on a stateful Node server (skip on *.vercel.app where WebSockets are unsupported)
    if (!isVercelHost) {
      let wsOpened = false;
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/neo/live`;
        const ws = new WebSocket(wsUrl);
        liveWsRef.current = ws;

        ws.onopen = () => {
          wsOpened = true;
          isServerlessModeRef.current = false;
          vadChunksRef.current = [];
          vadSpeakingRef.current = false;
          ws.send(
            JSON.stringify({
              type: 'init',
              voiceName: 'Charon',
              language: 'si',
              devices: devicesRef.current,
              schedule: scheduleRef.current,
              currentNews: newsRef.current,
            })
          );
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);

            if (msg.type === 'audio' && msg.audio) {
              soundEngine.enqueueLivePcm24kChunk(msg.audio);
            } else if (msg.type === 'interrupted') {
              soundEngine.clearLiveAudioQueue();
              setAgentState('listening');
            } else if (
              msg.type === 'live_ready' &&
              Array.isArray(msg.schedule)
            ) {
              setSchedule(msg.schedule);
            } else if (msg.type === 'reminder_due' && msg.reminder) {
              soundEngine.playWakeChime();
            } else if (msg.type === 'input_transcription' && msg.text) {
              userTurnBufferRef.current += msg.text;
              const now = Date.now();
              if (now - lastLocalCmdTimeRef.current > 1800) {
                const localAct = detectLocalDeviceCommand(
                  userTurnBufferRef.current
                );
                if (localAct) {
                  lastLocalCmdTimeRef.current = now;
                  applyNeoToolActions([localAct]);
                }
              }
            } else if (msg.type === 'tool_actions') {
              if (Array.isArray(msg.newsItems) && msg.newsItems.length > 0) {
                setNews(msg.newsItems);
                newsRef.current = msg.newsItems;
              }
              if (Array.isArray(msg.actions) && msg.actions.length > 0) {
                lastLocalCmdTimeRef.current = Date.now();
                applyNeoToolActions(msg.actions);
              }
            } else if (msg.type === 'turn_complete') {
              userTurnBufferRef.current = '';
            } else if (msg.type === 'error' || msg.type === 'closed') {
              // If server Gemini Live session closed/errored, switch seamlessly to Serverless Voice Mode without turning off Mic!
              isServerlessModeRef.current = true;
              try {
                ws.onclose = null;
                ws.onerror = null;
                ws.close();
              } catch {}
              liveWsRef.current = null;
            }
          } catch {}
        };

        ws.onerror = () => {
          if (isLiveConnectedRef.current) {
            isServerlessModeRef.current = true;
            liveWsRef.current = null;
          }
        };

        ws.onclose = () => {
          if (isLiveConnectedRef.current) {
            isServerlessModeRef.current = true;
            liveWsRef.current = null;
            if (!wsOpened) {
              setAgentState('listening');
            }
          }
        };
      } catch {
        isServerlessModeRef.current = true;
      }
    }

    // 3. Start Microphone Stream so Mic & Harmonic Orb stay active continuously
    try {
      await soundEngine.startLiveMicStream((base64Pcm16k, chunkRms) => {
        if (!isLiveConnectedRef.current) return;

        const ws = liveWsRef.current;
        if (
          ws &&
          ws.readyState === WebSocket.OPEN &&
          !isServerlessModeRef.current
        ) {
          ws.send(
            JSON.stringify({
              type: 'audio',
              audio: base64Pcm16k,
            })
          );
          return;
        }

        // Continuous VAD voice capture for Vercel Serverless / HTTP Voice Mode
        if (!isProcessingTurnRef.current && !soundEngine.isLiveSpeaking()) {
          const isVoiceActive = chunkRms > 0.018;
          if (isVoiceActive) {
            if (!vadSpeakingRef.current) {
              vadSpeakingRef.current = true;
              vadChunksRef.current = [];
            }
            vadSilenceStartRef.current = 0;
            if (vadChunksRef.current.length < 45) {
              vadChunksRef.current.push(base64Pcm16k);
            }
          } else if (vadSpeakingRef.current) {
            vadChunksRef.current.push(base64Pcm16k);
            if (!vadSilenceStartRef.current) {
              vadSilenceStartRef.current = Date.now();
            } else if (Date.now() - vadSilenceStartRef.current > 900) {
              const recordedChunks = vadChunksRef.current.slice();
              vadChunksRef.current = [];
              vadSpeakingRef.current = false;
              vadSilenceStartRef.current = 0;

              if (recordedChunks.length >= 4) {
                const wavB64 =
                  soundEngine.buildWavBase64FromPcm16kChunks(recordedChunks);
                const tx = pendingTranscriptRef.current;
                pendingTranscriptRef.current = '';
                sendServerlessVoiceTurn(tx, wavB64);
              }
            }
          }
        }
      });
    } catch (micErr) {
      console.warn('Mic stream error:', micErr);
    }
  }, [
    applyNeoToolActions,
    detectLocalDeviceCommand,
    sendServerlessVoiceTurn,
  ]);

  const handleToggleLive = useCallback(() => {
    if (isLiveConnectedRef.current) {
      // Prevent accidental double-tap / ghost click within 800ms of turning ON
      if (Date.now() - lastSessionStartTimeRef.current < 800) {
        return;
      }
      stopDirectGeminiLiveSession();
    } else {
      startDirectGeminiLiveSession();
    }
  }, [startDirectGeminiLiveSession, stopDirectGeminiLiveSession]);

  // Interrupt Neo speaking immediately (Barge-In)
  const handleInterruptSpeaking = useCallback(() => {
    soundEngine.clearLiveAudioQueue();
    setAgentState('listening');
  }, []);

  return (
    <div className="h-screen w-screen bg-[#06080D] text-[#F8FAFC] flex items-center justify-center overflow-hidden">
      <NeoVoiceVisualizer
        agentState={agentState}
        isLiveConnected={isLiveConnected}
        onToggleLive={handleToggleLive}
        onInterruptSpeaking={handleInterruptSpeaking}
        onDevicesDiscovered={(newDevices) => {
          setDevices((prev) => {
            const map = new Map<string, TuyaDevice>();
            for (const d of prev) map.set(d.id, d);
            for (const d of newDevices) {
              if (d && d.id) map.set(d.id, d);
            }
            return Array.from(map.values());
          });
        }}
      />
    </div>
  );
}

export default App;
