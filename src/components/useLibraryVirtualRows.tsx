import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export function libraryVirtualRange(offsets: number[], scrollTop: number, viewport: number, overscan = 600) {
  const count = offsets.length - 1;
  const lowerBound = (position: number) => {
    let low = 0;
    let high = count;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (offsets[middle + 1] <= position) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  return { start: lowerBound(Math.max(0, scrollTop - overscan)), end: Math.min(count, lowerBound(scrollTop + viewport + overscan) + 1) };
}

/** Window a scrollable list of rows while allowing cards with different heights. */
export function useLibraryVirtualRows(count: number, estimatedHeight: number, resetKey: string) {
  const scroller = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(600);
  const [scrollTop, setScrollTop] = useState(0);
  const [sizes, setSizes] = useState<Map<number, number>>(() => new Map());
  const frame = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewport(element.clientHeight));
    observer.observe(element);
    setViewport(element.clientHeight);
    return () => observer.disconnect();
  }, [count > 0]);

  useEffect(() => {
    setSizes(new Map());
    setScrollTop(0);
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [resetKey]);

  useEffect(() => () => { if (frame.current !== null) clearTimeout(frame.current); }, []);

  const onScroll = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = setTimeout(() => {
      frame.current = null;
      setScrollTop(scroller.current?.scrollTop || 0);
    }, 16);
  }, []);

  const measure = useCallback((index: number, height: number) => {
    const rounded = Math.ceil(height);
    if (!rounded) return;
    setSizes(previous => {
      if (previous.get(index) === rounded) return previous;
      const next = new Map(previous);
      next.set(index, rounded);
      return next;
    });
  }, []);

  const offsets = useMemo(() => {
    const result = new Array<number>(count + 1);
    result[0] = 0;
    for (let index = 0; index < count; index++) result[index + 1] = result[index] + (sizes.get(index) || estimatedHeight);
    return result;
  }, [count, sizes, estimatedHeight]);

  const { start, end } = libraryVirtualRange(offsets, scrollTop, viewport);

  return { scroller, onScroll, measure, start, end, offsets, totalHeight: offsets[count] || 0 };
}

export function MeasuredLibraryRow({ index, onMeasure, children, className = '', style }: {
  index: number; onMeasure: (index: number, height: number) => void; children: React.ReactNode; className?: string; style?: React.CSSProperties;
}) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!element.current) return;
    const observer = new ResizeObserver(() => onMeasure(index, element.current?.getBoundingClientRect().height || 0));
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [index, onMeasure]);
  return <div ref={element} className={className} style={style}>{children}</div>;
}

export function MeasuredLibraryTableRow({ index, onMeasure, children }: {
  index: number; onMeasure: (index: number, height: number) => void; children: React.ReactElement<{ ref?: React.Ref<HTMLTableRowElement> }>;
}) {
  const element = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (!element.current) return;
    const observer = new ResizeObserver(() => onMeasure(index, element.current?.getBoundingClientRect().height || 0));
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [index, onMeasure]);
  return React.cloneElement(children, { ref: element });
}
