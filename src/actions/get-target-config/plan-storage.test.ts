import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as lib from "../../lib";
import * as types from "../../lib/types";
import { getTargetConfig, run } from "./index";

beforeEach(() => {
  vi.spyOn(lib, "readTargetConfig").mockReturnValue({});
});

afterEach(() => vi.restoreAllMocks());

const inputs = {
  target: "tests/aws/foo/dev",
  workingDir: "tests/aws/foo/dev",
  isApply: false,
  jobType: "terraform" as const,
};

const config = async (
  root: Record<string, unknown> = {},
  group: Record<string, unknown> = {},
  workingDir: Record<string, unknown> = {},
) => {
  vi.mocked(lib.readTargetConfig).mockReturnValue(
    types.TargetConfig.parse(workingDir),
  );
  return lib.applyConfigDefaults(
    types.RawConfig.parse({
      plan_workflow_name: "plan.yaml",
      ...root,
      target_groups: [{ working_directory: "tests/aws/**", ...group }],
    }),
    "tests/tfaction-root.yaml",
    "",
  );
};

it.each([
  [{ plan_file_gcs: { bucket: "root" } }, {}, {}, "root"],
  [
    { plan_file_gcs: { bucket: "root" } },
    { plan_file_gcs: { bucket: "group" } },
    {},
    "group",
  ],
  [
    { plan_file_gcs: { bucket: "root" } },
    { plan_file_gcs: { bucket: "group" } },
    { plan_file_gcs: { bucket: "target", key_prefix: "custom/" } },
    "target",
  ],
])(
  "resolves GCS storage at the most specific level",
  async (root, group, wd, bucket) => {
    const result = await getTargetConfig(inputs, await config(root, group, wd));
    expect(result.plan_file_gcs?.bucket).toBe(bucket);
    if (bucket === "target")
      expect(result.plan_file_gcs?.key_prefix).toBe("custom/");
  },
);

it.each([
  [
    { plan_file_s3: { bucket: "s3" } },
    { plan_file_gcs: { bucket: "gcs" } },
    "gcs",
  ],
  [
    { plan_file_gcs: { bucket: "gcs" } },
    { plan_file_s3: { bucket: "s3" } },
    "s3",
  ],
])(
  "allows a more specific level to select another storage provider",
  async (root, group, provider) => {
    const result = await getTargetConfig(inputs, await config(root, group));
    expect(result.plan_file_gcs?.bucket).toBe(
      provider === "gcs" ? "gcs" : undefined,
    );
    expect(result.plan_file_s3?.bucket).toBe(
      provider === "s3" ? "s3" : undefined,
    );
  },
);

it.each([
  [
    { plan_file_s3: { bucket: "s3" }, plan_file_gcs: { bucket: "gcs" } },
    { plan_file_gcs: { bucket: "group" } },
    {},
  ],
  [
    {},
    { plan_file_s3: { bucket: "s3" }, plan_file_gcs: { bucket: "gcs" } },
    { plan_file_gcs: { bucket: "target" } },
  ],
  [
    {},
    {},
    { plan_file_s3: { bucket: "s3" }, plan_file_gcs: { bucket: "gcs" } },
  ],
])(
  "rejects conflicts while loading each configuration level, even when overridden",
  async (root, group, wd) => {
    await expect(config(root, group, wd)).rejects.toThrow(
      "plan_file_s3 and plan_file_gcs",
    );
  },
);

it("rejects conflicts in target groups that are not selected", () => {
  expect(() =>
    types.RawConfig.parse({
      plan_workflow_name: "plan.yaml",
      target_groups: [
        { working_directory: "tests/aws/**" },
        {
          working_directory: "other/**",
          plan_file_s3: { bucket: "s3" },
          plan_file_gcs: { bucket: "gcs" },
        },
      ],
    }),
  ).toThrow("plan_file_s3 and plan_file_gcs");
});

it("keeps the structured GCS config out of string action outputs", async () => {
  const result = await run(
    inputs,
    await config({ plan_file_gcs: { bucket: "gcs" } }),
  );
  expect(result.outputs.has("plan_file_gcs")).toBe(false);
});
