/**
 * A slim strip above every signed-in screen while a live build runs the demo,
 * so nobody mistakes the sample families for real ones, with the way back.
 * Builds that are only the demo don't show it (there is nothing to go back to).
 */
import { canExitDemo, exitDemo, type AppMode } from '../lib/mode';
import { Icon } from './Icon';

export function DemoStrip({ mode }: { mode: AppMode }) {
  if (!canExitDemo(mode)) return null;
  return (
    <div className="demo-strip" role="note" aria-label="Demo">
      <Icon name="sparkle" size={16} />
      <span className="demo-strip-text">Demo with made-up families. Nothing here is real.</span>
      <button type="button" className="btn btn-link btn-sm" onClick={() => exitDemo()}>
        Exit demo
      </button>
    </div>
  );
}
