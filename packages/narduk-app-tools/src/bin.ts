#!/usr/bin/env node

import { main } from './cli.js'

void main().then((status) => {
  process.exitCode = status
  return status
})
