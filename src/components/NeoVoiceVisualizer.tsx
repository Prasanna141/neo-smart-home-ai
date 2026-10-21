import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Mic, MicOff, QrCode, X } from 'lucide-react';
import { soundEngine } from '../services/soundEngine';

export type NeoAgentState = 'standby' | 'listening' | 'processing' | 'speaking';

interface NeoVoiceVisualizerProps {
  agentState: NeoAgentState;
  isLiveConnected: boolean;
  onToggleLive: () => void;
  onInterruptSpeaking?: () => void;
  onDevicesDiscovered?: (devices: any[]) => void;
}

export const NeoVoiceVisualizer: React.FC<NeoVoiceVisualizerProps> = ({
  agentState,
  isLiveConnected,
  onToggleLive,
  onInterruptSpeaking,
  onDevicesDiscovered,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const phaseRef = useRef<number>(0);
  const [micLevel, setMicLevel] = useState<number>(0);

  // Free Smart Life QR Link Modal State (hidden by default so main screen shows ONLY Orb + Mic status)
  const [showFreeSetupModal, setShowFreeSetupModal] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'qr' | 'trial'>('qr');
  const [userCode, setUserCode] = useState<string>('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [qrToken, setQrToken] = useState<string>('');
  const [qrLoading, setQrLoading] = useState<boolean>(false);
  const [qrError, setQrError] = useState<string>('');
  const [qrConnectedUser, setQrConnectedUser] = useState<string>('');

  // Optional Free Webhook / New Trial Key inputs
  const [switchOnUrl, setSwitchOnUrl] = useState<string>('');
  const [switchOffUrl, setSwitchOffUrl] = useState<string>('');
  const [customAccessId, setCustomAccessId] = useState<string>('');
  const [customAccessSecret, setCustomAccessSecret] = useState<string>('');
  const [webhookSavedMsg, setWebhookSavedMsg] = useState<string>('');

  useEffect(() => {
    fetch('/api/tuya/status')
      .then((r) => r.json())
      .then((st) => {
        if (st?.freeSharingConnected) {
          setQrConnectedUser(st.freeSharingUsername || 'Smart Life Connected');
        }
      })
      .catch(() => {});
  }, []);

  // Poll QR code scan status when QR code is displayed
  useEffect(() => {
    if (!qrToken || !userCode || !showFreeSetupModal) return;

    const timer = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/tuya/free-qr/poll?token=${encodeURIComponent(
            qrToken
          )}&userCode=${encodeURIComponent(userCode)}`
        );
        const data = await res.json();
        if (data?.authorized) {
          clearInterval(timer);
          setQrConnectedUser(data.username || 'Smart Life App');
          setQrToken('');
          setQrDataUrl('');
          if (Array.isArray(data.devices) && onDevicesDiscovered) {
            onDevicesDiscovered(data.devices);
          }
        }
      } catch {}
    }, 2500);

    return () => clearInterval(timer);
  }, [qrToken, userCode, showFreeSetupModal, onDevicesDiscovered]);

  const handleStartFreeQr = async (e: React.FormEvent) => {
    e.preventDefault();
    setQrError('');
    setQrDataUrl('');
    setQrToken('');
    if (!userCode.trim()) {
      setQrError(
        'Smart Life App -> Me -> Settings (⚙️) -> Account and Security -> User Code හි ඇති කේතය ඇතුළත් කරන්න.'
      );
      return;
    }

    setQrLoading(true);
    try {
      const res = await fetch('/api/tuya/free-qr/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userCode: userCode.trim() }),
      });
      const data = await res.json();
      if (!data?.success) {
        setQrError(
          data?.message || 'QR කේතය ලබා ගැනීමට නොහැකි විය. User Code පරීක්ෂා කරන්න.'
        );
      } else {
        setQrDataUrl(data.qrDataUrl);
        setQrToken(data.token);
      }
    } catch {
      setQrError('සම්බන්ධතා දෝෂයකි. නැවත උත්සාහ කරන්න.');
    } finally {
      setQrLoading(false);
    }
  };

  const handleSaveWebhookOrTrial = async (e: React.FormEvent) => {
    e.preventDefault();
    setWebhookSavedMsg('');
    try {
      const res = await fetch('/api/tuya/free-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          switchOnUrl,
          switchOffUrl,
          customAccessId,
          customAccessSecret,
        }),
      });
      const data = await res.json();
      if (data?.success) {
        setWebhookSavedMsg('සුරකින ලදී! (Saved successfully)');
        const devRes = await fetch('/api/tuya/discover-devices');
        const devData = await devRes.json();
        if (Array.isArray(devData?.devices) && onDevicesDiscovered) {
          onDevicesDiscovered(devData.devices);
        }
      }
    } catch {}
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let tick = 0;

    const render = () => {
      tick++;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const targetW = Math.max(300, rect.width);
      const targetH = Math.max(300, rect.height);

      if (
        canvas.width !== Math.floor(targetW * dpr) ||
        canvas.height !== Math.floor(targetH * dpr)
      ) {
        canvas.width = Math.floor(targetW * dpr);
        canvas.height = Math.floor(targetH * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      const width = targetW;
      const height = targetH;
      const cx = width / 2;
      const cy = height / 2;

      ctx.clearRect(0, 0, width, height);

      const freqData = soundEngine.getFrequencyData();
      let avgEnergy = 0;
      for (let i = 0; i < freqData.length; i++) {
        avgEnergy += freqData[i];
      }
      avgEnergy = freqData.length > 0 ? avgEnergy / (freqData.length * 255) : 0;

      const rms = soundEngine.getMicRmsLevel();
      const combinedEnergy = Math.max(avgEnergy, rms * 2.2);

      if (tick % 3 === 0) {
        if (isLiveConnected) {
          setMicLevel(Math.min(100, Math.round(combinedEnergy * 260)));
        } else {
          setMicLevel(0);
        }
      }

      const speed =
        agentState === 'speaking'
          ? 0.068
          : agentState === 'listening'
          ? 0.048
          : 0.018;
      phaseRef.current += speed;
      const phase = phaseRef.current;

      const primaryColor =
        agentState === 'listening'
          ? { r: 0, g: 245, b: 212 }
          : agentState === 'speaking'
          ? { r: 56, g: 189, b: 248 }
          : { r: 99, g: 102, b: 241 };

      const secondaryColor =
        agentState === 'listening'
          ? { r: 16, g: 185, b: 129 }
          : agentState === 'speaking'
          ? { r: 0, g: 245, b: 212 }
          : { r: 0, g: 245, b: 212 };

      const baseRadius = Math.min(width, height) * 0.25;
      const dynamicBoost =
        agentState === 'speaking' || agentState === 'listening'
          ? combinedEnergy * 52
          : Math.sin(phase) * 5;

      // 1. Outer Ambient Halo Glow
      const auraGrad = ctx.createRadialGradient(
        cx,
        cy,
        baseRadius * 0.15,
        cx,
        cy,
        baseRadius * 2.15
      );
      auraGrad.addColorStop(
        0,
        `rgba(${primaryColor.r}, ${primaryColor.g}, ${primaryColor.b}, ${
          0.28 + combinedEnergy * 0.38
        })`
      );
      auraGrad.addColorStop(
        0.5,
        `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, 0.1)`
      );
      auraGrad.addColorStop(1, 'rgba(6, 8, 13, 0)');

      ctx.fillStyle = auraGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius * 2.15, 0, Math.PI * 2);
      ctx.fill();

      // 2. Multi-layered Harmonic Wave Rings
      const rings = 4;
      for (let r = 0; r < rings; r++) {
        ctx.beginPath();
        const ringRadius =
          baseRadius + r * 14 + dynamicBoost * (0.42 + r * 0.22);
        const points = 128;

        for (let i = 0; i <= points; i++) {
          const angle = (i / points) * Math.PI * 2;
          const freqIdx = i % Math.max(1, freqData.length);
          const freqAmp = (freqData[freqIdx] || 20) / 255;

          const wave1 =
            Math.sin(angle * (3 + r) + phase * (r % 2 === 0 ? 1 : -1.2)) *
            (6 + freqAmp * 28);
          const wave2 =
            Math.cos(angle * (5 - r) - phase * 1.4) *
            (3 + combinedEnergy * 22);

          const rad = ringRadius + wave1 + wave2;
          const x = cx + Math.cos(angle) * rad;
          const y = cy + Math.sin(angle) * rad;

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }

        ctx.closePath();
        const alpha = 0.72 - r * 0.14;
        ctx.strokeStyle =
          r % 2 === 0
            ? `rgba(${primaryColor.r}, ${primaryColor.g}, ${primaryColor.b}, ${alpha})`
            : `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${alpha})`;
        ctx.lineWidth = r === 0 ? 2.8 : 1.6;
        ctx.stroke();
      }

      // 3. Inner Luminous Core Sphere
      const coreGrad = ctx.createRadialGradient(
        cx - baseRadius * 0.18,
        cy - baseRadius * 0.18,
        baseRadius * 0.05,
        cx,
        cy,
        baseRadius * 0.92 + dynamicBoost * 0.3
      );
      coreGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      coreGrad.addColorStop(
        0.35,
        `rgba(${primaryColor.r}, ${primaryColor.g}, ${primaryColor.b}, 0.82)`
      );
      coreGrad.addColorStop(
        0.78,
        `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, 0.28)`
      );
      coreGrad.addColorStop(1, 'rgba(6, 8, 13, 0.05)');

      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(
        cx,
        cy,
        baseRadius * 0.85 + dynamicBoost * 0.25,
        0,
        Math.PI * 2
      );
      ctx.fill();

      // 4. Orbital Frequency Nodes
      const nodeCount = 24;
      for (let n = 0; n < nodeCount; n++) {
        const angle = (n / nodeCount) * Math.PI * 2 + phase * 0.35;
        const bin = (freqData[n % Math.max(1, freqData.length)] || 0) / 255;
        const orbitR = baseRadius * 1.32 + bin * 34 + dynamicBoost * 0.4;
        const nx = cx + Math.cos(angle) * orbitR;
        const ny = cy + Math.sin(angle) * orbitR;

        ctx.fillStyle = `rgba(${primaryColor.r}, ${primaryColor.g}, ${
          primaryColor.b
        }, ${0.35 + bin * 0.6})`;
        ctx.beginPath();
        ctx.arc(nx, ny, 1.8 + bin * 2.6, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [agentState, isLiveConnected]);

  const handleOrbOrMicClick = () => {
    if (agentState === 'speaking' && onInterruptSpeaking) {
      onInterruptSpeaking();
      return;
    }
    onToggleLive();
  };

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center select-none overflow-hidden">
      {/* 1. Harmonic Orb Animation */}
      <div
        onClick={handleOrbOrMicClick}
        className="relative w-[340px] h-[340px] sm:w-[440px] sm:h-[440px] flex items-center justify-center cursor-pointer"
      >
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>

      {/* 2. Microphone Status Indicator (with subtle integrated QR icon for 100% Free Smart Life Link) */}
      <div
        className={`mt-6 flex items-center gap-3.5 px-6 py-3.5 rounded-2xl border transition-all duration-300 ${
          isLiveConnected
            ? agentState === 'speaking'
              ? 'bg-sky-500/15 border-sky-400/50 text-sky-300 shadow-[0_0_30px_rgba(56,189,248,0.2)]'
              : 'bg-[#00F5D4]/15 border-[#00F5D4]/50 text-[#00F5D4] shadow-[0_0_30px_rgba(0,245,212,0.2)]'
            : 'bg-white/[0.04] border-white/15 text-slate-300 hover:border-white/30 hover:bg-white/[0.07]'
        }`}
      >
        <button
          type="button"
          onClick={handleOrbOrMicClick}
          className="flex items-center gap-3.5 cursor-pointer text-left"
        >
          <span className="relative flex items-center justify-center">
            {isLiveConnected ? (
              <>
                <span
                  className={`absolute inline-flex h-7 w-7 rounded-full opacity-40 animate-ping ${
                    agentState === 'speaking' ? 'bg-sky-400' : 'bg-[#00F5D4]'
                  }`}
                />
                <Mic className="w-5 h-5 relative z-10" />
              </>
            ) : (
              <MicOff className="w-5 h-5 text-slate-400" />
            )}
          </span>

          <div className="flex flex-col items-start text-left">
            <span className="text-sm font-medium tracking-wide">
              {isLiveConnected
                ? agentState === 'speaking'
                  ? 'Mic ON · Neo කතා කරයි (Speaking)'
                  : 'Mic ON · සවන් දෙමින් පවතී (Listening)'
                : 'Mic OFF · කතා කිරීමට ඔබන්න (හෝ "Neo" කියන්න)'}
            </span>

            <div className="w-48 h-1.5 bg-white/10 rounded-full overflow-hidden mt-1.5">
              <div
                className={`h-full transition-all duration-75 rounded-full ${
                  isLiveConnected
                    ? agentState === 'speaking'
                      ? 'bg-sky-400'
                      : 'bg-[#00F5D4]'
                    : 'bg-slate-600'
                }`}
                style={{
                  width: isLiveConnected ? `${Math.max(12, micLevel)}%` : '0%',
                }}
              />
            </div>
          </div>
        </button>

        {/* Subtle integrated QR button inside Mic bar to link Smart Switch for 100% Free */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowFreeSetupModal(true);
          }}
          title="ගෙවීම් රහිතව Smart Switch සම්බන්ධ කරන්න (Free Smart Life QR Link)"
          className={`ml-2 p-2 rounded-xl border transition-all cursor-pointer ${
            qrConnectedUser
              ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
              : 'border-white/10 bg-white/5 text-slate-400 hover:text-white hover:border-white/30'
          }`}
        >
          <QrCode className="w-4 h-4" />
        </button>
      </div>

      {/* On-Demand Modal: 100% Free Smart Switch Link (No Tuya Payment Required) */}
      {showFreeSetupModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#0D111A] border border-white/15 rounded-2xl p-6 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div>
                <h2 className="text-base font-semibold text-white">
                  ගෙවීම් රහිතව Smart Switch සම්බන්ධ කිරීම (100% Free)
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Tuya IoT Platform එකට මුදල් නොගෙවා භාවිතා කළ හැකි ක්‍රම 2
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowFreeSetupModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="grid grid-cols-2 gap-2 mt-4 bg-white/5 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setActiveTab('qr')}
                className={`py-2 px-3 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  activeTab === 'qr'
                    ? 'bg-[#00F5D4] text-[#06080D] font-semibold'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                1. Smart Life Free QR (නොමිලේ)
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('trial')}
                className={`py-2 px-3 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  activeTab === 'trial'
                    ? 'bg-[#00F5D4] text-[#06080D] font-semibold'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                2. Tuya Free Trial දීර්ඝ කිරීම
              </button>
            </div>

            {activeTab === 'qr' ? (
              <div className="mt-4 space-y-4">
                {qrConnectedUser && (
                  <div className="flex items-center gap-2.5 p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>
                      Smart Life App සාර්ථකව සම්බන්ධ වී ඇත ({qrConnectedUser})! දැන් කටහඬින් Smart Switch ක්‍රියා කරවිය හැක.
                    </span>
                  </div>
                )}

                <div className="text-xs text-slate-300 space-y-1.5 bg-white/[0.03] p-3.5 rounded-xl border border-white/10 leading-relaxed">
                  <p className="font-medium text-[#00F5D4]">
                    iot.tuya.com ගිණුමක් හෝ ගෙවීමක් නොමැතිව Smart Life App එක සෘජුවම සම්බන්ධ කරන්න:
                  </p>
                  <p>
                    1. ඔබගේ දුරකථනයේ <b>Smart Life</b> (හෝ <b>Tuya Smart</b>) App එක විවෘත කරන්න.
                  </p>
                  <p>
                    2. පහළ දකුණු කෙළවරේ <b>Me</b> &rarr; ඉහළ දකුණු කෙළවරේ <b>Settings (⚙️)</b> &rarr; <b>Account and Security</b> &rarr; <b>User Code</b> බලාගන්න.
                  </p>
                  <p>
                    3. එම <b>User Code</b> එක පහතින් ඇතුළත් කර ලැබෙන QR කේතය Smart Life App එකෙන් (<b>+ &rarr; Scan</b>) ස්කෑන් කරන්න.
                  </p>
                </div>

                <form onSubmit={handleStartFreeQr} className="flex gap-2">
                  <input
                    type="text"
                    value={userCode}
                    onChange={(e) => setUserCode(e.target.value)}
                    placeholder="Smart Life User Code (උදා: EU12345...)"
                    className="flex-1 bg-black/50 border border-white/15 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#00F5D4]"
                  />
                  <button
                    type="submit"
                    disabled={qrLoading}
                    className="px-4 py-2.5 rounded-xl bg-[#00F5D4] text-[#06080D] text-xs font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    {qrLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <QrCode className="w-4 h-4" />
                    )}
                    QR ලබාගන්න
                  </button>
                </form>

                {qrError && (
                  <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl p-2.5">
                    {qrError}
                  </p>
                )}

                {qrDataUrl && (
                  <div className="flex flex-col items-center justify-center p-4 bg-white/5 border border-white/10 rounded-xl space-y-2">
                    <img
                      src={qrDataUrl}
                      alt="Smart Life Login QR"
                      className="w-44 h-44 rounded-xl border-4 border-white"
                    />
                    <p className="text-xs text-[#00F5D4] font-medium text-center">
                      Smart Life App එකේ ඉහළ දකුණු කෙළවරේ [+] &rarr; Scan මඟින් මෙය ස්කෑන් කර &quot;Confirm Login&quot; ඔබන්න...
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="text-xs text-slate-300 space-y-1.5 bg-white/[0.03] p-3.5 rounded-xl border border-white/10 leading-relaxed">
                  <p className="font-medium text-sky-300">
                    iot.tuya.com හි සතයක්වත් නොගෙවා Free Trial එක තවත් මාස 6කට දීර්ඝ කරගන්නා ආකාරය:
                  </p>
                  <p>
                    1. <b>iot.tuya.com</b> වෙත ලොග් වී <b>Cloud &rarr; Cloud Services</b> වෙත යන්න.
                  </p>
                  <p>
                    2. <b>IoT Core</b> ඉදිරියෙන් ඇති <b>&quot;Extend Trial Period&quot;</b> ඔබන්න (Subscribe ඔබන්න එපා).
                  </p>
                  <p>
                    3. හේතුව ලෙස <i>&quot;Personal smart home voice testing project&quot;</i> ලබා දී Submit කරන්න (සම්පූර්ණයෙන්ම නොමිලේ!).
                  </p>
                </div>

                <form onSubmit={handleSaveWebhookOrTrial} className="space-y-2.5">
                  <p className="text-xs text-slate-400">
                    නැතහොත් අලුත් Free Trial Access ID / Secret හෝ නොමිලේ ලැබෙන Sequematic / Home Assistant Webhook URL මෙහි ඇතුළත් කළ හැක:
                  </p>
                  <input
                    type="text"
                    value={customAccessId}
                    onChange={(e) => setCustomAccessId(e.target.value)}
                    placeholder="නව Tuya Access ID (විකල්ප)"
                    className="w-full bg-black/50 border border-white/15 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500"
                  />
                  <input
                    type="password"
                    value={customAccessSecret}
                    onChange={(e) => setCustomAccessSecret(e.target.value)}
                    placeholder="නව Tuya Access Secret (විකල්ප)"
                    className="w-full bg-black/50 border border-white/15 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500"
                  />
                  <input
                    type="text"
                    value={switchOnUrl}
                    onChange={(e) => setSwitchOnUrl(e.target.value)}
                    placeholder="Free Switch ON Webhook URL (Sequematic / IFTTT / HA)"
                    className="w-full bg-black/50 border border-white/15 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500"
                  />
                  <input
                    type="text"
                    value={switchOffUrl}
                    onChange={(e) => setSwitchOffUrl(e.target.value)}
                    placeholder="Free Switch OFF Webhook URL (Sequematic / IFTTT / HA)"
                    className="w-full bg-black/50 border border-white/15 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500"
                  />
                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-xl bg-sky-400 text-[#06080D] text-xs font-semibold hover:opacity-90 cursor-pointer"
                  >
                    සුරකින්න (Save Free Configuration)
                  </button>
                  {webhookSavedMsg && (
                    <p className="text-xs text-emerald-400 text-center">
                      {webhookSavedMsg}
                    </p>
                  )}
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
