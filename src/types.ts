export type TuyaCategory = 'dj' | 'kt' | 'cz' | 'cl' | 'ms' | 'sp' | 'wsdcg';

export interface TuyaDataPoints {
  switch?: boolean;
  switch_led?: boolean;
  switch_1?: boolean;
  bright_value?: number; // 10 - 100
  temp_value?: number; // 2700K - 6500K
  temp_set?: number; // 16 - 30 C
  temp_current?: number;
  humidity_value?: number;
  mode?: string; // 'cool' | 'eco' | 'fan' | 'white' | 'colour' | 'scene'
  percent_control?: number; // 0 - 100 for curtains
  lock_motor_state?: boolean; // true = unlocked, false = locked
  cur_power?: number; // Watts
  [key: string]: any;
}

export interface TuyaDevice {
  id: string;
  tuyaDeviceId: string;
  name: string;
  sinhalaName: string;
  room: string;
  sinhalaRoom: string;
  category: TuyaCategory; // dj=Light, kt=AC, cz=Socket/TV, cl=Curtain, ms=Smart Lock, wsdcg=Sensor
  online: boolean;
  isOn: boolean;
  dps: TuyaDataPoints;
  lastUpdated: string;
}

export interface TuyaScene {
  id: string;
  name: string;
  sinhalaName: string;
  description: string;
  sinhalaDescription: string;
  icon: string;
}

export interface ScheduleItem {
  id: string;
  title: string;
  sinhalaTitle?: string;
  time: string; // HH:mm
  category: 'work' | 'home' | 'reminder' | 'routine';
  completed: boolean;
  priority: 'high' | 'normal' | 'low';
  notified?: boolean;
}

export interface MusicTrack {
  id: string;
  title: string;
  sinhalaTitle: string;
  artist: string;
  genre: string;
  tempo: number; // BPM
  baseFreq: number;
  scale: number[];
  durationSec: number;
}

export interface NewsArticle {
  id: string;
  indexNumber?: number;
  headline: string;
  summary: string;
  fullDetails?: string;
  source: string;
  category: string;
  publishedAt: string;
  url?: string;
}

export type NewsItem = NewsArticle;

export interface HouseholdMember {
  id: string;
  name: string;
  sinhalaName: string;
  role: string;
  preferredLanguage: 'si' | 'en';
  greetingSceneId: string;
  favoriteGenre: string;
  faceDescriptorSummary: string;
  avatarDataUrl?: string;
  lastSeen?: string;
}

export interface FaceDetectionResult {
  detected: boolean;
  matchedMemberId?: string;
  matchedName?: string;
  confidence: number;
  expression: string;
  activityContext: string;
  personalizedSuggestion: string;
  autoActionTriggered?: string;
}

export interface AgentActionLog {
  id: string;
  timestamp: string;
  toolName: string;
  summary: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'neo';
  text: string;
  timestamp: string;
  triggeredByWakeWord?: boolean;
  actions?: AgentActionLog[];
  sources?: { title: string; url: string }[];
}
