import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { userContextApi } from '../services/userContextApi';

type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextType {
    theme: ThemeMode;
    setTheme: (theme: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [theme, setTheme] = useState<ThemeMode>(() => {
        return (localStorage.getItem('tavro_theme') as ThemeMode) || 'light';
    });
    const isFirstRun = useRef(true);

    // One-time hydration: only pull the server preference on devices that have
    // never set a theme locally (fresh device/incognito) — otherwise localStorage
    // stays the fast first-paint source of truth.
    useEffect(() => {
        if (localStorage.getItem('tavro_theme')) return;
        userContextApi.getUserContext().then(ctx => {
            if (ctx.theme) setTheme(ctx.theme as ThemeMode);
        }).catch(() => {});
    }, []);

    useEffect(() => {
        const root = window.document.documentElement;

        const applyTheme = (mode: ThemeMode) => {
            if (mode === 'system') {
                const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                root.classList.toggle('dark', systemTheme === 'dark');
            } else {
                root.classList.toggle('dark', mode === 'dark');
            }
        };

        applyTheme(theme);
        localStorage.setItem('tavro_theme', theme);

        if (isFirstRun.current) {
            isFirstRun.current = false;
        } else {
            userContextApi.patchUserContext({ theme }).catch(() => {});
        }

        // Listener for system preference changes
        if (theme === 'system') {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            const handleChange = () => applyTheme('system');
            mediaQuery.addEventListener('change', handleChange);
            return () => mediaQuery.removeEventListener('change', handleChange);
        }
    }, [theme]);

    return (
        <ThemeContext.Provider value={{ theme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};
