import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 위험도 등급 색 (색만으로 구분하지 않도록 화면에서는 항상 아이콘·텍스트를 함께 쓴다)
        grade: {
          normal: "#9ca3af",
          watch: "#2e9e5b",
          advisory: "#e8a317",
          warning: "#d7342c",
        },
        brand: { DEFAULT: "#1f6f4a", dark: "#174f36", light: "#e7f3ec" },
      },
    },
  },
  plugins: [],
};
export default config;
