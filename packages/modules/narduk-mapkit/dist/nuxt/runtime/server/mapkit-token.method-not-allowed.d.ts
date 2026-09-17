/**
 * Catch-all for the token route so a non-GET gets §e's 405 with `Allow`, rather
 * than Nitro's own 404 for "no handler for this method".
 *
 * This is the SAME handler as GET. A dummy with empty credentials would 503
 * any GET that landed here -- Nitro registers a method-less handler for every
 * method -- so a shadow cannot unconfigure a signed route. POST still 405s
 * because `mapKitTokenResponse` answers 405 before it signs.
 */
export { default } from './mapkit-token.get.js';
//# sourceMappingURL=mapkit-token.method-not-allowed.d.ts.map