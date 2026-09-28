/**
 * Refresh a bare AppMapKit host after it acquires a real layout box. A one-time
 * height nudge makes the real renderer reschedule tiles on initially collapsed
 * hosts. Vue scope disposal cancels retries, disconnects the observer and
 * restores the original inline height, including when a map is replaced.
 */
export declare function useMapKitLayoutSettle(): {
    handleMapReady: (rawMap: unknown) => void;
};
//# sourceMappingURL=useMapKitLayoutSettle.d.ts.map