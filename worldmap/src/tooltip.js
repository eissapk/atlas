/**
 * A deliberately small hover tooltip: one absolutely positioned <div> that
 * follows the pointer and is nudged to stay inside the container.
 *
 * It is pointer-events:none in CSS, which matters — otherwise it would sit
 * between the cursor and the map and swallow the very hovers it describes.
 */

export function createTooltip(container) {
  const node = document.createElement("div");
  node.className = "wm-tooltip";
  node.setAttribute("role", "tooltip");
  node.hidden = true;
  container.append(node);

  let frame = 0;
  let pending = null;

  function apply() {
    frame = 0;
    if (!pending) return;
    const { clientX, clientY } = pending;
    const bounds = container.getBoundingClientRect();

    // Measure once per move; the node is tiny so this is cheap.
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const gap = 14;

    let left = clientX - bounds.left + gap;
    let top = clientY - bounds.top + gap;

    // Flip rather than clamp when close to an edge, so the tooltip never
    // covers the thing the pointer is on.
    if (left + width > bounds.width) left = clientX - bounds.left - width - gap;
    if (top + height > bounds.height) top = clientY - bounds.top - height - gap;

    left = Math.max(0, Math.min(bounds.width - width, left));
    top = Math.max(0, Math.min(bounds.height - height, top));

    node.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  return {
    show(content, event) {
      if (content == null || content === "") return this.hide();
      if (content instanceof Node) node.replaceChildren(content);
      else node.textContent = String(content);
      node.hidden = false;
      this.move(event);
    },

    move(event) {
      if (node.hidden || !event) return;
      pending = { clientX: event.clientX, clientY: event.clientY };
      if (!frame) frame = requestAnimationFrame(apply);
    },

    hide() {
      node.hidden = true;
      pending = null;
    },

    destroy() {
      if (frame) cancelAnimationFrame(frame);
      node.remove();
    },
  };
}
