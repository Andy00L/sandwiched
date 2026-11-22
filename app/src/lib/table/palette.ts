export const PALETTE = {
  groundLight: "#b4c08f",
  groundDark: "#8fa274",
  path: "#d6ccae",
  kraftWood: "#c58a4b",
  kraftWoodDark: "#96602f",
  whaleSkin: "#5e7f97",
  whaleBelly: "#c7d5da",
  suit: "#2e3a50",
  tomato: "#d5452e",
  mustard: "#e0a62c",
  teal: "#3c998c",
  pigeonGrey: "#8e96a3",
  pigeonDark: "#5b6472",
  plum: "#8a5a84",
  ink: "#3b2a22",
  creamCore: "#f2e6cb",
  shadowTint: "#a0602c",
  contactTint: "#5a3214",
} as const;

export type PaletteRole = keyof typeof PALETTE;

export const GROUND_INKS = {
  lawn: "#a6c8b8",
  lawnShade: "#8aac9c",
  path: "#d2d4cc",
  padGravel: "#7f9a86",
  padStone: "#c9cbbd",
} as const;

export const KRAFT_INKS = {
  wood: "#bc9168",
  woodDark: "#8a6649",
} as const;
