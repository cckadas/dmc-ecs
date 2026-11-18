// =============================================================================
// Numbers are typed, never scrolled
//
// Most browsers change the number in a number box when the mouse wheel turns
// while the cursor is in that box, so scrolling down the page could quietly
// turn 100 cases into 99 (it did on a quotation request, Nov 2026). Taking the
// cursor out of the box as the wheel turns lets the page scroll as usual and
// leaves the number as it was typed. One listener for every number box on the
// website, so a payment amount or a received quantity can't change this way
// either.
// =============================================================================

export function keepNumbersFromScrolling(doc = document) {
  const onWheel = (event) => {
    const box = event.target
    if (box instanceof HTMLInputElement && box.type === 'number' && box === doc.activeElement) {
      box.blur()
    }
  }

  // Passive: the page still scrolls. Capture: before the box itself sees the wheel.
  doc.addEventListener('wheel', onWheel, { passive: true, capture: true })
  return () => doc.removeEventListener('wheel', onWheel, { capture: true })
}
