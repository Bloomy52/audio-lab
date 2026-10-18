import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Retire only this app's old isolation worker, without reloading an active edit.
if ("serviceWorker" in navigator) {
  const legacy = new URL(
    `${import.meta.env.BASE_URL}coi-serviceworker.js`,
    document.baseURI,
  ).href;
  void navigator.serviceWorker
    .getRegistrations()
    .then((registrations) =>
      Promise.all(
        registrations
          .filter((registration) =>
            [
              registration.active,
              registration.waiting,
              registration.installing,
            ].some((worker) => worker?.scriptURL === legacy),
          )
          .map((registration) => registration.unregister()),
      ),
    )
    .catch(() => {});
}
