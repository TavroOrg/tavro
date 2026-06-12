export interface PortalActivityItem {
  id: string;
  text: string;
  timestamp: number;
  dot: 'violet' | 'emerald' | 'amber';
}

const STORAGE_KEY = 'tavro_portal_activity';
const MAX_ITEMS = 40;

function read(): PortalActivityItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(items: PortalActivityItem[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
}

export const portalActivity = {
  list(limit = 4): PortalActivityItem[] {
    return read().filter(item => !item.text.startsWith('Viewed ')).slice(0, limit);
  },

  record(text: string, dot: PortalActivityItem['dot'] = 'violet'): PortalActivityItem[] {
    const trimmed = text.trim();
    if (!trimmed) return read();

    const timestamp = Date.now();
    const existing = read();
    const recentDuplicate = existing[0]?.text === trimmed && timestamp - existing[0].timestamp < 5000;
    if (recentDuplicate) return existing;

    const next = [
      {
        id: `${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
        text: trimmed,
        timestamp,
        dot,
      },
      ...existing,
    ];
    write(next);
    window.dispatchEvent(new CustomEvent('tavro:portal-activity-changed'));
    return next;
  },

  formatTime(timestamp: number): string {
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    const weeks = Math.floor(days / 7);
    return `${weeks}w ago`;
  },
};
