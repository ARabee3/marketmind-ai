import { useCallback, useEffect, useRef, useState } from "react";
import type { ContentPack, ContentProgressEvent } from "@marketmind/contracts";
import { getContentPack, getContentPackProgress } from "@/lib/api/content-cycle";

type Options = {
  readonly packId: string | null;
  readonly initialPack?: ContentPack | null;
  readonly onTerminal?: (pack: ContentPack) => void;
};

export function useContentPackProgress({
  packId,
  initialPack = null,
  onTerminal,
}: Options) {
  const [pack, setPack] = useState<ContentPack | null>(initialPack);
  const [events, setEvents] = useState<readonly ContentProgressEvent[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const onTerminalRef = useRef(onTerminal);
  const scheduleNextRef = useRef<((id: string) => void) | null>(null);

  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  const stopPolling = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const fetchOnce = useCallback(
    async (id: string, signal: AbortSignal) => {
      try {
        const [updatedPack, progressEvents] = await Promise.all([
          getContentPack(id, signal),
          getContentPackProgress(id, signal),
        ]);

        setPack(updatedPack);
        const sortedEvents = [...progressEvents].sort((a, b) => a.seq - b.seq);
        setEvents(sortedEvents);
        setErrorKey(null);

        const activeStatuses = ["queued", "generating", "validating"];
        const isTerminal = !activeStatuses.includes(updatedPack.status);

        if (isTerminal) {
          setIsPolling(false);
          onTerminalRef.current?.(updatedPack);
          return true;
        }

        return false;
      } catch (err: unknown) {
        if ((err as { name?: string })?.name === "AbortError") return false;
        setErrorKey("loadError");
        return false;
      }
    },
    [],
  );

  const scheduleNext = useCallback(
    (id: string) => {
      stopPolling();
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }

      setIsPolling(true);
      const controller = new AbortController();
      abortControllerRef.current = controller;

      fetchOnce(id, controller.signal).then((isTerminal) => {
        if (isTerminal || controller.signal.aborted) return;
        timeoutRef.current = setTimeout(() => {
          if (scheduleNextRef.current) {
            scheduleNextRef.current(id);
          }
        }, 2000);
      });
    },
    [fetchOnce, stopPolling],
  );

  useEffect(() => {
    scheduleNextRef.current = scheduleNext;
  }, [scheduleNext]);

  useEffect(() => {
    if (!packId) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      return;
    }

    const activeStatuses = ["queued", "generating", "validating"];
    const initialStatus = initialPack?.id === packId ? initialPack.status : "queued";

    if (!activeStatuses.includes(initialStatus)) {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        void fetchOnce(packId, controller.signal);
      }, 0);
      return () => {
        clearTimeout(timer);
        controller.abort();
      };
    }

    const initialTimer = setTimeout(() => {
      scheduleNext(packId);
    }, 0);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        scheduleNext(packId);
      } else {
        stopPolling();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearTimeout(initialTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stopPolling();
    };
  }, [packId, initialPack, scheduleNext, fetchOnce, stopPolling]);

  const refresh = useCallback(() => {
    if (!packId) return;
    const controller = new AbortController();
    fetchOnce(packId, controller.signal);
  }, [packId, fetchOnce]);

  return {
    pack: packId ? pack : null,
    events: packId ? events : [],
    isPolling,
    errorKey,
    refresh,
  };
}
