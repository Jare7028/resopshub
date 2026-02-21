"use client";

import { useEffect, useMemo } from "react";

const DEFAULT_READ_UPDATE_INTERVAL_MS = 30_000;

export default function SocialReadTracker({
  pageId,
  postIds,
  minIntervalMs = DEFAULT_READ_UPDATE_INTERVAL_MS,
}: {
  pageId: string;
  postIds: string[];
  minIntervalMs?: number;
}) {
  const normalizedPostIds = useMemo(() => {
    return Array.from(new Set(postIds.map((value) => String(value || "").trim()).filter(Boolean))).slice(0, 100);
  }, [postIds]);

  useEffect(() => {
    if (!pageId) {
      return;
    }

    const sessionKey = `social:read-tracker:${pageId}`;
    const now = Date.now();
    const previous = Number(sessionStorage.getItem(sessionKey) || "0");
    if (Number.isFinite(previous) && now - previous < minIntervalMs) {
      return;
    }

    sessionStorage.setItem(sessionKey, String(now));

    const controller = new AbortController();
    fetch(`/api/social/pages/${pageId}/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postIds: normalizedPostIds }),
      keepalive: true,
      signal: controller.signal,
    }).catch(() => {
      // Read tracking should never break the page experience.
    });

    return () => controller.abort();
  }, [minIntervalMs, normalizedPostIds, pageId]);

  return null;
}
