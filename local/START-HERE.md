# Audio Lab Local Edition

## Requirements
This reqires Node.js 24 or newer (including npm) to run. If you have not instaled Node.js, please download it from https://nodejs.org/ and install it before proceeding.

1. Download the latest release of Audio Lab Local Edition from [GitHub Releases](https://github.com/bloomy52/audio-lab/releases/latest).
2. Extract the entire ZIP into a writable folder.
3. Open a terminal in that folder. On Windows, open the folder in File Explorer,
   right-click an empty area and choose **Open in Terminal**. On macOS/Linux,
   open Terminal and run `cd "/path/to/extracted/audio-lab-local"`, replacing the path.
4. Run `npm install` and wait for setup to finish. The audio engine is included
   in the ZIP.
5. Run `npm start`. Audio Lab opens in your default browser. If it does not,
   open the printed `http://127.0.0.1:...` address manually.

After setup, you can launch and process audio offline. On subsequent launches,
run only `npm start` from this folder. No build command is needed.

Keep the terminal open while using Audio Lab. Press Ctrl+C in it to stop the
server. Closing the browser does not stop the server. Save your results before
closing or refreshing the page: audio sessions are not restored.

Audio is processed in your browser and is never uploaded. Browser support for
playing exported formats varies; a downloaded file can still be valid even if
the browser cannot play it.

If the engine is missing, extract a complete release ZIP again.
If `node` or `npm` is not recognized, install Node.js and reopen your terminal.

To update, download and extract a new release into a new folder, then repeat
setup. To remove this edition, stop the server and delete its extracted folder.
