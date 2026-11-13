export type ModeProfile = {
  name: string;
  description: string;
};

export const MODES = Object.freeze({
  default: Object.freeze({
    name: "default",
    description: "Current general-purpose clip selection and rendering behavior.",
  }),
  gaming: Object.freeze({
    name: "gaming",
    description: "Gaming streamer clips with energetic moments and game terminology.",
  }),
  podcast: Object.freeze({
    name: "podcast",
    description: "Conversation-focused clips with clean captions and context.",
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
