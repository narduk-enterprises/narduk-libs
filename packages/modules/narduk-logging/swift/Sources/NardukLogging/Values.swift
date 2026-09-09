import Foundation

/// Values are typed and Sendable; opaque objects are never introspected by a logger.
public indirect enum LogValue: Sendable, Equatable, Codable {
    case null
    case bool(Bool)
    case integer(Int64)
    case number(Double)
    case string(String)
    case array([LogValue])
    case object([String: LogValue])
    case `private`(LogValue)

    public init(from decoder: any Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() {
            self = .null
        } else if let bool = try? value.decode(Bool.self) {
            self = .bool(bool)
        } else if let integer = try? value.decode(Int64.self) {
            self = .integer(integer)
        } else if let number = try? value.decode(Double.self) {
            self = .number(number)
        } else if let string = try? value.decode(String.self) {
            self = .string(string)
        } else if let array = try? value.decode([LogValue].self) {
            self = .array(array)
        } else {
            self = .object(try value.decode([String: LogValue].self))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .null: try value.encodeNil()
        case .bool(let bool): try value.encode(bool)
        case .integer(let integer): try value.encode(integer)
        case .number(let number):
            if number.isFinite {
                try value.encode(number)
            } else {
                try value.encode(String(number))
            }
        case .string(let string): try value.encode(string)
        case .array(let array): try value.encode(array)
        case .object(let object): try value.encode(object)
        case .private: try value.encode("[REDACTED]")
        }
    }
}

extension LogValue: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral,
    ExpressibleByBooleanLiteral, ExpressibleByFloatLiteral, ExpressibleByNilLiteral,
    ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral
{
    public init(stringLiteral value: String) { self = .string(value) }
    public init(integerLiteral value: Int64) { self = .integer(value) }
    public init(booleanLiteral value: Bool) { self = .bool(value) }
    public init(floatLiteral value: Double) { self = .number(value) }
    public init(nilLiteral: ()) { self = .null }
    public init(arrayLiteral elements: LogValue...) { self = .array(elements) }
    public init(dictionaryLiteral elements: (String, LogValue)...) {
        self = .object(Dictionary(elements, uniquingKeysWith: { _, last in last }))
    }
}

public enum LogLevel: String, Sendable, Codable, CaseIterable {
    case trace, debug, info, warn, error, fatal, silent
    var priority: Int {
        switch self {
        case .trace: 0
        case .debug: 1
        case .info: 2
        case .warn: 3
        case .error: 4
        case .fatal: 5
        case .silent: 6
        }
    }
}

public struct LogContext: Sendable {
    public var requestId: String?
    public var operationId: String?
    public var traceId: String?
    public var spanId: String?
    public var method: String?
    public var path: String?
    public var source: LogSource?
    public var data: [String: LogValue]

    public init(
        requestId: String? = nil, operationId: String? = nil,
        traceId: String? = nil, spanId: String? = nil, method: String? = nil,
        path: String? = nil, source: LogSource? = nil, data: [String: LogValue] = [:]
    ) {
        self.requestId = requestId
        self.operationId = operationId
        self.traceId = traceId
        self.spanId = spanId
        self.method = method
        self.path = path
        self.source = source
        self.data = data
    }
}

public enum LogSource: String, Sendable, Codable { case server, client, job, cli }

public struct LogRecord: Sendable, Codable, Equatable {
    public let schemaVersion: Int
    public let timestamp: String
    public let level: LogLevel
    public var message: String
    public let service: String
    public let environment: String
    public let runtime: String
    public let release: String?
    public let scope: String?
    public let requestId: String?
    public let operationId: String?
    public let traceId: String?
    public let spanId: String?
    public let method: String?
    public let path: String?
    public let source: LogSource?
    public var data: [String: LogValue]?
    public var error: [String: LogValue]?

    public func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(self)
    }
}

public enum LoggingConfigurationError: Error {
    case invalidIdentity(String)
    case invalidEndpoint, invalidLimit
}

public struct LoggerOptions: Sendable {
    public let service: String
    public let environment: String
    public let runtime: String
    public let release: String?
    public let level: LogLevel
    public let redact: Set<String>
    public let clock: @Sendable () -> Date

    public init(
        service: String, environment: String, runtime: String = "swift",
        release: String? = nil, level: LogLevel? = nil, redact: Set<String> = [],
        clock: @escaping @Sendable () -> Date = { Date() }
    ) throws {
        for (name, value, limit) in [
            ("service", service, 128), ("environment", environment, 64),
            ("runtime", runtime, 64), ("release", release ?? "-", 128),
        ] {
            guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                value.utf16.count <= limit,
                !value.unicodeScalars.contains(where: {
                    CharacterSet.controlCharacters.contains($0)
                })
            else { throw LoggingConfigurationError.invalidIdentity(name) }
        }
        self.service = service
        self.environment = environment
        self.runtime = runtime
        self.release = release
        self.level = level ?? (environment == "development" ? .debug : .info)
        self.redact = redact
        self.clock = clock
    }
}
