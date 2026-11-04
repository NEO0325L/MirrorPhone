import SwiftUI

struct ContentView: View {
    @StateObject private var model = BroadcastModel()
    @StateObject private var cloudLogin = CloudLogin()
    @AppStorage("serverAddress") private var serverAddress = CloudLogin.fixedServer
    @AppStorage("cloudflareServerMigrated") private var cloudflareServerMigrated = false
    @State private var room = ""
    @State private var accessKey = ""
    @AppStorage("quality") private var quality = 1080
    @AppStorage("targetFPS") private var fps = 30
    @FocusState private var focusedField: Field?
    @Environment(\.colorScheme) private var colorScheme

    private enum Field: Hashable { case server, room, key }
    private let mint = Color(red: 0.49, green: 0.84, blue: 0.75)
    private var isLive: Bool { model.busy && model.status.contains("Transmitiendo") }
    private var canConnect: Bool {
        !serverAddress.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && room.count == 6
    }
    private var cardColor: Color { Color(uiColor: .secondarySystemGroupedBackground) }
    private var statusTitle: String {
        if model.error != nil { return "Revisar conexión" }
        if isLive { return "En directo" }
        return model.busy ? "Conectando" : "Listo"
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    header
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Tu pantalla,\nen el ordenador.")
                            .font(.system(.largeTitle, design: .rounded, weight: .semibold))
                            .tracking(-0.8)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("Imagen y sonido, juntos.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    connectionCard
                    qualityCard
                    transmissionControls
                    if let notice=model.networkNotice {Text(notice).font(.footnote).foregroundStyle(.secondary)}
                    Label("Activa el sonido en MirrorPhone del ordenador.", systemImage: "speaker.wave.2")
                        .font(.footnote).foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                }
                .frame(maxWidth: 560)
                .padding(.horizontal, 24)
                .padding(.top, 16)
                .padding(.bottom, 30)
                .frame(maxWidth: .infinity)
            }
            .background(Color(uiColor: .systemGroupedBackground))
            .scrollDismissesKeyboard(.interactively)
            .toolbar(.hidden, for: .navigationBar)
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Listo") { focusedField = nil }
                }
            }
        }
        .onAppear {
            if !cloudflareServerMigrated && !model.busy {serverAddress=CloudLogin.fixedServer;cloudflareServerMigrated=true}
        }
        .tint(colorScheme == .dark ? mint : Color(red: 0.13, green: 0.39, blue: 0.33))
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image("MirrorMark")
                .resizable().scaledToFit().frame(width: 38, height: 38)
                .clipShape(RoundedRectangle(cornerRadius: 11))
                .accessibilityHidden(true)
            Text("MirrorPhone").font(.headline)
            Spacer(minLength: 8)
            HStack(spacing: 6) {
                Circle().fill(model.error != nil ? Color.orange : isLive ? mint : Color.secondary.opacity(0.5))
                    .frame(width: 6, height: 6)
                Text(statusTitle).font(.caption).fontWeight(.medium)
            }
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(.primary.opacity(0.04), in: Capsule())
            .accessibilityElement(children: .combine)
        }
    }

    private var connectionCard: some View {
        VStack(alignment: .leading, spacing: 20) {
            Label("Conexión", systemImage: "link")
                .font(.subheadline.weight(.semibold))
            VStack(alignment: .leading, spacing: 8) {
                Text("Servidor").font(.caption).foregroundStyle(.secondary)
                TextField(CloudLogin.fixedServer, text: $serverAddress)
                    .font(.subheadline).keyboardType(.URL)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .focused($focusedField, equals: .server).submitLabel(.next)
                    .onSubmit { focusedField = .room }
                    .accessibilityLabel("Dirección del servidor")
            }
            if serverAddress != CloudLogin.fixedServer {
                Button("Usar mi enlace fijo") {serverAddress=CloudLogin.fixedServer}
                    .font(.footnote)
            }
            Divider().opacity(0.65)
            VStack(alignment: .leading, spacing: 8) {
                Text("Código de sala").font(.caption).foregroundStyle(.secondary)
                TextField("000000", text: $room)
                    .font(.system(.title2, design: .monospaced, weight: .medium))
                    .tracking(6).keyboardType(.numberPad)
                    .focused($focusedField, equals: .room)
                    .accessibilityLabel("Código de sala de seis dígitos")
                    .onChange(of: room) { _, value in
                        let digits = String(value.filter { $0 >= "0" && $0 <= "9" }.prefix(6))
                        if value != digits { room = digits }
                    }
            }
            if let remoteURL=URL(string:serverAddress.trimmingCharacters(in:.whitespacesAndNewlines)), CloudLogin.supports(remoteURL), remoteURL.host?.lowercased() != "mirrorphone-server.caradeboli.workers.dev" {
                Divider().opacity(0.65)
                Button { focusedField=nil;cloudLogin.connect(address:serverAddress) } label: {
                    Label(cloudLogin.busy ? "Autorizando…" : "Conectar cuenta",systemImage:"person.crop.circle.badge.checkmark")
                }.disabled(cloudLogin.busy)
                Text(cloudLogin.status).font(.footnote).foregroundStyle(.secondary)
            } else if let customURL=URL(string:serverAddress), customURL.scheme == "https", customURL.host?.lowercased() != "mirrorphone-server.caradeboli.workers.dev" {
                Divider().opacity(0.65)
                VStack(alignment: .leading, spacing: 8) {
                    Text("Acceso remoto").font(.caption).foregroundStyle(.secondary)
                    SecureField("Clave del servidor", text: $accessKey)
                        .font(.subheadline).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .focused($focusedField, equals: .key).submitLabel(.done)
                        .onSubmit { focusedField = nil }
                        .accessibilityLabel("Clave del servidor remoto")
                }
            }
        }
        .padding(22)
        .background(cardColor, in: RoundedRectangle(cornerRadius: 24))
        .disabled(model.busy)
        .opacity(model.busy ? 0.7 : 1)
    }

    private var qualityCard: some View {
        VStack(alignment: .leading, spacing: 18) {
            Label("Calidad", systemImage: "slider.horizontal.3")
                .font(.subheadline.weight(.semibold))
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 22) {
                    resolutionPicker
                    Divider().frame(height: 48)
                    frameRatePicker
                }
                VStack(alignment: .leading, spacing: 18) {
                    resolutionPicker
                    Divider()
                    frameRatePicker
                }
            }
            Text("Estos valores son máximos. La imagen se adapta a la conexión.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(22)
        .background(cardColor, in: RoundedRectangle(cornerRadius: 24))
        .disabled(model.busy)
        .opacity(model.busy ? 0.7 : 1)
    }

    private var resolutionPicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Resolución").font(.caption).foregroundStyle(.secondary)
            Picker("Resolución", selection: $quality) {
                Text("720p").tag(720)
                Text("1080p").tag(1080)
            }
            .pickerStyle(.menu).labelsHidden()
            .font(.headline).padding(.leading, -12)
            .accessibilityLabel("Resolución")
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private var frameRatePicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Fluidez").font(.caption).foregroundStyle(.secondary)
            Picker("FPS máximos", selection: $fps) {
                Text("30 FPS").tag(30)
                Text("60 FPS").tag(60)
            }
            .pickerStyle(.menu).labelsHidden()
            .font(.headline).padding(.leading, -12)
            .accessibilityLabel("FPS máximos")
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private var transmissionControls: some View {
        VStack(spacing: 12) {
            Button {
                focusedField = nil
                Task {
                    if model.busy { await model.stop() }
                    else { await model.connect(address: serverAddress, code: room, quality: quality, fps: fps, accessKey: accessKey) }
                }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: model.busy ? "stop.fill" : "rectangle.on.rectangle")
                    Text(model.busy ? "Finalizar transmisión" : "Compartir pantalla")
                        .fontWeight(.semibold)
                }
                .font(.subheadline)
                .frame(maxWidth: .infinity).padding(.vertical, 18)
                .foregroundStyle(model.busy ? Color.primary : Color(red: 0.07, green: 0.17, blue: 0.15))
                .background(model.busy ? cardColor : mint, in: RoundedRectangle(cornerRadius: 18))
                .overlay {
                    if model.busy { RoundedRectangle(cornerRadius: 18).strokeBorder(.primary.opacity(0.12)) }
                }
            }
            .buttonStyle(.plain)
            .disabled(!model.busy && !canConnect)
            .opacity(!model.busy && !canConnect ? 0.5 : 1)
            Text(model.error ?? (model.busy ? model.status : "Confirma la captura cuando iOS te lo pida."))
                .font(.footnote)
                .foregroundStyle(model.error != nil ? Color.red : Color.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(model.error != nil ? .updatesFrequently : [])
        }
    }
}

#Preview("MirrorPhone") { ContentView() }
#Preview("Modo oscuro") { ContentView().preferredColorScheme(.dark) }
