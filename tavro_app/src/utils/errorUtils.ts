/**
 * Parses a raw API error response into a user-friendly message.
 *
 * Priority order:
 *  1. FastAPI `detail` string (or array of Pydantic validation messages)
 *  2. Top-level `message` field
 *  3. Short plain-text body (< 200 chars, no HTML)
 *  4. Status-code lookup table
 *  5. Generic fallback
 */

const STATUS_MESSAGES: Record<number, string> = {
    400: 'The request was invalid. Please check your input and try again.',
    401: 'Your session has expired. Please sign in again.',
    403: 'You do not have permission to perform this action.',
    404: 'The requested item could not be found.',
    409: 'A conflict occurred. This resource may already exist.',
    413: 'The file is too large to upload. Please reduce the file size and try again.',
    422: 'The data provided could not be processed. Please check your input.',
    429: 'Too many requests. Please wait a moment and try again.',
    500: 'A server error occurred. Please try again or contact support if the issue persists.',
    502: 'The server is temporarily unavailable. Please try again in a moment.',
    503: 'The service is temporarily unavailable. Please try again shortly.',
    504: 'The request timed out. Please check your connection and try again.',
};

export function parseApiError(status: number, body: string): string {
    const trimmed = body.trim();

    if (trimmed) {
        try {
            const parsed = JSON.parse(trimmed);

            // FastAPI standard: { "detail": "..." } or { "detail": [...] }
            if (typeof parsed?.detail === 'string' && parsed.detail.trim()) {
                return parsed.detail.trim();
            }
            if (Array.isArray(parsed?.detail) && parsed.detail.length > 0) {
                // Pydantic v2 validation errors: each item has a `msg` field
                const messages = parsed.detail
                    .map((e: unknown) => {
                        if (typeof e === 'object' && e !== null && 'msg' in e) {
                            return String((e as Record<string, unknown>).msg);
                        }
                        return typeof e === 'string' ? e : null;
                    })
                    .filter(Boolean);
                if (messages.length > 0) return messages.join('; ');
            }

            // Generic `message` field
            if (typeof parsed?.message === 'string' && parsed.message.trim()) {
                return parsed.message.trim();
            }
        } catch {
            // Not JSON — try raw body if short and not HTML
            if (trimmed.length < 200 && !trimmed.startsWith('<')) {
                return trimmed;
            }
        }
    }

    return STATUS_MESSAGES[status] ?? `An unexpected error occurred (${status}). Please try again.`;
}

/**
 * Converts any caught error value into a user-friendly display string.
 *
 * Handles:
 *  - Network failures (TypeError "Failed to fetch" / "NetworkError") → connection message
 *  - Error objects whose message was already set by parseApiError → pass through
 *  - Everything else → generic fallback
 */
export function toUserMessage(err: unknown): string {
    if (err instanceof TypeError) {
        const msg = err.message.toLowerCase();
        if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed')) {
            return 'Unable to reach the server. Please check your connection and try again.';
        }
    }
    if (err instanceof Error && err.message) return err.message;
    return 'An unexpected error occurred. Please try again.';
}

/**
 * Dispatches a user-visible error notice via the tavro_notice event bus.
 * Components that render TimedInfoToast will pick this up automatically.
 */
export function notifyError(message: string, key = 'tavro_error_notice'): void {
    window.dispatchEvent(
        new CustomEvent('tavro_notice', {
            detail: { key, message, variant: 'error' },
        }),
    );
}

/**
 * Dispatches a user-visible success/info notice.
 */
export function notifyInfo(message: string, key = 'tavro_info_notice'): void {
    window.dispatchEvent(
        new CustomEvent('tavro_notice', {
            detail: { key, message, variant: 'info' },
        }),
    );
}
