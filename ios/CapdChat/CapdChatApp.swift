import SwiftUI

@main
struct CapdChatApp: App {
    @StateObject private var model = SessionModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                .preferredColorScheme(.dark)
                .onChange(of: scenePhase) { _, phase in
                    if phase == .background {
                        model.pauseForBackground()
                    } else if phase == .active {
                        model.resumeIfNeeded()
                    }
                }
        }
    }
}
