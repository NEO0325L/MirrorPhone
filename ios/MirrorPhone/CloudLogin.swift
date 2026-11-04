import Foundation
import Combine
import CryptoKit
import AuthenticationServices
import Security
import UIKit

struct CloudCredentialStore {
    static func token(for origin: String) -> String? {
        let query: [String:Any] = [kSecClass as String:kSecClassGenericPassword,
            kSecAttrService as String:"com.mirrorphone.cloud", kSecAttrAccount as String:origin,
            kSecReturnData as String:true, kSecMatchLimit as String:kSecMatchLimitOne]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary,&result) == errSecSuccess, let data=result as? Data else { return nil }
        return String(data:data,encoding:.utf8)
    }
    static func save(_ token:String, origin:String) throws {
        let query:[String:Any] = [kSecClass as String:kSecClassGenericPassword,
            kSecAttrService as String:"com.mirrorphone.cloud",kSecAttrAccount as String:origin]
        let data=Data(token.utf8)
        let status=SecItemUpdate(query as CFDictionary,[kSecValueData as String:data] as CFDictionary)
        if status == errSecItemNotFound {
            var add=query;add[kSecValueData as String]=data
            add[kSecAttrAccessible as String]=kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            guard SecItemAdd(add as CFDictionary,nil) == errSecSuccess else { throw MirrorError(message:"No se pudo guardar el acceso protegido.") }
        } else if status != errSecSuccess { throw MirrorError(message:"No se pudo actualizar el acceso protegido.") }
    }
}

@MainActor
final class CloudLogin: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    @Published var status = "Autoriza este iPhone una vez con tu clave privada de MirrorPhone."
    @Published var busy = false
    private var authentication: ASWebAuthenticationSession?
    nonisolated static let fixedServer = "https://mirrorphone-server.caradeboli.workers.dev"
    nonisolated static func supports(_ url:URL) -> Bool {
        guard url.scheme=="https",let host=url.host?.lowercased(),url.user==nil,url.password==nil,url.query==nil,url.fragment==nil,url.path.isEmpty||url.path=="/" else {return false}
        return host.hasSuffix(".chatgpt.site") || (host=="mirrorphone-server.caradeboli.workers.dev" && (url.port==nil || url.port==443))
    }
    static func origin(_ url:URL) -> String { var c=URLComponents();c.scheme=url.scheme;c.host=url.host;c.port=url.port==443 ? nil:url.port;return c.string ?? "" }
    static func encode(_ data:Data)->String {data.base64EncodedString().replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"")}
    static func decode(_ text:String)throws->Data {var raw=text.replacingOccurrences(of:"-",with:"+").replacingOccurrences(of:"_",with:"/");raw += String(repeating:"=",count:(4-raw.count%4)%4);guard let data=Data(base64Encoded:raw) else {throw MirrorError(message:"Autorización inválida.")};return data}
    func connect(address:String) {
        guard !busy,let base=URL(string:address.trimmingCharacters(in:.whitespacesAndNewlines)),Self.supports(base) else {status="Introduce el enlace HTTPS privado de MirrorPhone.";return}
        let origin=Self.origin(base),privateKey=P256.KeyAgreement.PrivateKey()
        var bytes=Data(count:24)
        guard bytes.withUnsafeMutableBytes({SecRandomCopyBytes(kSecRandomDefault,24,$0.baseAddress!)}) == errSecSuccess else {status="No se pudo iniciar la autorización.";return}
        let state=Self.encode(bytes)
        var url=URLComponents(string:origin+"/device/connect")!
        url.queryItems=[URLQueryItem(name:"platform",value:"ios"),URLQueryItem(name:"pub",value:Self.encode(privateKey.publicKey.x963Representation)),URLQueryItem(name:"state",value:state),URLQueryItem(name:"redirect",value:"mirrorphone://cloud-login")]
        let session=ASWebAuthenticationSession(url:url.url!,callbackURLScheme:"mirrorphone") { [weak self] callback,error in
            Task { @MainActor in
                guard let self else {return};defer{self.busy=false;self.authentication=nil}
                if error != nil {self.status="Autorización cancelada. Puedes volver a conectar la cuenta.";return}
                do {
                    guard let callback,callback.scheme=="mirrorphone",callback.host=="cloud-login",let parts=URLComponents(url:callback,resolvingAgainstBaseURL:false),parts.queryItems?.first(where:{$0.name=="state"})?.value==state,let raw=parts.queryItems?.first(where:{$0.name=="box"})?.value else {throw MirrorError(message:"La autorización no pertenece a esta solicitud.")}
                    let envelope=try JSONDecoder().decode(Envelope.self,from:Self.decode(raw))
                    let publicKey=try P256.KeyAgreement.PublicKey(x963Representation:Self.decode(envelope.pub))
                    let shared=try privateKey.sharedSecretFromKeyAgreement(with:publicKey)
                    let key=shared.hkdfDerivedSymmetricKey(using:SHA256.self,salt:try Self.decode(envelope.salt),sharedInfo:Data(("MirrorPhone cloud login v1:"+state).utf8),outputByteCount:32)
                    let data=try Self.decode(envelope.ciphertext)
                    guard data.count>16 else {throw MirrorError(message:"Autorización incompleta.")}
                    let sealed=try AES.GCM.SealedBox(nonce:try AES.GCM.Nonce(data:Self.decode(envelope.iv)),ciphertext:Data(data.dropLast(16)),tag:Data(data.suffix(16)))
                    let result=try JSONDecoder().decode(Credential.self,from:AES.GCM.open(sealed,using:key,authenticating:Data(origin.utf8)))
                    guard result.origin==origin,result.token.count>=24 else {throw MirrorError(message:"La autorización pertenece a otro servicio.")}
                    try CloudCredentialStore.save(result.token,origin:origin);self.status="Cuenta conectada. Introduce el código del ordenador."
                }catch{self.status=error.localizedDescription}
            }
        }
        session.presentationContextProvider=self
        authentication=session;busy=true;status="Autoriza este iPhone con tu clave privada de MirrorPhone."
        if !session.start(){busy=false;authentication=nil;status="No se pudo abrir la autorización."}
    }
    func presentationAnchor(for session:ASWebAuthenticationSession)->ASPresentationAnchor {
        UIApplication.shared.connectedScenes.compactMap{$0 as? UIWindowScene}.flatMap{$0.windows}.first(where:{$0.isKeyWindow}) ?? ASPresentationAnchor()
    }
    private struct Envelope:Decodable {let pub:String;let salt:String;let iv:String;let ciphertext:String}
    private struct Credential:Decodable {let origin:String;let token:String}
}
