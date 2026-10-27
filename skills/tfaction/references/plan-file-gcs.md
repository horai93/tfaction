---
sidebar_position: 3551
---

# Store Plan Files in GCS

Set `plan_file_gcs` to store the Terraform plan binary in Google Cloud Storage instead of GitHub Artifacts.
Only the metadata is uploaded to GitHub Artifacts; the plan binary and plan JSON are not.
This applies only to the `terraform` job type, not `tfmigrate`.

## Configuration

```yaml title="tfaction-root.yaml"
plan_file_gcs:
  bucket: my-plan-file-bucket
  key_prefix: tfaction_plan/ # optional; this is the default
```

This setting is also available in `target_groups[]` and `tfaction.yaml`.
The most specific level that sets either `plan_file_gcs` or `plan_file_s3` selects the storage:
`tfaction.yaml` takes precedence over the matching target group, which takes precedence over the root config.
This allows a target group to use GCS even if the root config uses S3, and vice versa.
Setting both providers at the same configuration level is rejected when that configuration is loaded, even if a more specific level overrides it.
When neither is set, the existing GitHub Artifacts behavior is retained.

## Authentication

Authenticate before running `plan` or `apply`.
The Google Cloud Storage Node.js client uses Application Default Credentials (ADC), including credentials configured by `google-github-actions/auth` through Workload Identity Federation.
tfaction does not authenticate for you and does not require the gcloud CLI or HMAC keys.

For example, add the following step before tfaction's Terraform operations in both workflows, using separate service accounts for plan and apply:

```yaml
- uses: google-github-actions/auth@v3
  with:
    workload_identity_provider: ${{ vars.GCP_WORKLOAD_IDENTITY_PROVIDER }}
    service_account: ${{ vars.GCP_SERVICE_ACCOUNT }}
    create_credentials_file: true
```

The job needs `id-token: write`, and checkout must run before authentication.
Configure your Workload Identity Federation trust and service accounts separately; see [Configuration for Google Cloud](google-cloud.md).

## How it works

The plan binary is stored at:

```text
<key_prefix><workflow run id>/<attempt number>/<terraform root module path>/plan.out
```

Uploads use a create-only generation precondition and do not use resumable uploads.
An existing object at the same key causes the upload to fail rather than replace it.
The error identifies the object and asks you to rerun the workflow, which uses a new attempt number.
This is additional protection against accidental overwrites; bucket IAM remains the access-control boundary.

The metadata artifact uses the same name and format as [S3 storage](plan-file-s3.md), with `storage: "gcs"`:

```json
{
  "storage": "gcs",
  "bucket": "my-plan-file-bucket",
  "files": [
    {
      "key": "tfaction_plan/1234/1/gcp/dev/vpc/plan.out",
      "hash": "<SHA-256 of plan.out>"
    }
  ],
  "summary": "create"
}
```

`apply` reads the metadata from the plan run selected by the existing head-SHA checks.
It downloads the exact recorded GCS object and compares its SHA-256 with the metadata before applying.
Download failures, invalid metadata, and hash mismatches stop apply.
The apply-time bucket configuration is not used, so changing the storage configuration between plan and apply does not change which object is downloaded.
`plan-label` continues to use the summary in the metadata without reading GCS.

## Access control and retention

tfaction does not create or enforce bucket IAM policies.
For a dedicated plan bucket:

- Grant the plan service account `roles/storage.objectCreator`, which permits creation without reading, deleting, or overwriting objects.
- Grant the apply service account `storage.objects.get`, for example through a custom role or `roles/storage.objectViewer` (which also permits listing).
- Restrict impersonation of the apply service account to the trusted apply context, such as the default branch. PR jobs must not be able to assume it.
- Check inherited project and organization roles as well: another grant can allow a plan identity to read objects despite the intended split.
- Use uniform bucket-level access, prevent public access, and configure lifecycle expiration for old plans. GitHub artifact retention does not delete GCS objects.

Keep read access out of jobs that execute untrusted PR code.
Downstream PR jobs can use the metadata summary, or process the plan in the original plan job where it is still local.
Bucket names, object paths, summaries, and hashes remain visible to users who can read the metadata artifact.
An older tfaction version that does not recognize `storage: "gcs"` cannot apply a GCS plan; use the GCS-capable version for both plan and apply.
