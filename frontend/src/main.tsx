import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./tokens.css";
import "./theme.css";

import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { theme } from "./theme";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <Notifications position="top-right" />
        {/* Inside the providers so the fallback can use the theme tokens, and
            around the router so a throw in ANY page is contained (#289). */}
        <ErrorBoundary>
          <BrowserRouter basename="/app">
            <App />
          </BrowserRouter>
        </ErrorBoundary>
      </MantineProvider>
    </QueryClientProvider>
  </StrictMode>,
);
