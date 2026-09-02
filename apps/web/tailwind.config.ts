import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Pretendard Variable",
          "Pretendard",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SF Mono", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      colors: {
        // Shared Photo Desk family palette: blue-grey surfaces progress from
        // canvas to chrome, raised panels, and hover states.
        panel: {
          0: "#15191e",
          1: "#191e24",
          2: "#1d232a",
          3: "#293037",
          4: "#3c434a",
        },
        ink: {
          1: "#ecf9ff",
          2: "#a4afb5",
          3: "#838c92",
        },
        line: {
          DEFAULT: "#2b3239",
          strong: "#3c434a",
        },
        accent: {
          DEFAULT: "#605dff",
          hover: "#7774ff",
          fg: "#ffffff",
        },
        focus: "#00bafe",
        ok: "#3ecf8e",
        keep: "#fcb700",
        drop: "#ff627d",
        // Timeline clip categories — keep in sync with timeline-clip.tsx.
        clip: {
          media: "#605dff",
          adjustment: "#3ecf8e",
          overlay: "#fcb700",
        },
      },
      fontSize: {
        // Shared Photo Desk typography scale. `xs` is the primary compact UI
        // label size; metadata and section labels use the smaller named steps.
        xs: ["13.5px", { lineHeight: "18px" }],
        meta: ["12px", { lineHeight: "16px" }],
        "2xs": ["11px", { lineHeight: "14px" }],
        "3xs": ["10px", { lineHeight: "12px" }],
      },
      borderRadius: {
        xl: "10px",
      },
    },
  },
  plugins: [],
};

export default config;
