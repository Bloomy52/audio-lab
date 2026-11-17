// Registers coi-sw.js and reloads once so the page becomes cross-origin
// isolated. Does nothing when the server already sends the headers.
(() => {
  if (self.crossOriginIsolated || !self.isSecureContext || !("serviceWorker" in navigator)) return;
  const key = "audio-lab-coi-reload";
  const script = document.currentScript.src;
  navigator.serviceWorker
    .register(new URL("coi-sw.js", script))
    .then(() => navigator.serviceWorker.ready)
    .then(() => {
      try {
        // One reload only, so a browser that ignores the worker cannot loop.
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, "1");
      } catch {
        return;
      }
      location.reload();
    })
    .catch(() => {});
})();
