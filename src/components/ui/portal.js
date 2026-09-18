// Shared plumbing for modal-style components (AlertDialog, Dialog, Sheet,
// Drawer, CommandDialog).
//
// Why this exists: `backdrop-filter` on an overlay does NOT blur the
// scrolling document in Chrome -- verified live, it only affects other
// composited layers (it blurred the dialog itself but left the page text
// pixel-sharp at any radius, even 20px). The frosted look therefore has to
// come from a real `filter: blur()` on the page content instead. That in turn
// requires the modal to live OUTSIDE the element being blurred, so the modal
// markup is moved into <body> while the app root (#app) takes the blur.

let uid = 0;

export const nextPortalId = () => `modal-portal-${uid++}`;

const PAGE_BLUR = "blur(4px)";

// Refcounted so stacked modals (or one closing while another is still open)
// don't clear the blur out from under each other.
let openCount = 0;

const appRoot = () => document.getElementById("app");

/**
 * Move `nodes` into <body>, outside the blurred app root.
 * Returns a teardown that removes them again.
 */
export function mountPortal(nodes) {
  nodes.forEach((node) => node && document.body.appendChild(node));
  return () => nodes.forEach((node) => node && node.remove());
}

// Deliberately no CSS transition on the filter: setting `transition` and
// `filter` together left the computed value pinned at blur(0px) indefinitely
// (the animation never ticked), i.e. no blur at all. Applying it directly is
// deterministic -- worth more here than a 150ms fade.
export function acquirePageBlur() {
  openCount += 1;
  if (openCount !== 1) return;
  const root = appRoot();
  if (!root) return;
  root.style.filter = PAGE_BLUR;
}

export function releasePageBlur() {
  openCount = Math.max(0, openCount - 1);
  if (openCount !== 0) return;
  const root = appRoot();
  if (root) root.style.filter = "";
}

/**
 * Close/action buttons render inside the portaled content, so once it moves
 * to <body> they can no longer reach their owning root via
 * closest('[data-slot=<root>]'). The content component stashes the checkbox
 * on the portaled node as `__olumModalInput`; prefer that, and fall back to
 * the in-tree lookup for the pre-portal case. Always resolve this lazily (on
 * click, not on mount) so it doesn't depend on component mount ordering.
 */
export function findModalInput(host, rootSlot, contentSlot) {
  const content = host.closest(`[data-slot="${contentSlot}"]`);
  if (content && content.__olumModalInput) return content.__olumModalInput;
  const root = host.closest(`[data-slot="${rootSlot}"]`);
  return root && root.querySelector(":scope > input");
}

/**
 * Wires a portaled modal to its checkbox: moves the nodes to <body>, keeps
 * their visibility in sync with `input.checked`, and drives the page blur.
 *
 * `displays` maps each node to the CSS display it should use when open. Omit
 * it for modals that animate themselves in/out (Sheet drives visibility from
 * a data-state attribute via opacity/transform, and toggling `display` would
 * kill those transitions).
 */
export function wireModal({ input, nodes, displays, onOpen, onClose }) {
  // A route change can re-run this without the previous teardown having fired:
  // the portaled nodes live in <body>, so discarding the old host doesn't take
  // them with it, and the checkbox they're wired to survives the re-render. The
  // result is one set of overlay/content per navigation, every one of them still
  // listening to the same input -- stacked scrims that darken with each visit,
  // plus an openCount that never returns to zero so the page blur sticks.
  //
  // A portal set whose checkbox is no longer in the document can never be opened
  // or closed again -- it's orphaned, so dispose it. That also covers re-wiring
  // the same input. Live modals on the page keep their own attached inputs and
  // are left alone, so this is safe with several dialogs mounted at once.
  document.querySelectorAll("body > [data-olum-portal]").forEach((node) => {
    const portal = node.__olumPortal;
    if (portal && (portal.input === input || !portal.input.isConnected)) portal.dispose();
  });

  const teardown = mountPortal(nodes);
  let opened = false;
  let disposed = false;

  const sync = () => {
    const open = !!input.checked;
    if (open === opened) return;
    opened = open;
    if (displays) {
      nodes.forEach((node, i) => {
        if (node) node.style.display = open ? displays[i] : "none";
      });
    }
    if (open) {
      acquirePageBlur();
      onOpen && onOpen();
    } else {
      releasePageBlur();
      onClose && onClose();
    }
  };

  sync();
  input.addEventListener("change", sync);

  // Idempotent: the sweep above and a normal unmount can both reach it.
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    input.removeEventListener("change", sync);
    if (opened) releasePageBlur();
    teardown();
  };

  // Stamped on the nodes so a later mount can find and dispose this set.
  nodes.forEach((node) => {
    if (!node) return;
    node.setAttribute("data-olum-portal", "");
    node.__olumPortal = { input, dispose };
  });

  return dispose;
}
