import {
  ActionIcon,
  AppShell,
  Group,
  Text,
  Title,
  UnstyledButton,
  useMantineColorScheme,
} from "@mantine/core";
import { IconMoon, IconSun } from "@tabler/icons-react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

const NAV_ITEMS = [
  { label: "Dashboard", path: "/" },
  { label: "Search", path: "/search" },
  { label: "Metadata Search", path: "/metadata-search" },
  { label: "Ingest", path: "/ingest" },
  { label: "Projects", path: "/projects" },
  { label: "Audit Log", path: "/audit-log" },
  { label: "Trash", path: "/trash" },
  { label: "Analytics", path: "/analytics" },
];

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const dark = colorScheme === "dark";

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
            <ActionIcon
              variant="subtle"
              size="lg"
              onClick={toggleColorScheme}
              title={dark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {dark ? <IconSun size={18} /> : <IconMoon size={18} />}
            </ActionIcon>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
