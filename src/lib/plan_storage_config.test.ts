import { expect, it } from "vitest";
import { z } from "zod";
import { RawConfig, TargetConfig } from "./types";

it("describes exclusive storage providers in every configuration JSON Schema", () => {
  const root = z.toJSONSchema(RawConfig, { io: "input" });
  const target = z.toJSONSchema(TargetConfig, { io: "input" });
  const exclusive = { required: ["plan_file_s3", "plan_file_gcs"] };
  expect(root.not).toEqual(exclusive);
  expect(root).toHaveProperty("properties.target_groups.items.not", exclusive);
  expect(target.not).toEqual(exclusive);
});
