import { useState, useEffect } from 'react';

const DOCKER_LOGS_KEY = 'tavro_docker_logs_open';

/** Returns [isOpen, setIsOpen]. Syncs with localStorage so the preference survives page reloads. */
export function useDockerLogs(): [boolean, (value: boolean) => void] {
    const [isOpen, setIsOpenState] = useState<boolean>(
        () => localStorage.getItem(DOCKER_LOGS_KEY) === 'true'
    );

    const setIsOpen = (value: boolean) => {
        localStorage.setItem(DOCKER_LOGS_KEY, value ? 'true' : 'false');
        setIsOpenState(value);
        window.dispatchEvent(new Event('tavro_settings_change'));
    };

    useEffect(() => {
        const sync = () => {
            setIsOpenState(localStorage.getItem(DOCKER_LOGS_KEY) === 'true');
        };
        window.addEventListener('storage', sync);
        window.addEventListener('tavro_settings_change', sync);
        return () => {
            window.removeEventListener('storage', sync);
            window.removeEventListener('tavro_settings_change', sync);
        };
    }, []);

    return [isOpen, setIsOpen];
}
