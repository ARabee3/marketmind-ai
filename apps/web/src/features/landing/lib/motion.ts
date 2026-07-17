// Shared motion timing bands (§4.8) + a reduced-motion hook.
import { useEffect, useState } from 'react';

export const EASE = {
  micro: [0.4, 0, 0.2, 1] as const,
  decel: [0, 0, 0.2, 1] as const,
  spring: [0.34, 1.56, 0.64, 1] as const
};

export const floatIn = {
  hidden: { opacity: 0, y: 24, scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.42, ease: EASE.decel }
  }
};

export const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } }
};

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduced;
}