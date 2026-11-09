// Runs "<tool> -version" and returns its first output line.
// Throws a clear error if the tool is missing or fails.
async function getVersionLine(tool: string): Promise<string> {
  let proc;
  try {
    // Argument array, not a shell string: safe with spaces in paths.
    proc = Bun.spawn([tool, "-version"], { stdout: "pipe", stderr: "pipe" });
  } catch {
    throw new Error(
      `"${tool}" was not found on PATH. Install FFmpeg and make sure "${tool} -version" works in a new terminal.`,
    );
  }

  // Read the whole stdout stream as text, then wait for the exit code.
  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`"${tool} -version" exited with code ${exitCode}.`);
  }

  // noUncheckedIndexedAccess: [0] may be undefined, so we fall back to "".
  return output.split("\n")[0]?.trim() ?? "";
}

// Checks that both FFmpeg tools are available. Call once at startup.
export async function checkFfmpeg(): Promise<void> {
  for (const tool of ["ffmpeg", "ffprobe"]) {
    console.log(`${tool}: ${await getVersionLine(tool)}`);
  }
}
