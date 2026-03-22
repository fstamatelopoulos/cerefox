import {
  Anchor,
  AppShell,
  Group,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

const NAV_ITEMS = [
  { label: "Search", path: "/search" },
  // Links back to Jinja2 UI during transition period
  { label: "Dashboard", href: "/" },
  { label: "Ingest", href: "/ingest" },
  { label: "Projects", href: "/projects" },
] as const;

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <AppShell header={{ height: 56 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <img
              src="/static/cerefox_logo.jpg"
              alt="Cerefox"
              height={32}
              width={32}
              style={{ borderRadius: 4 }}
            />
            <Title order={4} style={{ cursor: "pointer" }} onClick={() => navigate("/")}>
              Cerefox
            </Title>
          </Group>

          <Group gap="lg">
            {NAV_ITEMS.map((item) =>
              "path" in item ? (
                <UnstyledButton
                  key={item.label}
                  onClick={() => navigate(item.path)}
                  style={{
                    fontWeight:
                      location.pathname === item.path ||
                      (item.path === "/search" && location.pathname === "/")
                        ? 700
                        : 400,
                  }}
                >
                  <Text size="sm">{item.label}</Text>
                </UnstyledButton>
              ) : (
                <Anchor
                  key={item.label}
                  href={item.href}
                  size="sm"
                  c="dimmed"
                  underline="never"
                >
                  {item.label}
                </Anchor>
              ),
            )}
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
