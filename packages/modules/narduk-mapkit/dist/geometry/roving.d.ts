/**
 * Spatial keyboard navigation between map points (roving tabindex).
 *
 * A map with 200 focusable pins is 200 Tab stops. The accessible pattern is a
 * *roving tabindex*: the pin group is one Tab stop and the arrow keys move
 * between pins. On a map "next" has no list order, so the arrows move to the
 * nearest pin in that compass direction.
 *
 * Pure and unit-free: it works on latitude and longitude, not pixels, so it
 * needs no projection (the fake MapKit does not model one) and gives the same
 * answer at every zoom. Longitude is scaled by `cos(latitude)` so east-west and
 * north-south distances are comparable.
 */
/** A point that takes part in keyboard navigation. */
export interface MapKitRovingPoint {
    key: string;
    lat: number;
    lng: number;
}
/**
 * Where an arrow or Home/End key sends focus. `first` and `last` follow reading
 * order: north to south, then west to east.
 */
export type MapKitRovingDirection = 'east' | 'first' | 'last' | 'north' | 'south' | 'west';
/**
 * The key to move focus to, or `null` when there is nowhere to go (an arrow at
 * the edge of the group, or an empty group).
 *
 * `from` that is `null` or no longer present is treated as "start of the
 * group", so the first arrow press always lands somewhere.
 */
export declare function nextMapKitRovingKey(points: readonly MapKitRovingPoint[], from: string | null, direction: MapKitRovingDirection): string | null;
//# sourceMappingURL=roving.d.ts.map