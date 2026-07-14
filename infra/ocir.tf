# OCIR (OCI Container Registry) repository for the web app image. The
# in-cluster kaniko build (k8s/ci/) pushes here as
# <region-key>.ocir.io/<tenancy-namespace>/transigen-web:<git-sha>.
#
# Resource arguments verified against the oracle/oci provider docs
# (docs.oracle.com/en-us/iaas/tools/terraform-provider-oci/latest/docs/r/
# artifacts_container_repository.html), fetched 2026-07-13.

resource "oci_artifacts_container_repository" "web" {
  compartment_id = var.compartment_ocid
  display_name   = "transigen-web"
  is_public      = false
}

# The tenancy's Object Storage namespace, which is also the tenancy
# namespace segment in OCIR image paths
# (<region-key>.ocir.io/<tenancy-namespace>/<repo>). Data source verified
# against docs.oracle.com/en-us/iaas/tools/terraform-provider-oci/latest/
# docs/d/objectstorage_namespace.html, fetched 2026-07-13: compartment_id
# is optional and the value is exported as the `namespace` attribute.
data "oci_objectstorage_namespace" "tenancy" {
  compartment_id = var.tenancy_ocid
}

# Region subscriptions for the tenancy, used to derive the short OCIR
# region key (e.g. "iad" for us-ashburn-1) from var.region without a
# hand-maintained lookup table. Data source verified against
# docs.oracle.com/en-us/iaas/tools/terraform-provider-oci/latest/docs/d/
# identity_region_subscriptions.html, fetched 2026-07-13: requires
# tenancy_id, and each region_subscriptions element exports region_key
# (documented as an uppercase three-letter code, hence the lower() below)
# and region_name.
data "oci_identity_region_subscriptions" "tenancy" {
  tenancy_id = var.tenancy_ocid
}

locals {
  ocir_region_key = lower(
    [
      for sub in data.oci_identity_region_subscriptions.tenancy.region_subscriptions :
      sub.region_key if sub.region_name == var.region
    ][0]
  )
}
