import { z } from 'zod'

export const logLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
export const errorSchema = z
  .object({
    name: z.string(),
    message: z.string(),
    code: z.string().optional(),
    stack: z.string().optional(),
    cause: z.json().optional(),
  })
  .strict()

/** Source for the versioned JSON Schema consumed by all three implementations. */
export const logRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    timestamp: z.iso.datetime(),
    level: logLevelSchema,
    message: z.string(),
    service: z.string().min(1).max(128),
    environment: z.string().min(1).max(64),
    runtime: z.string().min(1).max(64),
    release: z.string().max(128).optional(),
    scope: z.string().max(256).optional(),
    requestId: z.string().max(128).optional(),
    operationId: z.string().max(128).optional(),
    traceId: z
      .string()
      .regex(/^[a-f0-9]{32}$/)
      .optional(),
    spanId: z
      .string()
      .regex(/^[a-f0-9]{16}$/)
      .optional(),
    method: z.string().max(32).optional(),
    path: z.string().max(512).optional(),
    source: z.enum(['server', 'client', 'job', 'cli']).optional(),
    data: z.record(z.string(), z.json()).optional(),
    error: errorSchema.optional(),
  })
  .strict()

export type LogRecord = z.infer<typeof logRecordSchema>
export type LogLevel = z.infer<typeof logLevelSchema>
export type LogError = z.infer<typeof errorSchema>
export type JsonValue = z.infer<ReturnType<typeof z.json>>
