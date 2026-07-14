# OKE cluster (basic control plane, free tier) plus a single-node
# VM.Standard.A1.Flex (arm64) node pool.
#
# Resource arguments verified against the oracle/oci provider docs
# (docs.oracle.com/en-us/iaas/tools/terraform-provider-oci/latest/docs/r/
# containerengine_cluster.html, containerengine_node_pool.html and
# .../d/core_images.html, .../d/identity_availability_domains.html),
# fetched 2026-07-13.

data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

# Latest Oracle Linux image for the A1 Flex shape. Oracle publishes
# arm64-native images under the same "Oracle Linux" operating_system
# filter as x86 — the shape filter is what selects the arm64 variant.
data "oci_core_images" "node_image" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Oracle Linux"
  operating_system_version = "8"
  shape                    = var.node_shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

resource "oci_containerengine_cluster" "transigen" {
  compartment_id     = var.compartment_ocid
  kubernetes_version = var.kubernetes_version
  name               = "transigen"
  vcn_id             = oci_core_vcn.transigen.id

  # BASIC_CLUSTER is free; ENHANCED_CLUSTER carries an hourly charge and
  # is not needed for a single-app, single-environment deployment.
  type = "BASIC_CLUSTER"

  endpoint_config {
    is_public_ip_enabled = true
    subnet_id            = oci_core_subnet.oke_endpoint.id
  }

  options {
    service_lb_subnet_ids = [oci_core_subnet.public_lb.id]

    kubernetes_network_config {
      pods_cidr     = "10.244.0.0/16"
      services_cidr = "10.96.0.0/16"
    }
  }
}

resource "oci_containerengine_node_pool" "transigen" {
  cluster_id         = oci_containerengine_cluster.transigen.id
  compartment_id     = var.compartment_ocid
  name               = "transigen-a1-pool"
  node_shape         = var.node_shape
  kubernetes_version = var.kubernetes_version

  node_shape_config {
    ocpus         = var.node_ocpus
    memory_in_gbs = var.node_memory_in_gbs
  }

  node_source_details {
    image_id                = data.oci_core_images.node_image.images[0].id
    source_type             = "IMAGE"
    boot_volume_size_in_gbs = var.node_boot_volume_size_in_gbs
  }

  node_config_details {
    size = var.node_pool_size

    placement_configs {
      availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
      subnet_id           = oci_core_subnet.private_nodes.id
    }
  }
}
