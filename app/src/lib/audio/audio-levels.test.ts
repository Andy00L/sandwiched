import { describe, expect, test } from "bun:test";
import { parseAudioLevels } from "./audio-levels";
import { DEFAULT_LEVELS } from "./mix";

describe("stored audio levels", () => {
  test("read back what the sliders stored", () => {
    expect(parseAudioLevels(JSON.stringify({ music: 0.2, sounds: 0.5, voices: 0 }))).toEqual({ music: 0.2, sounds: 0.5, voices: 0 });
  });

  test("fall back to full level for a missing, broken or out-of-range value", () => {
    expect(parseAudioLevels(null)).toEqual(DEFAULT_LEVELS);
    expect(parseAudioLevels("{not json")).toEqual(DEFAULT_LEVELS);
    expect(parseAudioLevels(JSON.stringify({ music: "loud", sounds: 3, voices: -1 }))).toEqual({ music: 1, sounds: 1, voices: 0 });
  });
});
