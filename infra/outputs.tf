# Outputs consumed by deploy/bootstrap.sh (cluster OCID/name for
# `oci ce cluster create-kubeconfig`) and useful for manual verification.

output "cluster_id" {
  description = "OCID of the OKE cluster."
  value       = oci_containerengine_cluster.transigen.id
}

output "cluster_name" {
  description = "Display name of the OKE cluster."
  value       = oci_containerengine_cluster.transigen.name
}

output "region" {
  description = "OCI region the cluster was created in."
  value       = var.region
}

output "ocir_region_key" {
  description = "Short OCIR region key for var.region (e.g. \"iad\" for us-ashburn-1), lowercased for use in the <region-key>.ocir.io hostname."
  value       = local.ocir_region_key
}

output "ocir_repo_path" {
  description = "OCIR repository path without the registry host, in the form <tenancy-namespace>/<repo-name>. Prepend <region-key>.ocir.io/ for a full image reference."
  value       = "${data.oci_objectstorage_namespace.tenancy.namespace}/${oci_artifacts_container_repository.web.display_name}"
}
