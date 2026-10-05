/**
 * Streaks that travel along a path of stretches: which way the water flows.
 *
 * The desktop hover on the national river map lights a river, its path
 * downstream and its tributaries. This is the part of that picture that moves:
 * a train of bright comet streaks, evenly spaced, running along the path in the
 * direction it is listed, with fainter streaks on any tributaries. It draws on
 * one canvas laid over the map, never in the network's tile images, so it costs
 * only what it draws and repaints nothing underneath.
 *
 * A streak is a bright head with a tail that fades away behind it, over an
 * optional halo of a second colour: the head reads against a dark river
 * because it is light, and against a light one because the halo is dark.
 *
 * What it costs, by design:
 *
 * - Geometry is read when the path or the view changes, never per frame. The
 *   path's pieces come from decoded tiles already in memory
 *   ({@link FlowPulsePathSource.pathPieces}); neighbouring pieces are joined
 *   into a few long lines, so the dashes run unbroken across stretches.
 * - Each line is built once into a `Path2D` (when the platform has one). A
 *   frame is a clear and a few strokes per line, with the dash pattern offset
 *   by the clock. It allocates nothing.
 * - Pieces are joined whichever way the tiles draw them: a stretch drawn
 *   against the flow is turned round, so a river is one long line and a streak
 *   runs it unbroken.
 * - Tributaries are stitched into one line each (when the caller says where a
 *   line ends, see {@link FlowPulseBranch.lineSizes}), the lines too short to
 *   carry a streak are left to the lit line underneath, and each remaining
 *   line gets one or two slow streaks timed to reach the end together, so they
 *   read as water running into the river.
 * - The loop runs only while there is a path to draw and the map is still.
 *   `suspend()` stops it and clears the canvas while the map moves; `update()`
 *   starts it again for the settled view.
 *
 * With `prefers-reduced-motion`, nothing moves: the same path is drawn once as
 * small chevrons pointing the way the water goes.
 *
 * Nothing here knows what a stretch is. The caller lists feature ids with
 * their ground lengths, upstream first, and picks the colour.
 */
import { pixelsPerMeter } from './vector-tile-paths.js';
export const FLOW_PULSE_DEFAULTS = {
    branchOpacity: 0.85,
    chevron: 4,
    chevronSpacing: 64,
    chevronWidth: 2.2,
    dash: 30,
    glowOpacity: 0.45,
    glowScale: 1.8,
    opacity: 1,
    period: 56,
    speed: 90,
    tail: 4,
};
/** Pieces whose ends are this close, in CSS pixels, are one line. */
const JOIN_PX = 3;
/** A point closer than this to the one before it adds nothing to a line. */
const SAME_POINT_PX = 0.3;
/** Most tributary lines that carry streaks: the longest ones, so a lit basin of thousands stays cheap. */
const MAX_BRANCH_CHAINS = 160;
/** Pieces and lines this far past the view are still read. */
const MARGIN_PX = 48;
/** Times an empty read is repeated, a beat apart, while tiles may still be decoding. */
const EMPTY_RETRIES = 3;
const EMPTY_RETRY_MS = 350;
const MAX_PIXEL_RATIO = 2;
function positiveModulo(value, modulus) {
    return ((value % modulus) + modulus) % modulus;
}
function lengthsOf(points) {
    const count = points.length / 2;
    const lengths = new Float32Array(count);
    for (let index = 1; index < count; index += 1) {
        lengths[index] =
            lengths[index - 1] +
                Math.hypot(points[index * 2] - points[index * 2 - 2], points[index * 2 + 1] - points[index * 2 - 1]);
    }
    return lengths;
}
function turnRound(points) {
    const turned = new Float32Array(points.length);
    const count = points.length / 2;
    for (let index = 0; index < count; index += 1) {
        turned[index * 2] = points[(count - 1 - index) * 2];
        turned[index * 2 + 1] = points[(count - 1 - index) * 2 + 1];
    }
    return turned;
}
/**
 * Join the pieces of a path, in path order, into lines: a piece that starts
 * where the last one ended continues it, and so does one that ends there (the
 * tiles draw a stretch in either direction, and the path knows which way the
 * water goes), which is then turned round. A line made of one piece is turned
 * round too when the next piece meets its start. A gap (a tile not decoded, a
 * stretch off the screen) starts a new line whose pattern phase comes from the
 * ground distance, so the dashes on the far side of a gap still line up with
 * the ones before it, to within the difference between ground and drawn
 * length. Points that repeat one another are dropped.
 */
