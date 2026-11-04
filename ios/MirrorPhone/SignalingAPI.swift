import Foundation

struct MirrorError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

struct SignalingAPI {
    let base: URL
    private let serviceToken: String?
    private let privateSite: Bool
    private let privateCloud: Bool
    init(address: String) throws {
        let text = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: text), ["http", "https"].contains(url.scheme ?? ""), let host = url.host,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/" else {
            throw MirrorError(message: "Introduce la dirección local o el enlace HTTPS de MirrorPhone.")
        }
        privateSite = url.scheme == "https" && host.lowercased().hasSuffix(".chatgpt.site")
        privateCloud = CloudLogin.supports(url)
        var components=URLComponents();components.scheme=url.scheme;components.host=url.host;components.port=url.port==443 ? nil:url.port
        serviceToken=privateSite ? CloudCredentialStore.token(for:components.string ?? "") : nil
        if url.scheme == "https" { base = url; return }
        let octets = host.split(separator: ".", omittingEmptySubsequences: false)
        let parts = octets.compactMap { Int($0) }
        guard octets.count == 4, parts.count == 4, parts.allSatisfy({ (0...255).contains($0) }),
              parts[0] == 10 || (parts[0] == 192 && parts[1] == 168) ||
              (parts[0] == 172 && (16...31).contains(parts[1])) ||
              (parts[0] == 169 && parts[1] == 254) else {
            throw MirrorError(message: "Usa la IP privada del PC en tu red local. No uses localhost ni una dirección de internet.")
        }
        base = url
    }
    func request(_ path: String, body: [String: Any]? = nil, token: String? = nil) async throws -> [String: Any] {
        guard let url = URL(string: path, relativeTo: base)?.absoluteURL else { throw MirrorError(message: "Dirección inválida.") }
        if privateSite && serviceToken == nil && path != "/api/health" { throw MirrorError(message:"Pulsa Conectar cuenta para autorizar este iPhone en el servicio privado.") }
        var request = URLRequest(url: url, timeoutInterval: path.hasPrefix("/api/events") ? 25 : 8)
        request.httpMethod = body == nil ? "GET" : "POST"
        if let serviceToken { request.setValue("Bearer \(serviceToken)",forHTTPHeaderField:privateSite ? "OAI-Sites-Authorization" : "X-MirrorPhone-Authorization") }
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let session=privateCloud ? PrivateSignalingSession.shared : URLSession.shared
        let (data, response) = try await session.data(for: request)
        if privateCloud, let http=response as? HTTPURLResponse, [301,302,303,307,308].contains(http.statusCode) {
            throw MirrorError(message:"Vuelve a conectar tu cuenta para autorizar el acceso a MirrorPhone.")
        }
        guard let http = response as? HTTPURLResponse,
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw MirrorError(message: "El servidor no respondió como MirrorPhone.")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw MirrorError(message: json["error"] as? String ?? "Error del servidor: \(http.statusCode).")
        }
        return json
    }
}

// Never forward the private Site credential through a redirect to another host.
private final class PrivateSignalingSession: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    static let delegate=PrivateSignalingSession()
    static let shared=URLSession(configuration:.ephemeral,delegate:delegate,delegateQueue:nil)
    func urlSession(_ session:URLSession, task:URLSessionTask, willPerformHTTPRedirection response:HTTPURLResponse, newRequest request:URLRequest, completionHandler:@escaping (URLRequest?)->Void) {completionHandler(nil)}
}
