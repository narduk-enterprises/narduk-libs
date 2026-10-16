export const MAPKIT_HIT_AREA_ATTRIBUTE = 'data-mapkit-hit-area';
/**
 * Size and pad `host` for `geometry` (the enlarged one `expandMapKitHitArea`
 * returned) and `padding`. With no padding, or no size, it removes what an
 * earlier call set, so a marker that no longer needs the larger target goes back
 * to the size of its glyph.
 */
export function writeMapKitHitArea(host, geometry, padding) {
    const grown = padding.top + padding.right + padding.bottom + padding.left > 0;
    if (!grown || !geometry.size) {
        host.removeAttribute(MAPKIT_HIT_AREA_ATTRIBUTE);
        for (const name of ['box-sizing', 'height', 'padding', 'width'])
            host.style.removeProperty(name);
        return;
    }
    host.setAttribute(MAPKIT_HIT_AREA_ATTRIBUTE, '');
    host.style.boxSizing = 'border-box';
    host.style.height = `${String(geometry.size.height)}px`;
    host.style.width = `${String(geometry.size.width)}px`;
    host.style.padding = [padding.top, padding.right, padding.bottom, padding.left]
        .map((value) => `${String(value)}px`)
        .join(' ');
}
//# sourceMappingURL=hit-area.js.map