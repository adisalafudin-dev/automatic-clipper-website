import { expect, test } from "bun:test";
import { getMode, listModes, parseFacecamRect } from "./modes.ts";

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

test("gaming uses split layout and facecam rectangles stay normalized", () => {
  expect(getMode("gaming").layout).toBe("split");
  expect(getMode("gaming").audioWeight).toBe(0.3);
  expect(getMode("podcast").audioWeight).toBe(0.1);
  expect(getMode("default").audioWeight).toBe(0);
  expect(getMode("default").captionPreset).toBe("classic");
  expect(getMode("gaming").captionPreset).toBe("bold");
  expect(getMode("podcast").captionPreset).toBe("clean");
  expect(getMode("default").layout).toBe("center-crop");
  expect(parseFacecamRect("0.6,0.1,0.3,0.25")).toEqual({ x: 0.6, y: 0.1, w: 0.3, h: 0.25 });
  for (const value of ["x,0,1,1", "-0.1,0,0.2,0.2", "0.8,0,0.3,0.2", "0,0,0,1"]) {
    expect(() => parseFacecamRect(value)).toThrow();
  }
});
