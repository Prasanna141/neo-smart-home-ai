import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { GoogleGenAI, FunctionDeclaration, Type } from '@google/genai';

const TUYA_FREE_CLIENT_ID = 'HA_3y9q4ak7g4ephrvke';
const TUYA_FREE_SCHEMA = 'haauthorize';
const TUYA_FREE_LOGIN_HOST = 'https://apigw.iotbing.com';

const MEMORY_FILE_PATH = path.join('/tmp', 'neo-long-term-memory.json');

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
  facts: { id: string; fact: string; category: string; createdAt: string }[];
  episodicHistory: { timestamp: string; userSaid: string; neoReplied: string }[];
  schedule: any[];
  savedDevices: any[];
  tuyaFreeSharing?: TuyaFreeSharingSession | null;
  freeWebhooks?: FreeWebhookConfig;
}

let inMemoryBrain: NeoPersistentBrain = {
  facts: [],
  episodicHistory: [],
  schedule: [],
  savedDevices: [],
  tuyaFreeSharing: null,
  freeWebhooks: {},
};

function loadBrain(): NeoPersistentBrain {
  try {
    if (fs.existsSync(MEMORY_FILE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(MEMORY_FILE_PATH, 'utf-8'));
      inMemoryBrain = {
        facts: Array.isArray(parsed.facts) ? parsed.facts : inMemoryBrain.facts,
        episodicHistory: Array.isArray(parsed.episodicHistory)
          ? parsed.episodicHistory
          : inMemoryBrain.episodicHistory,
        schedule: Array.isArray(parsed.schedule)
          ? parsed.schedule
          : inMemoryBrain.schedule,
        savedDevices: Array.isArray(parsed.savedDevices)
          ? parsed.savedDevices
          : inMemoryBrain.savedDevices,
        tuyaFreeSharing:
          parsed.tuyaFreeSharing || inMemoryBrain.tuyaFreeSharing || null,
        freeWebhooks: parsed.freeWebhooks || inMemoryBrain.freeWebhooks || {},
      };
    }
  } catch {}
  return inMemoryBrain;
}

function saveBrain(brain: NeoPersistentBrain) {
  inMemoryBrain = brain;
  try {
    fs.writeFileSync(MEMORY_FILE_PATH, JSON.stringify(brain, null, 2), 'utf-8');
  } catch {}
}

