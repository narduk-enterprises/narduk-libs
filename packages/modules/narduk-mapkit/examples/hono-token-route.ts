import { createMapKitTokenHandler } from '@narduk-enterprises/narduk-mapkit/node'
import { Hono } from 'hono'

const app = new Hono()

const mapKitTokenHandler = createMapKitTokenHandler({
  allowedOrigins: ['http://localhost:5173', 'https://maps.example.com'],
})

app.get('/api/mapkit-token', (c) => mapKitTokenHandler(c.req.raw))

export default app
