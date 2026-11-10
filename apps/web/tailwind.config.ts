import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Pretendard Variable"', "Pretendard", "-apple-system", "BlinkMacSystemFont", '"Apple SD Gothic Neo"', '"Noto Sans KR"', '"Malgun Gothic"', "system-ui", "sans-serif"],
      },
      colors: {
        // 위험도 등급 색 (색만으로 구분하지 않도록 화면에서는 항상 아이콘·텍스트를 함께 쓴다)
        grade: {
          normal: "#9ca3af",
          watch: "#2e9e5b",
          advisory: "#e8a317",
          warning: "#d7342c",
        },
        brand: {
          50: "#eff8f2",
          100: "#d8eee0",
          200: "#b2dcc3",
          500: "#2b8a5c",
          600: "#1f6f4a",
          700: "#195c3e",
          900: "#0f3826",
          DEFAULT: "#1f6f4a",
          dark: "#174f36",
          light: "#e7f3ec",
        },
        canvas: "#f4f6f5",
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.03)",
        lift: "0 8px 24px -8px rgba(16, 24, 40, 0.12), 0 2px 6px rgba(16, 24, 40, 0.04)",
      },
      borderRadius: {
        "2xl": "1rem",
      },
    },
  },
  plugins: [],
};
export default config;
