import { useRef, useState } from "react";
import {
  boxSpecFor,
  caseColorFor,
  caseColorIsLight,
  type PlatformFamily,
} from "@gm/shared";

interface Props {
  title: string;
  coverSrc: string | null;
  platformName: string;
  family: PlatformFamily;
  summary?: string | null;
  /** rendered box height in px */
  size?: number;
}

/** Darken a hex color by a factor (0..1). */
function shade(hex: string, factor: number): string {
  const c = (i: number) =>
    Math.round(parseInt(hex.slice(i, i + 2), 16) * factor)
      .toString(16)
      .padStart(2, "0");
  return `#${c(1)}${c(3)}${c(5)}`;
}

/**
 * A real 3D game box built from six CSS faces at the platform's actual
 * retail proportions. Drag to spin it around.
 */
export function BoxViewer3D({ title, coverSrc, platformName, family, summary, size = 320 }: Props) {
  const spec = boxSpecFor(platformName);
  const color = caseColorFor(platformName, family);
  const lightCase = caseColorIsLight(color);
  const ink = lightCase ? "rgba(0,0,0,0.82)" : "rgba(255,255,255,0.92)";

  const H = size;
  const W = (spec.w / spec.h) * size;
  const D = Math.max(8, (spec.d / spec.h) * size);

  const [rot, setRot] = useState({ x: -8, y: -28 });
  const drag = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    drag.current = { startX: e.clientX, startY: e.clientY, baseX: rot.x, baseY: rot.y };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const d = drag.current;
    setRot({
      x: Math.max(-75, Math.min(75, d.baseX - (e.clientY - d.startY) * 0.4)),
      y: d.baseY + (e.clientX - d.startX) * 0.5,
    });
  }
  function onPointerUp() {
    drag.current = null;
  }

  const banner =
    spec.style !== "cardboard" && spec.wordmark ? (
      <div
        className="absolute inset-x-0 top-0 z-10 flex items-center justify-center"
        style={{
          height: Math.round(H * 0.075),
          backgroundColor: color,
          color: ink,
          fontSize: Math.max(8, Math.round(H * 0.032)),
          fontWeight: 800,
          letterSpacing: "0.12em",
        }}
      >
        {spec.wordmark}
      </div>
    ) : null;

  const face = (extra: React.CSSProperties): React.CSSProperties => ({
    position: "absolute",
    backfaceVisibility: "hidden",
    ...extra,
  });

  return (
    <div
      className="select-none"
      style={{ perspective: 1400, touchAction: "none", cursor: "grab" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div
        style={{
          position: "relative",
          width: W,
          height: H,
          margin: "0 auto",
          transformStyle: "preserve-3d",
          transform: `rotateX(${rot.x}deg) rotateY(${rot.y}deg)`,
          transition: drag.current ? "none" : "transform 0.08s linear",
        }}
      >
        {/* front — cover art */}
        <div
          style={face({
            width: W,
            height: H,
            transform: `translateZ(${D / 2}px)`,
            overflow: "hidden",
            borderRadius: spec.style === "cardboard" ? 2 : "2px 6px 6px 2px",
            background: "#27272a",
            border: `1px solid ${shade(color, 0.7)}`,
          })}
        >
          {banner}
          {coverSrc ? (
            <img
              src={coverSrc}
              alt={title}
              draggable={false}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-center font-bold text-zinc-400">
              {title}
            </div>
          )}
          {/* plastic sheen */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(105deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.04) 18%, transparent 30%)",
              pointerEvents: "none",
            }}
          />
        </div>

        {/* back — synthesized back-of-box */}
        <div
          style={face({
            width: W,
            height: H,
            transform: `rotateY(180deg) translateZ(${D / 2}px)`,
            backgroundColor: color,
            color: ink,
            borderRadius: spec.style === "cardboard" ? 2 : "6px 2px 2px 6px",
            padding: Math.round(H * 0.05),
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          })}
        >
          <p style={{ fontWeight: 800, fontSize: Math.round(H * 0.045), lineHeight: 1.15 }}>
            {title}
          </p>
          <p
            style={{
              marginTop: Math.round(H * 0.03),
              fontSize: Math.max(7, Math.round(H * 0.028)),
              lineHeight: 1.45,
              opacity: 0.85,
              flex: 1,
              overflow: "hidden",
            }}
          >
            {summary?.slice(0, 420) ?? "No description available."}
          </p>
          {/* barcode */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <div
              style={{
                width: Math.round(W * 0.28),
                height: Math.round(H * 0.09),
                background:
                  "repeating-linear-gradient(90deg, #111 0 2px, #fff 2px 4px, #111 4px 5px, #fff 5px 8px)",
                backgroundColor: "#fff",
                border: "3px solid #fff",
              }}
            />
            {spec.wordmark && (
              <span style={{ fontSize: Math.max(7, Math.round(H * 0.03)), fontWeight: 800, opacity: 0.9 }}>
                {spec.wordmark}
              </span>
            )}
          </div>
        </div>

        {/* left spine */}
        <div
          style={face({
            width: D,
            height: H,
            left: (W - D) / 2,
            transform: `rotateY(-90deg) translateZ(${W / 2}px)`,
            backgroundColor: color,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            overflow: "hidden",
          })}
        >
          <div
            style={{
              marginTop: 6,
              width: Math.max(3, D * 0.35),
              height: Math.round(H * 0.06),
              backgroundColor: lightCase ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.85)",
              borderRadius: 1,
            }}
          />
          <span
            style={{
              writingMode: "vertical-rl",
              flex: 1,
              display: "flex",
              alignItems: "center",
              color: ink,
              fontSize: Math.max(7, Math.min(D * 0.55, Math.round(H * 0.035))),
              fontWeight: 700,
              letterSpacing: "0.05em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              padding: "6px 0",
            }}
          >
            {title.toUpperCase()}
          </span>
        </div>

        {/* right (opening edge) */}
        <div
          style={face({
            width: D,
            height: H,
            left: (W - D) / 2,
            transform: `rotateY(90deg) translateZ(${W / 2}px)`,
            backgroundColor: shade(color, 0.75),
          })}
        />
        {/* top */}
        <div
          style={face({
            width: W,
            height: D,
            top: (H - D) / 2,
            transform: `rotateX(90deg) translateZ(${H / 2}px)`,
            backgroundColor: shade(color, 0.85),
          })}
        />
        {/* bottom */}
        <div
          style={face({
            width: W,
            height: D,
            top: (H - D) / 2,
            transform: `rotateX(-90deg) translateZ(${H / 2}px)`,
            backgroundColor: shade(color, 0.6),
          })}
        />
      </div>
    </div>
  );
}
