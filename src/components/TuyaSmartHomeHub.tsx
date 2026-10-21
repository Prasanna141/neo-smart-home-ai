import React, { useEffect, useState } from 'react';
import {
  Blinds,
  BookOpen,
  Briefcase,
  Check,
  Copy,
  ExternalLink,
  Film,
  Lightbulb,
  Lock,
  Plus,
  Power,
  RefreshCw,
  ShieldCheck,
  Sun,
  Thermometer,
  Trash2,
  Unlock,
  Zap,
} from 'lucide-react';
import { TuyaCategory, TuyaDevice, TuyaScene } from '../types';

interface TuyaSmartHomeHubProps {
  devices: TuyaDevice[];
  scenes: TuyaScene[];
  lastTuyaSyncInfo: string | null;
  isSyncingCloud: boolean;
  onSyncFromCloud: () => void;
  onToggleDevice: (id: string) => void;
  onUpdateDeviceDp: (id: string, key: string, value: any) => void;
  onDeleteDevice: (id: string) => void;
  onActivateScene: (sceneId: string) => void;
  onAddDevice: (
    name: string,
    sinhalaName: string,
    room: string,
    category: TuyaCategory,
    tuyaDeviceId: string
  ) => void;
}

export const TuyaSmartHomeHub: React.FC<TuyaSmartHomeHubProps> = ({
  devices,
  scenes,
  lastTuyaSyncInfo,
  isSyncingCloud,
  onSyncFromCloud,
  onToggleDevice,
  onUpdateDeviceDp,
  onDeleteDevice,
  onActivateScene,
  onAddDevice,
}) => {
  const [selectedRoom, setSelectedRoom] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [cloudStatus, setCloudStatus] = useState<{
    configured: boolean;
    endpoint: string;
    mode: string;
  } | null>(null);

  const [devName, setDevName] = useState('');
  const [devSinhalaName, setDevSinhalaName] = useState('');
  const [devRoom, setDevRoom] = useState('Living Room');
  const [devCategory, setDevCategory] = useState<TuyaCategory>('dj');
  const [devTuyaId, setDevTuyaId] = useState('');

  useEffect(() => {
    fetch('/api/tuya/status')
      .then((r) => r.json())
      .then((data) => setCloudStatus(data))
      .catch(() => {});
  }, []);

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedKey(label);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  // Build room list dynamically from the user's actual devices
  const dynamicRooms = Array.from(new Set(devices.map((d) => d.room)));
  const rooms = ['all', ...dynamicRooms];

  const filteredDevices =
    selectedRoom === 'all'
      ? devices
      : devices.filter((d) => d.room.toLowerCase() === selectedRoom.toLowerCase());

  const totalWatts = devices.reduce(
    (acc, d) => acc + (d.isOn ? d.dps.cur_power || 0 : 0),
    0
  );
  const activeCount = devices.filter((d) => d.isOn).length;

  const handleCreateDevice = (e: React.FormEvent) => {
    e.preventDefault();
    if (!devName.trim() || !devTuyaId.trim()) return;
    onAddDevice(
      devName.trim(),
      devSinhalaName.trim() || devName.trim(),
      devRoom.trim() || 'Smart Home',
      devCategory,
      devTuyaId.trim()
    );
    setDevName('');
    setDevSinhalaName('');
    setDevTuyaId('');
    setShowAddModal(false);
  };

  const renderSceneIcon = (iconName: string) => {
    switch (iconName) {
      case 'Sun':
        return <Sun className="h-4 w-4 text-amber-400" />;
      case 'Briefcase':
        return <Briefcase className="h-4 w-4 text-sky-400" />;
      case 'Film':
        return <Film className="h-4 w-4 text-purple-400" />;
      default:
        return <ShieldCheck className="h-4 w-4 text-emerald-400" />;
    }
  };

  return (
    <div className="space-y-5 rounded-xl border border-slate-800/90 bg-[#0F1623] p-5">
      {/* Header & Power Telemetry */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/70 pb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-100">
            My Connected Tuya Smart Devices (මගේ පවතින ස්මාර්ට් උපාංග)
          </h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>
              {cloudStatus?.configured
                ? 'Tuya Cloud Connected'
                : 'Awaiting Tuya Cloud Sync / Device Link'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-slate-300 tabular-nums">
              {activeCount}/{devices.length} Active
            </span>
            {devices.length > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-amber-400 tabular-nums">
                  {totalWatts} W Load
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onSyncFromCloud}
            disabled={isSyncingCloud}
            className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isSyncingCloud ? 'animate-spin' : ''}`}
            />
            <span>
              {isSyncingCloud ? 'Syncing Cloud...' : 'Sync from Tuya Cloud'}
            </span>
          </button>

          <button
            onClick={() => setShowAddModal((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/90 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5 text-sky-400" />
            <span>Add My Device ID</span>
          </button>

          <button
            onClick={() => setShowGuideModal((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              showGuideModal
                ? 'border-sky-500/50 bg-sky-500/15 text-sky-300'
                : 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'
            }`}
          >
            <BookOpen className="h-3.5 w-3.5 text-sky-400" />
            <span>Tuya Keys ගන්නේ කොහොමද?</span>
          </button>
        </div>
      </div>

      {/* Step-by-Step Sinhala Guide for TUYA_ACCESS_ID, TUYA_ACCESS_SECRET, TUYA_API_ENDPOINT */}
      {showGuideModal && (
        <div className="space-y-4 rounded-xl border border-sky-500/30 bg-slate-900/95 p-4 text-xs leading-relaxed text-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
            <div>
              <h3 className="text-sm font-semibold text-sky-300">
                TUYA_ACCESS_ID, TUYA_ACCESS_SECRET සහ TUYA_API_ENDPOINT ලබාගන්නා පියවර
              </h3>
              <p className="text-slate-400">
                Tuya IoT Development Platform හරහා ඔබේ නිවසේ පවතින සැබෑ Tuya / Smart Life උපාංග පමණක් සම්බන්ධ කරන ආකාරය
              </p>
            </div>
            <a
              href="https://iot.tuya.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md bg-sky-500/20 px-2.5 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/30 whitespace-nowrap shrink-0"
            >
              <span>Open iot.tuya.com</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <ol className="space-y-2.5 text-slate-300 list-decimal list-inside">
            <li>
              <strong className="text-slate-100">Tuya IoT ගිණුමක් සාදන්න:</strong>{' '}
              <span className="font-mono text-sky-300">https://iot.tuya.com</span> වෙත පිවිස නොමිලේ Developer ගිණුමක් සාදා Log වන්න.
            </li>
            <li>
              <strong className="text-slate-100">Cloud Project එකක් සාදන්න:</strong>{' '}
              වම් පස මෙනුවෙන් <span className="font-mono text-slate-100">Cloud → Development → Create Cloud Project</span> තෝරන්න. Industry ලෙස <span className="text-sky-300">Smart Home</span> ද, Data Center ලෙස ශ්‍රී ලංකාවට අදාළව <span className="text-emerald-300">India Data Center</span> තෝරන්න.
            </li>
            <li>
              <strong className="text-slate-100">
                TUYA_ACCESS_ID සහ TUYA_ACCESS_SECRET ලබාගන්න:
              </strong>{' '}
              Project එකෙහි <span className="font-mono text-slate-100">Overview</span> ටැබ් එකෙහි <span className="font-mono text-slate-100">Authorization Key</span> කොටසේ ඇති Access ID සහ Access Secret ලබාගන්න.
            </li>
            <li>
              <strong className="text-slate-100">TUYA_API_ENDPOINT තෝරන්න:</strong>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[
                  {
                    region: 'India Data Center (Sri Lanka Default)',
                    url: 'https://openapi.tuyain.com',
                  },
                  {
                    region: 'Central Europe Data Center',
                    url: 'https://openapi.tuyaeu.com',
                  },
                  {
                    region: 'Western America Data Center',
                    url: 'https://openapi.tuyaus.com',
                  },
                  {
                    region: 'China Data Center',
                    url: 'https://openapi.tuyacn.com',
                  },
                ].map((ep) => (
                  <div
                    key={ep.url}
                    className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1.5"
                  >
                    <div className="min-w-0 pr-2">
                      <p className="text-[11px] text-slate-400 truncate">{ep.region}</p>
                      <p className="font-mono text-xs text-sky-300 truncate">{ep.url}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyText(ep.url, ep.url)}
                      className="rounded border border-slate-700 bg-slate-800 p-1 text-slate-300 hover:text-white cursor-pointer"
                      title="Copy Endpoint URL"
                    >
                      {copiedKey === ep.url ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </li>
            <li>
              <strong className="text-slate-100">
                ඔබේ පවතින උපාංග Sync කරන්න:
              </strong>{' '}
              AI Studio හි <span className="font-mono text-sky-300">Settings → Secrets</span> තුළ එම අගයන් තුන Save කර ඉහත <span className="font-semibold text-sky-300">"Sync from Tuya Cloud"</span> බොත්තම ඔබන්න. එවිට ඔබගේ නිවසේ පවතින සැබෑ උපාංග පමණක් ස්වයංක්‍රීයව මෙහි පෙන්වයි.
            </li>
          </ol>
        </div>
      )}

      {/* Add Existing Tuya Device Form */}
      {showAddModal && (
        <form
          onSubmit={handleCreateDevice}
          className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/90 p-4"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200">
              Add Your Real Tuya Smart Device (ඔබේ පවතින උපාංගයක් එක් කරන්න)
            </span>
            <span className="font-mono text-xs text-slate-400">
              Requires Real Tuya Device ID
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <input
              type="text"
              placeholder="Tuya Device ID (e.g. bf91c482...)"
              value={devTuyaId}
              onChange={(e) => setDevTuyaId(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
              required
            />
            <input
              type="text"
              placeholder="Device Name (e.g. Living Room Light)"
              value={devName}
              onChange={(e) => setDevName(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
              required
            />
            <input
              type="text"
              placeholder="Sinhala Name (e.g. සාලයේ විදුලි පහන)"
              value={devSinhalaName}
              onChange={(e) => setDevSinhalaName(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
            />
            <input
              type="text"
              placeholder="Room (e.g. Living Room / සාලය)"
              value={devRoom}
              onChange={(e) => setDevRoom(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
            />
            <select
              value={devCategory}
              onChange={(e) => setDevCategory(e.target.value as TuyaCategory)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
            >
              <option value="dj">Smart Light (dj)</option>
              <option value="kt">Air Conditioner (kt)</option>
              <option value="cz">Smart Plug / Switch (cz)</option>
              <option value="cl">Smart Curtain (cl)</option>
              <option value="ms">Smart Door Lock (ms)</option>
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAddModal(false)}
              className="rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-sky-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 cursor-pointer"
            >
              Save My Device
            </button>
          </div>
        </form>
      )}

      {lastTuyaSyncInfo && (
        <div className="flex items-center justify-between rounded-lg border border-slate-800/80 bg-slate-900/50 px-3.5 py-2 text-xs text-slate-300">
          <span>Tuya Status:</span>
          <span className="font-mono text-sky-400">{lastTuyaSyncInfo}</span>
        </div>
      )}

      {/* Empty State when no devices are linked yet */}
      {devices.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-800/80 bg-slate-950/60 px-6 py-10 text-center">
          <Zap className="mb-3 h-9 w-9 text-sky-400/80" />
          <h3 className="text-sm font-semibold text-slate-100">
            ඔබේ පවතින ස්මාර්ට් උපාංග පමණක් මෙහි පෙන්වයි (Only Your Real Devices Are Shown)
          </h3>
          <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-400">
            කිසිදු ව්‍යාජ (Demo) උපාංගයක් මෙහි ඇතුළත් කර නැත. ඔබගේ Tuya Cloud ගිණුමෙන් උපාංග ලබාගැනීමට{' '}
            <strong className="text-slate-200">Sync from Tuya Cloud</strong> ඔබන්න, නැතහොත්{' '}
            <strong className="text-slate-200">Add My Device ID</strong> මඟින් ඔබගේ උපාංගය එක් කරන්න.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={onSyncFromCloud}
              disabled={isSyncingCloud}
              className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 transition-colors cursor-pointer"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isSyncingCloud ? 'animate-spin' : ''}`}
              />
              <span>Sync My Real Devices from Tuya Cloud</span>
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5 text-sky-400" />
              <span>Add My Device ID Manually</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Tuya Smart Automation Scenes (only shown when user has devices) */}
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">
                Smart Scenes for Connected Devices · ස්වයංක්‍රීය අවස්ථා
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {scenes.map((scene) => (
                <button
                  key={scene.id}
                  onClick={() => onActivateScene(scene.id)}
                  className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-left transition-colors hover:border-sky-500/50 hover:bg-slate-900 cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-100">
                      {scene.name}
                    </span>
                    {renderSceneIcon(scene.icon)}
                  </div>
                  <span className="mt-1 text-xs text-sky-400/90">
                    {scene.sinhalaName}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Room Filter Bar */}
          {rooms.length > 1 && (
            <div className="flex items-center gap-1 overflow-x-auto rounded-lg bg-slate-900/90 p-1">
              {rooms.map((room) => (
                <button
                  key={room}
                  onClick={() => setSelectedRoom(room)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    selectedRoom === room
                      ? 'bg-slate-800 text-sky-400 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {room === 'all' ? 'All My Devices' : room}
                </button>
              ))}
            </div>
          )}

          {/* Connected Devices Grid */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {filteredDevices.map((device) => (
              <div
                key={device.id}
                className={`flex flex-col justify-between rounded-lg border p-3.5 transition-colors ${
                  device.isOn
                    ? 'border-sky-500/35 bg-slate-900/90'
                    : 'border-slate-800/80 bg-slate-950/60'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span>{device.room}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-[11px] text-slate-500">
                        ID: {device.tuyaDeviceId}
                      </span>
                    </div>
                    <h3 className="mt-1 text-sm font-semibold text-slate-100 truncate">
                      {device.name}
                    </h3>
                    <p className="text-xs text-slate-400 truncate">
                      {device.sinhalaName}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => onToggleDevice(device.id)}
                      aria-label={`Toggle ${device.name}`}
                      className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors cursor-pointer ${
                        device.isOn
                          ? 'border-sky-400/50 bg-sky-500 text-slate-950 hover:bg-sky-400'
                          : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {device.category === 'ms' ? (
                        device.isOn ? (
                          <Lock className="h-4 w-4" />
                        ) : (
                          <Unlock className="h-4 w-4" />
                        )
                      ) : (
                        <Power className="h-4 w-4" />
                      )}
                    </button>

                    <button
                      onClick={() => onDeleteDevice(device.id)}
                      aria-label={`Remove ${device.name}`}
                      title="Remove device"
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Category-Specific Tuya Data Point Controls */}
                <div className="mt-3 border-t border-slate-800/70 pt-2.5">
                  {device.category === 'dj' && (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5 text-xs text-slate-300">
                        <Lightbulb className="h-3.5 w-3.5 text-amber-400" />
                        <span className="font-mono tabular-nums">
                          Brightness: {device.dps.bright_value ?? 80}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={10}
                        max={100}
                        value={device.dps.bright_value ?? 80}
                        onChange={(e) =>
                          onUpdateDeviceDp(
                            device.id,
                            'bright_value',
                            Number(e.target.value)
                          )
                        }
                        className="h-1.5 w-28 accent-sky-400 cursor-pointer"
                      />
                    </div>
                  )}

                  {device.category === 'kt' && (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5 text-xs text-slate-300">
                        <Thermometer className="h-3.5 w-3.5 text-sky-400" />
                        <span className="font-mono tabular-nums">
                          Target: {device.dps.temp_set ?? 24}°C
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() =>
                            onUpdateDeviceDp(
                              device.id,
                              'temp_set',
                              Math.max(16, (device.dps.temp_set ?? 24) - 1)
                            )
                          }
                          className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-200 hover:bg-slate-700 cursor-pointer"
                        >
                          -
                        </button>
                        <button
                          onClick={() =>
                            onUpdateDeviceDp(
                              device.id,
                              'temp_set',
                              Math.min(30, (device.dps.temp_set ?? 24) + 1)
                            )
                          }
                          className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-200 hover:bg-slate-700 cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  )}

                  {device.category === 'cl' && (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5 text-xs text-slate-300">
                        <Blinds className="h-3.5 w-3.5 text-sky-400" />
                        <span className="font-mono tabular-nums">
                          Curtain Open: {device.dps.percent_control ?? 75}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={device.dps.percent_control ?? 75}
                        onChange={(e) =>
                          onUpdateDeviceDp(
                            device.id,
                            'percent_control',
                            Number(e.target.value)
                          )
                        }
                        className="h-1.5 w-28 accent-sky-400 cursor-pointer"
                      />
                    </div>
                  )}

                  {device.category === 'cz' && (
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span className="flex items-center gap-1.5">
                        <Zap className="h-3.5 w-3.5 text-amber-400" />
                        <span>Smart Switch State</span>
                      </span>
                      <span className="font-mono text-slate-300 tabular-nums">
                        {device.isOn ? 'ON' : 'OFF'}
                      </span>
                    </div>
                  )}

                  {device.category === 'ms' && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Door Lock Status</span>
                      <span
                        className={`font-mono font-medium ${
                          device.isOn ? 'text-emerald-400' : 'text-amber-400'
                        }`}
                      >
                        {device.isOn ? 'LOCKED' : 'UNLOCKED'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
