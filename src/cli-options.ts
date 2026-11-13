import { getMode, listModes, parseFacecamRect, type FacecamRect, type ModeName } from "./modes.ts";

export type CliOptions = {
  videoPath?: string;
  force: boolean;
  faceTracking: boolean;
  mode?: ModeName;
  facecamRect?: FacecamRect;
};

export function parseCliArgs(args: string[]): CliOptions {
  let videoPath: string | undefined;
  let force = false;
  let faceTracking = false;
  let mode: ModeName | undefined;
  let facecamRect: FacecamRect | undefined;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === "--force") force = true;
    else if (argument === "--face-track") faceTracking = true;
    else if (argument === "--facecam-rect") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--facecam-rect requires x,y,w,h");
      facecamRect = parseFacecamRect(value);
      index++;
    }
    else if (argument === "--mode") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`--mode requires a mode name. Valid modes: ${listModes().map((item) => item.name).join(", ")}`);
      }
      mode = getMode(value).name as ModeName;
      index++;
    } else if (argument.startsWith("--")) {
      throw new Error(`Unknown option "${argument}". Valid options: --force, --face-track, --mode, --facecam-rect`);
    } else if (videoPath === undefined) videoPath = argument;
    else throw new Error("Only one video file may be specified");
  }

  return { videoPath, force, faceTracking, mode, facecamRect };
}
