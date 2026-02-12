"use client";

import { useEffect, useState } from "react";

export function useKeyboardInset() {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) {
      return;
    }

    const viewport = window.visualViewport;
    const updateInset = () => {
      const nextInset = Math.max(
        0,
        window.innerHeight - viewport.height - viewport.offsetTop,
      );
      setInset(Math.round(nextInset));
    };

    updateInset();
    viewport.addEventListener("resize", updateInset);
    viewport.addEventListener("scroll", updateInset);
    window.addEventListener("orientationchange", updateInset);

    return () => {
      viewport.removeEventListener("resize", updateInset);
      viewport.removeEventListener("scroll", updateInset);
      window.removeEventListener("orientationchange", updateInset);
    };
  }, []);

  return inset;
}
