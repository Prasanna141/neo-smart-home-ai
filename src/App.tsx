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

  const serverlessLiveSessionRef = useRef<any>(null);

  // Stop Direct Gemini Live Session
  const stopDirectGeminiLiveSession = useCallback(() => {
    setIsLiveConnected(false);
    isLiveConnectedRef.current = false;

    if (liveSpeechHelperRef.current) {
      try {
        liveSpeechHelperRef.current.onend = null;
        liveSpeechHelperRef.current.stop();
      } catch {}
      liveSpeechHelperRef.current = null;
    }
    if (liveWsRef.current) {
      try {
        liveWsRef.current.close();
      } catch {}
      liveWsRef.current = null;
    }
    if (serverlessLiveSessionRef.current) {
      try {
        serverlessLiveSessionRef.current.close();
      } catch {}
      serverlessLiveSessionRef.current = null;
    }
    soundEngine.stopLiveMicStream();
    soundEngine.stopSpeaking();
    soundEngine.setDucking(false);
    setAgentState('standby');
  }, []);

  // Fallback for Vercel Serverless deployments (where /api/neo/live WebSocket is not hosted on a persistent server)
  const startVercelServerlessLiveFallback = useCallback(async () => {
    try {
      const initRes = await fetch('/api/neo/serverless-live-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceName: 'Charon',
          language: 'si',
          devices: devicesRef.current,
          schedule: scheduleRef.current,
          currentNews: newsRef.current,
        }),
      });
      const cfg = await initRes.json();
      if (!cfg?.apiKey) {
        stopDirectGeminiLiveSession();
        return;
      }

      const { GoogleGenAI, Modality } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: cfg.apiKey });

      const session = await ai.live.connect({
        model: cfg.model || 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: cfg.voiceName || 'Charon',
              },
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: cfg.systemInstruction,
          tools: [
            {
              functionDeclarations: cfg.functionDeclarations || [],
            },
          ],
        },
        callbacks: {
          onopen: async () => {
            if (Array.isArray(cfg.schedule)) {
              setSchedule(cfg.schedule);
            }
            try {
              await soundEngine.startLiveMicStream((base64Pcm16k) => {
                if (serverlessLiveSessionRef.current) {
                  serverlessLiveSessionRef.current.sendRealtimeInput({
                    audio: {
                      data: base64Pcm16k,
                      mimeType: 'audio/pcm;rate=16000',
                    },
                  });
                }
              });
            } catch {}
          },
          onmessage: async (message: any) => {
            try {
              const parts = message.serverContent?.modelTurn?.parts || [];
              for (const part of parts) {
                if (part.inlineData?.data) {
                  soundEngine.enqueueLivePcm24kChunk(part.inlineData.data);
                }
              }
              if (message.serverContent?.interrupted) {
                soundEngine.clearLiveAudioQueue();
                setAgentState('listening');
              }
              const inputTx = message.serverContent?.inputTranscription?.text;
              if (inputTx) {
                userTurnBufferRef.current += inputTx;
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
              }
              if (message.serverContent?.turnComplete) {
                userTurnBufferRef.current = '';
              }
              const toolCall = message.toolCall;
              if (toolCall?.functionCalls?.length) {
                const execRes = await fetch('/api/neo/serverless-tool-exec', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    functionCalls: toolCall.functionCalls,
                  }),
                });
                const execData = await execRes.json();
                if (
                  Array.isArray(execData?.newsItems) &&
                  execData.newsItems.length > 0
                ) {
                  setNews(execData.newsItems);
                  newsRef.current = execData.newsItems;
                }
                if (
                  Array.isArray(execData?.actions) &&
                  execData.actions.length > 0
                ) {
                  lastLocalCmdTimeRef.current = Date.now();
                  applyNeoToolActions(execData.actions);
                }
                if (
                  serverlessLiveSessionRef.current &&
                  Array.isArray(execData?.functionResponses)
                ) {
                  serverlessLiveSessionRef.current.sendToolResponse({
                    functionResponses: execData.functionResponses,
                  });
                }
              }
            } catch {}
          },
          onerror: () => {
            stopDirectGeminiLiveSession();
          },
          onclose: () => {
            if (isLiveConnectedRef.current) {
              stopDirectGeminiLiveSession();
            }
          },
        },
      });

      serverlessLiveSessionRef.current = session;
    } catch {
      stopDirectGeminiLiveSession();
    }
  }, [
    applyNeoToolActions,
    detectLocalDeviceCommand,
    stopDirectGeminiLiveSession,
  ]);

  // Connect Directly to Real-Time Gemini Live (`gemini-3.8-live`) over WebSocket (or Vercel Serverless Fallback)
  const startDirectGeminiLiveSession = useCallback(async () => {
    if (isLiveConnectedRef.current) {
      stopDirectGeminiLiveSession();
      return;
    }

    if (wakeRecognitionRef.current) {
      try {
        wakeRecognitionRef.current.onend = null;
        wakeRecognitionRef.current.stop();
      } catch {}
      wakeRecognitionRef.current = null;
    }

    soundEngine.playWakeChime();
    setIsLiveConnected(true);
    isLiveConnectedRef.current = true;
    setAgentState('listening');
    userTurnBufferRef.current = '';

    let wsOpened = false;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/neo/live`;
    const ws = new WebSocket(wsUrl);
    liveWsRef.current = ws;

    ws.onopen = async () => {
      wsOpened = true;
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

      try {
        await soundEngine.startLiveMicStream((base64Pcm16k) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'audio',
                audio: base64Pcm16k,
              })
            );
          }
        });
      } catch (micErr) {
        console.warn('Mic stream error:', micErr);
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'audio' && msg.audio) {
          soundEngine.enqueueLivePcm24kChunk(msg.audio);
        } else if (msg.type === 'interrupted') {
          soundEngine.clearLiveAudioQueue();
          setAgentState('listening');
        } else if (msg.type === 'live_ready' && Array.isArray(msg.schedule)) {
          setSchedule(msg.schedule);
        } else if (msg.type === 'reminder_due' && msg.reminder) {
          soundEngine.playWakeChime();
        } else if (msg.type === 'input_transcription' && msg.text) {
          userTurnBufferRef.current += msg.text;
          const now = Date.now();
          if (now - lastLocalCmdTimeRef.current > 1800) {
            const localAct = detectLocalDeviceCommand(userTurnBufferRef.current);
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
        }
      } catch {}
    };

    ws.onerror = () => {
      if (!wsOpened && isLiveConnectedRef.current) {
        liveWsRef.current = null;
        startVercelServerlessLiveFallback();
      }
    };

    ws.onclose = () => {
      if (!wsOpened && isLiveConnectedRef.current && !serverlessLiveSessionRef.current) {
        liveWsRef.current = null;
        startVercelServerlessLiveFallback();
        return;
      }
      if (wsOpened && isLiveConnectedRef.current) {
        stopDirectGeminiLiveSession();
      }
    };

    // Parallel browser SpeechRecognition helper for instant Sinhala/Singlish Smart Switch & Live Internet Search
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
            const now = Date.now();
            if (now - lastLocalCmdTimeRef.current > 1800) {
              const localAct = detectLocalDeviceCommand(cleaned);
              if (localAct) {
                lastLocalCmdTimeRef.current = now;
                applyNeoToolActions([localAct]);
              }
            }
            if (isFinal && ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: 'voice_transcript',
                  text: cleaned,
                })
              );
            }
          }
        };
        sr.onend = () => {
          if (isLiveConnectedRef.current) {
            try {
              sr.start();
            } catch {}
          }
        };
        liveSpeechHelperRef.current = sr;
        sr.start();
      } catch {}
    }
  }, [
    applyNeoToolActions,
    detectLocalDeviceCommand,
    startVercelServerlessLiveFallback,
    stopDirectGeminiLiveSession,
  ]);

  // Interrupt Neo speaking immediately (Barge-In)
  const handleInterruptSpeaking = useCallback(() => {
    soundEngine.clearLiveAudioQueue();
    setAgentState('listening');
  }, []);

  // Standby Wake-Word Sentinel ("Neo" / "නියෝ") when Live session is not yet connected
  useEffect(() => {
    if (isLiveConnected) return;

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    let isMounted = true;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      if (isLiveConnectedRef.current) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript.toLowerCase().trim();
        if (
          transcript.includes('neo') ||
          transcript.includes('niyo') ||
          transcript.includes('නියෝ')
        ) {
          startDirectGeminiLiveSession();
          break;
        }
      }
    };

    recognition.onend = () => {
      if (isMounted && !isLiveConnectedRef.current) {
        setTimeout(() => {
          try {
            if (isMounted && !isLiveConnectedRef.current) {
              recognition.start();
            }
          } catch {}
        }, 400);
      }
    };

    wakeRecognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {}

    return () => {
      isMounted = false;
      try {
        recognition.onend = null;
        recognition.stop();
      } catch {}
    };
  }, [isLiveConnected, startDirectGeminiLiveSession]);

  return (
    <div className="h-screen w-screen bg-[#06080D] text-[#F8FAFC] flex items-center justify-center overflow-hidden">
      <NeoVoiceVisualizer
        agentState={agentState}
        isLiveConnected={isLiveConnected}
        onToggleLive={startDirectGeminiLiveSession}
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
