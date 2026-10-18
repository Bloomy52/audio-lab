import { useRef } from "react";
export function Header({
  activeTab,
  onTabChange,
}: {
  activeTab: "studio" | "batch";
  onTabChange: (tab: "studio" | "batch") => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <header className="header">
        <div>
          <h1>AUDIO LAB</h1>
          <p>Local audio conversion & loop editing</p>
        </div>
        <nav aria-label="Workspaces">
          <button
            aria-pressed={activeTab === "studio"}
            onClick={() => onTabChange("studio")}
          >
            Loop & edit studio
          </button>
          <button
            aria-pressed={activeTab === "batch"}
            onClick={() => onTabChange("batch")}
          >
            Batch converter
          </button>
        </nav>
        <button onClick={() => dialog.current?.showModal()}>
          Help & shortcuts
        </button>
      </header>
      <dialog ref={dialog} aria-labelledby="help-title">
        <h2 id="help-title">Audio Lab guide</h2>
        <p>
          Audio files stay in your browser. The audio engine is served with this
          site; no third-party engine download or audio upload is required. Keep
          this page open until you download your results. Refreshing or closing
          it clears this session.
        </p>
        <p>
          Switching between workspaces preserves your edits and batch. Jobs run
          one at a time and can be cancelled. The single-thread engine works
          without cross-origin isolation.
        </p>
        <p>
          Valid WAV, AIFF, FLAC, Vorbis, and Opus loop markers can be retained.
          All displayed end frames are exclusive. Imported markers are not
          snapped or crossfaded automatically.
        </p>
        <p>
          Whole-track export retains the intro and tail. Region export crops the
          selection; optional overlap crossfade shortens each repetition.
          Compression and loudness effects are export-only: audition the
          rendered result to hear them.
        </p>
        <p>
          Space: play/pause. L: toggle looping. Shortcuts apply in the active
          studio, outside form controls and this dialog. Exact frame inputs
          support keyboard editing; drag handles support touch.
        </p>
        <p>
          Browser playback varies by codec. If native decoding fails, the local
          engine attempts decoding. Mono/stereo editing is supported; use Batch
          to downmix multichannel audio first. AMR export is unavailable in this
          engine build.
        </p>
        <form method="dialog">
          <button autoFocus>Close guide</button>
        </form>
      </dialog>
    </>
  );
}
