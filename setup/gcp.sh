#!/usr/bin/env bash
# One-time setup: let this repo's GitHub Actions (main branch only) write to
# BigQuery in project scm-seoul, with no stored key (Workload Identity Federation).
set -e
PROJECT=scm-seoul
REPO_ID=1455608998
gcloud config set project $PROJECT
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com bigquery.googleapis.com
gcloud iam workload-identity-pools describe github --location=global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create github --location=global --display-name="GitHub"
gcloud iam workload-identity-pools providers describe scm-repo --location=global --workload-identity-pool=github >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc scm-repo --location=global \
    --workload-identity-pool=github --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository_id=='$REPO_ID' && assertion.ref=='refs/heads/main'"
SA=scm-github@$PROJECT.iam.gserviceaccount.com
gcloud iam service-accounts describe $SA >/dev/null 2>&1 || \
  gcloud iam service-accounts create scm-github --display-name="SCM GitHub Actions"
gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$SA" --role=roles/bigquery.dataEditor --condition=None >/dev/null
gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$SA" --role=roles/bigquery.jobUser --condition=None >/dev/null
NUM=$(gcloud projects describe $PROJECT --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding $SA --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$NUM/locations/global/workloadIdentityPools/github/attribute.repository_id/$REPO_ID" >/dev/null
echo
echo "DONE. Send this line to Claude:"
echo "PROVIDER=projects/$NUM/locations/global/workloadIdentityPools/github/providers/scm-repo"
