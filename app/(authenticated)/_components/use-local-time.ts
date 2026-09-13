"use client";
import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, 60_000);
  return () => {
    clearInterval(timer);
  };
}
function currentMinute() {
  return Math.floor(Date.now() / 60_000);
}
function serverMinute() {
  return 0;
}

export function useLocalTime() {
  const minute = useSyncExternalStore(subscribe, currentMinute, serverMinute);
  return minute === 0 ? undefined : new Date(minute * 60_000);
}
