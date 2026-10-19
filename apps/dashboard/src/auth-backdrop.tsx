import React, { useEffect, useRef } from "react";
import "./auth-backdrop.css";

type Hue = "signal" | "blue" | "purple" | "amber";

const PALETTE: Record<Hue, string> = {
  signal: "66, 212, 189",
  blue: "66, 111, 209",
  purple: "136, 112, 186",
  amber: "167, 120, 47",
};
const EDGE_HUES: Hue[] = ["signal", "blue", "purple", "signal"];

type BlockKind = "bar" | "line" | "button" | "media";
type Block = {
  rx: number;
  ry: number;
  rw: number;
  rh: number;
  kind: BlockKind;
};

type PageCard = {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  phase: number;
  blocks: Block[];
};

type FlowEdge = {
  from: number;
  to: number;
  hue: Hue;
  bend: number;
};

type FlowPulse = {
  edge: number;
  t: number;
  speed: number;
};

type Extraction = {
  card: number;
  block: number;
  label: string;
  start: number;
  duration: number;
  above: boolean;
};

type Dust = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  phase: number;
};

const TAGS_BY_KIND: Record<BlockKind, string[]> = {
  bar: ["<nav>", "<header>", "role=banner"],
  line: ["<p>", "span.label", "h2.title"],
  button: ["<button>", "a.cta", "[type=submit]"],
  media: ["<section>", "div.card", "<img>"],
};

const bezierPoint = (
  p0: { x: number; y: number },
  c: { x: number; y: number },
  p1: { x: number; y: number },
  t: number,
) => {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x,
    y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y,
  };
};

