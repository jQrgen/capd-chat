# CAPD Chat for iPhone

A listen-only Nexa peer. While the app is open it speaks the Nexa P2P protocol directly, receives CAPD messages, and keeps them on the phone in the same group-chat feed as the website. It does not use Rostrum.

iOS will not keep this socket open once you leave the app. Listening pauses in the background and resumes when you come back, if you had pressed **Listen**.

## Why this is not libnexakotlin

[libnexakotlin](https://gitlab.com/nexa/libnexakotlin) does implement CAPD (`CapdMsg`, `P2pClient.installMsgMonitor`). Shipping that library on iPhone means compiling its native `libnexa` dependency, which is the Nexa C++ tree, and Kotlin/Native Apple targets only build on a Mac. `CapdMsg.hash`, `solve`, and `check` all call into that native library.

This app only needs to listen. The CAPD wire format is pure serialization, so `ios/shared` implements the messages itself and is tested on the JVM. The encodings follow Nexa, not a blind copy of the Kotlin wallet:

- Message header: 4-byte magic, 12-byte command, uint32 length, uint32 cookie. Nexa has no checksum. Mainnet magic is `72 27 12 21`. (`src/protocol.h`, `CMessageHeader`)
- `version` addresses are 26 bytes: services, 16-byte IPv4-mapped IP, big-endian port. Time is Unix seconds. Relay is off, and the only service bit advertised is `NODE_EXTVERSION`. (`src/net.cpp` `PushVersion`, `src/protocol.h` `CAddress`)
- `extversion` is a compact map. Values are themselves compact integers. CAPD is enabled on the peer only when `BU_CAPD_VERSION` (`0x000000020000000e`) is non-zero. (`src/extversionmessage.cpp`, `CNode::ReadConfigFromExtversion`)
- A CAPD message hash is `SHA256(SHA256(SHA256(preimage) || nonce))`, displayed reversed, matching `CapdMsg::CalcHash`. The preimage uses expiration `65535` when the field is omitted. (`src/capd/capdmsg.cpp`)
- There is no “every message” query. The app asks the peer to inventory new messages (`capdgetmsg` with priority 0) and, if you enter a 2, 4, 8, or 16 byte prefix, installs a `capdquery` notify for that prefix.

## Layout

| Path | What it is |
| --- | --- |
| `ios/shared` | Kotlin Multiplatform protocol, archive, and feed logic |
| `ios/CapdChat` | SwiftUI app and Xcode project |
| `ios/gradlew` | Builds the JVM tests, and on a Mac the `Shared` framework |

The website at the repository root is unchanged.

## Tests

JDK 17 or newer, on Linux or on the Mac:

```sh
cd ios
./gradlew :shared:jvmTest
```

Apple frameworks are registered only when Gradle is running on macOS. On a Mac, `./gradlew :shared:iosSimulatorArm64Test` runs the same protocol tests in the iOS simulator.

GitHub Actions splits the work. `.github/workflows/pages.yml` and the JVM protocol job stay on `ubuntu-latest`. The iOS build and simulator tests run on jQrgen's Mac mini:

```yaml
runs-on: [self-hosted, macOS, jqrgen-mac]
```

That job runs `iosSimulatorArm64Test`, then `xcodebuild` for the iOS Simulator and for a generic iOS device, with code signing turned off. A later TestFlight upload should use the same runner.

## Build on a Mac

1. Install Xcode 16 or newer, and a JDK 17 or newer (`java -version` in the same shell Xcode uses).
2. Open `ios/CapdChat/CapdChat.xcodeproj`.
3. Select the CapdChat target, Signing & Capabilities, and choose your Team. The bundle id is `org.nexa.capdchat`. Change it if that id is already taken on your account.
4. The first build phase runs `./gradlew :shared:embedAndSignAppleFrameworkForXcode`, which produces the static `Shared` framework for the selected SDK.
5. Run on an iPhone or the simulator. **Listen** connects to `seeder.nexa.org:7228` by default (testnet port 7230). **Demo pool** fills the feed without a peer.

User script sandboxing is off so Gradle can write the framework next to the project. The first Gradle run downloads Kotlin.

## TestFlight

1. Enroll in the Apple Developer Program. TestFlight needs a paid membership.
2. In App Store Connect, create an iOS app with the same bundle id (`org.nexa.capdchat`) and the name CAPD Chat.
3. In Xcode, set the target’s Team and a unique bundle id if you changed it. Version is 1.0 (build 1). Bump the build number for every upload.
4. Choose **Any iOS Device (arm64)** as the run destination. Product → Archive.
5. In the Organizer, **Distribute App** → **App Store Connect** → **Upload**.
6. Wait for processing. App Store Connect → TestFlight → Internal Testing, add yourself, and install from the TestFlight app.
7. Export compliance is already answered in the generated Info.plist (`ITSAppUsesNonExemptEncryption = NO`). The app uses TCP and SHA-256 for message identity. It does not implement its own encryption.

External TestFlight adds Apple’s beta review. Internal testing is enough for a first install.

When upload is automated, that job should use `runs-on: [self-hosted, macOS, jqrgen-mac]`, the same runner as the iOS build. It needs the Apple credentials kept on the Mac, not in the repository.

This repository was prepared on Linux, so the Xcode archive and an on-device screenshot were not produced here. The protocol tests, including a live handshake to a mainnet seed when port 7228 is reachable, are the check that runs in this environment.
