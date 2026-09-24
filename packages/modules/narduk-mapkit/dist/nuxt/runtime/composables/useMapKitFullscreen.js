/**
 * `useMapKitFullscreen()` -- fullscreen presentation for a map surface, as a
 * Vue ref plus a toggle over `createMapKitFullscreenController`.
 *
 * Lifted unchanged from buoys. `surface` must resolve to the element
 * holding the map *and* its chrome, and that element must have no `transform`
 * / `filter` / `backdrop-filter` / `perspective` / `contain: paint` ancestor --
 * see the containing-block caveat in the controller's own module doc.
 * `onLayout` runs after every geometry change and before subscribers, which is
 * where MapKit's viewport is refreshed.
 */
import { onScopeDispose, shallowRef } from 'vue';
import { createMapKitFullscreenController } from '../../../client/fullscreen.js';
export function useMapKitFullscreen(options) {
    const active = shallowRef(false);
    let controller = null;
    function ensure() {
        if (controller)
            return controller;
        const element = options.surface();
        if (!element)
            return null;
        controller = createMapKitFullscreenController({
            element,
            onLayout: () => options.onLayout(),
        });
        controller.subscribe((event) => {
            active.value = event.active;
        });
        return controller;
    }
    function toggle() {
        void ensure()?.toggle();
    }
    onScopeDispose(() => {
        controller?.destroy();
        controller = null;
    });
    return { active, toggle };
}
//# sourceMappingURL=useMapKitFullscreen.js.map