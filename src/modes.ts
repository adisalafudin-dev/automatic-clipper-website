export type ModeProfile = {
  name: string;
  description: string;
  layout: "center-crop" | "split";
  facecamRect: FacecamRect;
};

export type FacecamRect = { x: number; y: number; w: number; h: number };

export function parseFacecamRect(value: string): FacecamRect {
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error("Facecam rectangle must be x,y,w,h using normalized values from 0 to 1");
  }
  const [x, y, w, h] = parts as [number, number, number, number];
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1 || y + h > 1) {
    throw new Error("Facecam rectangle must fit within the normalized frame (0 to 1)");
  }
  return { x, y, w, h };
}

export const MODES = Object.freeze({
  default: Object.freeze({
    name: "default",
    description: "Current general-purpose clip selection and rendering behavior.",
    layout: "center-crop",
    facecamRect: { x: 0.68, y: 0.04, w: 0.28, h: 0.28 },
  }),
  gaming: Object.freeze({
    name: "gaming",
    description: "Gaming streamer clips with energetic moments and game terminology.",
    layout: "split",
    facecamRect: { x: 0.68, y: 0.04, w: 0.28, h: 0.28 },
  }),
  podcast: Object.freeze({
    name: "podcast",
    description: "Conversation-focused clips with clean captions and context.",
    layout: "center-crop",
    facecamRect: { x: 0.68, y: 0.04, w: 0.28, h: 0.28 },
  }),
} satisfies Record<string, ModeProfile>);

export type ModeName = keyof typeof MODES;

export function getMode(name: string = "default"): ModeProfile {
  if (!Object.hasOwn(MODES, name)) {
    throw new Error(`Unknown mode "${name}". Valid modes: ${Object.keys(MODES).join(", ")}`);
  }
  return MODES[name as ModeName];
}

export function listModes(): ModeProfile[] {
  return Object.values(MODES);
}
