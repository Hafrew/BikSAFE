# BikSAFE Mobile App Store Port Plan

## Recommendation

Port BikSAFE with Capacitor first, then consider a native ML pipeline later.

Capacitor is the best first path because BikSAFE is already a static web app using browser camera, canvas, TensorFlow.js, audio, haptics, and local settings. Capacitor lets us wrap the current web code in native iOS and Android shells while keeping the web codebase largely intact.

## Porting Options

### Option 1: PWA

Pros:

- Fastest path.
- Already close to working.
- No App Store review.

Cons:

- Not a normal App Store download.
- Harder to monetize and market as a mobile app.
- iOS permissions, background behavior, and install UX are less predictable for mainstream users.

Use this for early testers, not the main launch.

### Option 2: Capacitor Native Wrapper

Pros:

- Real App Store and Google Play distribution.
- Keeps the current JavaScript engine.
- Can add native camera, haptics, wake lock, Bluetooth, and notifications over time.
- Lets us ship TestFlight and Android closed tests quickly.

Cons:

- Need Xcode, Android Studio, signing, store accounts, privacy disclosures, and device testing.
- WebView camera/WebGL performance must be tested on real phones.
- May eventually need native camera frames for better performance and reliability.

This is the recommended MVP route.

### Option 3: Full Native App

Pros:

- Best long-term performance and camera control.
- Easier to use TensorFlow Lite, Core ML, native camera APIs, Bluetooth/ANT accessories, and background services.
- Strongest path for hardware integrations.

Cons:

- Much slower rebuild.
- More duplicated iOS/Android engineering unless using React Native/Flutter.
- The current web app would become a prototype rather than the production codebase.

Use this only after the app proves demand.

## Capacitor Implementation Plan

1. Create app manifest metadata:
   - app name: `BikSAFE`
   - bundle id: likely `com.biksafe.app` or `com.hafrew.biksafe`
   - app icons, splash screen, launch colors

2. Add Capacitor:
   - install `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/android`
   - configure web assets to point at the existing static app
   - add iOS and Android platforms

3. Permissions:
   - iOS: add camera usage text in `Info.plist`
   - Android: add camera permission in `AndroidManifest.xml`
   - verify haptics and wake-lock behavior on both platforms

4. Camera/runtime testing:
   - test `getUserMedia` inside the native WebView on iPhone and Android
   - test front/rear camera switching
   - test TensorFlow.js WebGL backend
   - test thermal behavior and battery drain on a 20-30 minute ride simulation

5. Store readiness:
   - create privacy policy
   - document that video processing happens on-device if we keep it local
   - prepare App Store privacy details and Google Play Data safety answers
   - write safety disclaimer: rider must not rely solely on BikSAFE; always ride attentively

6. Beta release:
   - iOS: TestFlight
   - Android: internal or closed testing track
   - collect device matrix: iPhone model, Android model, FPS, battery drain, false positives, missed vehicles

7. Production release:
   - App Store review submission
   - Google Play production access / rollout
   - staged rollout with crash and performance monitoring

## Store Requirements To Track

- Apple App Store uploads after April 28, 2026 need to use the iOS/iPadOS 26 SDK or later.
- Apple requires privacy details in App Store Connect and purpose strings for protected resources like camera access.
- Google Play requires new apps and updates to target Android 15 / API level 35 or higher as of the current policy.
- Google Play requires Android App Bundles for new apps.
- New Google Play personal developer accounts may need a closed test with at least 12 opted-in testers for 14 continuous days before production access.

## App Store Risk Notes

- Avoid claiming BikSAFE prevents crashes. Use language like "traffic awareness" and "riding assist."
- Show an in-app safety notice before first camera use.
- Do not upload or store video unless intentionally adding that feature later.
- If video never leaves the device, make that a core privacy promise.
- Be careful with the word "safe"; the app name can stay BikSAFE, but product copy should not imply guaranteed safety.

## Recommended First Milestone

Ship a TestFlight/Android closed-test build with:

- radar-first `Ride` UI
- secondary `Vision` view
- on-device camera detection
- no accounts
- no cloud video upload
- no ads
- clear privacy policy
- safety disclaimer
- basic crash/performance logging only if disclosed

This keeps review risk lower and gets real-device feedback quickly.
