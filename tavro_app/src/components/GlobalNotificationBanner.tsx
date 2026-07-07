import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Ban, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

type BannerVariant = 'error' | 'warning' | 'success' | 'info';

type BannerItem = {
    id: number;
    message: string;
    variant: BannerVariant;
};

const MAX_VISIBLE = 3;

const AUTO_DISMISS_MS: Record<BannerVariant, number | null> = {
    success: 10000,
    info: 5000,
    warning: 10000,
    error: null,
};

const VARIANT_CONFIG: Record<BannerVariant, {
    bg: string;
    border: string;
    iconColor: string;
    textColor: string;
    icon: React.ReactNode;
}> = {
    error: {
        bg: 'bg-red-50',
        border: 'border-red-300',
        iconColor: 'text-red-500',
        textColor: 'text-red-800',
        icon: <Ban size={16} />,
    },
    warning: {
        bg: 'bg-amber-50',
        border: 'border-amber-300',
        iconColor: 'text-amber-500',
        textColor: 'text-amber-800',
        icon: <AlertTriangle size={16} />,
    },
    success: {
        bg: 'bg-emerald-50',
        border: 'border-emerald-300',
        iconColor: 'text-emerald-600',
        textColor: 'text-emerald-800',
        icon: <CheckCircle2 size={16} />,
    },
    info: {
        bg: 'bg-blue-50',
        border: 'border-blue-300',
        iconColor: 'text-blue-500',
        textColor: 'text-blue-800',
        icon: <Info size={16} />,
    },
};

let nextId = 0;

const GlobalNotificationBanner: React.FC = () => {
    const [active, setActive] = useState<BannerItem[]>([]);
    const [visibleIds, setVisibleIds] = useState<Set<number>>(new Set());
    const queueRef = useRef<BannerItem[]>([]);
    const timersRef = useRef<Map<number, number>>(new Map());
    const timersStartedRef = useRef<Set<number>>(new Set());

    const dismissById = useCallback((id: number) => {
        // Animate out first
        setVisibleIds(prev => { const next = new Set(prev); next.delete(id); return next; });

        setTimeout(() => {
            if (timersRef.current.has(id)) {
                clearTimeout(timersRef.current.get(id)!);
                timersRef.current.delete(id);
            }
            timersStartedRef.current.delete(id);

            setActive(prev => {
                const next = prev.filter(b => b.id !== id);
                const slots = MAX_VISIBLE - next.length;
                const fromQueue = queueRef.current.splice(0, slots);
                return [...next, ...fromQueue];
            });
        }, 250);
    }, []);

    // Start timers and animate-in for newly added active items
    useEffect(() => {
        active.forEach(item => {
            if (timersStartedRef.current.has(item.id)) return;
            timersStartedRef.current.add(item.id);

            // Animate in
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setVisibleIds(prev => new Set([...prev, item.id]));
                });
            });

            // Auto-dismiss timer
            const ms = AUTO_DISMISS_MS[item.variant];
            if (ms !== null) {
                const timer = window.setTimeout(() => dismissById(item.id), ms);
                timersRef.current.set(item.id, timer);
            }
        });
    }, [active, dismissById]);

    const addNotification = useCallback((message: string, variant: BannerVariant) => {
        const item: BannerItem = { id: nextId++, message, variant };
        setActive(prev => {
            if (prev.length < MAX_VISIBLE) {
                return [...prev, item];
            }
            queueRef.current.push(item);
            return prev;
        });
    }, []);

    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<{ message?: string; variant?: BannerVariant }>).detail;
            if (!detail?.message) return;
            addNotification(detail.message, detail.variant ?? 'info');
        };
        window.addEventListener('tavro_notice', handler);
        return () => window.removeEventListener('tavro_notice', handler);
    }, [addNotification]);

    useEffect(() => {
        return () => { timersRef.current.forEach(t => clearTimeout(t)); };
    }, []);

    if (active.length === 0) return null;

    return (
        <div className="flex-shrink-0 w-full">
            <div className="max-w-[1600px] mx-auto px-8 pt-4 pb-1 flex flex-col gap-2">
            {active.map(item => {
                const config = VARIANT_CONFIG[item.variant];
                const isVisible = visibleIds.has(item.id);
                return (
                    <div
                        key={item.id}
                        className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-all duration-250 ease-in-out ${config.bg} ${config.border} ${
                            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
                        }`}
                    >
                        <span className={`flex-shrink-0 ${config.iconColor}`}>{config.icon}</span>
                        <span className={`flex-1 text-sm font-medium ${config.textColor}`}>{item.message}</span>
                        <button
                            onClick={() => dismissById(item.id)}
                            className={`flex-shrink-0 ${config.iconColor} opacity-60 hover:opacity-100 transition-opacity p-0.5 rounded`}
                            aria-label="Dismiss"
                        >
                            <X size={14} />
                        </button>
                    </div>
                );
            })}
            </div>
        </div>
    );
};

export default GlobalNotificationBanner;
