import {
  useEffect,
  useState,
  useRef,
  forwardRef,
  useImperativeHandle } from
'react';
import { useReducedMotion } from '../lib/motion';
const PARTICLE_LIMIT = 28;
const SPAWN_DISTANCE = 14;
const LIGHT_SIZE = 420;
type ParticleKind = 'dot' | 'line';
type Particle = {
  active: boolean;
  age: number;
  life: number;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  rotation: number;
  kind: ParticleKind;
};
export type HeroPointerEffectHandle = {
  move: (x: number, y: number) => void;
  leave: () => void;
};
function chooseParticleColor() {
  const roll = Math.random();
  if (roll < 0.72) return '#0B6F71';
  if (roll < 0.94) return '#8EE3D5';
  return roll < 0.98 ? '#102A43' : '#A15C00';
}
export const HeroPointerEffect = forwardRef<HeroPointerEffectHandle>(
  function HeroPointerEffect(_, ref) {
    const reduced = useReducedMotion();
    const lightRef = useRef<HTMLDivElement>(null);
    const layerRef = useRef<HTMLDivElement>(null);
    const elementsRef = useRef<HTMLSpanElement[]>([]);
    const particlesRef = useRef<Particle[]>([]);
    const frameRef = useRef<number | null>(null);
    const lastFrame = useRef(0);
    const lastSpawn = useRef<{
      x: number;
      y: number;
    } | null>(null);
    const target = useRef({
      x: 0,
      y: 0,
      visible: false
    });
    const lightPosition = useRef({
      x: 0,
      y: 0
    });
    const [finePointer, setFinePointer] = useState(false);
    const stop = () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
    const reset = () => {
      target.current.visible = false;
      lastSpawn.current = null;
      particlesRef.current.forEach((particle) => {
        particle.active = false;
      });
      elementsRef.current.forEach((element) => {
        element.style.opacity = '0';
      });
      if (lightRef.current) lightRef.current.style.opacity = '0';
      stop();
    };
    useEffect(() => {
      const query = matchMedia('(hover: hover) and (pointer: fine)');
      const update = () => setFinePointer(query.matches);
      update();
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    }, []);
    useEffect(() => {
      const layer = layerRef.current;
      if (!layer || !finePointer || reduced) {
        reset();
        return;
      }
      const particles = Array.from(
        {
          length: PARTICLE_LIMIT
        },
        () => ({
          active: false,
          age: 0,
          life: 0,
          x: 0,
          y: 0,
          velocityX: 0,
          velocityY: 0,
          rotation: 0,
          kind: 'dot' as ParticleKind
        })
      );
      const elements = particles.map(() => {
        const element = document.createElement('span');
        element.className = 'hero-pointer-particle';
        layer.appendChild(element);
        return element;
      });
      particlesRef.current = particles;
      elementsRef.current = elements;
      return () => {
        reset();
        elements.forEach((element) => element.remove());
        elementsRef.current = [];
        particlesRef.current = [];
      };
    }, [finePointer, reduced]);
    const tick = (time: number) => {
      const elapsed = lastFrame.current ?
      Math.min((time - lastFrame.current) / 1000, 0.05) :
      0;
      lastFrame.current = time;
      const currentTarget = target.current;
      const light = lightPosition.current;
      if (currentTarget.visible) {
        light.x += (currentTarget.x - light.x) * 0.18;
        light.y += (currentTarget.y - light.y) * 0.18;
        if (lightRef.current) {
          lightRef.current.style.transform = `translate3d(${light.x - LIGHT_SIZE / 2}px, ${light.y - LIGHT_SIZE / 2}px, 0)`;
          lightRef.current.style.opacity = '1';
        }
      }
      particlesRef.current.forEach((particle, index) => {
        if (!particle.active) return;
        particle.age += elapsed;
        const element = elementsRef.current[index];
        if (particle.age >= particle.life) {
          particle.active = false;
          element.style.opacity = '0';
          return;
        }
        particle.x += particle.velocityX * elapsed;
        particle.y += particle.velocityY * elapsed;
        particle.velocityX *= 0.97;
        particle.velocityY *= 0.97;
        const progress = particle.age / particle.life;
        element.style.transform = `translate3d(${particle.x}px, ${particle.y}px, 0) rotate(${particle.rotation}deg) scale(${1 - progress * 0.55})`;
        element.style.opacity = String((1 - progress) * 0.72);
      });
      if (
      currentTarget.visible ||
      particlesRef.current.some((particle) => particle.active))

      frameRef.current = requestAnimationFrame(tick);else
      frameRef.current = null;
    };
    const ensureFrame = () => {
      if (frameRef.current === null) {
        lastFrame.current = 0;
        frameRef.current = requestAnimationFrame(tick);
      }
    };
    const spawn = (x: number, y: number, distance: number) => {
      const index = particlesRef.current.findIndex(
        (particle) => !particle.active
      );
      const chosen = index === -1 ? 0 : index;
      const particle = particlesRef.current[chosen];
      const element = elementsRef.current[chosen];
      if (!particle || !element) return;
      const angle = Math.random() * Math.PI * 2;
      const kind: ParticleKind = Math.random() > 0.7 ? 'line' : 'dot';
      particle.active = true;
      particle.age = 0;
      particle.life = 0.42 + Math.random() * 0.24;
      particle.x = x + (Math.random() - 0.5) * 7;
      particle.y = y + (Math.random() - 0.5) * 7;
      particle.velocityX =
      Math.cos(angle) * (12 + Math.min(distance, 48) * 0.35);
      particle.velocityY =
      Math.sin(angle) * (12 + Math.min(distance, 48) * 0.35);
      particle.rotation = Math.random() * 180;
      particle.kind = kind;
      element.className = `hero-pointer-particle hero-pointer-particle--${kind}`;
      element.style.backgroundColor = chooseParticleColor();
      element.style.opacity = '0.72';
    };
    useImperativeHandle(
      ref,
      () => ({
        move(x, y) {
          if (!finePointer || reduced || !elementsRef.current.length) return;
          target.current = {
            x,
            y,
            visible: true
          };
          const previous = lastSpawn.current;
          if (!previous) {
            lightPosition.current = {
              x,
              y
            };
            lastSpawn.current = {
              x,
              y
            };
            ensureFrame();
            return;
          }
          const distance = Math.hypot(x - previous.x, y - previous.y);
          if (distance >= SPAWN_DISTANCE) {
            for (
            let index = 0;
            index < Math.min(3, Math.max(1, Math.floor(distance / 22)));
            index += 1)
            {
              const amount =
              (index + 1) /
              Math.min(3, Math.max(1, Math.floor(distance / 22)));
              spawn(
                previous.x + (x - previous.x) * amount,
                previous.y + (y - previous.y) * amount,
                distance
              );
            }
            lastSpawn.current = {
              x,
              y
            };
          }
          ensureFrame();
        },
        leave: reset
      }),
      [finePointer, reduced]
    );
    if (!finePointer || reduced) return null;
    return (
      <div
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
        aria-hidden="true">
        
        <div ref={lightRef} className="hero-pointer-light" />
        <div ref={layerRef} className="absolute inset-0" />
      </div>);

  }
);
