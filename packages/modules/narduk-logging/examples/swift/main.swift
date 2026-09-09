import Foundation
import NardukLogging

let log = createLogger(try LoggerOptions(service: "example-swift", environment: "production"))
await log.operation("example-job") { job in
    await Task.yield()
    job.info("Synthetic logging check", ["check": "swift", "count": 1])
}
await log.close()
