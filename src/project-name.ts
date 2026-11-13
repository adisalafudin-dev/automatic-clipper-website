export const MAX_PROJECT_NAME_LENGTH = 100;

export function defaultProjectName(filename: string): string {
  const basename = filename.replace(/\\/g, "/").split("/").pop() ?? "";
  const stem = basename.replace(/\.[^.]*$/, "").trim();
  return stem.slice(0, MAX_PROJECT_NAME_LENGTH) || "Untitled video";
}

export function normalizeProjectName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Project name must be text");
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!name) throw new Error("Project name cannot be empty");
  if (name.length > MAX_PROJECT_NAME_LENGTH) throw new Error(`Project name must be ${MAX_PROJECT_NAME_LENGTH} characters or fewer`);
  return name;
}