export function AuthBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !parent || !ctx) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let width = 0;
    let height = 0;
    let cards: PageCard[] = [];
    let edges: FlowEdge[] = [];
    let dust: Dust[] = [];
    const pulses: FlowPulse[] = [];
    const extractions: Extraction[] = [];
    let raf = 0;
    let lastPulseSpawn = 0;
    let lastExtractSpawn = 0;
    let last = performance.now();
    let elapsed = 0;
    let visible = document.visibilityState === "visible";

    const makeBlocks = (): Block[] => {
      const blocks: Block[] = [
        { rx: 0.08, ry: 0.22, rw: 0.5, rh: 0.1, kind: "bar" },
        { rx: 0.08, ry: 0.4, rw: 0.84, rh: 0.07, kind: "line" },
        { rx: 0.08, ry: 0.52, rw: 0.62, rh: 0.07, kind: "line" },
        { rx: 0.08, ry: 0.68, rw: 0.38, rh: 0.12, kind: "media" },
        { rx: 0.52, ry: 0.68, rw: 0.22, rh: 0.12, kind: "button" },
      ];
      return blocks;
    };

    const resize = () => {
      const rect = parent.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const cardW = Math.min(220, Math.max(150, width * 0.17));
      const cardH = cardW * 0.7;
      const count = width < 640 ? 3 : width < 1040 ? 4 : 5;
      const cx = width / 2;
      const cy = height / 2;
      const exclR = Math.min(width, height) * 0.32;

      const placed: PageCard[] = [];
      for (let i = 0; i < count; i++) {
        let x = 0;
        let y = 0;
        for (let attempt = 0; attempt < 24; attempt++) {
          x = cardW / 2 + Math.random() * (width - cardW);
          y = cardH / 2 + Math.random() * (height - cardH);
          const farFromCenter = Math.hypot(x - cx, y - cy) > exclR;
          const farFromOthers = placed.every(
            (p) => Math.hypot(x - p.x, y - p.y) > cardW * 1.1,
          );
          if (farFromCenter && farFromOthers) break;
        }
        placed.push({
          x,
          y,
          w: cardW,
          h: cardH,
          vx: (Math.random() - 0.5) * 0.045,
          vy: (Math.random() - 0.5) * 0.045,
          phase: Math.random() * Math.PI * 2,
          blocks: makeBlocks(),
        });
      }
      cards = placed;

      edges = [];
      for (let i = 0; i < cards.length - 1; i++) {
        edges.push({
          from: i,
          to: i + 1,
          hue: EDGE_HUES[i % EDGE_HUES.length],
          bend: (Math.random() - 0.5) * 0.6,
        });
      }
      if (cards.length >= 4) {
        edges.push({
          from: 0,
          to: cards.length - 1,
          hue: EDGE_HUES[2],
          bend: (Math.random() - 0.5) * 0.6,
        });
      }

      const dustCount = Math.min(22, Math.max(10, Math.round((width * height) / 70000)));
      dust = Array.from({ length: dustCount }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.08,
        vy: (Math.random() - 0.5) * 0.08,
        r: 0.8 + Math.random() * 1.2,
        phase: Math.random() * Math.PI * 2,
      }));

      pulses.length = 0;
      extractions.length = 0;
    };

    const edgePoints = (edge: FlowEdge) => {
      const a = cards[edge.from];
      const b = cards[edge.to];
      const mx = (a.x + b.x) / 2 - (b.y - a.y) * edge.bend;
      const my = (a.y + b.y) / 2 + (b.x - a.x) * edge.bend;
      return {
        p0: { x: a.x, y: a.y },
        c: { x: mx, y: my },
        p1: { x: b.x, y: b.y },
      };
    };

    const spawnPulse = (time: number) => {
      if (!edges.length) return;
      pulses.push({
        edge: Math.floor(Math.random() * edges.length),
        t: 0,
        speed: 0.22 + Math.random() * 0.2,
      });
      lastPulseSpawn = time;
    };

    const spawnExtraction = (time: number) => {
      if (!cards.length || extractions.length >= 3) return;
      const candidates: Array<{ cardIdx: number; blockIdx: number }> = [];
      cards.forEach((card, cardIdx) => {
        card.blocks.forEach((_, blockIdx) => {
          const active = extractions.some(
            (ex) => ex.card === cardIdx && ex.block === blockIdx,
          );
          if (!active) candidates.push({ cardIdx, blockIdx });
        });
      });
      if (!candidates.length) return;
      const { cardIdx, blockIdx } =
        candidates[Math.floor(Math.random() * candidates.length)];
      const card = cards[cardIdx];
      const block = card.blocks[blockIdx];
      const tags = TAGS_BY_KIND[block.kind];
      extractions.push({
        card: cardIdx,
        block: blockIdx,
        label: tags[Math.floor(Math.random() * tags.length)],
        start: time,
        duration: 1900 + Math.random() * 500,
        above: block.ry > 0.3,
      });
      lastExtractSpawn = time;
    };

    const drawArrowhead = (x: number, y: number, angle: number, color: string) => {
      const size = 5;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = `rgba(${color}, 0.5)`;
      ctx.beginPath();
      ctx.moveTo(size, 0);
      ctx.lineTo(-size * 0.6, -size * 0.6);
      ctx.lineTo(-size * 0.6, size * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    const drawFrame = (dt: number, animate: boolean) => {
      ctx.clearRect(0, 0, width, height);

      if (animate) {
        for (const c of cards) {
          c.x += c.vx * (dt / 16);
          c.y += c.vy * (dt / 16);
          c.phase += dt / 2200;
        }
        for (const d of dust) {
          d.x += d.vx * (dt / 16);
          d.y += d.vy * (dt / 16);
          if (d.x < -10) d.x = width + 10;
          else if (d.x > width + 10) d.x = -10;
          if (d.y < -10) d.y = height + 10;
          else if (d.y > height + 10) d.y = -10;
          d.phase += dt / 1100;
        }
      }

      for (const d of dust) {
        const twinkle = animate ? 0.3 + Math.sin(d.phase) * 0.25 : 0.4;
        ctx.fillStyle = `rgba(226, 238, 243, ${Math.max(0, twinkle) * 0.4})`;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.lineWidth = 1.1;
      for (const edge of edges) {
        const { p0, c, p1 } = edgePoints(edge);
        ctx.strokeStyle = `rgba(226, 238, 243, 0.14)`;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.quadraticCurveTo(c.x, c.y, p1.x, p1.y);
        ctx.stroke();
        const tip = bezierPoint(p0, c, p1, 0.94);
        const beforeTip = bezierPoint(p0, c, p1, 0.86);
        const angle = Math.atan2(tip.y - beforeTip.y, tip.x - beforeTip.x);
        drawArrowhead(tip.x, tip.y, angle, PALETTE[edge.hue]);
      }

      if (animate) {
        for (let i = pulses.length - 1; i >= 0; i--) {
          const p = pulses[i];
          p.t += (dt / 1000) * p.speed;
          if (p.t >= 1) {
            pulses.splice(i, 1);
            continue;
          }
          const edge = edges[p.edge];
          if (!edge) {
            pulses.splice(i, 1);
            continue;
          }
          const { p0, c, p1 } = edgePoints(edge);
          const pt = bezierPoint(p0, c, p1, p.t);
          const fade = Math.sin(p.t * Math.PI);
          const color = PALETTE[edge.hue];
          const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, 6);
          grad.addColorStop(0, `rgba(${color}, ${0.95 * fade})`);
          grad.addColorStop(1, `rgba(${color}, 0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      for (const card of cards) {
        const breathe = animate ? Math.sin(card.phase) * 1.5 : 0;
        const left = card.x - card.w / 2;
        const top = card.y - card.h / 2 + breathe;
        const r = 8;

        ctx.beginPath();
        ctx.moveTo(left + r, top);
        ctx.arcTo(left + card.w, top, left + card.w, top + card.h, r);
        ctx.arcTo(left + card.w, top + card.h, left, top + card.h, r);
        ctx.arcTo(left, top + card.h, left, top, r);
        ctx.arcTo(left, top, left + card.w, top, r);
        ctx.closePath();
        ctx.fillStyle = "rgba(16, 28, 43, 0.4)";
        ctx.fill();
        ctx.strokeStyle = "rgba(226, 238, 243, 0.16)";
        ctx.lineWidth = 1;
        ctx.stroke();

        const chromeH = card.h * 0.16;
        for (let d = 0; d < 3; d++) {
          ctx.fillStyle = "rgba(226, 238, 243, 0.22)";
          ctx.beginPath();
          ctx.arc(left + 10 + d * 9, top + chromeH / 2, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "rgba(226, 238, 243, 0.08)";
        const pillX = left + 42;
        const pillW = card.w - 52;
        ctx.beginPath();
        ctx.roundRect(pillX, top + chromeH / 2 - 4, pillW, 8, 4);
        ctx.fill();
        ctx.strokeStyle = "rgba(226, 238, 243, 0.14)";
        ctx.beginPath();
        ctx.moveTo(left, top + chromeH);
        ctx.lineTo(left + card.w, top + chromeH);
        ctx.stroke();

        for (const block of card.blocks) {
          const bx = left + block.rx * card.w;
          const by = top + block.ry * card.h;
          const bw = block.rw * card.w;
          const bh = block.rh * card.h;
          if (block.kind === "button") {
            ctx.fillStyle = "rgba(66, 212, 189, 0.1)";
            ctx.strokeStyle = "rgba(66, 212, 189, 0.3)";
          } else if (block.kind === "bar") {
            ctx.fillStyle = "rgba(226, 238, 243, 0.1)";
            ctx.strokeStyle = "rgba(226, 238, 243, 0)";
          } else {
            ctx.fillStyle = "rgba(226, 238, 243, 0.06)";
            ctx.strokeStyle = "rgba(226, 238, 243, 0)";
          }
          ctx.beginPath();
          ctx.roundRect(bx, by, bw, bh, 3);
          ctx.fill();
          if (block.kind === "button") ctx.stroke();
        }
      }

      if (animate) {
        for (let i = extractions.length - 1; i >= 0; i--) {
          const ex = extractions[i];
          const age = elapsed - ex.start;
          if (age >= ex.duration) {
            extractions.splice(i, 1);
            continue;
          }
          const t = age / ex.duration;
          const fade = Math.sin(t * Math.PI);
          const card = cards[ex.card];
          const block = card.blocks[ex.block];
          if (!card || !block) continue;
          const left = card.x - card.w / 2;
          const top = card.y - card.h / 2;
          const bx = left + block.rx * card.w;
          const by = top + block.ry * card.h;
          const bw = block.rw * card.w;
          const bh = block.rh * card.h;
          const color = PALETTE.signal;

          ctx.strokeStyle = `rgba(${color}, ${0.8 * fade})`;
          ctx.lineWidth = 1.4;
          ctx.strokeRect(bx, by, bw, bh);

          const arm = 5;
          ctx.strokeStyle = `rgba(${color}, ${fade})`;
          ctx.lineWidth = 2;
          for (const [cx2, cy2, dx, dy] of [
            [bx, by, 1, 1],
            [bx + bw, by, -1, 1],
            [bx, by + bh, 1, -1],
            [bx + bw, by + bh, -1, -1],
          ] as const) {
            ctx.beginPath();
            ctx.moveTo(cx2 + arm * dx, cy2);
            ctx.lineTo(cx2, cy2);
            ctx.lineTo(cx2, cy2 + arm * dy);
            ctx.stroke();
          }

          const labelY = ex.above ? by - 8 : by + bh + 14;
          ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
          const metrics = ctx.measureText(ex.label);
          const padX = 5;
          const pillW = metrics.width + padX * 2;
          const pillH = 15;
          const pillX = Math.min(Math.max(bx, 0), width - pillW);
          const pillY = ex.above ? labelY - pillH : labelY - pillH + 14;
          ctx.fillStyle = `rgba(10, 18, 28, ${0.78 * fade})`;
          ctx.beginPath();
          ctx.roundRect(pillX, pillY, pillW, pillH, 4);
          ctx.fill();
          ctx.strokeStyle = `rgba(${color}, ${0.5 * fade})`;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = `rgba(${color}, ${0.95 * fade})`;
          ctx.textBaseline = "middle";
          ctx.fillText(ex.label, pillX + padX, pillY + pillH / 2 + 1);
        }
      }
    };

    const tick = (time: number) => {
      const dt = Math.min(32, time - last);
      last = time;
      elapsed += dt;
      drawFrame(dt, true);
      if (time - lastPulseSpawn > 900 && pulses.length < 4) spawnPulse(time);
      if (time - lastExtractSpawn > 650) spawnExtraction(time);
      if (visible) raf = requestAnimationFrame(tick);
    };

    resize();

    if (reduceMotion) {
      drawFrame(0, false);
    } else {
      raf = requestAnimationFrame(tick);
    }

    const onResize = () => {
      resize();
      if (reduceMotion) drawFrame(0, false);
    };
    const onVisibility = () => {
      visible = document.visibilityState === "visible";
      if (visible && !reduceMotion) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div className="auth-backdrop" aria-hidden="true">
      <div className="auth-backdrop-aurora auth-backdrop-aurora-a" />
      <div className="auth-backdrop-aurora auth-backdrop-aurora-b" />
      <div className="auth-backdrop-aurora auth-backdrop-aurora-c" />
      <div className="auth-backdrop-grid" />
      <canvas ref={canvasRef} className="auth-backdrop-canvas" />
      <div className="auth-backdrop-vignette" />
    </div>
  );
}
