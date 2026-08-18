// Shared motion timing bands (§4.8) + a reduced-motion hook.
import { useEffect, useState } from 'react';

export const EASE = {
  micro: [0.4, 0, 0.2, 1] as const,
  decel: [0, 0, 0.2, 1] as const,
  spring: [0.34, 1.56, 0.64, 1] as const
};

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduced;
}
