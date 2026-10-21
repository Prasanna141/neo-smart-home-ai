import React, { useState } from 'react';
import {
  ExternalLink,
  Music,
  Newspaper,
  Pause,
  Play,
  RefreshCw,
  SkipBack,
  SkipForward,
  Volume2,
} from 'lucide-react';
import { MusicTrack, NewsArticle } from '../types';

interface MediaAndNewsDeckProps {
  tracks: MusicTrack[];
  currentTrack: MusicTrack;
  isPlaying: boolean;
  volume: number;
  isDucked: boolean;
  news: NewsArticle[];
  groundingLinks: { title: string; url: string }[];
  isLoadingNews: boolean;
  onTogglePlay: () => void;
  onSelectTrack: (track: MusicTrack) => void;
  onNextTrack: () => void;
  onPrevTrack: () => void;
  onVolumeChange: (val: number) => void;
  onFetchNewsTopic: (topic: string) => void;
  onReadNewsAloud: (article?: NewsArticle, mode?: 'summary' | 'full') => void;
}

export const MediaAndNewsDeck: React.FC<MediaAndNewsDeckProps> = ({
  tracks,
  currentTrack,
  isPlaying,
  volume,
  isDucked,
  news,
  groundingLinks,
  isLoadingNews,
  onTogglePlay,
  onSelectTrack,
  onNextTrack,
  onPrevTrack,
  onVolumeChange,
  onFetchNewsTopic,
  onReadNewsAloud,
}) => {
  const [selectedTopic, setSelectedTopic] = useState('Sri Lanka Latest News today');
  const [expandedArticleId, setExpandedArticleId] = useState<string | null>(null);

  const topics = [
    { label: 'Sri Lanka (ශ්‍රී ලංකා)', query: 'Sri Lanka Latest News today' },
    { label: 'Tech & AI', query: 'Global Technology and AI News today' },
    { label: 'Weather (කාලගුණය)', query: 'Sri Lanka Weather Forecast today' },
    { label: 'Cricket & Sports', query: 'Sri Lanka Cricket and World Sports News' },
  ];

  const handleTopicClick = (query: string) => {
    setSelectedTopic(query);
    onFetchNewsTopic(query);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Music Synthesizer Deck */}
      <div className="flex flex-col justify-between rounded-xl border border-slate-800/90 bg-[#0F1623] p-5">
        <div>
          <div className="flex items-center justify-between gap-3 border-b border-slate-800/70 pb-3.5">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Smart Home Audio & Music Deck
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                සිංදු සහ සංගීත වාදනය · Auto-ducks when you say "Neo"
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono text-sky-400 tabular-nums">
              <Music className="h-4 w-4" />
              <span>{currentTrack.tempo} BPM</span>
            </div>
          </div>

          {/* Now Playing Spotlight */}
          <div className="my-3.5 rounded-lg border border-slate-800 bg-slate-900/90 p-4">
            <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
              <span>{currentTrack.genre}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">
                {isDucked
                  ? 'Volume Ducked for Neo Voice'
                  : isPlaying
                  ? 'Playing via WebAudio Synth'
                  : 'Paused'}
              </span>
            </div>
            <h3 className="mt-1 text-base font-bold text-slate-100 truncate">
              {currentTrack.title}
            </h3>
            <p className="text-xs text-sky-400 truncate">
              {currentTrack.sinhalaTitle} · {currentTrack.artist}
            </p>

            {/* Transport & Volume Controls */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={onPrevTrack}
                  aria-label="Previous track"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  <SkipBack className="h-4 w-4" />
                </button>
                <button
                  onClick={onTogglePlay}
                  aria-label={isPlaying ? 'Pause music' : 'Play music'}
                  className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500 text-slate-950 hover:bg-sky-400 transition-colors cursor-pointer"
                >
                  {isPlaying ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </button>
                <button
                  onClick={onNextTrack}
                  aria-label="Next track"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  <SkipForward className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <Volume2 className="h-4 w-4 text-slate-400" />
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(volume * 100)}
                  onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
                  className="h-1.5 w-24 accent-sky-400 cursor-pointer"
                />
                <span className="w-8 font-mono text-xs text-slate-300 tabular-nums">
                  {Math.round(volume * 100)}%
                </span>
              </div>
            </div>
          </div>

          {/* Track Queue */}
          <div className="space-y-1.5">
            {tracks.map((track) => {
              const active = track.id === currentTrack.id;
              return (
                <button
                  key={track.id}
                  onClick={() => onSelectTrack(track)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors cursor-pointer ${
                    active
                      ? 'border-sky-500/40 bg-sky-500/10 text-slate-100'
                      : 'border-slate-800/70 bg-slate-950/50 text-slate-300 hover:bg-slate-900'
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <p className="text-xs font-semibold truncate">{track.title}</p>
                    <p className="text-[11px] text-slate-400 truncate">
                      {track.sinhalaTitle}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-slate-400 tabular-nums">
                    {track.genre}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Live Interactive News & Grounded Information */}
      <div className="flex flex-col justify-between rounded-xl border border-slate-800/90 bg-[#0F1623] p-5">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/70 pb-3.5">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Interactive Live News (මාතෘකා → සාරාංශය → වැඩි විස්තර)
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                "අද ලංකාවේ ප්‍රවෘත්ති මොනවද?" කියා Neo ගෙන් අසන්න
              </p>
            </div>

            <div className="flex items-center gap-2">
              {news.length > 0 && (
                <button
                  onClick={() => onReadNewsAloud()}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Volume2 className="h-3.5 w-3.5 text-sky-400" />
                  <span>Read Headlines</span>
                </button>
              )}
              <button
                onClick={() => onFetchNewsTopic(selectedTopic)}
                disabled={isLoadingNews}
                className="flex items-center gap-1 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${isLoadingNews ? 'animate-spin' : ''}`}
                />
                <span>{isLoadingNews ? 'Searching Web...' : 'Search Today’s News'}</span>
              </button>
            </div>
          </div>

          {/* Topic Filter Buttons */}
          <div className="my-3 flex items-center gap-1 overflow-x-auto rounded-lg bg-slate-900/90 p-1">
            {topics.map((t) => (
              <button
                key={t.query}
                onClick={() => handleTopicClick(t.query)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  selectedTopic === t.query
                    ? 'bg-slate-800 text-sky-400 shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* News Articles */}
          <div className="space-y-2.5">
            {news.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-slate-800/70 bg-slate-950/50 px-5 py-8 text-center">
                <Newspaper className="mb-2 h-8 w-8 text-sky-400/70" />
                <p className="text-xs font-semibold text-slate-200">
                  අන්තර්ජාලයෙන් සජීවී පුවත් ලබාගැනීමට සූදානම්
                </p>
                <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-400">
                  "Neo, අද දවසේ ලංකාවේ ප්‍රවෘත්ති මොනවද?" කියා අසන්න. එවිට Neo ප්‍රධාන මාතෘකා කියා ඔබට අවශ්‍ය පුවතේ සාරාංශය සහ වැඩි විස්තර පියවරෙන් පියවර කියයි.
                </p>
              </div>
            ) : (
              news.map((item, idx) => {
                const isExpanded = expandedArticleId === item.id;
                const num = item.indexNumber || idx + 1;
                return (
                  <div
                    key={item.id}
                    className="rounded-lg border border-slate-800 bg-slate-900/75 p-3.5 transition-colors hover:border-slate-700"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-sky-400 tabular-nums">
                          #{num}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{item.source}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {item.publishedAt}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onReadNewsAloud(item, 'summary')}
                          className="text-xs font-medium text-sky-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          සාරාංශය (Summary)
                        </button>
                        <span aria-hidden="true" className="text-slate-600">
                          ·
                        </span>
                        <button
                          onClick={() => {
                            setExpandedArticleId(isExpanded ? null : item.id);
                            onReadNewsAloud(item, 'full');
                          }}
                          className="text-xs font-medium text-emerald-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          වැඩි විස්තර (Full Details)
                        </button>
                      </div>
                    </div>

                    <h3 className="mt-1.5 text-sm font-semibold text-slate-100">
                      {num}. {item.headline}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-slate-300">
                      {item.summary}
                    </p>

                    {isExpanded && item.fullDetails && (
                      <div className="mt-2.5 border-t border-slate-800 pt-2 text-xs leading-relaxed text-slate-200">
                        <span className="font-semibold text-emerald-400">
                          වැඩි විස්තර:{' '}
                        </span>
                        {item.fullDetails}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Grounding Citations if any */}
          {groundingLinks.length > 0 && (
            <div className="mt-3 border-t border-slate-800/70 pt-2.5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>Sources:</span>
                {groundingLinks.slice(0, 3).map((link, idx) => (
                  <React.Fragment key={link.url + idx}>
                    {idx > 0 && <span aria-hidden="true">·</span>}
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sky-400 hover:underline truncate max-w-[180px]"
                    >
                      <span>{link.title}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
