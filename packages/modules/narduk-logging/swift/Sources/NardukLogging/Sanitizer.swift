import Foundation

public enum LogSanitizer {
    static let maxRecordBytes = 16 * 1024
    static let sensitive: Set<String> = [
        "password", "passwd", "secret", "token", "apikey", "authorization", "proxyauthorization",
        "cookie", "cookies", "setcookie", "session", "sessionid", "privatekey", "clientsecret",
        "body", "requestbody", "responsebody", "payload", "payment", "cardnumber", "cvv", "email",
        "phone", "address", "latitude", "longitude", "prompt", "completion",
    ]

    static func clean(_ value: String, limit: Int = 2048) -> String {
        String(
            String.UnicodeScalarView(
                value.unicodeScalars.prefix(limit).map {
                    $0.value < 32 || (127...159).contains($0.value) ? Unicode.Scalar(32) : $0
                }))
    }

    static func normalized(_ key: String) -> String {
        String(
            String.UnicodeScalarView(
                key.lowercased().unicodeScalars.filter {
                    (97...122).contains($0.value) || (48...57).contains($0.value)
                }))
    }

    public static func url(_ value: String) -> String {
        guard !value.isEmpty else { return "[empty]" }
        guard var components = URLComponents(string: value) else { return "[invalid URL]" }
        if value.hasPrefix("/"), !value.hasPrefix("//") {
            return clean(
                components.percentEncodedPath.isEmpty ? "/" : components.percentEncodedPath,
                limit: 512)
        }
        guard let scheme = components.scheme?.lowercased() else { return "[invalid URL]" }
        guard scheme == "http" || scheme == "https" else { return "[unsupported URL]" }
        guard let host = components.host, !host.isEmpty else { return "[invalid URL]" }
        components.host = host.lowercased()
        components.scheme = scheme
        components.user = nil
        components.password = nil
        components.query = nil
        components.fragment = nil
        if (scheme == "http" && components.port == 80)
            || (scheme == "https" && components.port == 443)
        {
            components.port = nil
        }
        if components.path.isEmpty { components.path = "/" }
        return components.string.map { clean($0, limit: 512) } ?? "[invalid URL]"
    }

    public static func fields(_ fields: [String: LogValue], redact: Set<String> = []) -> [String:
        LogValue]
    {
        let extra = Set(redact.map(normalized))
        var nodes = 0
        func walk(_ value: LogValue, key: String = "", depth: Int = 0) -> LogValue {
            let normalizedKey = normalized(key)
            if sensitive.contains(normalizedKey) || extra.contains(normalizedKey)
                || ["token", "password", "secret"].contains(where: normalizedKey.hasSuffix)
            {
                return "[REDACTED]"
            }
            if case .private = value { return "[REDACTED]" }
            nodes += 1
            guard depth <= 6, nodes <= 500 else { return "[Truncated]" }
            switch value {
            case .null, .bool: return value
            case .integer(let number):
                return number > 9_007_199_254_740_991 || number < -9_007_199_254_740_991
                    ? .string(String(number)) : value
            case .number(let number): return number.isFinite ? value : .string(String(number))
            case .string(let string):
                let key = key.lowercased()
                return .string(
                    key.hasSuffix("url") || key.hasSuffix("uri") ? url(string) : clean(string))
            case .array(let array):
                var result = array.prefix(50).map { walk($0, depth: depth + 1) }
                if array.count > 50 { result.append("[Truncated]") }
                return .array(result)
            case .object(let object):
                var result: [String: LogValue] = [:]
                for (key, value) in object.prefix(50)
                where !["__proto__", "prototype", "constructor"].contains(key) {
                    result[clean(key, limit: 128)] = walk(value, key: key, depth: depth + 1)
                }
                return .object(result)
            case .private: return "[REDACTED]"
            }
        }
        guard case .object(let result) = walk(.object(fields)) else { return [:] }
        return result
    }

    public static func error(_ error: any Error) -> [String: LogValue] {
        var seen: Set<ObjectIdentifier> = []
        func walk(_ error: any Error, depth: Int) -> [String: LogValue] {
            let native = error as NSError
            guard depth < 6, seen.insert(ObjectIdentifier(native)).inserted else {
                return ["name": "Error", "message": "[Circular or truncated cause]"]
            }
            var result: [String: LogValue] = [
                "name": .string(clean(native.domain, limit: 256)),
                "message": .string(clean(native.localizedDescription)),
                "code": .string(String(native.code)),
            ]
            if let cause = native.userInfo[NSUnderlyingErrorKey] as? any Error {
                result["cause"] = .object(walk(cause, depth: depth + 1))
            }
            return result
        }
        return walk(error, depth: 0)
    }

    static func errorFields(_ value: LogValue, depth: Int = 0) -> [String: LogValue] {
        guard depth < 6, case .object(let fields) = value else {
            return ["name": "Error", "message": "Non-error thrown"]
        }
        var result: [String: LogValue] = ["name": "Error", "message": "Non-error thrown"]
        for key in ["name", "message", "code", "stack"] {
            if case .string(let string) = fields[key] { result[key] = .string(clean(string)) }
        }
        if let cause = fields["cause"] {
            result["cause"] = .object(errorFields(cause, depth: depth + 1))
        }
        return result
    }

    static func context(_ context: LogContext, redact: Set<String>) -> LogContext {
        var result = context
        result.requestId = context.requestId.map { clean($0, limit: 128) }
        result.operationId = context.operationId.map { clean($0, limit: 128) }
        result.method = context.method.map { clean($0, limit: 32) }
        result.path = context.path.map(url)
        func validHex(_ value: String?, length: Int) -> String? {
            guard let value, value.count == length,
                value.allSatisfy({ "0123456789abcdef".contains($0) })
            else { return nil }
            return value
        }
        result.traceId = validHex(context.traceId, length: 32)
        result.spanId = validHex(context.spanId, length: 16)
        result.data = fields(context.data, redact: redact)
        return result
    }
}
