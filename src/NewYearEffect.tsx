import { useEffect, useRef, useState } from 'react';
import { claimLiveBellEvent } from './lib/animGuard';
import { serverNowMs } from './lib/serverTime';
import { fxSound } from './lib/sound';

export interface NewYearProps {
  date: string;
  secs: number;
  tv: boolean;
  enabled: boolean;
  sound?: boolean;
  preview?: boolean;
}

type BurstPattern = 'willow' | 'star' | 'heart' | 'doubleRing' | 'palm';

interface Palette {
  name: string;
  colors: string[];
  glow: string;
}

const GALA_PALETTES: Palette[] = [
  {
    name: 'champagne',
    colors: ['#fffbeb', '#fef08a', '#ffd166', '#f59e0b'],
    glow: 'rgba(255, 209, 102, 0.92)',
  },
  {
    name: 'emerald',
    colors: ['#ecfdf5', '#6ee7b7', '#22d3ee', '#10b981'],
    glow: 'rgba(52, 211, 153, 0.9)',
  },
  {
    name: 'ruby',
    colors: ['#fff1f2', '#fda4af', '#f472b6', '#e11d48'],
    glow: 'rgba(244, 114, 182, 0.92)',
  },
  {
    name: 'royal',
    colors: ['#eff6ff', '#93c5fd', '#38bdf8', '#2563eb'],
    glow: 'rgba(56, 189, 248, 0.9)',
  },
  {
    name: 'violet',
    colors: ['#faf5ff', '#e879f9', '#c084fc', '#9333ea'],
    glow: 'rgba(232, 121, 249, 0.92)',
  },
  {
    name: 'solar',
    colors: ['#fff7ed', '#fdba74', '#fb923c', '#facc15'],
    glow: 'rgba(251, 146, 60, 0.92)',
  },
];

const PATTERN_CYCLE: BurstPattern[] = ['willow', 'star', 'heart', 'doubleRing', 'palm'];

const CONFETTI_COLORS = [
  '#fde047',
  '#fbbf24',
  '#f472b6',
  '#38bdf8',
  '#34d399',
  '#e879f9',
  '#fb7185',
  '#ffffff',
];

interface Shell {
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetY: number;
  palette: Palette;
  secondaryPalette: Palette;
  pattern: BurstPattern;
  scale: number;
  trail: Array<{ x: number; y: number }>;
  heroYear?: number;
}

interface Ember {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  color: string;
  glow: string;
  size: number;
  life: number;
  maxLife: number;
  drag: number;
  gravity: number;
  twinkle: boolean;
  crackles: boolean;
}

interface Ring {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  color: string;
  life: number;
  maxLife: number;
  lineWidth: number;
}

interface Flash {
  x: number;
  y: number;
  radius: number;
  color: string;
  life: number;
  maxLife: number;
}

interface ConfettiPiece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  w: number;
  h: number;
  tilt: number;
  tiltSpeed: number;
  spin: number;
  spinSpeed: number;
  phase: number;
  flutterFreq: number;
  life: number;
  maxLife: number;
}

interface QueuedAction {
  at: number;
  run: () => void;
}

interface HeroState {
  id: number;
  year: number;
  xPct: number;
  yPct: number;
  expiresAt: number;
}

const rnd = (min: number, max: number): number => min + Math.random() * (max - min);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

export function isNewYearWindow(date: string, secs: number): boolean {
  if (date.endsWith('-12-31')) return secs >= 18 * 3600;
  if (date.endsWith('-01-01')) return true;
  return false;
}

function parseYear(date: string): number {
  const y = Number.parseInt(date.slice(0, 4), 10);
  if (!Number.isFinite(y)) return new Date().getFullYear();
  return date.endsWith('-12-31') ? y + 1 : y;
}

