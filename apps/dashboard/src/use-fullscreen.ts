import { useCallback, useEffect, useState, type RefObject } from "react";

/** Toggles the browser's native Fullscreen API on the given element. */
export function useFullscreenToggle(ref: RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleChange = () =>
      setIsFullscreen(document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", handleChange);
    return () => document.removeEventListener("fullscreenchange", handleChange);
  }, [ref]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement === ref.current) void document.exitFullscreen();
    else void ref.current?.requestFullscreen();
  }, [ref]);

  return { isFullscreen, toggleFullscreen };
}
