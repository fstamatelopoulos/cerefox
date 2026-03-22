import {
  AppShell,
  Group,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

const NAV_ITEMS = [
  { label: "Dashboard", path: "/" },
  { label: "Search", path: "/search" },
  { label: "Ingest", path: "/ingest" },
  { label: "Projects", path: "/projects" },
];

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
            <Title
              order={4}
              style={{ cursor: "pointer" }}
              onClick={() => navigate("/")}
            >
              Cerefox
            </Title>
          </Group>

          <Group gap="lg">
            {NAV_ITEMS.map((item) => (
              <UnstyledButton
                key={item.label}
                onClick={() => navigate(item.path)}
              >
                <Text
                  size="sm"
                  fw={location.pathname === item.path ? 700 : 400}
                  c={location.pathname === item.path ? undefined : "dimmed"}
                >
                  {item.label}
                </Text>
              </UnstyledButton>
            ))}
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
