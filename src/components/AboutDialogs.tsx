import { useRef, useState } from "react";
import licenseText from "../../LICENSE?raw";
export const SOURCE_URL = "https://github.com/Bloomy52/audio-lab";
const copyright = licenseText
  .split("\n")
  .find((l) => l.startsWith("Copyright"));
export function AboutDialogs({ version }: { version: string }) {
  const about = useRef<HTMLDialogElement>(null);
  const licenses = useRef<HTMLDialogElement>(null);
  const [thirdParty, setThirdParty] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const openLicenses = () => {
    licenses.current?.showModal();
    if (thirdParty !== null) return;
    setFailed(false);
    fetch("./THIRD_PARTY_LICENSES.txt")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then(setThirdParty)
      .catch(() => setFailed(true));
  };
  return (
    <>
      <nav className="footer-links" aria-label="About">
        <button className="link" onClick={() => about.current?.showModal()}>
          About
        </button>
        <button className="link" onClick={openLicenses}>
          Third-party licenses
        </button>
        <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
          Source code
        </a>
      </nav>
      <dialog ref={about} aria-labelledby="about-title">
        <h2 id="about-title">About Audio Lab</h2>
        <p>Audio Lab v{version}</p>
        <p>{copyright}</p>
        <p>
          Audio Lab is licensed under the MIT License. Source code:{" "}
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
            {SOURCE_URL}
          </a>
        </p>
        <pre tabIndex={0} aria-label="Audio Lab license text">
          {licenseText}
        </pre>
        <form method="dialog">
          <button autoFocus>Close</button>
        </form>
      </dialog>
      <dialog ref={licenses} aria-labelledby="licenses-title">
        <h2 id="licenses-title">Third-party licenses</h2>
        <pre tabIndex={0} aria-label="Third-party license text">
          {failed
            ? "Could not load the third-party licenses. See THIRD_PARTY_LICENSES.txt in the source repository."
            : (thirdParty ?? "Loading…")}
        </pre>
        <form method="dialog">
          <button autoFocus>Close</button>
        </form>
      </dialog>
    </>
  );
}
