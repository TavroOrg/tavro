/**
 * AppLogger — structured singleton logger for Tavro ARM.
 *
 * Captures MCP tool calls, HTTP requests/responses, errors, and
 * general info/warn events. Keeps a ring buffer of MAX_ENTRIES and
 * notifies reactive subscribers (e.g. DevLogPanel) on every new entry.
 */

export type LogLevel = 'info' | 'warn' | 'error' | 'tool_call' | 'request' | 'response';

export interface LogEntry {
    id: string;
    timestamp: Date;
    level: LogLevel;
    label: string;
    detail?: unknown;          // JSON-serialisable payload (args, response body, etc.)
    durationMs?: number;       // optional: for request/response pairs
}

type Subscriber = (entries: LogEntry[]) => void;

const MAX_ENTRIES = 500;

class Logger {
    private entries: LogEntry[] = [];
    private subscribers: Set<Subscriber> = new Set();
    private counter = 0;

    // ── Write API ──────────────────────────────────────────────────────────────

    private add(level: LogLevel, label: string, detail?: unknown, durationMs?: number): LogEntry {
        const entry: LogEntry = {
            id: `log-${++this.counter}-${Date.now()}`,
            timestamp: new Date(),
            level,
            label,
            detail,
            durationMs,
        };

        this.entries.push(entry);
        if (this.entries.length > MAX_ENTRIES) {
            this.entries.shift(); // evict oldest
        }

        this.notify();
        return entry;
    }

    info(label: string, detail?: unknown) { return this.add('info', label, detail); }
    warn(label: string, detail?: unknown) { return this.add('warn', label, detail); }
    error(label: string, detail?: unknown) { return this.add('error', label, detail); }
    tool(label: string, detail?: unknown) { return this.add('tool_call', label, detail); }
    req(label: string, detail?: unknown) { return this.add('request', label, detail); }
    res(label: string, detail?: unknown, durationMs?: number) {
        return this.add('response', label, detail, durationMs);
    }

    // ── Read API ───────────────────────────────────────────────────────────────

    getAll(): LogEntry[] {
        return [...this.entries];
    }

    clear() {
        this.entries = [];
        this.notify();
    }

    // ── Subscription ───────────────────────────────────────────────────────────

    subscribe(cb: Subscriber): () => void {
        this.subscribers.add(cb);
        // Immediately deliver current state
        cb([...this.entries]);
        return () => this.subscribers.delete(cb);
    }

    private notify() {
        const snapshot = [...this.entries];
        this.subscribers.forEach(cb => cb(snapshot));
    }
}

/** Global singleton — import this everywhere. */
export const appLogger = new Logger();
