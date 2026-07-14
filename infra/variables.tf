# Variables for the transigen OKE deployment. Defaults target the OCI
# always-free tier: a single VM.Standard.A1.Flex node with 3 OCPU / 18 GB
# (headroom under the 4 OCPU / 24 GB free-tier cap for Ampere A1 Flex
# compute) and a basic (not enhanced) OKE control plane. The 10 Mbps
# flexible load balancer is configured via Service annotations in
# k8s/web-service.yaml, not here. Free-tier limits are UNVERIFIED as of
# writing — confirm current terms at https://www.oracle.com/cloud/free/
# before relying on them.

variable "tenancy_ocid" {
  description = "OCID of the OCI tenancy. Required by the OCI provider and used as the compartment_id default for tenancy-root resources."
  type        = string
}

variable "compartment_ocid" {
  description = "OCID of the compartment to create all resources in. Can be the tenancy OCID itself if you are not using a dedicated compartment."
  type        = string
}

variable "region" {
  description = "OCI region identifier, e.g. \"us-ashburn-1\". Must be a region where A1 Flex free-tier capacity is available; capacity varies by region and can be exhausted (see docs/design/deploy-oci-cicd-plan.md risks section)."
  type        = string
}

variable "node_shape" {
  description = "Compute shape for the OKE node pool. VM.Standard.A1.Flex is Oracle's Ampere arm64 shape and is required for the always-free tier."
  type        = string
  default     = "VM.Standard.A1.Flex"
}

variable "node_ocpus" {
  description = "OCPUs per node. Default of 3 leaves 1 OCPU of headroom under the 4 OCPU always-free cap for a single node."
  type        = number
  default     = 3
}

variable "node_memory_in_gbs" {
  description = "Memory (GB) per node. Default of 18 leaves 6 GB of headroom under the 24 GB always-free cap for a single node."
  type        = number
  default     = 18
}

variable "node_pool_size" {
  description = "Number of nodes in the pool. Kept at 1 to stay well inside always-free capacity; the app is small enough not to need more."
  type        = number
  default     = 1
}

variable "node_boot_volume_size_in_gbs" {
  description = "Boot volume size (GB) for each node. 50 GB is the provider-documented minimum."
  type        = number
  default     = 50
}

variable "kubernetes_version" {
  description = "Kubernetes version for the OKE control plane and node pool. Left as a variable so it can be bumped without touching oke.tf; check OKE's supported-versions list before changing."
  type        = string
  default     = "v1.31.1"
}
