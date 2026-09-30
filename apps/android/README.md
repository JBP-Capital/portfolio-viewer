# Portfolio Viewer for Android

One app for phones and TVs (`de.jbpcapital.portfolioviewer`). It is a WebView around a Portfolio Viewer
server, so a web deployment updates the app without a new release.

- **First start** asks for the server (default `https://portfolio.jbpcapital.de`) and accepts it only when
  `/api/health` answers as Portfolio Viewer. The launcher shortcut "Change server" and the offline screen
  lead back to that screen.
- **Phones** open the dashboard (`/`). **TVs** (Android TV, Google TV, projectors with the leanback interface)
  open TV mode (`/tv`): the TV shows a code, which is entered on `/pair` from a phone. The screen stays on.
- **Offline**: when the server cannot be reached, a local page retries after 15 s, then 30, 60 and every
  2 minutes, and offers "Try now" and "Change server".
- Links to other sites open in the browser; `file:`, `content:` and `intent:` links never open in the app.
- CSV import uses the system file picker; CSV export downloads with the sign-in cookie to *Downloads*
  (Android 10 and later) or to the app's own download folder (Android 7–9, which would need a storage
  permission for *Downloads*); the download notification opens the file.
- The Menu key of a TV remote opens the server screen (TV launchers show no app shortcuts).
- Back: phones go back through the pages; TV mode, the offline page and the first page leave the app,
  which stays in memory.

## Build

Requirements: JDK 21 and the Android SDK (platform 36), for example as installed by Android Studio. Point
`JAVA_HOME` at the JDK and `ANDROID_HOME` (or `sdk.dir` in `local.properties`) at the SDK.

```sh
cd apps/android
./gradlew testDebugUnitTest lintDebug assembleDebug
# The emulator reaches the host computer at 10.0.2.2:
./gradlew assembleDebug -PdefaultServer=http://10.0.2.2:3310
```

Release bundles for Google Play are signed with an upload key kept outside the repository. Put these lines
into `~/.gradle/gradle.properties` (never into this project):

```properties
pvUploadStoreFile=C:/path/to/portfolio-viewer-upload.jks
pvUploadStorePassword=…
pvUploadKeyAlias=upload
pvUploadKeyPassword=…
```

Then `./gradlew bundleRelease` writes `app/build/outputs/bundle/release/app-release.aab`.

## Icons

`scripts/make-icons.ps1` draws the launcher icons, the TV banner and the Play Store graphics from
`scripts/jbp-capital-logo.png` (Windows, PowerShell).