export function joinPathPieces(pieces, pixelsPerMetre, joinPx = JOIN_PX) {
    const chains = [];
    let run = [];
    let members = 0;
    let phase = 0;
    let last = -1;
    const flush = () => {
        if (run.length >= 4) {
            const points = new Float32Array(run);
            const lengths = lengthsOf(points);
            chains.push({ length: lengths[lengths.length - 1], lengths, phase, points });
        }
        run = [];
        members = 0;
    };
    const near = (x, y, at) => Math.hypot(x - run[at], y - run[at + 1]) <= joinPx;
    for (const piece of pieces) {
        if (piece.points.length < 4)
            continue;
        let { points } = piece;
        const end = points.length - 2;
        let joined = false;
        if (run.length >= 2 && piece.rank >= last) {
            const tail = run.length - 2;
            const meets = (at) => near(points[0], points[1], at) ||
                near(points[end], points[end + 1], at);
            if (members === 1 && !meets(tail) && meets(0)) {
                run = Array.from(turnRound(new Float32Array(run)));
            }
            if (near(points[0], points[1], tail)) {
                joined = true;
            }
            else if (near(points[end], points[end + 1], tail)) {
                points = turnRound(points);
                joined = true;
            }
        }
        if (!joined) {
            flush();
            phase = piece.distanceM * pixelsPerMetre;
        }
        // A joined piece's first point is the last one's end, within a pixel or two.
        for (let at = joined ? 2 : 0; at < points.length; at += 2) {
            const x = points[at];
            const y = points[at + 1];
            if (run.length >= 2 &&
                Math.hypot(x - run[run.length - 2], y - run[run.length - 1]) <
                    SAME_POINT_PX) {
                continue;
            }
            run.push(x, y);
        }
        members += 1;
        last = piece.rank;
    }
    flush();
    return chains;
}
export function createFlowPulseLayer(options) {
    const { canvas, source } = options;
    const requestFrame = options.requestAnimationFrame ??
        (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : undefined);
    const cancelFrame = options.cancelAnimationFrame ??
        (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : undefined);
    const clock = options.now ?? (() => performance.now());
    const createPath = options.createPath ??
        (typeof Path2D === 'function'
            ? () => new Path2D()
            : null);
    const query = options.reducedMotion === undefined && typeof matchMedia === 'function'
        ? matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    const reduced = () => options.reducedMotion ?? query?.matches ?? false;
    let style = options.style;
    let stretches = null;
    let branches = null;
    let view = null;
    let held = false;
    let destroyed = false;
    let chains = [];
    let branchLines = [];
    let branchDropped = 0;
    let frame = 0;
    let frames = 0;
    let retries = 0;
    let retryTimer = null;
    let pixelRatio = 1;
    let passes = [];
    let branchPasses = [];
    let branchPeriod = 190;
    let branchSpeed = FLOW_PULSE_DEFAULTS.speed;
    let period = FLOW_PULSE_DEFAULTS.period;
    let speed = FLOW_PULSE_DEFAULTS.speed;
    let dash = FLOW_PULSE_DEFAULTS.dash;
    let mode = 'idle';
    const value = (key) => style[key] ?? FLOW_PULSE_DEFAULTS[key];
    function context() {
        return canvas.getContext('2d');
    }
    function clear() {
        const context2d = context();
        if (!context2d)
            return;
        context2d.setTransform(1, 0, 0, 1, 0, 0);
        context2d.clearRect(0, 0, canvas.width, canvas.height);
        context2d.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }
    function stop() {
        if (frame && cancelFrame)
            cancelFrame(frame);
        frame = 0;
    }
    function cancelRetry() {
        if (retryTimer !== null)
            clearTimeout(retryTimer);
        retryTimer = null;
    }
    function traceLine(target, points) {
        target.moveTo(points[0], points[1]);
        for (let at = 2; at < points.length; at += 2) {
            target.lineTo(points[at], points[at + 1]);
        }
    }
    function strokeChain(context2d, chain) {
        if (chain.path) {
            context2d.stroke(chain.path);
            return;
        }
        context2d.beginPath();
        traceLine(context2d, chain.points);
        context2d.stroke();
    }
    /** The steps of a streak's tail: long and faint first, the short bright head last. */
    function tailPasses(options) {
        const { alpha, color, dash: length, steps, width } = options;
        const each = style.tailOpacity;
        const made = [];
        for (let step = 0; step < steps; step += 1) {
            const strength = steps === 1 ? 1 : step / (steps - 1);
            made.push({
                alpha: alpha * (steps === 1 ? 1 : each === undefined ? 0.28 + 0.72 * strength : each),
                color,
                length: length * (1 - step / steps),
                width: steps === 1 ? width : width * (0.55 + 0.45 * strength),
            });
        }
        return made;
    }
    /** Read the style into the passes a frame draws: a halo, then the tail steps, head last. */
    function configure() {
        dash = Math.max(value('dash'), 2);
        period = Math.max(value('period'), dash + 2);
        speed = value('speed');
        const width = style.width;
        const opacity = value('opacity');
        passes = [];
        if (style.glowColor) {
            passes.push({
                alpha: value('glowOpacity') * opacity,
                color: style.glowColor,
                length: dash,
                width: width * value('glowScale'),
            });
        }
        passes.push(...tailPasses({
            alpha: opacity,
            color: style.color,
            dash,
            steps: Math.max(1, Math.round(value('tail'))),
            width,
        }));
        const branchDash = Math.max(6, style.branchDash ?? dash * 0.65);
        branchPeriod = Math.max(style.branchPeriod ?? 190, branchDash * 2);
        branchSpeed = style.branchSpeed ?? speed;
        branchPasses = tailPasses({
            alpha: opacity * value('branchOpacity'),
            color: style.color,
            dash: branchDash,
            steps: Math.max(1, Math.round(style.branchTail ?? 1)),
            width: style.branchWidth ?? Math.max(1.4, width * 0.6),
        });
    }
    /**
     * Tributary streaks. Every line has its own period (one streak, or two on a long
     * line) in whole multiples of the shared one, and the pattern is anchored to the
     * line's end: each streak's head reaches the end when the clock is a multiple of
     * the shared period, on every line at once, so the water seems to arrive together.
     */
    function paintBranches(context2d, time) {
        if (branchLines.length === 0)
            return;
        const seconds = time / 1000;
        for (const line of branchLines) {
            const per = branchPeriod * Math.max(1, Math.ceil(line.length / (2 * branchPeriod)));
            const arrival = positiveModulo(seconds * branchSpeed, per);
            for (const pass of branchPasses) {
                context2d.strokeStyle = pass.color;
                context2d.lineWidth = pass.width;
                context2d.globalAlpha = Math.min(1, pass.alpha * line.opacity);
                context2d.setLineDash([pass.length, per - pass.length]);
                context2d.lineDashOffset = positiveModulo(pass.length - (line.length - per + arrival), per);
                if (line.path) {
                    context2d.stroke(line.path);
                    continue;
                }
                context2d.beginPath();
                traceLine(context2d, line.points);
                context2d.stroke();
            }
        }
    }
    /** The moving streaks, one frame. No allocation: a clear, an offset and a stroke per line and pass. */
    function paintPulse(time) {
        const context2d = context();
        if (!context2d || !view)
            return;
        context2d.clearRect(0, 0, view.width, view.height);
        const travelled = (time / 1000) * speed;
        paintBranches(context2d, time);
        for (const pass of passes) {
            context2d.strokeStyle = pass.color;
            context2d.lineWidth = pass.width;
            context2d.globalAlpha = pass.alpha;
            context2d.setLineDash([pass.length, period - pass.length]);
            for (const chain of chains) {
                // The head sits at the downstream end of the streak; every pass shares it.
                const head = travelled - chain.phase + dash;
                context2d.lineDashOffset = positiveModulo(pass.length - head, period);
                strokeChain(context2d, chain);
            }
        }
    }
    function loop(time) {
        frame = 0;
        if (destroyed || held || mode !== 'pulse')
            return;
        frames += 1;
        paintPulse(time);
        if (requestFrame)
            frame = requestFrame(loop);
    }
    /** Chevrons along every line, once: the same path, held still. */
    function paintChevrons() {
        const context2d = context();
        if (!context2d || !view)
            return;
        context2d.clearRect(0, 0, view.width, view.height);
        context2d.setLineDash([]);
        const spacing = value('chevronSpacing');
        const size = value('chevron');
        context2d.beginPath();
        for (const chain of chains) {
            const { lengths, phase, points } = chain;
            const total = lengths[lengths.length - 1];
            let segment = 1;
            for (let along = positiveModulo(spacing / 2 - phase, spacing); along < total; along += spacing) {
                while (segment < lengths.length - 1 && lengths[segment] < along)
                    segment += 1;
                const from = segment - 1;
                const span = lengths[segment] - lengths[from];
                if (!(span > 0))
                    continue;
                const t = (along - lengths[from]) / span;
                const ax = points[from * 2];
                const ay = points[from * 2 + 1];
                const bx = points[segment * 2];
                const by = points[segment * 2 + 1];
                const tipX = ax + (bx - ax) * t;
                const tipY = ay + (by - ay) * t;
                // Unit vector back along the line, then the two wings at 35 degrees to it.
                const backX = (ax - bx) / span;
                const backY = (ay - by) / span;
                const cos = Math.cos(0.61);
                const sin = Math.sin(0.61);
                context2d.moveTo(tipX + size * (backX * cos - backY * sin), tipY + size * (backX * sin + backY * cos));
                context2d.lineTo(tipX, tipY);
                context2d.lineTo(tipX + size * (backX * cos + backY * sin), tipY + size * (-backX * sin + backY * cos));
            }
        }
        context2d.lineCap = 'round';
        context2d.lineJoin = 'round';
        if (style.glowColor) {
            context2d.strokeStyle = style.glowColor;
            context2d.lineWidth = value('chevronWidth') * 2.2;
            context2d.globalAlpha = value('glowOpacity') * value('opacity');
            context2d.stroke();
        }
        context2d.strokeStyle = style.color;
        context2d.lineWidth = value('chevronWidth');
        context2d.globalAlpha = value('opacity');
        context2d.stroke();
    }
    function resize(next) {
        const wanted = Math.min(options.pixelRatio?.() ?? globalDevicePixelRatio(), MAX_PIXEL_RATIO);
        pixelRatio = wanted > 0 ? wanted : 1;
        const width = Math.max(1, Math.round(next.width * pixelRatio));
        const height = Math.max(1, Math.round(next.height * pixelRatio));
        if (canvas.width !== width)
            canvas.width = width;
        if (canvas.height !== height)
            canvas.height = height;
        if (canvas.style) {
            canvas.style.width = `${next.width}px`;
            canvas.style.height = `${next.height}px`;
        }
        const context2d = context();
        context2d?.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }
    /** Keep each main line as a path, so a frame replays it instead of tracing it. */
    function keepPaths(lines) {
        if (!createPath)
            return;
        for (const chain of lines) {
            const path = createPath();
            if (!path)
                return;
            traceLine(path, chain.points);
            chain.path = path;
        }
    }
    /**
     * Read the tributary pieces, stitch each line's into one, and keep the lines long
     * enough to carry a streak (the longest, when there are very many).
     */
    function buildBranches(pixelsPerMetre) {
        branchLines = [];
        branchDropped = 0;
        if (!view || !branches)
            return;
        const merged = [];
        const lineOf = [];
        const opacityOf = [];
        let lineCount = 0;
        for (const branch of branches) {
            const sizes = branch.lineSizes ?? [branch.stretches.length];
            let offset = 0;
            for (const size of sizes) {
                const end = Math.min(branch.stretches.length, offset + Math.max(0, size));
                for (; offset < end; offset += 1) {
                    merged.push(branch.stretches[offset]);
                    lineOf.push(lineCount);
                }
                opacityOf.push(Math.max(0, Math.min(1, branch.opacity)));
                lineCount += 1;
            }
            // Stretches past the sizes are one more line.
            if (offset < branch.stretches.length) {
                for (; offset < branch.stretches.length; offset += 1) {
                    merged.push(branch.stretches[offset]);
                    lineOf.push(lineCount);
                }
                opacityOf.push(Math.max(0, Math.min(1, branch.opacity)));
                lineCount += 1;
            }
        }
        if (merged.length === 0)
            return;
        const buckets = Array.from({ length: lineCount }, () => []);
        for (const piece of source.pathPieces({ marginPx: MARGIN_PX, stretches: merged, view })) {
            buckets[lineOf[piece.rank] ?? 0]?.push(piece);
        }
        const minLength = style.branchMinLength ?? 30;
        const kept = [];
        for (const [line, bucket] of buckets.entries()) {
            for (const chain of joinPathPieces(bucket, pixelsPerMetre)) {
                if (chain.length < minLength) {
                    branchDropped += 1;
                    continue;
                }
                kept.push({
                    length: chain.length,
                    opacity: opacityOf[line] ?? 1,
                    path: null,
                    points: chain.points,
                });
            }
        }
        kept.sort((left, right) => right.length - left.length);
        branchDropped += Math.max(0, kept.length - MAX_BRANCH_CHAINS);
        branchLines = kept.slice(0, MAX_BRANCH_CHAINS);
        if (!createPath)
            return;
        for (const line of branchLines) {
            const path = createPath();
            if (!path)
                break;
            traceLine(path, line.points);
            line.path = path;
        }
    }
    function rebuild() {
        stop();
        cancelRetry();
        chains = [];
        branchLines = [];
        branchDropped = 0;
        const hasPath = stretches !== null && stretches.length > 0;
        const hasBranches = branches?.some((branch) => branch.stretches.length > 0) ?? false;
        if (destroyed || held || !view || (!hasPath && !hasBranches)) {
            mode = 'idle';
            if (view) {
                resize(view);
                clear();
            }
            return;
        }
        resize(view);
        clear();
        const pixelsPerMetre = pixelsPerMeter(view);
        if (hasPath) {
            const pieces = source.pathPieces({ marginPx: MARGIN_PX, stretches: stretches, view });
            chains = joinPathPieces(pieces, pixelsPerMetre);
            keepPaths(chains);
        }
        if (hasBranches)
            buildBranches(pixelsPerMetre);
        if (chains.length === 0 && branchLines.length === 0) {
            mode = 'idle';
            if (retries < EMPTY_RETRIES) {
                retries += 1;
                retryTimer = setTimeout(() => {
                    retryTimer = null;
                    rebuild();
                }, EMPTY_RETRY_MS);
            }
            return;
        }
        retries = 0;
        const context2d = context();
        if (!context2d) {
            mode = 'idle';
            return;
        }
        configure();
        context2d.lineCap = 'round';
        context2d.lineJoin = 'round';
        if (reduced() || !requestFrame) {
            mode = 'chevrons';
            branchLines = [];
            paintChevrons();
            return;
        }
        mode = 'pulse';
        paintPulse(clock());
        frame = requestFrame(loop);
    }
    const onMotionChange = () => {
        if (!destroyed && !held && view)
            rebuild();
    };
    query?.addEventListener('change', onMotionChange);
    return {
        destroy() {
            if (destroyed)
                return;
            destroyed = true;
            stop();
            cancelRetry();
            query?.removeEventListener('change', onMotionChange);
            chains = [];
            branchLines = [];
            mode = 'idle';
            if (view)
                clear();
        },
        setPath(next, nextBranches = null) {
            stretches = next && next.length > 0 ? next : null;
            branches = nextBranches && nextBranches.length > 0 ? nextBranches : null;
            retries = 0;
            rebuild();
        },
        setStyle(next) {
            style = next;
            if (!destroyed && !held && view)
                rebuild();
        },
        get stats() {
            let points = 0;
            for (const chain of chains)
                points += chain.points.length / 2;
            return {
                branchChains: branchLines.length,
                branchDropped,
                chains: chains.length,
                frames,
                mode,
                points,
            };
        },
        suspend() {
            if (destroyed)
                return;
            held = true;
            stop();
            cancelRetry();
            mode = 'idle';
            if (view)
                clear();
        },
        update(next) {
            view = next;
            held = false;
            retries = 0;
            rebuild();
        },
    };
}
function globalDevicePixelRatio() {
    return typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
}
//# sourceMappingURL=flow-pulse.js.map