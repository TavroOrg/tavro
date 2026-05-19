/**
 * Shared SSE (Server-Sent Events) stream parser.
 *
 * WHY: All three providers use SSE for streaming but previously each had an inlined
 * copy of this logic. Extracting it eliminates the duplication and gives a single
 * place to fix edge cases (e.g. multi-line data payloads, keep-alive pings).
 */
export async function* parseSSE(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    extractDelta: (parsed: any) => string,
): AsyncGenerator<string> {
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') return;
            try {
                const parsed = JSON.parse(data);
                const delta = extractDelta(parsed);
                if (delta) yield delta;
            } catch { /* skip malformed / keep-alive chunks */ }
        }
    }
}
