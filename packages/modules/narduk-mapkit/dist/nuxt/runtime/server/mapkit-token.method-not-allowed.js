/**
 * Catch-all for the token route so a non-GET gets §e's 405 with `Allow`, rather
 * than Nitro's own 404 for "no handler for this method".
 */
import { defineEventHandler, getRequestHeaders, getRequestURL } from 'h3';
import { mapKitTokenResponse } from '../../../server/handler.js';
export default defineEventHandler(async (event) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(getRequestHeaders(event))) {
        if (value)
            headers.set(name, value);
    }
    return await mapKitTokenResponse(new Request(getRequestURL(event), { headers, method: event.method }), { doppler: false, keyId: '', privateKey: '', teamId: '' }, { self: getRequestURL(event, { xForwardedHost: false }).origin });
});
//# sourceMappingURL=mapkit-token.method-not-allowed.js.map