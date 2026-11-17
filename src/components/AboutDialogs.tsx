import { useRef, useState } from "react";
import dependencies from "virtual:dependencies";
import licenseText from "../../LICENSE?raw";
export const SOURCE_URL = "https://github.com/Bloomy52/audio-lab";
const copyright = licenseText
  .split("\n")
  .find((l) => l.startsWith("Copyright"));
function DependencyList({ items }: { items: typeof dependencies }) {
  return (
    <ul className="deps">
      {items.map((d) => (
        <li key={`${d.name}@${d.version}`}>
          <span>{d.name}</span> <span>{d.version}</span>
        </li>
      ))}
    </ul>
  );
}
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
      <dialog ref={about} className="about" aria-labelledby="about-title">
        <h2 id="about-title">About Audio Lab</h2>
        <p className="about-version">Version {version}</p>
        <p>
          This project is licensed under the <strong>MIT License</strong>.
        </p>
        <p>{copyright}</p>
        <p>
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
            View the source code on GitHub
          </a>
        </p>
        <details>
          <summary>Full MIT License text</summary>
          <pre tabIndex={0}>{licenseText}</pre>
        </details>
        <h3>Runtime dependencies</h3>
        <DependencyList items={dependencies.filter((d) => !d.dev)} />
        <h3>Development dependencies</h3>
        <DependencyList items={dependencies.filter((d) => d.dev)} />
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
