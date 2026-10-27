import { ActionIcon, Alert, Button, Checkbox, Modal, PasswordInput, Stack, Text } from "@mantine/core";
import { IconKeyOff } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";

import { checkApiKey } from "../api/client";
import {
  forgetApiKey,
  getApiKey,
  getAuthPrompt,
  setApiKey,
  subscribeApiKey,
} from "../lib/apiKey";

/** One string, so `useSyncExternalStore` sees a stable snapshot. */
const snapshot = () => `${getAuthPrompt() ?? "none"}|${getApiKey() ? "key" : "nokey"}`;

function useApiKeyState() {
  const [prompt, key] = useSyncExternalStore(subscribeApiKey, snapshot).split("|");
  return { prompt: prompt === "none" ? null : prompt, hasKey: key === "key" };
}

/**
 * The API key dialog (#346). Opens only after the server refused the browser
 * with the Cerefox challenge (see `lib/apiKey.ts`), so an ungated install never
 * renders it. Design: `docs/specs/lan-web-access.md`.
 */
export function ApiKeyPrompt() {
  const { prompt } = useApiKeyState();
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!prompt) return null;

  const submit = async () => {
    const key = value.trim();
    if (!key) return;
    setBusy(true);
    setError(null);
    const result = await checkApiKey(key);
    setBusy(false);
    if (result === "ok") {
      setApiKey(key, remember);
      setValue("");
      await queryClient.resetQueries();
    } else {
      setError(
        result === "rejected"
          ? "That key was not accepted."
          : "Could not reach the server to check the key.",
      );
    }
  };

  return (
    <Modal
      opened
      onClose={() => {}}
      withCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
      title="This server needs its API key"
      centered
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Stack gap="sm">
          {prompt === "rejected" && (
            <Alert color="yellow" variant="light">
              The saved key was not accepted. It may have been rotated.
            </Alert>
          )}
          <Text size="sm" c="dimmed">
            Print it with <code>cerefox api-key show</code>, or <code>cerefox-local api-key</code>{" "}
            for a Cerefox Local container. If you set <code>CEREFOX_API_KEY</code> yourself, use
            that value.
          </Text>
          <PasswordInput
            label="API key"
            placeholder="cfx_lak_…"
            autoFocus
            autoComplete="off"
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
            error={error}
          />
          <Checkbox
            label="Remember on this browser"
            description="Otherwise the key is forgotten when this tab closes."
            checked={remember}
            onChange={(event) => setRemember(event.currentTarget.checked)}
          />
          <Button type="submit" loading={busy} disabled={!value.trim()}>
            Continue
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

/** Header control, shown only while the browser holds a key. */
export function ForgetApiKeyButton() {
  const { hasKey } = useApiKeyState();
  const queryClient = useQueryClient();
  if (!hasKey) return null;
  return (
    <ActionIcon
      variant="subtle"
      size="lg"
      title="Forget the API key on this browser"
      aria-label="Forget API key"
      onClick={() => {
        forgetApiKey();
        void queryClient.resetQueries();
      }}
    >
      <IconKeyOff size={18} />
    </ActionIcon>
  );
}
