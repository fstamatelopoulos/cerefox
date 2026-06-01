// theme.ts — Cerefox Mantine v8 theme
// Wire into MantineProvider:  <MantineProvider theme={theme}> … </MantineProvider>
//
// Fonts are loaded via Google Fonts <link> tags in index.html:
//   Space Grotesk (display/headings), Geist (UI/body), JetBrains Mono (data)
//
// The hex ramps below are derived from the authoritative oklch tokens (see
// design handoff tokens.css). Mantine wants 10-shade arrays (0 = lightest … 9 = darkest).

import { createTheme, type MantineColorsTuple } from "@mantine/core";

// Fox-orange — primary action color
const fox: MantineColorsTuple = [
  "#fff1e8", "#ffdcc6", "#fcbd97", "#f99d66", "#f78440",
  "#f57626", "#e6641a", "#bf5115", "#983f10", "#722f0b",
];

// Indigo-tinted neutral ramp → drives dark mode surfaces.
// Mantine dark convention: dark[0] = text … dark[7] = body bg … dark[9] = deepest.
const ink: MantineColorsTuple = [
  "#f3f1f7", // 0  text
  "#c4c0d4", // 1
  "#a6a2b8", // 2  dimmed text
  "#756f88", // 3  faint text
  "#332f49", // 4  border (dark)
  "#2b2840", // 5
  "#1f1c34", // 6  surface / card (dark)
  "#161427", // 7  body bg (dark)
  "#121023", // 8
  "#0d0b1c", // 9
];

const violet: MantineColorsTuple = [
  "#f3eefe", "#e0d3fb", "#c4aef4", "#aa8aed", "#9a76e8",
  "#8a62e2", "#7a45d6", "#6636bb", "#522a96", "#3f2175",
];

const blue: MantineColorsTuple = [
  "#e9f2fd", "#cbe0fa", "#9cc6f4", "#6cabef", "#5aa9f0",
  "#3f8fe0", "#356fd0", "#2b5aad", "#22478a", "#193668",
];

const green: MantineColorsTuple = [
  "#e6f8ef", "#c3edd9", "#8fdcb6", "#5acf95", "#4ec98a",
  "#36b576", "#2f9e6a", "#257e54", "#1d6242", "#154731",
];

const yellow: MantineColorsTuple = [
  "#fdf6e3", "#f8e9bd", "#f0d585", "#e8c24f", "#e6bb45",
  "#d6a52f", "#b88824", "#8f6a1b", "#6d5115", "#4d390e",
];

const red: MantineColorsTuple = [
  "#fdecea", "#f9cfc9", "#f1a79c", "#ea7f70", "#e8675a",
  "#dd4a3b", "#c43a2c", "#9d2f24", "#79251c", "#591b15",
];

export const theme = createTheme({
  primaryColor: "fox",
  // brighter shade in dark mode, deeper in light for contrast
  primaryShade: { light: 6, dark: 5 },

  colors: { fox, dark: ink, violet, blue, green, yellow, red },

  fontFamily: "Geist, system-ui, -apple-system, sans-serif",
  fontFamilyMonospace: "'JetBrains Mono', ui-monospace, monospace",
  headings: {
    fontFamily: "'Space Grotesk', system-ui, sans-serif",
    fontWeight: "600",
    sizes: {
      h1: { fontSize: "30px", lineHeight: "1.15", fontWeight: "600" },
      h2: { fontSize: "22px", lineHeight: "1.2", fontWeight: "600" },
      h3: { fontSize: "16px", lineHeight: "1.3", fontWeight: "600" },
    },
  },

  defaultRadius: "md",
  radius: { xs: "6px", sm: "8px", md: "10px", lg: "14px", xl: "16px" },

  shadows: {
    sm: "0 1px 2px rgba(0,0,0,.10)",
    md: "0 10px 30px -12px rgba(40,40,70,.18)",
    lg: "0 28px 64px -20px rgba(35,30,80,.28)",
  },

  components: {
    Card: {
      defaultProps: { radius: "lg", withBorder: true, shadow: "sm", padding: "lg" },
    },
    Button: {
      defaultProps: { radius: "md" },
      styles: { root: { fontWeight: 600 } },
    },
    Badge: {
      defaultProps: { radius: "xl", variant: "light" },
      styles: { root: { fontFamily: "'JetBrains Mono', monospace", fontWeight: 500, textTransform: "none" } },
    },
    TextInput: { defaultProps: { radius: "md" } },
    Select:    { defaultProps: { radius: "md" } },
    Table: {
      styles: {
        th: {
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "10.5px",
          fontWeight: 500,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        },
      },
    },
    SegmentedControl: { defaultProps: { radius: "md" } },
    Modal:   { defaultProps: { radius: "lg" } },
    Tabs:    {},
  },

  other: {
    // accent tokens for ad-hoc use in CSS-in-JS / modules
    fontDisplay: "'Space Grotesk', sans-serif",
    fontMono: "'JetBrains Mono', monospace",
  },
});
