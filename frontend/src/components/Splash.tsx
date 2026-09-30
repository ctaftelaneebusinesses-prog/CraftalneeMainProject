/**
 * Full-screen loading screen: the CraftLanee mark on a white disc inside a spinning gradient ring.
 * Styles live in index.css (.cl-splash …) and index.html repeats this markup, so the very same
 * screen shows before the JavaScript has even loaded — keep the two in sync.
 */
export function Splash({ label = "Loading your workspace" }: { label?: string }) {
  return (
    <div className="cl-splash" role="status" aria-live="polite" aria-label={`CraftLanee — ${label}`}>
      <div className="cl-stage" aria-hidden>
        <div className="cl-orbit" />
        <div className="cl-track" />
        <div className="cl-arc" />
        <div className="cl-head" />
        <div className="cl-plate"><img src="/brand/craftlanee-mark.png" alt="" /></div>
      </div>
      <div className="cl-caption"><strong>CraftLanee</strong><span>{label}</span></div>
    </div>
  );
}
