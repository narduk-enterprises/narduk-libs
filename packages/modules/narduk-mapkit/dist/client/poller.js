/**
 * Polling that respects the reader: asks again only while the tab is visible,
 * never runs two requests at once, asks straight away when the tab comes back,
 * and throws away an answer that belongs to something the page has since left.
 *
 * Built for live vehicle feeds (every ~15 s), but it is just a polite loop.
 * Plain TypeScript with injectable timers, so it is tested without a clock.
 * Wire `visibilityChanged` to the document's `visibilitychange` event.
 *
 * **Client-only.** The default visibility check reads `document.hidden`, and a
 * poll that runs during SSR would fire a request per render. Create it in
 * `onMounted` (or behind `import.meta.client`), never at module or setup scope
 * of a server-rendered component; on the server `document` is absent, the
 * default check reports "visible", and the poll would run.
 */
import { defaultMapKitTimerScheduler } from './timers.js';
export function createMapKitPoller(options) {
    const isVisible = options.isVisible ?? (() => globalThis.document?.hidden !== true);
    const timers = options.timers ?? defaultMapKitTimerScheduler;
    let running = false;
    let busy = false;
    let epoch = 0;
    let timer;
    function clear() {
        if (timer !== undefined)
            timers.cancel(timer);
        timer = undefined;
    }
    function schedule() {
        clear();
        // Hidden: no timer at all. visibilityChanged() starts the next request when the tab returns.
        if (running && isVisible())
            timer = timers.schedule(() => void tick(), options.intervalMs);
    }
    async function tick() {
        clear();
        if (!running || busy || !isVisible())
            return;
        busy = true;
        const mine = epoch;
        try {
            const result = await options.run();
            if (mine === epoch && running)
                options.onResult(result);
        }
        catch (error) {
            if (mine === epoch && running)
                options.onError?.(error);
        }
        finally {
            busy = false;
            // A restart during the request already asked for another; otherwise schedule the next.
            if (running && mine === epoch)
                schedule();
            else if (running)
                void tick();
        }
    }
    return {
        restart() {
            if (!running)
                return;
            epoch++;
            clear();
            if (!busy)
                void tick();
        },
        start() {
            if (running)
                return;
            running = true;
            void tick();
        },
        stop() {
            running = false;
            epoch++;
            clear();
        },
        visibilityChanged() {
            if (!running)
                return;
            if (isVisible()) {
                if (!busy)
                    void tick();
            }
            else
                clear();
        },
    };
}
/** Run `fn` over `items` with at most `limit` in flight; results keep the input order. */
export async function mapKitMapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const index = next++;
            out[index] = await fn(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => worker()));
    return out;
}
//# sourceMappingURL=poller.js.map