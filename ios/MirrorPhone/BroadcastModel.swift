import Foundation
import Combine
import UIKit
@preconcurrency import ScreenCaptureKit

@MainActor
final class BroadcastModel: ObservableObject {
    @Published var status = "Listo para conectar"
    @Published var error: String?
    @Published var busy = false
    @Published var networkNotice: String?
    private var api: SignalingAPI?
    private var token: String?
    private var stream: SCStream?
    private var pipeline: VideoPipeline?
    private var polling: Task<Void, Never>?
    private var generation = 0
    private var quality = 1080
    private var fps = 30
    private var answerReady = false
    private var supportsLongPolling = false
    private var candidates: [[String: Any]] = []
    private let captureQueue = DispatchQueue(label: "mirrorphone.capture", qos: .userInteractive)
    private let audioQueue = DispatchQueue(label: "mirrorphone.audio", qos: .userInitiated)
    private lazy var observer = PickerObserver(model: self)
    private var observing = false

    func connect(address: String, code: String, quality: Int, fps: Int, accessKey: String = "") async {
        guard !busy else { return }
        generation += 1
        let current = generation
        busy = true; error = nil; networkNotice = nil; status = "Conectando al servidor…"
        self.quality = quality; self.fps = fps
        do {
            let api = try SignalingAPI(address: address)
            let health = try await api.request("/api/health")
            guard health["service"] as? String == "MirrorPhone", [1,2].contains(health["version"] as? Int ?? 0) else {
                throw MirrorError(message: "Este servidor no es compatible con MirrorPhone.")
            }
            guard current == generation else { return }
            if health["configured"] as? Bool == false {throw MirrorError(message:"El servidor remoto todavía no está configurado.")}
            if health["relayConfigured"] as? Bool == false {networkNotice="Relé pendiente: se intentará una conexión directa. Algunas redes pueden impedirla."}
            supportsLongPolling = health["eventWait"] as? Bool ?? false
            let joined = try await api.request("/api/join", body: ["code":code, "accessKey":accessKey])
            guard let token = joined["token"] as? String else { throw MirrorError(message: "El servidor no entregó una sesión.") }
            guard current == generation else { _ = try? await api.request("/api/leave", body: [:], token: token); return }
            self.api = api; self.token = token
            polling = Task { await self.poll(current: current) }
            let picker = SCContentSharingPicker.shared
            guard picker.isAvailable else { throw MirrorError(message: "La captura de pantalla no está disponible en este iPhone.") }
            if !observing { picker.add(observer); observing = true }
            picker.defaultConfiguration = SCContentSharingPickerConfiguration()
            picker.isActive = true
            status = "Autoriza compartir la pantalla en iOS"
            picker.present()
        } catch { if current == generation { await fail(error) } }
    }

    func startCapture(filter: SCContentFilter) async {
        guard busy, pipeline == nil, let api, let token else { return }
        let current = generation
        let rect = filter.contentRect
        let native = (UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first?.screen.nativeBounds.size)
            ?? CGSize(width:1170, height:2532)
        let pixelScale = max(1, Double(filter.pointPixelScale))
        let size = rect.width > 0 && rect.height > 0
            ? CGSize(width:rect.width * pixelScale, height:rect.height * pixelScale) : native
        let outputSize = CaptureResolution.outputSize(for: size, shortEdge: quality)
        let width = Int(outputSize.width), height = Int(outputSize.height)
        let ice: [String: Any]
        do { ice = try await api.request("/api/ice", token:token) }
        catch { if current == generation { await fail(error) }; return }
        guard current == generation else { return }
        if let warning=ice["networkWarning"] as? String {networkNotice=warning}
        let pipeline = VideoPipeline(width:width, height:height, fps:fps, iceServers: ice["iceServers"] as? [[String: Any]] ?? [])
        self.pipeline = pipeline
        pipeline.onSignal = { [weak self] message in
            Task { @MainActor in
                guard let self, self.generation == current else { return }
                do { _ = try await api.request("/api/signal", body:message, token:token) }
                catch { if self.generation == current { await self.fail(error) } }
            }
        }
        pipeline.onState = { [weak self] value in
            Task { @MainActor in if self?.generation == current { self?.status = value } }
        }
        pipeline.onFailure = { [weak self] error in
            Task { @MainActor in if self?.generation == current { await self?.fail(error) } }
        }
        let configuration = SCStreamConfiguration()
        configuration.width = width; configuration.height = height
        configuration.capturesAudio = true
        configuration.sampleRate = 48_000
        configuration.channelCount = 2
        configuration.excludesCurrentProcessAudio = false
        let newStream = SCStream(filter:filter, configuration:configuration, delegate:pipeline)
        self.stream = newStream
        do {
            try newStream.addStreamOutput(pipeline, type:.screen, sampleHandlerQueue:captureQueue)
            try newStream.addStreamOutput(pipeline, type:.audio, sampleHandlerQueue:audioQueue)
            try await newStream.startCapture()
            guard current == generation else { try? await newStream.stopCapture(); return }
            let sdp = try await pipeline.offer()
            guard current == generation else { return }
            _ = try await api.request("/api/signal", body:["type":"offer", "sdp":sdp], token:token)
            status = "Conectando vídeo…"
        } catch { if current == generation { await fail(error) } }
    }

