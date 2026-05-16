import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#16211d",
        moss: "#586f52",
        cloud: "#f6f8f5",
      },
      boxShadow: {
        panel: "0 18px 45px rgba(22, 33, 29, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
