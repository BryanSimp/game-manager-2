interface Props {
  value: number | null;
  onChange?: (value: number | null) => void;
  size?: "sm" | "lg";
}

/** Half-star rating, 0.5–5.0. Click a half to set; click the current value to clear. */
export function StarRating({ value, onChange, size = "lg" }: Props) {
  const px = size === "lg" ? "text-2xl" : "text-sm";
  const stars = [1, 2, 3, 4, 5];

  function pick(v: number) {
    if (!onChange) return;
    onChange(v === value ? null : v);
  }

  return (
    <div className={`flex ${px} leading-none`} role={onChange ? "radiogroup" : undefined}>
      {stars.map((star) => {
        const fill = value == null ? 0 : Math.max(0, Math.min(1, value - (star - 1)));
        return (
          <span key={star} className="relative inline-block select-none">
            <span className="text-zinc-700">★</span>
            <span
              className="absolute inset-0 overflow-hidden text-amber-400"
              style={{ width: `${fill * 100}%` }}
            >
              ★
            </span>
            {onChange && (
              <span className="absolute inset-0 flex">
                <button
                  type="button"
                  aria-label={`${star - 0.5} stars`}
                  className="h-full w-1/2 cursor-pointer"
                  onClick={() => pick(star - 0.5)}
                />
                <button
                  type="button"
                  aria-label={`${star} stars`}
                  className="h-full w-1/2 cursor-pointer"
                  onClick={() => pick(star)}
                />
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