function randomNonce12(): string {
  const chars = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function generateFreeSharingSecret(
  rid: string,
  sid: string,
  hashKey: string
): string {
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

async function tuyaFreeSharingRequest(
  session: TuyaFreeSharingSession,
  method: 'GET' | 'POST',
  apiPath: string,
  params?: Record<string, any> | null,
  body?: Record<string, any> | null,
  skipRefresh = false
): Promise<any> {
  if (!session || !session.accessToken || !session.refreshToken || !session.endpoint) {
    throw new Error('FREE_SHARING_NOT_CONNECTED');
  }

  if (
    !skipRefresh &&
    session.expireTimeMs &&
    session.expireTimeMs - 60_000 <= Date.now()
  ) {
    try {
      const refreshRes = await tuyaFreeSharingRequest(
        session,
        'GET',
        `/v1.0/m/token/${session.refreshToken}`,
        null,
        null,
        true
      );
      if (refreshRes?.success && refreshRes?.result) {
        const r = refreshRes.result;
        session.accessToken = r.accessToken || r.access_token || session.accessToken;
        session.refreshToken = r.refreshToken || r.refresh_token || session.refreshToken;
        const expSec = Number(r.expireTime || r.expire_time || 7200);
        session.expireTimeMs = Date.now() + expSec * 1000;
        const brain = loadBrain();
        brain.tuyaFreeSharing = session;
        saveBrain(brain);
      }
    } catch {}
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

  const rawText = await res.text();
  let ret: any = {};
  try {
    ret = JSON.parse(rawText);
  } catch {
    ret = { success: false, msg: rawText };
  }
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

async function discoverDevicesFromFreeSharing(
  session: TuyaFreeSharingSession
): Promise<any[]> {
  const homesRes = await tuyaFreeSharingRequest(
    session,
    'GET',
    '/v1.0/m/life/users/homes'
  );
  const homes: any[] = Array.isArray(homesRes?.result) ? homesRes.result : [];
  const allRawDevices: any[] = [];

  for (const h of homes) {
    const homeId = String(h.ownerId || h.homeId || h.id || '');
    if (!homeId) continue;
    try {
      const devRes = await tuyaFreeSharingRequest(
        session,
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

function extractClientSession(
  req: any,
  brain: NeoPersistentBrain
): TuyaFreeSharingSession | null {
  try {
    const bodySession = req.body?.tuyaSession;
    if (bodySession && bodySession.accessToken && bodySession.refreshToken) {
      brain.tuyaFreeSharing = bodySession;
      return bodySession;
    }
    const headerSession = req.headers?.['x-tuya-session'];
    if (typeof headerSession === 'string' && headerSession.trim().startsWith('{')) {
      const parsed = JSON.parse(headerSession);
      if (parsed && parsed.accessToken && parsed.refreshToken) {
        brain.tuyaFreeSharing = parsed;
        return parsed;
      }
    }
  } catch {}
  return brain.tuyaFreeSharing || null;
}

function inferDirectSmartHomeAction(text: string, devices: any[]): any | null {
  const lower = text.toLowerCase();
  const turnOn =
    lower.includes('දාන්න') ||
    lower.includes('ඔන් කරන්න') ||
    lower.includes('on කරන්න') ||
    lower.includes('danna') ||
    lower.includes('on karanna') ||
    lower.includes('turn on') ||
    lower.includes('switch on');
  const turnOff =
    lower.includes('නිවන්න') ||
    lower.includes('ඕෆ් කරන්න') ||
    lower.includes('off කරන්න') ||
    lower.includes('niwanna') ||
    lower.includes('off karanna') ||
    lower.includes('turn off') ||
    lower.includes('switch off');

  if (!turnOn && !turnOff) return null;

  const isSwitchMentioned =
    lower.includes('ස්විච්') ||
    lower.includes('switch') ||
    lower.includes('ලයිට්') ||
    lower.includes('light') ||
    lower.includes('බල්බ්') ||
    lower.includes('ප්ලග්');

  if (!isSwitchMentioned && devices.length === 0) return null;

  return {
    name: 'controlTuyaDevice',
    args: {
      target: 'smart switch',
      turnOn: turnOn ? true : false,
    },
  };
}

const controlTuyaDeviceDecl: FunctionDeclaration = {
  name: 'controlTuyaDevice',
  description: 'Turn ON/OFF or adjust any smart switch, light, AC, curtain, or lock.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      target: {
        type: Type.STRING,
        description: 'Device name, room, or "smart switch" / "all"',
      },
      turnOn: {
        type: Type.BOOLEAN,
        description: 'True to turn ON, false to turn OFF',
      },
    },
    required: ['target', 'turnOn'],
  },
};

const controlMusicPlayerDecl: FunctionDeclaration = {
  name: 'controlMusicPlayer',
  description: 'Play or stop a Sinhala or English song.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      action: { type: Type.STRING, description: 'play, pause, stop, next' },
      genreOrQuery: { type: Type.STRING, description: 'Song title or artist' },
    },
    required: ['action'],
  },
};

const manageDailyScheduleDecl: FunctionDeclaration = {
  name: 'manageDailySchedule',
  description: 'Add or complete a daily reminder or scheduled task.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      action: { type: Type.STRING, description: 'add or complete' },
      title: { type: Type.STRING, description: 'Task description' },
      time: { type: Type.STRING, description: 'Time in HH:MM' },
      remindInMinutes: { type: Type.NUMBER, description: 'Minutes from now' },
    },
    required: ['action', 'title'],
  },
};

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, x-tuya-session, x-tuya-webhooks'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Parse body safely if string
  if (typeof req.body === 'string' && req.body.trim()) {
    try {
      req.body = JSON.parse(req.body);
    } catch {}
  }

  // Reconstruct route path reliably across direct and rewritten Vercel invocations
  const parsedUrl = new URL(req.url || '/', 'http://localhost');
  let routePath = parsedUrl.pathname;
  const queryPath = req.query?.__path || parsedUrl.searchParams.get('__path');
  if (queryPath) {
    const cleanSub = Array.isArray(queryPath)
      ? queryPath.join('/')
      : String(queryPath).replace(/^\/+/, '');
    routePath = `/api/${cleanSub}`;
  }

  const brain = loadBrain();
  const activeSession = extractClientSession(req, brain);

  // 1. POST /api/tuya/free-qr/start
  if (routePath.endsWith('/tuya/free-qr/start')) {
    try {
      const rawUserCode = String(
        req.body?.userCode || parsedUrl.searchParams.get('userCode') || ''
      ).trim();
      const userCode = rawUserCode.replace(/\s+/g, '');

      if (!userCode) {
        return res.status(200).json({
          success: false,
          message:
            'කරුණාකර ඔබගේ Smart Life / Tuya Smart App හි User Code එක ඇතුළත් කරන්න (Me -> Settings ⚙️ -> Account and Security -> User Code).',
        });
      }

      const url = `${TUYA_FREE_LOGIN_HOST}/v1.0/m/life/home-assistant/qrcode/tokens?clientid=${TUYA_FREE_CLIENT_ID}&usercode=${encodeURIComponent(
        userCode
      )}&schema=${TUYA_FREE_SCHEMA}`;

      const r = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'User-Agent': 'TuyaHomeAssistant/1.0',
        },
      });
      const rawText = await r.text();
      let data: any = {};
      try {
        data = JSON.parse(rawText);
      } catch {
        data = { success: false, msg: rawText };
      }

      const token = data?.result?.qrcode;
      if (!data?.success || !token) {
        return res.status(200).json({
          success: false,
          code: data?.code || 'QR_ERROR',
          message:
            data?.code === 'USERCODE_INCORRECT' ||
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

      return res.status(200).json({
        success: true,
        token,
        userCode,
        qrContent,
        qrDataUrl,
      });
    } catch (err: any) {
      return res.status(200).json({
        success: false,
        message: err?.message || 'Failed to generate Smart Life QR code',
      });
    }
  }

  // 2. GET /api/tuya/free-qr/poll
  if (routePath.endsWith('/tuya/free-qr/poll')) {
    try {
      const token = String(
        req.query?.token || parsedUrl.searchParams.get('token') || ''
      ).trim();
      const userCode = String(
        req.query?.userCode || parsedUrl.searchParams.get('userCode') || ''
      )
        .trim()
        .replace(/\s+/g, '');

      if (!token || !userCode) {
        return res.status(200).json({ success: false, authorized: false });
      }

      const url = `${TUYA_FREE_LOGIN_HOST}/v1.0/m/life/home-assistant/qrcode/tokens/${encodeURIComponent(
        token
      )}?clientid=${TUYA_FREE_CLIENT_ID}&usercode=${encodeURIComponent(userCode)}`;

      const r = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'User-Agent': 'TuyaHomeAssistant/1.0',
        },
      });
      const rawText = await r.text();
      let data: any = {};
      try {
        data = JSON.parse(rawText);
      } catch {}

      if (data?.success && data?.result?.access_token) {
        const resObj = data.result;
        const expSec = Number(resObj.expire_time || 7200);
        const newSession: TuyaFreeSharingSession = {
          userCode,
          accessToken: resObj.access_token,
          refreshToken: resObj.refresh_token,
          expireTimeMs: (Number(data.t) || Date.now()) + expSec * 1000,
          endpoint: resObj.endpoint || 'https://apigw.tuyaeu.com',
          terminalId: resObj.terminal_id || '',
          uid: resObj.uid || '',
          username: resObj.username || '',
        };
        brain.tuyaFreeSharing = newSession;
        saveBrain(brain);

        let discovered: any[] = [];
        try {
          discovered = await discoverDevicesFromFreeSharing(newSession);
          if (discovered.length > 0) {
            brain.savedDevices = discovered;
            saveBrain(brain);
          }
        } catch {}

        return res.status(200).json({
          success: true,
          authorized: true,
          username: resObj.username || 'Smart Life User',
          devices: discovered,
          tuyaSession: newSession,
        });
      }

      return res.status(200).json({
        success: true,
        authorized: false,
      });
    } catch (err: any) {
      return res.status(200).json({
        success: false,
        authorized: false,
        message: err?.message,
      });
    }
  }

  // 3. POST /api/tuya/free-webhook
  if (routePath.endsWith('/tuya/free-webhook')) {
    try {
      const {
        switchOnUrl,
        switchOffUrl,
        customAccessId,
        customAccessSecret,
        customEndpoint,
      } = req.body || {};

      brain.freeWebhooks = {
        ...brain.freeWebhooks,
        ...(typeof switchOnUrl === 'string'
          ? { switchOnUrl: switchOnUrl.trim() }
          : {}),
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
      saveBrain(brain);

      return res.status(200).json({
        success: true,
        freeWebhooks: brain.freeWebhooks,
      });
    } catch (err: any) {
      return res.status(200).json({ success: false, message: err?.message });
    }
  }

  // 4. GET /api/tuya/status
  if (routePath.endsWith('/tuya/status')) {
    const accessId =
      brain.freeWebhooks?.customAccessId || process.env.TUYA_ACCESS_ID || '';
    const accessSecret =
      brain.freeWebhooks?.customAccessSecret ||
      process.env.TUYA_ACCESS_SECRET ||
      '';
    const endpoint =
      brain.freeWebhooks?.customEndpoint ||
      process.env.TUYA_API_ENDPOINT ||
      'https://openapi.tuyaeu.com';
    const configured = Boolean(
      activeSession?.accessToken ||
        (accessId && accessSecret) ||
        brain.freeWebhooks?.switchOnUrl
    );

    return res.status(200).json({
      configured,
      freeSharingConnected: Boolean(activeSession?.accessToken),
      freeSharingUsername: activeSession?.username || null,
      freeWebhookConfigured: Boolean(
        brain.freeWebhooks?.switchOnUrl || brain.freeWebhooks?.switchOffUrl
      ),
      endpoint,
      accessIdPreview: accessId ? `${accessId.slice(0, 6)}...` : null,
      mode: activeSession?.accessToken
        ? 'SMART_LIFE_FREE_QR_CONNECTED'
        : configured
        ? 'TUYA_IOT_CLOUD_LIVE'
        : 'TUYA_AWAITING_CREDENTIALS',
    });
  }

  // 5. GET / POST /api/tuya/discover-devices
  if (routePath.endsWith('/tuya/discover-devices')) {
    try {
      if (activeSession?.accessToken) {
        const freeDevices = await discoverDevicesFromFreeSharing(activeSession);
        if (freeDevices.length > 0) {
          brain.savedDevices = freeDevices;
          saveBrain(brain);
          return res.status(200).json({
            success: true,
            mode: 'SMART_LIFE_FREE_QR_CONNECTED',
            devices: freeDevices,
            rawCount: freeDevices.length,
            tuyaSession: activeSession,
          });
        }
      }
      return res.status(200).json({
        success: false,
        devices: brain.savedDevices || [],
        freeSharingConnected: Boolean(activeSession?.accessToken),
      });
    } catch (err: any) {
      return res.status(200).json({
        success: false,
        devices: brain.savedDevices || [],
        message: err?.message,
      });
    }
  }

  // 6. POST /api/tuya/cloud-sync
  if (routePath.endsWith('/tuya/cloud-sync')) {
    try {
      const { deviceId, commands, freeWebhooks: clientWebhooks } = req.body || {};
      const cleanDeviceId = String(deviceId || '').replace(/^tuya-/, '');
      const primaryCommands: { code: string; value: any }[] = Array.isArray(
        commands
      )
        ? commands
        : [];
      const switchValue = primaryCommands[0]?.value;

      if (activeSession?.accessToken && cleanDeviceId) {
        try {
          let freeRes = await tuyaFreeSharingRequest(
            activeSession,
            'POST',
            `/v1.1/m/thing/${cleanDeviceId}/commands`,
            null,
            { commands: primaryCommands }
          );

          if (!freeRes?.success && typeof switchValue === 'boolean') {
            for (const altCode of ['switch_1', 'switch', 'switch_led']) {
              if (primaryCommands[0]?.code === altCode) continue;
              const retryFree = await tuyaFreeSharingRequest(
                activeSession,
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
            return res.status(200).json({
              success: true,
              mode: 'SMART_LIFE_FREE_QR_LIVE',
              deviceId: cleanDeviceId,
              timestamp: Date.now().toString(),
              dispatchedCommands: primaryCommands,
              tuyaSession: activeSession,
            });
          }
        } catch {}
      }

      const hooks = clientWebhooks || brain.freeWebhooks;
      if (typeof switchValue === 'boolean' && hooks) {
        const targetHook = switchValue ? hooks.switchOnUrl : hooks.switchOffUrl;
        if (targetHook && targetHook.startsWith('http')) {
          try {
            await fetch(targetHook, {
              method: 'GET',
              signal: AbortSignal.timeout(4000),
            });
            return res.status(200).json({
              success: true,
              mode: 'FREE_WEBHOOK_TRIGGERED',
              deviceId: cleanDeviceId,
              timestamp: Date.now().toString(),
              dispatchedCommands: primaryCommands,
            });
          } catch {}
        }
      }

      return res.status(200).json({
        success: true,
        mode: 'TUYA_LAN_BRIDGE_READY',
        deviceId: cleanDeviceId,
        timestamp: Date.now().toString(),
        dispatchedCommands: primaryCommands,
      });
    } catch (err: any) {
      return res.status(200).json({
        success: false,
        error: err?.message || 'Tuya sync error',
      });
    }
  }

  // 7. GET /api/neo/memory
  if (routePath.endsWith('/neo/memory')) {
    return res.status(200).json(brain);
  }

  // 8. GET /api/neo/tts-proxy
  if (routePath.endsWith('/neo/tts-proxy')) {
    try {
      const text = String(
        req.query?.text || parsedUrl.searchParams.get('text') || ''
      )
        .trim()
        .slice(0, 200);
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
      const arrayBuf = await upstream.arrayBuffer();
      return res.send(Buffer.from(arrayBuf));
    } catch {
      return res.status(500).send('TTS proxy failed');
    }
  }

  // 9. POST /api/neo/voice-turn
  if (routePath.endsWith('/neo/voice-turn')) {
    try {
      const {
        transcript = '',
        audioWavBase64 = '',
        devices = [],
      } = req.body || {};

      const cleanTranscript = String(transcript || '').trim();
      if (!cleanTranscript && !audioWavBase64) {
        return res.status(200).json({ replyText: '', actions: [] });
      }

      const clientActions: any[] = [];
      if (cleanTranscript) {
        const directAct = inferDirectSmartHomeAction(cleanTranscript, devices);
        if (directAct) {
          clientActions.push(directAct);
        }
      }

      const apiKey =
        process.env.GEMINI_API_KEY ||
        process.env.API_KEY ||
        process.env.VITE_GEMINI_API_KEY ||
        '';

      if (!apiKey) {
        return res.status(200).json({
          replyText:
            clientActions.length > 0
              ? 'හරි, ස්මාර්ට් ස්විච් එක ක්‍රියාත්මක කළා.'
              : 'කරුණාකර Vercel Environment Variables වල GEMINI_API_KEY ඇතුළත් කරන්න.',
          actions: clientActions,
        });
      }

      const ai = new GoogleGenAI({ apiKey });
      const parts: any[] = [];
      if (audioWavBase64) {
        parts.push({
          inlineData: {
            mimeType: 'audio/wav',
            data: audioWavBase64,
          },
        });
      }
      parts.push({
        text:
          cleanTranscript ||
          'Listen to the user speaking in Sinhala or English in this audio clip and respond naturally in spoken Sinhala (1-2 short sentences).',
      });

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction:
            'You are Neo (නියෝ), a warm, intelligent Sinhala & English Smart Home AI assistant with a male persona. Always reply concisely in natural spoken Sinhala (1-2 short sentences). Use tools when the user asks to control smart switches/lights, play music, or set reminders.',
          tools: [
            {
              functionDeclarations: [
                controlTuyaDeviceDecl,
                controlMusicPlayerDecl,
                manageDailyScheduleDecl,
              ],
            },
          ],
        },
      });

      const calls = response.functionCalls || [];
      for (const fc of calls) {
        clientActions.push({ name: fc.name, args: fc.args });
      }

      let replyText = (response.text || '').trim();
      if (!replyText && clientActions.length > 0) {
        replyText = 'හරි, එය ඉටු කළා.';
      }

      return res.status(200).json({
        replyText,
        actions: clientActions,
      });
    } catch (err: any) {
      return res.status(200).json({
        replyText: 'සමාවන්න, නැවත කියන්න.',
        actions: [],
        error: err?.message,
      });
    }
  }

  return res.status(200).json({
    ok: true,
    service: 'Neo Smart Home API',
    routePath,
  });
}
