import { notifications } from "@mantine/notifications";

export function showSuccess(title: string, message?: string) {
  notifications.show({
    title,
    message: message || "",
    color: "green",
    autoClose: 4000,
  });
}

export function showError(title: string, message?: string) {
  notifications.show({
    title,
    message: message || "",
    color: "red",
    autoClose: 6000,
  });
}

export function showInfo(title: string, message?: string) {
  notifications.show({
    title,
    message: message || "",
    color: "blue",
    autoClose: 4000,
  });
}

import { V07IngestionDeferredError } from "../api/client";

/**
 * Surface the friendly "ingestion lands in v0.7" toast for any thrown
 * V07IngestionDeferredError. Returns true if the error was matched (and
 * a toast shown), false otherwise — callers can chain a generic-error
 * fallback when false.
 */
export function showV07DeferredToast(err: unknown): boolean {
  if (err instanceof V07IngestionDeferredError) {
    notifications.show({
      title: "Ingestion lands in v0.7",
      message:
        err.note ??
        "Use `cerefox ingest <file>` from the CLI for now — it still works against your Cerefox.",
      color: "yellow",
      autoClose: 8000,
    });
    return true;
  }
  return false;
}
