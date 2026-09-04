import { defineEventHandler, setResponseHeader, setResponseStatus } from 'h3'

/** Explicit fallback for non-GET requests to the configured token path. */
export default defineEventHandler((event) => {
  setResponseHeader(event, 'allow', 'GET')
  setResponseHeader(event, 'cache-control', 'no-store')
  setResponseStatus(event, 405, 'Method Not Allowed')
  return {
    error: 'Method Not Allowed',
    statusCode: 405,
  }
})
