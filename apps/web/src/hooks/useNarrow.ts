import { useEffect, useState } from 'react';

/** Phones and narrow windows: too small for the three-column battle layout. */
const QUERY = '(max-width: 899px)';

export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const update = () => setNarrow(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return narrow;
}
