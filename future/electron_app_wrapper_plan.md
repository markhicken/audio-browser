# Build a Windows App Wrapper (Electron)

The goal is to wrap the existing Express server into a standalone Windows application, hiding the terminal window entirely. Electron is the perfect tool here since it natively integrates with Node.js, allowing `server.js` to run seamlessly in the background while displaying the web app in a dedicated app window.

## User Review Required

> [!IMPORTANT]
> I have selected **Electron** as it's the industry standard for this and the easiest way to package a Node.js Express server with a Chromium frontend. 
> 
> "Hot new" alternatives exist like **Tauri** (Rust-based) and **NeutralinoJS** (lightweight webviews), but they require separating the backend more rigidly and managing native system calls differently. Because your `server.js` uses `child_process` commands and `ffmpeg`, Electron allows us to keep your code almost entirely unchanged.
> 
> Does Electron sound good to you?

## Proposed Changes

We will introduce a new entry point (`main.js`) that configures the Electron window and spins up our Express server, plus `electron-builder` to package everything into a `.exe`.

### Configuration & Tooling

#### [MODIFY] [package.json](file:///c:/Users/owner/Repositories/simple-audio-browser/package.json)
- Add `electron` and `electron-builder` as development dependencies.
- Add `main: "main.js"` property to point to the new Electron entry script.
- Add `electron:start` and `build` scripts to let you test and compile the executable.

### Application Logic

#### [NEW] [main.js](file:///c:/Users/owner/Repositories/simple-audio-browser/main.js)
- Import `app` and `BrowserWindow` from Electron.
- Set an environment variable (e.g. `process.env.ELECTRON_APP = 1`).
- `require('./server.js')` to launch the Express backend natively.
- Open a frameless or standard `BrowserWindow` pointing to `http://localhost:3000`.

#### [MODIFY] [server.js](file:///c:/Users/owner/Repositories/simple-audio-browser/server.js)
- Add a check around the auto-browser launching code (line 512). If `process.env.ELECTRON_APP` is set, we will skip trying to open the external default web browser using the command line `start` command, because Electron handles its own window.

## Verification Plan

### Manual Verification
1. Run `npm install` and start the app via `npm run electron:start` to verify it opens in a native standalone window instead of the browser, with no visible terminal prompt.
2. Run `npm run build` to package the app and test the resulting `.exe` installer.
