import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";
import { uploadPlanToGCS, downloadPlanFromGCS } from "./plan_storage";

const { upload, download, bucket, file } = vi.hoisted(() => ({
  upload: vi.fn(),
  download: vi.fn(),
  bucket: vi.fn(),
  file: vi.fn(),
}));

vi.mock("@google-cloud/storage", () => ({
  Storage: vi.fn(function () {
    return { bucket };
  }),
}));

describe("GCS plan storage", () => {
  let dir: string;
  const contents = Buffer.from("plan binary fixture");

  beforeEach(() => {
    vi.resetAllMocks();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tfaction-gcs-"));
    bucket.mockReturnValue({ upload, file });
    file.mockReturnValue({ download });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("uploads a unique create-only object and returns the binary's SHA-256", async () => {
    const source = path.join(dir, "tfplan.binary");
    fs.writeFileSync(source, contents);
    const stored = await uploadPlanToGCS(
      { bucket: "plans", runId: "123", attempt: "2", target: "gcp/dev" },
      source,
    );
    expect(stored).toEqual({
      key: "tfaction_plan/123/2/gcp/dev/plan.out",
      hash: createHash("sha256").update(contents).digest("hex"),
    });
    expect(bucket).toHaveBeenCalledWith("plans");
    expect(upload).toHaveBeenCalledWith(source, {
      destination: stored.key,
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
    });
  });

  it("supports a custom prefix and propagates upload failures", async () => {
    const source = path.join(dir, "tfplan.binary");
    fs.writeFileSync(source, contents);
    upload.mockRejectedValueOnce(new Error("permission denied"));
    await expect(
      uploadPlanToGCS(
        {
          bucket: "plans",
          keyPrefix: "custom",
          runId: "1",
          attempt: "1",
          target: "",
        },
        source,
      ),
    ).rejects.toThrow("permission denied");
    expect(upload).toHaveBeenCalledWith(
      source,
      expect.objectContaining({
        destination: "custom/1/1//plan.out",
      }),
    );
  });

  it("explains an existing GCS plan without retrying or reading it", async () => {
    const source = path.join(dir, "tfplan.binary");
    fs.writeFileSync(source, contents);
    const failure = Object.assign(new Error("Precondition Failed"), {
      code: 412,
    });
    upload.mockRejectedValueOnce(failure);
    await expect(
      uploadPlanToGCS(
        { bucket: "plans", runId: "123", attempt: "2", target: "gcp/dev" },
        source,
      ),
    ).rejects.toThrow(
      "plan file already exists in GCS: gs://plans/tfaction_plan/123/2/gcp/dev/plan.out",
    );
    expect(upload).toHaveBeenCalledTimes(1);
    expect(file).not.toHaveBeenCalled();
  });

  it("downloads the exact object into the local plan file", async () => {
    download.mockImplementationOnce(async ({ destination }) => {
      await fs.promises.writeFile(destination, contents);
    });
    const result = await downloadPlanFromGCS(
      "plans",
      "custom/123/2/gcp/dev/plan.out",
      dir,
    );
    expect(bucket).toHaveBeenCalledWith("plans");
    expect(file).toHaveBeenCalledWith("custom/123/2/gcp/dev/plan.out");
    expect(fs.readFileSync(result)).toEqual(contents);
    expect(result).toBe(path.join(dir, "plan.out"));
  });

  it("propagates download failures", async () => {
    download.mockRejectedValueOnce(new Error("not found"));
    await expect(
      downloadPlanFromGCS("plans", "missing/plan.out", dir),
    ).rejects.toThrow("not found");
  });
});
