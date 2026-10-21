import React, { useState } from 'react';
import { Bell, CalendarCheck, CheckCircle2, Circle, Plus, Trash2, Volume2 } from 'lucide-react';
import { ScheduleItem } from '../types';

interface DailyPlannerPanelProps {
  schedule: ScheduleItem[];
  onToggleTask: (id: string) => void;
  onAddTask: (
    title: string,
    sinhalaTitle: string,
    time: string,
    category: ScheduleItem['category'],
    priority: ScheduleItem['priority']
  ) => void;
  onDeleteTask: (id: string) => void;
  onReadScheduleAloud: () => void;
}

export const DailyPlannerPanel: React.FC<DailyPlannerPanelProps> = ({
  schedule,
  onToggleTask,
  onAddTask,
  onDeleteTask,
  onReadScheduleAloud,
}) => {
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [sinhalaTitle, setSinhalaTitle] = useState('');
  const [time, setTime] = useState('17:00');
  const [category, setCategory] = useState<ScheduleItem['category']>('reminder');
  const [priority, setPriority] = useState<ScheduleItem['priority']>('normal');

  const sortedSchedule = [...schedule].sort((a, b) => a.time.localeCompare(b.time));
  const visibleItems = sortedSchedule.filter((item) => {
    if (filter === 'pending') return !item.completed;
    if (filter === 'completed') return item.completed;
    return true;
  });

  const pendingCount = schedule.filter((s) => !s.completed).length;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onAddTask(
      title.trim(),
      sinhalaTitle.trim() || title.trim(),
      time,
      category,
      priority
    );
    setTitle('');
    setSinhalaTitle('');
    setShowAdd(false);
  };

  return (
    <div className="flex flex-col justify-between rounded-xl border border-slate-800/90 bg-[#0F1623] p-5">
      <div>
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/70 pb-3.5">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Daily Planner & Smart Reminders
            </h2>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
              <span>දෛනික කටයුතු සහ සිහිකැඳවීම්</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-sky-400 tabular-nums">
                {pendingCount} Pending
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onReadScheduleAloud}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              title="Have Neo read your daily plan aloud"
            >
              <Volume2 className="h-3.5 w-3.5 text-sky-400" />
              <span>Voice Briefing</span>
            </button>

            <button
              onClick={() => setShowAdd((v) => !v)}
              className="flex items-center gap-1 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Task</span>
            </button>
          </div>
        </div>

        {/* Add Task Form */}
        {showAdd && (
          <form
            onSubmit={handleSubmit}
            className="my-3 space-y-2.5 rounded-lg border border-slate-800 bg-slate-900/90 p-3.5"
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                type="text"
                placeholder="Task or Reminder (e.g. Call Doctor)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                required
              />
              <input
                type="text"
                placeholder="Sinhala note (e.g. වෛද්‍යවරයා ඇමතීම)"
                value={sinhalaTitle}
                onChange={(e) => setSinhalaTitle(e.target.value)}
                className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
              />
              <select
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as ScheduleItem['category'])
                }
                className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
              >
                <option value="reminder">Reminder</option>
                <option value="work">Work</option>
                <option value="home">Smart Home</option>
                <option value="routine">Daily Routine</option>
              </select>
              <select
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as ScheduleItem['priority'])
                }
                className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
              >
                <option value="high">High Priority</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-md bg-sky-500 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-sky-400 cursor-pointer"
              >
                Save Reminder
              </button>
            </div>
          </form>
        )}

        {/* Filter Bar */}
        <div className="my-3 flex items-center gap-1 rounded-lg bg-slate-900/90 p-1">
          {(['all', 'pending', 'completed'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`flex-1 rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors cursor-pointer ${
                filter === tab
                  ? 'bg-slate-800 text-sky-400 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Task List */}
        <div className="space-y-2">
          {visibleItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-slate-800/60 bg-slate-950/40 py-8 text-center">
              <CalendarCheck className="mb-2 h-7 w-7 text-slate-600" />
              <p className="text-xs font-medium text-slate-300">
                No tasks in this view
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Say "Neo, remind me at 5 PM to..." or click Add Task above.
              </p>
            </div>
          ) : (
            visibleItems.map((item) => (
              <div
                key={item.id}
                className={`flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 transition-colors ${
                  item.completed
                    ? 'border-slate-800/50 bg-slate-950/40 opacity-65'
                    : 'border-slate-800 bg-slate-900/75 hover:border-slate-700'
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    onClick={() => onToggleTask(item.id)}
                    className="shrink-0 text-slate-400 hover:text-sky-400 transition-colors cursor-pointer"
                    aria-label={`Mark ${item.title} ${
                      item.completed ? 'incomplete' : 'complete'
                    }`}
                  >
                    {item.completed ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <Circle className="h-4 w-4" />
                    )}
                  </button>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span className="font-mono font-semibold text-sky-400 tabular-nums">
                        {item.time}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="capitalize">{item.category}</span>
                      {item.priority === 'high' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="flex items-center gap-1 text-amber-400">
                            <Bell className="h-3 w-3" />
                            High Priority
                          </span>
                        </>
                      )}
                    </div>
                    <p
                      className={`mt-0.5 text-sm font-medium truncate ${
                        item.completed
                          ? 'line-through text-slate-500'
                          : 'text-slate-100'
                      }`}
                    >
                      {item.title}
                    </p>
                    {item.sinhalaTitle && item.sinhalaTitle !== item.title && (
                      <p className="text-xs text-slate-400 truncate">
                        {item.sinhalaTitle}
                      </p>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => onDeleteTask(item.id)}
                  aria-label="Delete task"
                  className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-rose-400 transition-colors cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
