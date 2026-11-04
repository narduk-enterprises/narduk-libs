#if os(macOS)
    import Combine
    import Foundation
    import NardukAppKit
    import Observation
    import Sparkle
    import SwiftUI
    import UserNotifications

    /// A new version found this run, for the app's status bar. It stays until the update installs or is skipped, so
    /// "Remind Me Later" and a missed notification still leave a way in from inside the app.
    @MainActor @Observable
    public final class UpdateStatus {
        public static let shared = UpdateStatus()
        public private(set) var available: String?
        @ObservationIgnored public var open: @MainActor () -> Void = {}

        public init() {}

        public func found(_ version: String) { available = version }
        public func settled() { available = nil }
    }

    /// Finish the app's normal save before Sparkle terminates the process for an update.
    @MainActor
    public final class UpdaterHooks: NSObject, SPUUpdaterDelegate {
        public var beforeRelaunch: @MainActor () async -> Bool = { true }

        override public init() { super.init() }

        public func updater(
            _ updater: SPUUpdater, userDidMake choice: SPUUserUpdateChoice, forUpdate updateItem: SUAppcastItem,
            state: SPUUserUpdateState
        ) {
            if choice == .skip { UpdateStatus.shared.settled() }
        }

        public func updater(
            _ updater: SPUUpdater, shouldPostponeRelaunchForUpdate item: SUAppcastItem,
            untilInvokingBlock installHandler: @escaping () -> Void
        ) -> Bool {
            Task { @MainActor in
                await prepareAndResumeInstallation(installHandler)
            }
            return true
        }

        /// The update installs only when `beforeRelaunch` answers true.
        public func prepareAndResumeInstallation(_ installHandler: () -> Void) async {
            guard await beforeRelaunch() else { return }
            installHandler()
        }
    }

    /// Announces a new version with a notification as soon as it is found, rather than an alert that waits behind the
    /// person's windows. Sparkle still shows its own alert when it would put it in front anyway (just launched, or back
    /// from idle), and whenever notifications are not allowed. Clicking the notification brings up Sparkle's update
    /// window.
    @MainActor
    final class UpdateReminders: NSObject, @preconcurrency SPUStandardUserDriverDelegate,
        UNUserNotificationCenterDelegate
    {
        let appName: String
        nonisolated let identifier: String
        var show: @MainActor () -> Void = {}
        /// Set once any update has been shown this run; the quick polling stops there and Sparkle's own schedule does
        /// the reminding, so a "Remind Me Later" is not undone fifteen minutes on.
        private(set) var announced = false
        private var notificationsAllowed = false

        init(appName: String, identifier: String) {
            self.appName = appName
            self.identifier = identifier
        }

        func requestPermission() async {
            _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
            await refreshPermission()
        }

        /// Follows a change made in System Settings since launch; never prompts.
        func refreshPermission() async {
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            notificationsAllowed =
                (settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional)
                && settings.alertSetting == .enabled
        }

        var supportsGentleScheduledUpdateReminders: Bool { true }

        func standardUserDriverShouldHandleShowingScheduledUpdate(
            _ update: SUAppcastItem, andInImmediateFocus immediateFocus: Bool
        ) -> Bool {
            immediateFocus || !notificationsAllowed
        }

        func standardUserDriverWillHandleShowingUpdate(
            _ handleShowingUpdate: Bool, forUpdate update: SUAppcastItem, state: SPUUserUpdateState
        ) {
            announced = true
            UpdateStatus.shared.found(update.displayVersionString)
            guard !handleShowingUpdate else { return }
            let content = UNMutableNotificationContent()
            content.title = "\(appName) \(update.displayVersionString) is available"
            content.body = "Click to see what’s new and update."
            content.sound = .default
            // If the banner cannot be posted, fall back to Sparkle's alert so the update is never left unshown.
            let show = show
            UNUserNotificationCenter.current().add(
                UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
            ) { error in
                if error != nil { Task { @MainActor in show() } }
            }
        }

        func standardUserDriverDidReceiveUserAttention(forUpdate update: SUAppcastItem) { dismiss() }

        func standardUserDriverWillFinishUpdateSession() { dismiss() }

        private func dismiss() {
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [identifier])
        }

        nonisolated func userNotificationCenter(
            _ center: UNUserNotificationCenter, willPresent notification: UNNotification
        ) async -> UNNotificationPresentationOptions {
            [.banner, .list, .sound]
        }

        nonisolated func userNotificationCenter(
            _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
        ) async {
            guard response.notification.request.identifier == identifier else { return }
            await MainActor.run {
                NSApp.activate()
                show()
            }
        }
    }

    /// The updater for an ordinary UI app: Sparkle's standard driver and prompts. It starts only in the production
    /// build with a real public key, so a development build never looks for updates.
    @MainActor
    public final class AppUpdater: ObservableObject {
        /// How often a running app looks for a new version beyond Sparkle's own schedule. The feed is cached for five
        /// minutes, so a release reaches a running copy within about twenty.
        public static let pollInterval: Duration = .seconds(15 * 60)
        private let controller: SPUStandardUpdaterController?
        private let hooks = UpdaterHooks()
        private let reminders: UpdateReminders
        private var polling: Task<Void, Never>?
        @Published public private(set) var canCheck = false

        /// - Parameters:
        ///   - appName: Shown in the notification, such as "MyApp 1.2 is available".
        ///   - notificationIdentifier: The app's own id for that notification, such as `myapp-update-available`.
        ///   - beforeRelaunch: Saves the app's work. Answering false withholds the update.
        public init(
            identity: AppIdentity, appName: String, notificationIdentifier: String,
            beforeRelaunch: @escaping @MainActor () async -> Bool = { true }
        ) {
            reminders = UpdateReminders(appName: appName, identifier: notificationIdentifier)
            hooks.beforeRelaunch = beforeRelaunch
            guard identity.isProduction, UpdateFeed.isConfigured else {
                controller = nil
                return
            }
            UNUserNotificationCenter.current().delegate = reminders
            let controller = SPUStandardUpdaterController(
                startingUpdater: true, updaterDelegate: hooks, userDriverDelegate: reminders)
            self.controller = controller
            reminders.show = { [weak controller] in controller?.checkForUpdates(nil) }
            UpdateStatus.shared.open = reminders.show
            controller.updater.publisher(for: \.canCheckForUpdates).receive(on: RunLoop.main).assign(to: &$canCheck)
            let reminders = reminders
            // Asked apart from the polling, so an unanswered prompt never holds up the checks.
            Task { await reminders.requestPermission() }
            polling = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: Self.pollInterval)
                    await reminders.refreshPermission()
                    self?.checkQuietly()
                }
            }
        }

        /// A background check that finds only new, unskipped versions and announces them through `UpdateReminders`.
        private func checkQuietly() {
            guard let updater = controller?.updater, updater.automaticallyChecksForUpdates, !updater.sessionInProgress,
                !reminders.announced
            else { return }
            updater.checkForUpdatesInBackground()
        }

        public var isEnabled: Bool { controller != nil }

        public func check() { controller?.checkForUpdates(nil) }
    }

    /// "Check for Updates…" for the app menu. Greyed out in a development build, which has no key.
    public struct CheckForUpdatesButton: View {
        @ObservedObject var updater: AppUpdater

        public init(updater: AppUpdater) { self.updater = updater }

        public var body: some View {
            Button("Check for Updates…") { updater.check() }
                .disabled(!updater.canCheck)
        }
    }

    /// The "Update to X" pill for a status bar. It draws nothing until `UpdateStatus` has a version; `separator` is
    /// shown after the pill only then. The surrounding font and line limit come from the bar.
    public struct UpdatePill<Separator: View>: View {
        private let appName: String
        private let tint: Color
        private let separator: Separator

        public init(appName: String, tint: Color, @ViewBuilder separator: () -> Separator) {
            self.appName = appName
            self.tint = tint
            self.separator = separator()
        }

        public var body: some View {
            if let version = UpdateStatus.shared.available {
                Button {
                    UpdateStatus.shared.open()
                } label: {
                    Label("Update to \(version)", systemImage: "arrow.down.circle.fill").lineLimit(1)
                        .fontWeight(.semibold).padding(.horizontal, 8).padding(.vertical, 2)
                        .background(tint.opacity(0.16), in: Capsule())
                }
                .buttonStyle(.plain).foregroundStyle(tint).fixedSize()
                .help("\(appName) \(version) is ready. See what’s new and update.")
                separator
            }
        }
    }

    extension UpdatePill where Separator == EmptyView {
        public init(appName: String, tint: Color) {
            self.init(appName: appName, tint: tint) { EmptyView() }
        }
    }
#endif