    private func poll(current: Int) async {
        guard let api, let token else { return }
        var cursor = 0, failures = 0
        while !Task.isCancelled && generation == current {
            do {
                let response = try await api.request("/api/events?after=\(cursor)\(supportsLongPolling ? "&wait=20" : "")", token:token)
                guard generation == current else { return }
                for event in response["events"] as? [[String: Any]] ?? [] {
                    if event["type"] as? String == "answer", let sdp = event["sdp"] as? String, let pipeline {
                        try await pipeline.answer(sdp)
                        answerReady = true
                        for candidate in candidates { try await pipeline.addCandidate(candidate) }
                        candidates.removeAll()
                    } else if event["type"] as? String == "candidate" {
                        if answerReady, let pipeline { try await pipeline.addCandidate(event) }
                        else { candidates.append(event) }
                    }
                    cursor = event["id"] as? Int ?? cursor
                }
                failures = 0
            } catch {
                guard generation == current, !Task.isCancelled else { return }
                failures += 1
                if failures >= 4 { await fail(error); return }
            }
            if failures > 0 { try? await Task.sleep(for: .seconds(1)) }
            else if !supportsLongPolling { try? await Task.sleep(for: .milliseconds(answerReady ? 2000 : 350)) }
        }
    }

    func stop() async {
        generation += 1
        polling?.cancel(); polling = nil
        let oldStream = stream, oldPipeline = pipeline, oldAPI = api, oldToken = token
        stream = nil; pipeline = nil; api = nil; token = nil
        answerReady = false; candidates.removeAll()
        let picker = SCContentSharingPicker.shared
        if observing { picker.remove(observer); observing = false }
        picker.isActive = false
        oldPipeline?.close()
        if let oldStream { try? await oldStream.stopCapture() }
        if let oldAPI, let oldToken { _ = try? await oldAPI.request("/api/leave", body:[:], token:oldToken) }
        busy = false; status = "Desconectado"
    }
    func fail(_ failure: Error) async {
        await stop()
        error = failure.localizedDescription; status = "No se pudo continuar"
    }
    func pickerCancelled() async { if pipeline == nil { await stop() } }
}

private final class PickerObserver: NSObject, SCContentSharingPickerObserver {
    weak var model: BroadcastModel?
    init(model: BroadcastModel) { self.model = model }
    func contentSharingPicker(_ picker: SCContentSharingPicker, didUpdateWith filter: SCContentFilter, for stream: SCStream?) {
        Task { @MainActor in await model?.startCapture(filter: filter) }
    }
    func contentSharingPicker(_ picker: SCContentSharingPicker, didCancelFor stream: SCStream?) {
        Task { @MainActor in await model?.pickerCancelled() }
    }
    func contentSharingPickerStartDidFailWithError(_ error: Error) {
        Task { @MainActor in await model?.fail(error) }
    }
}
