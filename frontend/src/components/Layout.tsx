import {
  ActionIcon,
  AppShell,
  Group,
  Menu,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { IconCheck, IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useThemePreference } from "../hooks/useThemePreference";
import { EnvironmentBanner } from "./EnvironmentBanner";
import { SchemaVersionBanner } from "./SchemaVersionBanner";
import { VersionFooter } from "./VersionFooter";

const NAV_ITEMS = [
  { label: "Dashboard", path: "/" },
  { label: "Search", path: "/search" },
  { label: "Metadata Search", path: "/metadata-search" },
  { label: "Ingest", path: "/ingest" },
  { label: "Projects", path: "/projects" },
  { label: "Audit Log", path: "/audit-log" },
  { label: "Trash", path: "/trash" },
  { label: "Analytics", path: "/analytics" },
  { label: "Help", path: "/help" },
];

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: IconSun },
  { value: "dark", label: "Dark", icon: IconMoon },
  { value: "auto", label: "System", icon: IconDeviceDesktop },
] as const;

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, setTheme } = useThemePreference();
  const CurrentThemeIcon =
    theme === "light" ? IconSun : theme === "dark" ? IconMoon : IconDeviceDesktop;

  return (
    <AppShell header={{ height: 56 }} padding="xs">
      <AppShell.Header style={{ position: "relative" }}>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <img
              src="/app/cerefox_icon.png"
              alt="Cerefox"
              height={32}
              width={32}
              style={{ borderRadius: 4 }}
            />
            <Text
              component="span"
              onClick={() => navigate("/")}
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 18,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                cursor: "pointer",
              }}
            >
              Cere<span style={{ color: "var(--primary)" }}>fox</span>
            </Text>
          </Group>

          <Group gap="lg">
            {NAV_ITEMS.map((item) => (
              <UnstyledButton key={item.label} onClick={() => navigate(item.path)}>
                <Text
                  size="sm"
                  fw={location.pathname === item.path ? 700 : 400}
                  c={location.pathname === item.path ? undefined : "dimmed"}
                >
                  {item.label}
                </Text>
              </UnstyledButton>
            ))}

            <Menu position="bottom-end" withArrow shadow="md" width={150}>
              <Menu.Target>
                <ActionIcon variant="subtle" size="lg" title="Color theme" aria-label="Color theme">
                  <CurrentThemeIcon size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Theme</Menu.Label>
                {THEME_OPTIONS.map((opt) => {
                  const OptIcon = opt.icon;
                  return (
                    <Menu.Item
                      key={opt.value}
                      leftSection={<OptIcon size={16} />}
                      rightSection={theme === opt.value ? <IconCheck size={14} /> : null}
                      onClick={() => setTheme(opt.value)}
                    >
                      {opt.label}
                    </Menu.Item>
                  );
                })}
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>

        {/* 2px gradient accent line under the header */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 2,
            background:
              "linear-gradient(90deg, var(--primary), var(--violet) 60%, transparent)",
          }}
        />
      </AppShell.Header>

      <AppShell.Main>
        <EnvironmentBanner />
        <SchemaVersionBanner />
        <Outlet />
        <VersionFooter />
      </AppShell.Main>
    </AppShell>
  );
}
