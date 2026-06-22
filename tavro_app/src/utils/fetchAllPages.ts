interface PagedResponse<T> {
    total_records?: number;
    data?: T[] | null;
}

/**
 * Fetches all pages in parallel and returns a flat array.
 * Fetches page 1 first to learn total_records, then fires all remaining pages
 * concurrently. Use this for simple cases where you need all data at once.
 */
export async function fetchAllPages<T>(
    fetchPage: (start: number, recordRange: string) => Promise<PagedResponse<T>>,
    pageSize = 100,
): Promise<T[]> {
    const first = await fetchPage(1, `1-${pageSize}`);
    const total = first.total_records ?? 0;
    const firstBatch = (first.data ?? []) as T[];

    if (total <= pageSize) return firstBatch;

    const pageStarts: number[] = [];
    for (let start = pageSize + 1; start <= total; start += pageSize) {
        pageStarts.push(start);
    }

    const remaining = await Promise.all(
        pageStarts.map(async start => {
            const end = Math.min(start + pageSize - 1, total);
            try {
                const r = await fetchPage(start, `${start}-${end}`);
                return (r.data ?? []) as T[];
            } catch {
                return [] as T[];
            }
        }),
    );

    return [...firstBatch, ...remaining.flat()];
}

/**
 * Fetches all pages progressively, calling onPage as each arrives.
 *
 * Page 1 is awaited first (reveals total_records) and onPage is called with
 * isFirstPage=true so the caller can show data immediately and clear its loading
 * state. All remaining pages are then fired concurrently; onPage is called for
 * each as it resolves. A failed page is silently skipped.
 */
export async function fetchPagesProgressive<T>(
    fetchPage: (start: number, recordRange: string) => Promise<PagedResponse<T>>,
    onPage: (items: T[], isFirstPage: boolean) => void,
    pageSize = 100,
): Promise<void> {
    const first = await fetchPage(1, `1-${pageSize}`);
    const total = first.total_records ?? 0;
    onPage((first.data ?? []) as T[], true);

    if (total <= pageSize) return;

    const pageStarts: number[] = [];
    for (let start = pageSize + 1; start <= total; start += pageSize) {
        pageStarts.push(start);
    }

    await Promise.all(
        pageStarts.map(async start => {
            const end = Math.min(start + pageSize - 1, total);
            try {
                const resp = await fetchPage(start, `${start}-${end}`);
                onPage((resp.data ?? []) as T[], false);
            } catch {
                // Silently skip failed pages — partial data is better than nothing.
            }
        }),
    );
}
