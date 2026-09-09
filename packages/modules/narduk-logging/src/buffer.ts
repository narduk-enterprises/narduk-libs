export interface BufferStats {
  buffered: number
  bytes: number
  delivered: number
  dropped: number
  deliveryFailures: number
}

export interface BufferOptions<T> {
  send(batch: readonly T[], signal: AbortSignal): Promise<void>
  size(value: T): number
  intervalMs?: number
  timeoutMs?: number
  shutdownMs?: number
}

/** Count and byte limits include the batch in flight. No unbounded task per log call. */
export function createBoundedBuffer<T>(options: BufferOptions<T>): {
  push(value: T): void
  flush(): Promise<void>
  close(): Promise<void>
  readonly stats: Readonly<BufferStats>
} {
  const queue: Array<{ value: T; bytes: number }> = []
  const stats: BufferStats = {
    buffered: 0,
    bytes: 0,
    delivered: 0,
    dropped: 0,
    deliveryFailures: 0,
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<void> | undefined
  let closed = false
  let controller: AbortController | undefined

  function release(items: typeof queue, delivered: boolean): void {
    stats.buffered -= items.length
    stats.bytes -= items.reduce((total, item) => total + item.bytes, 0)
    if (delivered) stats.delivered += items.length
    else stats.dropped += items.length
  }

  async function send(batch: readonly T[]): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (controller?.signal.aborted) return false
      const deadline = AbortSignal.timeout(options.timeoutMs ?? 2000)
      const signal = controller ? AbortSignal.any([controller.signal, deadline]) : deadline
      try {
        await new Promise<void>((resolve, reject) => {
          const abort = () => reject(new Error('Log delivery deadline exceeded'))
          signal.addEventListener('abort', abort, { once: true })
          Promise.resolve()
            .then(() => options.send(batch, signal))
            .then(resolve, reject)
            .finally(() => signal.removeEventListener('abort', abort))
            .catch(reject)
        })
        return true
      } catch {
        stats.deliveryFailures++
        if (controller?.signal.aborted) return false
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)))
      }
    }
    return false
  }

  async function drain(): Promise<void> {
    // Only drain records present at the flush boundary. Producers cannot keep flush alive forever.
    let remaining = queue.length
    while (remaining > 0 && queue.length > 0 && !controller?.signal.aborted) {
      const items: typeof queue = []
      let bytes = 0
      while (queue.length && items.length < Math.min(10, remaining)) {
        const next = queue[0]
        // Leave room for JSON array separators and the ingestion envelope.
        if (!next || bytes + next.bytes > 63 * 1024) break
        items.push(next)
        queue.shift()
        bytes += next.bytes
      }
      remaining -= items.length
      release(items, await send(items.map((item) => item.value)))
    }
  }

  function schedule(): void {
    if (timer || closed || !queue.length) return
    timer = setTimeout(() => {
      timer = undefined
      void flush()
    }, options.intervalMs ?? 5000)
    // A logger must not keep a CLI process alive. Explicit close() drains before exit.
    if (typeof timer === 'object' && 'unref' in timer) timer.unref()
  }

  function flush(): Promise<void> {
    if (running) return running
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    controller = new AbortController()
    running = drain().finally(() => {
      running = undefined
      schedule()
    })
    return running
  }

  return {
    push(value) {
      let bytes: number
      try {
        bytes = options.size(value)
      } catch {
        stats.dropped++
        return
      }
      if (
        closed ||
        bytes > 16 * 1024 ||
        !Number.isFinite(bytes) ||
        bytes < 0 ||
        stats.buffered >= 100 ||
        stats.bytes + bytes > 1024 * 1024
      ) {
        stats.dropped++
        return
      }
      queue.push({ value, bytes })
      stats.buffered++
      stats.bytes += bytes
      schedule()
    },
    flush,
    async close() {
      if (closed) {
        await running
        return
      }
      closed = true
      if (timer) {
        clearTimeout(timer)
        timer = undefined
      }
      const deadline = setTimeout(() => controller?.abort(), options.shutdownMs ?? 2000)
      try {
        await flush()
        // A prior flush may have had a smaller snapshot. Drain the remaining queue within the same deadline.
        if (queue.length && !controller?.signal.aborted) await drain()
      } finally {
        clearTimeout(deadline)
        release(queue.splice(0), false)
      }
    },
    get stats() {
      return { ...stats }
    },
  }
}
