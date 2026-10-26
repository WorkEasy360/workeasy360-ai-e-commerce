"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Availability {
  slug: string;
  available: boolean;
  reason?: string;
}

/**
 * The store-address input with the storefront prefix and a live, debounced
 * availability check. `current` is the store's own address, which is
 * reported as available when editing.
 */
export function SlugField({
  id,
  value,
  onChange,
  storefrontUrl,
  current,
}: {
  id: string;
  value: string;
  onChange: (slug: string) => void;
  storefrontUrl: string;
  current?: string;
}) {
  const [check, setCheck] = useState<Availability | undefined>();

  useEffect(() => {
    if (value === "" || value === current) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api<Availability>(`/api/v1/store-slugs/${encodeURIComponent(value)}`)
        .then((result) => {
          if (!cancelled) setCheck(result);
        })
        .catch(() => {
          if (!cancelled) setCheck(undefined);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, current]);

  const host = storefrontUrl.replace(/^https?:\/\//, "");
  // Only a result for exactly what is typed counts; the store's own address needs no check.
  const stale = check === undefined || check.slug !== value || value === current;
  return (
    <div className="c-field">
      <label className="c-label" htmlFor={id}>
        Store address
      </label>
      <div className="c-input-group">
        <span>{host}/s/</span>
        <input
          id={id}
          className="c-input"
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
          maxLength={48}
          required
          spellCheck={false}
          autoCapitalize="off"
          aria-describedby={`${id}-status`}
          aria-invalid={!stale && !check.available ? true : undefined}
        />
      </div>
      <p id={`${id}-status`} className={stale ? "c-hint" : check.available ? "c-ok" : "c-error"} aria-live="polite">
        {stale ? "Shoppers find your store here. Letters, numbers and hyphens." : check.available ? "This address is available." : (check.reason ?? "This address is not available.")}
      </p>
    </div>
  );
}
