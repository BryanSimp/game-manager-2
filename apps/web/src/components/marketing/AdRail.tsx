import { AdSlot } from "./AdSlot.js";

/**
 * A sticky sidebar ad column.
 *
 * Fixed at 300px so it fits AdSense's sidebar family — 300×600 half-page,
 * 300×250 medium rectangle, and the 160×600 wide skyscraper — without the
 * column reflowing when a different unit fills it. The width is reserved
 * whether or not an ad serves, so the centre column never shifts.
 *
 * Hidden below `xl`: two 300px rails plus a readable main column need roughly
 * 1280px, and a skyscraper on a phone is a policy problem as much as a layout
 * one. `MarketingLayout` renders a horizontal unit inside the content column
 * at those sizes instead.
 */
export function AdRail({
  side,
  slotId,
}: {
  side: "left" | "right";
  slotId?: string;
}) {
  return (
    <aside
      className="hidden w-[300px] min-w-[300px] shrink-0 xl:block"
      aria-label={`${side === "left" ? "Left" : "Right"} sidebar advertisements`}
    >
      {/* top-20 clears the sticky nav; the rail scrolls with short pages and
          pins on long ones */}
      <div className="sticky top-20 space-y-4">
        <AdSlot slotId={slotId} format="vertical" minHeight={600} />
      </div>
    </aside>
  );
}
