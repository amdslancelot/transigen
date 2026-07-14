# OCI Terraform provider. Verified against
# https://registry.terraform.io/providers/oracle/oci/latest/docs
# (fetched 2026-07-13 via the mirrored docs at docs.oracle.com, since the
# registry site itself is JS-rendered and not fetchable by static tools).
#
# Authentication uses the standard OCI CLI config file (~/.oci/config),
# the same one `oci setup config` writes and that deploy/bootstrap.sh's
# prerequisite check (`oci iam region list`) already depends on. This
# keeps credentials out of the Terraform files entirely — no API key
# material is passed as a provider argument here.

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = ">= 5.0.0"
    }
  }

  # No backend block: state is local (infra/terraform.tfstate), per the
  # approved plan. This is a single-operator, single-environment setup;
  # revisit if the project grows a second maintainer or environment.
}

provider "oci" {
  region = var.region
}
