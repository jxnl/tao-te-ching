/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,ts}"],
  theme: {
    extend: {
      fontFamily: {
        book: [
          "Iowan Old Style",
          "Palatino Linotype",
          "Book Antiqua",
          "Palatino",
          "Georgia",
          "serif",
        ],
      },
      colors: {
        paper: "#ffffff",
        ink: "#111111",
        rule: "#d8d8d8",
        fog: "#666666",
      },
    },
  },
}
