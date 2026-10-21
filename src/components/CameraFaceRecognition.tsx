import React, { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, ScanFace, Sparkles, UserCheck, UserPlus } from 'lucide-react';
import { FaceDetectionResult, HouseholdMember } from '../types';

interface CameraFaceRecognitionProps {
  householdMembers: HouseholdMember[];
  recognizedMember: HouseholdMember | null;
  lastDetection: FaceDetectionResult | null;
  isScanning: boolean;
  autoExecuteOnFace: boolean;
  onToggleAutoExecute: () => void;
  onScanFrame: (base64Frame: string) => void;
  onEnrollMember: (name: string, sinhalaName: string, greetingSceneId: string, favoriteGenre: string, avatarDataUrl?: string) => void;
  onCaptureCurrentFrameRef?: (getter: () => string | null) => void;
}

export const CameraFaceRecognition: React.FC<CameraFaceRecognitionProps> = ({
  householdMembers,
  recognizedMember,
  lastDetection,
  isScanning,
  autoExecuteOnFace,
  onToggleAutoExecute,
  onScanFrame,
  onEnrollMember,
  onCaptureCurrentFrameRef,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [autoScanIntervalOn, setAutoScanIntervalOn] = useState(false);
  const [showEnrollForm, setShowEnrollForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSinhalaName, setNewSinhalaName] = useState('');
  const [newScene, setNewScene] = useState('morning-awakening');
  const [newGenre, setNewGenre] = useState('Sinhala Acoustic');

  const captureFrameBase64 = (): string | null => {
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas || !cameraActive || video.readyState < 2) return null;
    canvas.width = 480;
    canvas.height = 270;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.78);
  };

  useEffect(() => {
    if (onCaptureCurrentFrameRef) {
      onCaptureCurrentFrameRef(captureFrameBase64);
    }
  }, [cameraActive]);

  const startCamera = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 360 } },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch (err: any) {
      setCameraError(
        'Camera permission denied or unavailable. Enable camera access to use live face recognition.'
      );
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setAutoScanIntervalOn(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  useEffect(() => {
    if (!cameraActive || !autoScanIntervalOn) return;
    const timer = window.setInterval(() => {
      if (!isScanning) {
        const frame = captureFrameBase64();
        if (frame) onScanFrame(frame);
      }
    }, 20000);
    return () => clearInterval(timer);
  }, [cameraActive, autoScanIntervalOn, isScanning]);

  const handleManualScan = () => {
    const frame = captureFrameBase64();
    if (frame) {
      onScanFrame(frame);
    }
  };

  const handleEnrollSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const snapshot = captureFrameBase64() || undefined;
    onEnrollMember(
      newName.trim(),
      newSinhalaName.trim() || newName.trim(),
      newScene,
      newGenre,
      snapshot
    );
    setNewName('');
    setNewSinhalaName('');
    setShowEnrollForm(false);
  };

  return (
    <div className="flex flex-col justify-between rounded-xl border border-slate-800/90 bg-[#0F1623] p-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b border-slate-800/70 pb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">
            Biometric Camera & Face Recognition
          </h2>
          <p className="text-xs text-slate-400">
            මුහුණ හඳුනාගෙන ස්වයංක්‍රීයව නිවසේ උපාංග ක්‍රියා කරවීම
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => (cameraActive ? stopCamera() : startCamera())}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              cameraActive
                ? 'border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
                : 'bg-sky-500 text-slate-950 hover:bg-sky-400 font-semibold'
            }`}
          >
            {cameraActive ? (
              <>
                <CameraOff className="h-3.5 w-3.5" />
                <span>Stop Camera</span>
              </>
            ) : (
              <>
                <Camera className="h-3.5 w-3.5" />
                <span>Enable Camera</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Camera Viewport */}
      <div className="relative my-3 aspect-video w-full overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`h-full w-full object-cover scale-x-[-1] ${
            cameraActive ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <canvas ref={captureCanvasRef} className="hidden" />

        {!cameraActive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
            <ScanFace className="mb-2 h-10 w-10 text-slate-600" />
            <p className="text-xs font-medium text-slate-300">
              Neo Vision Sensor Standby
            </p>
            <p className="mt-1 max-w-xs text-xs text-slate-500">
              Enable the camera so Neo can recognize your face, detect your mood, and automatically run your room scene & reminders.
            </p>
            {cameraError && (
              <p className="mt-2 text-xs text-amber-400">{cameraError}</p>
            )}
          </div>
        )}

        {cameraActive && (
          <>
            {/* Face Reticle Guide */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className={`h-36 w-36 rounded-2xl border transition-colors ${
                  isScanning
                    ? 'border-amber-400/80'
                    : lastDetection?.detected
                    ? 'border-emerald-400/80'
                    : 'border-sky-400/40'
                }`}
              />
            </div>

            {/* Scrim at bottom for legibility */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-3">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-slate-200">
                  <UserCheck className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="font-medium">
                    {recognizedMember
                      ? `${recognizedMember.name} · ${recognizedMember.sinhalaName}`
                      : 'Ready to identify face'}
                  </span>
                </div>
                {lastDetection?.detected && (
                  <span className="font-mono text-emerald-300 tabular-nums">
                    {Math.round((lastDetection.confidence || 0.94) * 100)}% Match ·{' '}
                    {lastDetection.expression}
                  </span>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Controls & Recognition Result */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={handleManualScan}
              disabled={!cameraActive || isScanning}
              className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ScanFace className="h-3.5 w-3.5 text-sky-400" />
              <span>{isScanning ? 'Analyzing Face...' : 'Scan & Identify Now'}</span>
            </button>

            <button
              onClick={() => setAutoScanIntervalOn((v) => !v)}
              disabled={!cameraActive}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                autoScanIntervalOn
                  ? 'border border-sky-500/40 bg-sky-500/15 text-sky-300'
                  : 'border border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
              } disabled:opacity-40`}
            >
              {autoScanIntervalOn ? 'Auto-Scan: ON (20s)' : 'Auto-Scan: OFF'}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onToggleAutoExecute}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                autoExecuteOnFace
                  ? 'border border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                  : 'border border-slate-800 bg-slate-900 text-slate-400'
              }`}
              title="Automatically activate user's smart home scene and greeting when recognized"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Auto-Routine: {autoExecuteOnFace ? 'ON' : 'OFF'}</span>
            </button>

            <button
              onClick={() => setShowEnrollForm((v) => !v)}
              className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>Enroll Face</span>
            </button>
          </div>
        </div>

        {/* Enroll New Household Member Modal/Drawer */}
        {showEnrollForm && (
          <form
            onSubmit={handleEnrollSubmit}
            className="space-y-2.5 rounded-lg border border-slate-800 bg-slate-900/90 p-3"
          >
            <div className="flex items-center justify-between text-xs font-medium text-slate-200">
              <span>Register Household Face Profile</span>
              <span className="text-slate-400">Uses current camera snapshot</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                type="text"
                placeholder="Name (e.g. Nimal)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                required
              />
              <input
                type="text"
                placeholder="Sinhala Name (e.g. නිමල්)"
                value={newSinhalaName}
                onChange={(e) => setNewSinhalaName(e.target.value)}
                className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
              />
              <select
                value={newScene}
                onChange={(e) => setNewScene(e.target.value)}
                className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
              >
                <option value="morning-awakening">Scene: Morning Awakening</option>
                <option value="deep-focus">Scene: Work & Study Focus</option>
                <option value="cinema-night">Scene: Cinema & Relax</option>
                <option value="night-guard">Scene: Goodnight Security</option>
              </select>
              <select
                value={newGenre}
                onChange={(e) => setNewGenre(e.target.value)}
                className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
              >
                <option value="Sinhala Acoustic">Music: Sinhala Acoustic</option>
                <option value="Lo-Fi Focus">Music: Lo-Fi Focus</option>
                <option value="Meditation & Calm">Music: Bamboo Flute Calm</option>
                <option value="Ambient Synth">Music: Ambient Synth</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowEnrollForm(false)}
                className="rounded-md px-3 py-1 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-md bg-sky-500 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-sky-400 cursor-pointer"
              >
                Save Face Profile
              </button>
            </div>
          </form>
        )}

        {/* Enrolled Profiles & Latest Vision Insights */}
        <div className="flex items-center justify-between border-t border-slate-800/70 pt-2.5 text-xs text-slate-400">
          <div className="flex items-center gap-2 overflow-x-auto">
            <span>Profiles:</span>
            {householdMembers.map((m, idx) => (
              <React.Fragment key={m.id}>
                {idx > 0 && <span aria-hidden="true">·</span>}
                <span
                  className={
                    recognizedMember?.id === m.id
                      ? 'font-semibold text-sky-400'
                      : 'text-slate-300'
                  }
                >
                  {m.name}
                </span>
              </React.Fragment>
            ))}
          </div>
          {lastDetection?.activityContext && (
            <span className="font-mono text-slate-300 truncate max-w-[180px]">
              {lastDetection.activityContext}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
