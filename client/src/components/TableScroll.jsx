import { useEffect, useRef, useState } from 'react'


// =============================================
// TABLE SCROLL
//
// Wraps a table that can be wider than the window. Its sideways scrollbar
// sticks to the bottom of the screen while the table is in view, so a long
// table can be slid left or right without first scrolling to its last row.
// Use it in place of a <div className="overflow-x-auto ...">.
// =============================================
export default function TableScroll({ className = '', children }) {
  const contentRef = useRef(null)
  const barRef = useRef(null)
  const [widths, setWidths] = useState({ scroll: 0, client: 0 })


  // Track how wide the table is versus the space it has.
  useEffect(() => {
    const content = contentRef.current
    if (!content) return

    const measure = () => setWidths({ scroll: content.scrollWidth, client: content.clientWidth })
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(content)
    if (content.firstElementChild) observer.observe(content.firstElementChild)

    return () => observer.disconnect()
  }, [])


  const overflowing = widths.scroll > widths.client + 1


  // Line the bar up with the table when it first appears.
  useEffect(() => {
    if (overflowing && barRef.current && contentRef.current) {
      barRef.current.scrollLeft = contentRef.current.scrollLeft
    }
  }, [overflowing])


  // Keep the table and the bar at the same position. Only setting it when it
  // differs stops the two scroll events from triggering each other forever.
  function sync(source, target) {
    if (source && target && target.scrollLeft !== source.scrollLeft) {
      target.scrollLeft = source.scrollLeft
    }
  }


  return (
    <div className={className}>
      <div
        ref={contentRef}
        onScroll={() => sync(contentRef.current, barRef.current)}
        className="overflow-x-auto rounded-[inherit] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>

      {overflowing && (
        <div
          ref={barRef}
          onScroll={() => sync(barRef.current, contentRef.current)}
          aria-hidden="true"
          className="sticky bottom-0 z-10 overflow-x-auto rounded-b-[inherit] border-t border-gray-200 bg-white/95"
        >
          <div style={{ width: widths.scroll, height: 1 }} />
        </div>
      )}
    </div>
  )
}
