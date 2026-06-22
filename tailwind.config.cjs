module.exports = {
  content: [
    "./src/**/*.ts",
    "!./src/panel/generated-css.ts",
  ],
  safelist: [
    "text-green-400",
    "text-red-400",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#ffffff",
          900: "#fbfbfd",
          850: "#f4f5f7",
          800: "#eceef2",
          700: "#dde1e8",
          600: "#9aa3b2",
          400: "#6b7280",
          300: "#4b5563",
          200: "#1f2937",
          100: "#0f172a",
        },
        accent: {
          500: "#6366f1",
          400: "#7c7ff5",
          300: "#a5a7f9",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)",
        "card-hover": "0 4px 12px -2px rgb(15 23 42 / 0.08), 0 2px 4px -2px rgb(15 23 42 / 0.04)",
      },
    },
  },
};
