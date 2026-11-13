import { expect, test } from "bun:test";
import { getMode, listModes } from "./modes.ts";

test("defaults to the existing general-purpose mode", () => {
  expect(getMode()).toEqual(getMode("default"));
  expect(getMode().name).toBe("default");
});

test("lists the configured modes in stable order", () => {
  expect(listModes().map((mode) => mode.name)).toEqual(["default", "gaming", "podcast"]);
  expect(listModes().every((mode) => mode.description.length > 0)).toBe(true);
});

test("rejects unknown and inherited object names with valid choices", () => {
  for (const name of ["unknown", "toString", "constructor", "__proto__"]) {
    expect(() => getMode(name)).toThrow('Valid modes: default, gaming, podcast');
  }
});
