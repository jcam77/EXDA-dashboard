# macOS build (Electron demo)

This creates a macOS app bundle and DMG that bundle the frontend, backend, and demo project.

Important: macOS builds must be run on a Mac.

## Option A: GitHub Actions (macOS)
Workflow file: `.github/workflows/macos-build.yml`

1) Push this repo to GitHub.
2) Go to Actions → **Build macOS App** → Run workflow.
3) Download the artifacts named `EXDA-dashboard-macos-x64` (Intel) and `EXDA-dashboard-macos-arm64` (Apple Silicon).

## Option B: Local macOS build

### 1) Build backend app
From `EXDA-dashboard-v0.3/backend` on macOS:

```bash
python3 -m pip install -U pyinstaller
python3 -m pip install -r requirements.txt
# Optional: extra AI/analysis features
# python3 -m pip install -r requirements-optional.txt
pyinstaller exda-backend.spec
```

Output: `EXDA-dashboard-v0.3/backend/dist/exda-backend`

### 2) Build frontend (demo mode)
From `EXDA-dashboard-v0.3`:

```bash
npm install
npm run build:demo
```

### 3) Build macOS app and DMG
From `EXDA-dashboard-v0.3`:

```bash
npm run dist:mac
```

Output: `EXDA-dashboard-v0.3/dist-electron/`

Notes:
- Demo projects are copied on first run to `~/Documents/EXDA Projects/Demo Projects`.
- AI is disabled in demo mode and shows a banner on the AI page.
- If you plan to distribute outside your own machine, you will likely need Apple code signing and notarization.

## Code Signing and Notarization (Optional)

Electron Builder can sign and notarize if the required Apple credentials are present.

### What you need
- An Apple Developer account with **Developer ID Application** certificate.
- The certificate installed in the macOS keychain, or exported as a `.p12` for CI.
- App Store Connect credentials for notarization.

### Environment variables (local or CI)
Certificate signing:
`CSC_LINK` = base64 of the `.p12` certificate
`CSC_KEY_PASSWORD` = password for the `.p12`

Notarization with Apple ID:
`APPLE_ID`
`APPLE_APP_SPECIFIC_PASSWORD`
`APPLE_TEAM_ID`

Notarization with App Store Connect API key:
`APPLE_API_KEY`
`APPLE_API_KEY_ID`
`APPLE_API_ISSUER`

With these set, run:
```bash
npm run dist:mac
```
