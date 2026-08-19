"use client";

import { useEffect } from "react";

/**
 * Releases a stuck `pointer-events: none` on <body>.
 *
 * Radix modal layers (Dialog, Sheet, DropdownMenu, Select) disable pointer
 * events on the body while they are open and restore them on close. The
 * restore is tied to the layer's unmount cleanup, so it is skipped whenever a
 * layer disappears without closing first — a `router.push` fired from inside a
 * dialog, a sheet whose parent unmounts on a data refresh, a dialog opened
 * from a dropdown that never closed. The style then survives on <body> and
 * every click in the app is swallowed: navigation, buttons, the sidebar. The
 * page still renders, so it looks like the app has simply stopped responding,
 * and only a full reload (or a new tab) clears it.
 *
 * The guard watches for that state and clears it, but only when no Radix layer
 * is actually mounted — an open modal keeps its pointer lock. Two triggers:
 *
 *   - a MutationObserver on <body>, which fires when a portal is removed (the
 *     moment the leak happens) and when the style attribute itself changes;
 *   - a capture-phase pointerdown on the document, so the very first click
 *     after a leak heals it even if the mutation was missed. `pointer-events:
 *     none` on <body> stops the event reaching page content, but the document
 *     still sees it.
 */
export function PointerEventsGuard() {
  useEffect(() => {
    const body = document.body;

    // Anything Radix keeps mounted while a layer is open. Popper wrappers
    // cover dropdowns/selects/popovers; the [data-state=open] dialog roles
    // cover Dialog and Sheet, including our own wrappers around them.
    const OPEN_LAYER_SELECTOR = [
      "[data-radix-popper-content-wrapper]",
      '[role="dialog"][data-state="open"]',
      '[role="alertdialog"][data-state="open"]',
      '[role="menu"][data-state="open"]',
      '[data-slot="dialog-content"][data-state="open"]',
      '[data-slot="sheet-content"][data-state="open"]',
    ].join(",");

    function release() {
      if (body.style.pointerEvents !== "none") return;
      if (document.querySelector(OPEN_LAYER_SELECTOR)) return;
      body.style.removeProperty("pointer-events");
    }

    const observer = new MutationObserver(release);
    observer.observe(body, {
      attributes: true,
      attributeFilter: ["style"],
      childList: true,
    });

    document.addEventListener("pointerdown", release, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", release, true);
    };
  }, []);

  return null;
}