function formatCountdown(remSec: number): string {
  const s = Math.max(0, Math.floor(remSec));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(sec)}` : `${pad(mins)}:${pad(sec)}`;
}

function sampleTextTargets(
  textTop: string,
  textBottom: string,
  cx: number,
  cy: number,
  scale: number,
): Array<{ x: number; y: number }> {
  if (typeof document === 'undefined') return [];
  const off = document.createElement('canvas');
  const ow = 260;
  const oh = 110;
  off.width = ow;
  off.height = oh;
  const octx = off.getContext('2d');
  if (!octx) return [];

  octx.clearRect(0, 0, ow, oh);
  octx.fillStyle = '#ffffff';
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  octx.font = '800 22px system-ui, sans-serif';
  octx.fillText(textTop, ow / 2, 30);
  octx.font = '900 44px system-ui, sans-serif';
  octx.fillText(textBottom, ow / 2, 74);

  const img = octx.getImageData(0, 0, ow, oh).data;
  const pts: Array<{ x: number; y: number }> = [];
  const spreadX = 1.65 * scale;
  const spreadY = 1.65 * scale;

  for (let py = 0; py < oh; py += 4) {
    for (let px = 0; px < ow; px += 4) {
      if (img[(py * ow + px) * 4 + 3] > 140) {
        pts.push({
          x: cx + (px - ow / 2) * spreadX,
          y: cy + (py - oh / 2) * spreadY,
        });
      }
    }
  }
  return pts;
}

export default function NewYearEffect({
  date,
  secs,
  tv,
  enabled,
  sound = false,
  preview = false,
}: NewYearProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const soundRef = useRef(sound);
  const tvRef = useRef(tv);
  soundRef.current = sound;
  tvRef.current = tv;

  const [hero, setHero] = useState<HeroState | null>(null);
  const heroIdRef = useRef(0);
  const finaleFnRef = useRef<((yearNum: number) => void) | null>(null);
  const onHeroBurstRef = useRef<(burst: Omit<HeroState, 'id'>) => void>(() => {});

  onHeroBurstRef.current = (burst) => {
    heroIdRef.current += 1;
    setHero({ id: heroIdRef.current, ...burst });
  };

  const targetYear = parseYear(date);
  const isDec31 = date.endsWith('-12-31');
  const isJan01 = date.endsWith('-01-01');
  const remToMidnight = isDec31 ? Math.max(0, 86400 - secs) : 0;
  const isFinalTen = enabled && isDec31 && remToMidnight <= 10 && remToMidnight >= 1;
  const showCountdown = enabled && isDec31 && secs >= 22 * 3600 && remToMidnight > 10;
  const showAmbientCanvas = enabled && (preview || isJan01);
  const showRibbon =
    enabled && !hero && ((isJan01 && secs > 10) || (preview && secs >= 0));

  useEffect(() => {
    if (!hero) return;
    const msLeft = Math.max(200, hero.expiresAt - serverNowMs());
    const id = window.setTimeout(() => {
      setHero((cur) => (cur && cur.id === hero.id ? null : cur));
    }, msLeft);
    return () => window.clearTimeout(id);
  }, [hero]);

  useEffect(() => {
    if (showAmbientCanvas) {
      document.documentElement.dataset.nye = '1';
      return () => {
        delete document.documentElement.dataset.nye;
      };
    }
    delete document.documentElement.dataset.nye;
  }, [showAmbientCanvas]);

  useEffect(() => {
    if (!showAmbientCanvas) {
      finaleFnRef.current = null;
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let w = window.innerWidth;
    let h = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const shells: Shell[] = [];
    const embers: Ember[] = [];
    const rings: Ring[] = [];
    const flashes: Flash[] = [];
    const confetti: ConfettiPiece[] = [];
    const queue: QueuedAction[] = [];

    let elapsedSim = 0;
    let nextAmbientAt = 2.6;
    let patternIdx = 0;
    let rafId = 0;
    let lastTs = 0;

    const getScale = (): number => {
      const base = Math.max(0.76, Math.min(1.48, Math.min(w, h) / 760));
      return tvRef.current ? Math.min(1.55, base * 1.12) : base;
    };

    const panAt = (x: number): number => Math.max(-0.9, Math.min(0.9, (x / Math.max(1, w)) * 2 - 1));

    const playFx = (kind: 'launch' | 'boom' | 'pop' | 'fanfare', x: number) => {
      if (!soundRef.current || document.hidden) return;
      fxSound(kind, panAt(x));
    };

    const pushEmber = (e: Ember) => {
      if (embers.length < 1800) embers.push(e);
    };

    const fireConfettiCannons = (power = 1) => {
      const sc = getScale();
      const totalPerCorner = Math.round(95 * power);

      const fireCorner = (originX: number, dirX: 1 | -1) => {
        flashes.push({
          x: originX,
          y: h - 10,
          radius: 95 * sc,
          color: 'rgba(255, 224, 130, 0.85)',
          life: 0.28,
          maxLife: 0.28,
        });
        rings.push({
          x: originX,
          y: h - 10,
          radius: 8,
          maxRadius: 150 * sc,
          color: '#fef08a',
          life: 0.42,
          maxLife: 0.42,
          lineWidth: 3.5,
        });

        for (let i = 0; i < totalPerCorner; i++) {
          if (confetti.length >= 700) break;
          const deg = rnd(26, 72);
          const rad = (deg * Math.PI) / 180;
          const speed = rnd(690, 1240) * sc * Math.sqrt(power);
          const vx = Math.cos(rad) * speed * dirX;
          const vy = -Math.sin(rad) * speed;
          const size = rnd(7, 13) * Math.max(0.85, Math.min(1.25, sc));
          confetti.push({
            x: originX + dirX * rnd(0, 14),
            y: h - rnd(4, 18),
            vx,
            vy,
            color: pick(CONFETTI_COLORS),
            w: size,
            h: size * rnd(0.45, 0.72),
            tilt: rnd(0, Math.PI * 2),
            tiltSpeed: rnd(5, 11) * (Math.random() < 0.5 ? 1 : -1),
            spin: rnd(0, Math.PI * 2),
            spinSpeed: rnd(3.5, 8.5) * (Math.random() < 0.5 ? 1 : -1),
            phase: rnd(0, Math.PI * 2),
            flutterFreq: rnd(3.2, 6.2),
            life: rnd(3.4, 5.2),
            maxLife: 5.2,
          });
        }
      };

      fireCorner(14, 1);
      fireCorner(w - 14, -1);
      playFx('pop', 0);
    };

    const spawnPatternBurst = (
      cx: number,
      cy: number,
      pattern: BurstPattern,
      palette: Palette,
      secondaryPalette: Palette,
      sc: number,
      isHero = false,
    ) => {
      const baseSpeed = rnd(310, 470) * sc * (isHero ? 1.24 : 1);

      flashes.push({
        x: cx,
        y: cy,
        radius: (isHero ? 260 : 155) * sc,
        color: palette.glow,
        life: isHero ? 0.45 : 0.3,
        maxLife: isHero ? 0.45 : 0.3,
      });

      rings.push({
        x: cx,
        y: cy,
        radius: 10 * sc,
        maxRadius: (isHero ? 270 : 165) * sc,
        color: palette.colors[1],
        life: isHero ? 0.62 : 0.46,
        maxLife: isHero ? 0.62 : 0.46,
        lineWidth: isHero ? 4.5 : 3,
      });

      if (isHero) {
        rings.push({
          x: cx,
          y: cy,
          radius: 4 * sc,
          maxRadius: 360 * sc,
          color: '#fef08a',
          life: 0.78,
          maxLife: 0.78,
          lineWidth: 2.5,
        });
      }

      if (pattern === 'willow') {
        const count = isHero ? 140 : 108;
        for (let i = 0; i < count; i++) {
          const ang = (Math.PI * 2 * i) / count + rnd(-0.04, 0.04);
          const spd = baseSpeed * rnd(0.45, 1.08);
          pushEmber({
            x: cx,
            y: cy,
            px: cx,
            py: cy,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd - 24 * sc,
            color: i % 5 === 0 ? palette.colors[0] : palette.colors[(i % 3) + 1],
            glow: palette.glow,
            size: rnd(2.4, 3.8) * sc,
            life: rnd(1.85, 2.75),
            maxLife: 2.75,
            drag: 2.0,
            gravity: 165 * sc,
            twinkle: i % 4 === 0,
            crackles: false,
          });
        }
      } else if (pattern === 'star') {
        const points = 5;
        const vertices: Array<{ x: number; y: number }> = [];
        const rot = rnd(-0.2, 0.2);
        for (let k = 0; k < points * 2; k++) {
          const r = k % 2 === 0 ? 1.0 : 0.44;
          const a = (k * Math.PI) / points - Math.PI / 2 + rot;
          vertices.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
        }
        const perEdge = 10;
        for (let e = 0; e < vertices.length; e++) {
          const v0 = vertices[e];
          const v1 = vertices[(e + 1) % vertices.length];
          for (let s = 0; s < perEdge; s++) {
            const t = s / perEdge;
            const dx = v0.x + (v1.x - v0.x) * t;
            const dy = v0.y + (v1.y - v0.y) * t;
            const col = palette.colors[(e + s) % palette.colors.length];
            pushEmber({
              x: cx,
              y: cy,
              px: cx,
              py: cy,
              vx: dx * baseSpeed * 0.96 + rnd(-14, 14) * sc,
              vy: dy * baseSpeed * 0.96 + rnd(-14, 14) * sc,
              color: col,
              glow: palette.glow,
              size: rnd(2.8, 4.1) * sc,
              life: rnd(1.25, 1.75),
              maxLife: 1.75,
              drag: 1.9,
              gravity: 95 * sc,
              twinkle: true,
              crackles: false,
            });
          }
        }
        for (let c = 0; c < 28; c++) {
          const a = rnd(0, Math.PI * 2);
          const spd = baseSpeed * rnd(0.18, 0.42);
          pushEmber({
            x: cx,
            y: cy,
            px: cx,
            py: cy,
            vx: Math.cos(a) * spd,
            vy: Math.sin(a) * spd,
            color: secondaryPalette.colors[1],
            glow: secondaryPalette.glow,
            size: rnd(2.0, 3.2) * sc,
            life: rnd(0.95, 1.45),
            maxLife: 1.45,
            drag: 2.2,
            gravity: 110 * sc,
            twinkle: false,
            crackles: false,
          });
        }
      } else if (pattern === 'heart') {
        const count = 96;
        const hScale = baseSpeed / 16.2;
        for (let i = 0; i < count; i++) {
          const t = (Math.PI * 2 * i) / count;
          const hx = 16 * Math.pow(Math.sin(t), 3);
          const hy = -(
            13 * Math.cos(t) -
            5 * Math.cos(2 * t) -
            2 * Math.cos(3 * t) -
            Math.cos(4 * t)
          );
          pushEmber({
            x: cx,
            y: cy,
            px: cx,
            py: cy,
            vx: hx * hScale + rnd(-12, 12) * sc,
            vy: hy * hScale + rnd(-12, 12) * sc,
            color: palette.colors[i % palette.colors.length],
            glow: palette.glow,
            size: rnd(2.8, 4.2) * sc,
            life: rnd(1.35, 1.85),
            maxLife: 1.85,
            drag: 1.95,
            gravity: 85 * sc,
            twinkle: i % 3 === 0,
            crackles: false,
          });
        }
        for (let s = 0; s < 24; s++) {
          const a = rnd(0, Math.PI * 2);
          const spd = baseSpeed * rnd(0.1, 0.35);
          pushEmber({
            x: cx,
            y: cy,
            px: cx,
            py: cy,
            vx: Math.cos(a) * spd,
            vy: Math.sin(a) * spd,
            color: '#fffbeb',
            glow: palette.glow,
            size: rnd(1.8, 2.8) * sc,
            life: rnd(0.85, 1.25),
            maxLife: 1.25,
            drag: 2.1,
            gravity: 100 * sc,
            twinkle: true,
            crackles: false,
          });
        }
      } else if (pattern === 'doubleRing') {
        const outerCount = 66;
        for (let i = 0; i < outerCount; i++) {
          const a = (Math.PI * 2 * i) / outerCount + rnd(-0.02, 0.02);
          const spd = baseSpeed * rnd(0.95, 1.06);
          pushEmber({
            x: cx,
            y: cy,
            px: cx,
            py: cy,
            vx: Math.cos(a) * spd,
            vy: Math.sin(a) * spd,
            color: palette.colors[i % palette.colors.length],
            glow: palette.glow,
            size: rnd(2.8, 4.0) * sc,
            life: rnd(1.3, 1.8),
            maxLife: 1.8,
            drag: 1.85,
            gravity: 110 * sc,
            twinkle: true,
            crackles: false,
          });
        }
        const innerCount = 44;
        for (let i = 0; i < innerCount; i++) {
          const a = (Math.PI * 2 * i) / innerCount + rnd(-0.03, 0.03);
          const spd = baseSpeed * rnd(0.52, 0.62);
          pushEmber({
            x: cx,
            y: cy,
            px: cx,
            py: cy,
            vx: Math.cos(a) * spd,
            vy: Math.sin(a) * spd,
            color: secondaryPalette.colors[i % secondaryPalette.colors.length],
            glow: secondaryPalette.glow,
            size: rnd(2.4, 3.6) * sc,
            life: rnd(1.15, 1.65),
            maxLife: 1.65,
            drag: 1.85,
            gravity: 110 * sc,
            twinkle: false,
            crackles: false,
          });
        }
      } else {
        // 'palm' — bold curving comet fronds that scatter sub-sparks
        const branches = 11;
        for (let b = 0; b < branches; b++) {
          const a = (Math.PI * 2 * b) / branches + rnd(-0.1, 0.1);
          const armSpeed = baseSpeed * rnd(0.88, 1.12);
          const col = palette.colors[b % palette.colors.length];
          for (let sub = 0; sub < 5; sub++) {
            const frac = 0.72 + sub * 0.08;
            pushEmber({
              x: cx,
              y: cy,
              px: cx,
              py: cy,
              vx: Math.cos(a + rnd(-0.04, 0.04)) * armSpeed * frac,
              vy: Math.sin(a + rnd(-0.04, 0.04)) * armSpeed * frac - 20 * sc,
              color: sub === 4 ? '#ffffff' : col,
              glow: palette.glow,
              size: rnd(3.6, 5.0) * sc,
              life: rnd(1.35, 1.95),
              maxLife: 1.95,
              drag: 1.55,
              gravity: 185 * sc,
              twinkle: sub === 4,
              crackles: sub === 4,
            });
          }
        }
      }
    };

    const spawnHeroExplosion = (cx: number, cy: number, yearNum: number, sc: number) => {
      spawnPatternBurst(
        cx,
        cy,
        'doubleRing',
        GALA_PALETTES[0],
        GALA_PALETTES[2],
        sc * 1.12,
        true,
      );
      spawnPatternBurst(
        cx,
        cy,
        'star',
        GALA_PALETTES[1],
        GALA_PALETTES[0],
        sc * 0.96,
        false,
      );

      // Pyrotechnic spark-text silhouette outlining "BOLDOG ÚJ ÉVET! <YEAR>"
      const textPts = sampleTextTargets('BOLDOG ÚJ ÉVET!', String(yearNum), cx, cy, sc);
      const maxPts = 180;
      const step = Math.max(1, Math.floor(textPts.length / maxPts));
      for (let i = 0; i < textPts.length; i += step) {
        const pt = textPts[i];
        const dx = pt.x - cx;
        const dy = pt.y - cy;
        pushEmber({
          x: cx + dx * 0.25,
          y: cy + dy * 0.25,
          px: cx,
          py: cy,
          vx: dx * 1.35 + rnd(-18, 18) * sc,
          vy: dy * 1.35 + rnd(-18, 18) * sc,
          color: i % 3 === 0 ? '#fffbeb' : i % 3 === 1 ? '#fde047' : '#f472b6',
          glow: 'rgba(255, 215, 102, 0.95)',
          size: rnd(2.0, 3.2) * sc,
          life: rnd(1.15, 1.65),
          maxLife: 1.65,
          drag: 3.1,
          gravity: 32 * sc,
          twinkle: true,
          crackles: false,
        });
      }

      fireConfettiCannons(1.0);
      playFx('boom', cx);
      playFx('fanfare', cx);

      onHeroBurstRef.current({
        year: yearNum,
        xPct: (cx / Math.max(1, w)) * 100,
        yPct: (cy / Math.max(1, h)) * 100,
        expiresAt: serverNowMs() + 7200,
      });
    };

    const launchShell = (opts?: {
      xPct?: number;
      targetYPct?: number;
      pattern?: BurstPattern;
      palette?: Palette;
      secondaryPalette?: Palette;
      heroYear?: number;
    }) => {
      const sc = getScale();
      const startX = (opts?.xPct ?? rnd(0.14, 0.86)) * w;
      const targetY = (opts?.targetYPct ?? rnd(0.2, 0.44)) * h;
      const distanceY = Math.max(140, h + 12 - targetY);
      const gravity = 340 * sc;
      // v^2 = 2 * g * d so it reaches exact apex right at targetY
      const vy = -Math.sqrt(2 * gravity * distanceY);
      const flightTime = Math.abs(vy) / gravity;
      const driftX = opts?.heroYear ? 0 : rnd(-45, 45) * sc;
      const palette = opts?.palette ?? GALA_PALETTES[patternIdx % GALA_PALETTES.length];
      const secondaryPalette =
        opts?.secondaryPalette ?? GALA_PALETTES[(patternIdx + 2) % GALA_PALETTES.length];
      const pattern = opts?.pattern ?? PATTERN_CYCLE[patternIdx % PATTERN_CYCLE.length];
      patternIdx += 1;

      shells.push({
        x: startX - driftX * flightTime * 0.25,
        y: h + 12,
        vx: driftX,
        vy,
        targetY,
        palette,
        secondaryPalette,
        pattern,
        scale: sc,
        trail: [],
        heroYear: opts?.heroYear,
      });
      playFx('launch', startX);
    };

    const scheduleAt = (delaySec: number, run: () => void) => {
      queue.push({ at: elapsedSim + delaySec, run });
    };

    const triggerFinale = (yearNum: number) => {
      if (reduceMotion) {
        onHeroBurstRef.current({
          year: yearNum,
          xPct: 50,
          yPct: 38,
          expiresAt: serverNowMs() + 7200,
        });
        playFx('fanfare', w * 0.5);
        return;
      }

      queue.length = 0;
      nextAmbientAt = elapsedSim + 8.5;

      // 1. Center hero shell shoots upward and bursts into "Boldog Új Évet!" + cannons
      launchShell({
        xPct: 0.5,
        targetYPct: 0.38,
        pattern: 'doubleRing',
        palette: GALA_PALETTES[0],
        secondaryPalette: GALA_PALETTES[2],
        heroYear: yearNum,
      });

      // 2. Choreographed multi-pattern salvo after hero detonation (~0.75s)
      scheduleAt(1.3, () => {
        launchShell({ xPct: 0.22, targetYPct: 0.28, pattern: 'star', palette: GALA_PALETTES[1] });
        launchShell({ xPct: 0.78, targetYPct: 0.28, pattern: 'star', palette: GALA_PALETTES[2] });
      });

      scheduleAt(2.05, () => {
        launchShell({ xPct: 0.34, targetYPct: 0.25, pattern: 'heart', palette: GALA_PALETTES[2] });
        launchShell({
          xPct: 0.66,
          targetYPct: 0.27,
          pattern: 'doubleRing',
          palette: GALA_PALETTES[3],
          secondaryPalette: GALA_PALETTES[0],
        });
      });

      scheduleAt(2.85, () => {
        launchShell({ xPct: 0.2, targetYPct: 0.33, pattern: 'palm', palette: GALA_PALETTES[5] });
        launchShell({ xPct: 0.8, targetYPct: 0.33, pattern: 'palm', palette: GALA_PALETTES[4] });
        fireConfettiCannons(0.75);
      });

      scheduleAt(3.75, () => {
        launchShell({ xPct: 0.5, targetYPct: 0.22, pattern: 'willow', palette: GALA_PALETTES[0] });
        launchShell({ xPct: 0.28, targetYPct: 0.34, pattern: 'star', palette: GALA_PALETTES[4] });
        launchShell({ xPct: 0.72, targetYPct: 0.34, pattern: 'heart', palette: GALA_PALETTES[1] });
      });

      // 3. Grand 3-shell golden willow fan finale + second confetti volley
      scheduleAt(5.15, () => {
        launchShell({ xPct: 0.25, targetYPct: 0.3, pattern: 'willow', palette: GALA_PALETTES[4] });
        launchShell({ xPct: 0.5, targetYPct: 0.24, pattern: 'willow', palette: GALA_PALETTES[0] });
        launchShell({ xPct: 0.75, targetYPct: 0.3, pattern: 'willow', palette: GALA_PALETTES[1] });
      });
      scheduleAt(5.9, () => {
        fireConfettiCannons(0.85);
      });
    };

    finaleFnRef.current = triggerFinale;

    const frame = (ts: number) => {
      if (document.hidden) {
        rafId = 0;
        return;
      }
      if (!lastTs) lastTs = ts;
      const dt = Math.min(0.05, Math.max(0.001, (ts - lastTs) / 1000));
      lastTs = ts;
      elapsedSim += dt;

      // Dispatch queued choreography
      for (let i = queue.length - 1; i >= 0; i--) {
        if (elapsedSim >= queue[i].at) {
          const item = queue.splice(i, 1)[0];
          item.run();
        }
      }

      // Gentle ambient celebration shells when idle
      if (elapsedSim >= nextAmbientAt && shells.length < 3) {
        nextAmbientAt = elapsedSim + rnd(2.2, 4.2);
        launchShell();
      }

      ctx.clearRect(0, 0, w, h);

      // Update & draw radial flashes (additive lighting)
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i];
        f.life -= dt;
        if (f.life <= 0) {
          flashes.splice(i, 1);
          continue;
        }
        const a = Math.pow(f.life / f.maxLife, 1.5);
        const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.radius);
        grad.addColorStop(0, `rgba(255, 250, 230, ${0.72 * a})`);
        grad.addColorStop(0.35, f.color.replace(/[\d.]+\)$/, `${0.46 * a})`));
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // Update & draw ascending firework shells
      for (let i = shells.length - 1; i >= 0; i--) {
        const s = shells[i];
        s.trail.push({ x: s.x, y: s.y });
        if (s.trail.length > 10) s.trail.shift();

        const gravity = 340 * s.scale;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += gravity * dt;

        if (s.trail.length > 1) {
          ctx.strokeStyle = s.heroYear ? '#fef08a' : s.palette.colors[1];
          ctx.lineWidth = (s.heroYear ? 4.2 : 2.6) * s.scale;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(s.trail[0].x, s.trail[0].y);
          for (let k = 1; k < s.trail.length; k++) {
            ctx.lineTo(s.trail[k].x, s.trail[k].y);
          }
          ctx.lineTo(s.x, s.y);
          ctx.stroke();
        }

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(s.x, s.y, (s.heroYear ? 4.8 : 3.0) * s.scale, 0, Math.PI * 2);
        ctx.fill();

        // Sparkle tail from hero rocket
        if (s.heroYear && Math.random() < 0.75) {
          pushEmber({
            x: s.x + rnd(-2, 2),
            y: s.y + rnd(0, 6),
            px: s.x,
            py: s.y,
            vx: rnd(-35, 35) * s.scale,
            vy: rnd(40, 110) * s.scale,
            color: '#fde047',
            glow: 'rgba(255, 209, 102, 0.9)',
            size: rnd(1.8, 3.0) * s.scale,
            life: rnd(0.25, 0.45),
            maxLife: 0.45,
            drag: 2.4,
            gravity: 120 * s.scale,
            twinkle: true,
            crackles: false,
          });
        }

        if (s.vy >= -12 || s.y <= s.targetY) {
          shells.splice(i, 1);
          if (s.heroYear !== undefined) {
            spawnHeroExplosion(s.x, s.y, s.heroYear, s.scale);
          } else {
            spawnPatternBurst(
              s.x,
              s.y,
              s.pattern,
              s.palette,
              s.secondaryPalette,
              s.scale,
              false,
            );
            playFx('boom', s.x);
          }
        }
      }

      // Update & draw shockwave rings
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.life -= dt;
        if (r.life <= 0) {
          rings.splice(i, 1);
          continue;
        }
        const prog = 1 - r.life / r.maxLife;
        const rad = r.radius + (r.maxRadius - r.radius) * (1 - Math.pow(1 - prog, 2.4));
        ctx.globalAlpha = Math.max(0, 1 - prog) * 0.72;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = Math.max(0.8, r.lineWidth * (1 - prog * 0.65));
        ctx.beginPath();
        ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Update & draw firework embers
      for (let i = embers.length - 1; i >= 0; i--) {
        const e = embers[i];
        e.life -= dt;
        if (e.life <= 0) {
          if (e.crackles && embers.length < 1650) {
            for (let c = 0; c < 4; c++) {
              const a = rnd(0, Math.PI * 2);
              const spd = rnd(45, 95);
              pushEmber({
                x: e.x,
                y: e.y,
                px: e.x,
                py: e.y,
                vx: Math.cos(a) * spd,
                vy: Math.sin(a) * spd,
                color: '#fffbeb',
                glow: e.glow,
                size: Math.max(1.5, e.size * 0.65),
                life: rnd(0.22, 0.42),
                maxLife: 0.42,
                drag: 2.5,
                gravity: e.gravity * 0.7,
                twinkle: true,
                crackles: false,
              });
            }
          }
          embers.splice(i, 1);
          continue;
        }

        e.px = e.x;
        e.py = e.y;
        const damp = Math.exp(-e.drag * dt);
        e.vx *= damp;
        e.vy = e.vy * damp + e.gravity * dt;
        e.x += e.vx * dt;
        e.y += e.vy * dt;

        let alpha = Math.min(1, (e.life / e.maxLife) * 1.45);
        if (e.twinkle && e.life < e.maxLife * 0.55) {
          alpha *= 0.45 + 0.55 * Math.sin(elapsedSim * 28 + i * 1.7);
        }
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.strokeStyle = e.color;
        ctx.lineWidth = e.size;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(e.px, e.py);
        ctx.lineTo(e.x, e.y);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(e.x, e.y, Math.max(1, e.size * 0.42), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Draw tumbling metallic confetti (normal compositing for crisp colors)
      for (let i = confetti.length - 1; i >= 0; i--) {
        const p = confetti[i];
        p.life -= dt;
        if (p.life <= 0 || p.y > h + 40) {
          confetti.splice(i, 1);
          continue;
        }

        const sc = getScale();
        p.vx *= Math.exp(-2.2 * dt);
        p.vy = p.vy * Math.exp(-1.9 * dt) + 235 * sc * dt;
        p.vx += Math.sin(p.phase + elapsedSim * p.flutterFreq) * 58 * sc * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.tilt += p.tiltSpeed * dt;
        p.spin += p.spinSpeed * dt;

        const flipScale = Math.cos(p.tilt);
        const alpha = Math.min(1, p.life / 0.9);
        ctx.save();
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.scale(1, Math.abs(flipScale) * 0.85 + 0.15);
        ctx.fillStyle = flipScale > 0 ? p.color : '#fffbeb';
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }

      rafId = window.requestAnimationFrame(frame);
    };

    const startLoop = () => {
      if (reduceMotion || rafId || document.hidden) return;
      lastTs = 0;
      rafId = window.requestAnimationFrame(frame);
    };

    const stopLoop = () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    const onVisibility = () => {
      if (document.hidden) {
        stopLoop();
        shells.length = 0;
        embers.length = 0;
        rings.length = 0;
        flashes.length = 0;
        confetti.length = 0;
        queue.length = 0;
        ctx.clearRect(0, 0, w, h);
      } else {
        setHero((cur) => (cur && serverNowMs() >= cur.expiresAt ? null : cur));
        startLoop();
      }
    };

    const onLabTrigger = () => {
      triggerFinale(parseYear(date));
    };

    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('sbx:nye', onLabTrigger);
    startLoop();

    return () => {
      stopLoop();
      finaleFnRef.current = null;
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('sbx:nye', onLabTrigger);
    };
  }, [showAmbientCanvas, date]);

  // Fire midnight finale exactly once via central live window guard
  useEffect(() => {
    if (!enabled || !isJan01) return;
    if (secs <= 20 && claimLiveBellEvent(date, 'nye-midnight', secs, 12)) {
      finaleFnRef.current?.(targetYear);
    }
  }, [enabled, isJan01, date, secs, targetYear]);

  // Fire immediately when preview mode activates (e.g., /?nye=1 or TestLab toggle)
  useEffect(() => {
    if (!enabled || !preview) return;
    const id = window.setTimeout(() => {
      finaleFnRef.current?.(targetYear);
    }, 60);
    return () => window.clearTimeout(id);
  }, [enabled, preview, targetYear]);

  return (
    <>
      {showAmbientCanvas && (
        <canvas ref={canvasRef} className="nye-canvas" aria-hidden="true" />
      )}

      {hero && (
        <div
          key={hero.id}
          className="nye-hero"
          style={{ left: `${hero.xPct}%`, top: `${hero.yPct}%` }}
          aria-live="polite"
        >
          <div className="nye-hero-sparkles" aria-hidden="true">
            <span className="s1">✦</span>
            <span className="s2">✧</span>
            <span className="s3">✦</span>
            <span className="s4">✧</span>
          </div>
          <div className="nye-hero-kicker">Boldog Új Évet!</div>
          <div className="nye-hero-year">{hero.year}</div>
        </div>
      )}

      {isFinalTen && (
        <div key={Math.ceil(remToMidnight)} className="nye-final-ten" aria-live="assertive">
          {Math.ceil(remToMidnight)}
        </div>
      )}

      {showCountdown && (
        <div className="nye-countdown" aria-live="off">
          <span aria-hidden="true">🎆</span>
          <span>Éjfélig {formatCountdown(remToMidnight)}</span>
        </div>
      )}

      {showRibbon && (
        <div className="nye-ribbon" aria-hidden="true">
          ✨ Boldog Új Évet {targetYear}! 🎆
        </div>
      )}
    </>
  );
}
