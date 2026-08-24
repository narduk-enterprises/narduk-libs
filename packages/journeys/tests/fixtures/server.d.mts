import type { Server } from 'node:http'

export interface WorldServer {
  close(): Promise<void>
  interfere(): void
  listen(): Promise<string>
  server: Server
}
export function createWorldServer(): WorldServer
