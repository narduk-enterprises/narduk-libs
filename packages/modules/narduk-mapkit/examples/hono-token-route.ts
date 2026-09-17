import { createMapKitTokenHandler } from '@narduk-enterprises/narduk-mapkit/node'
import { Hono } from 'hono'

const app = new Hono()

// No origin allowlist: the route mints only for the origin that routed the
// request (narduk-libs#421 §e).
const mapKitTokenHandler = createMapKitTokenHandler()

app.get('/api/mapkit-token', (c) => mapKitTokenHandler(c.req.raw))

export default app
