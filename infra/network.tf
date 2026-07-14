# Networking for the OKE cluster: one VCN with a public subnet for the
# load balancer and a private subnet for worker nodes, following the
# standard OKE "quick create" topology (public LB, private nodes reached
# only through a NAT gateway for outbound access).
#
# Resource arguments verified against the oracle/oci provider docs
# (docs.oracle.com/en-us/iaas/tools/terraform-provider-oci/latest/docs/r/
# core_vcn.html, core_subnet.html, core_internet_gateway.html,
# core_nat_gateway.html, core_route_table.html, core_security_list.html),
# fetched 2026-07-13.

resource "oci_core_vcn" "transigen" {
  compartment_id = var.compartment_ocid
  cidr_blocks    = ["10.0.0.0/16"]
  display_name   = "transigen-vcn"
  dns_label      = "transigen"
}

resource "oci_core_internet_gateway" "transigen" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.transigen.id
  display_name   = "transigen-igw"
  enabled        = true
}

resource "oci_core_nat_gateway" "transigen" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.transigen.id
  display_name   = "transigen-nat"
}

# Public route table: default route to the internet gateway. Used by the
# LB subnet so the load balancer gets a public IP path.
resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.transigen.id
  display_name   = "transigen-public-rt"

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.transigen.id
  }
}

# Private route table: default route to the NAT gateway. Used by the node
# subnet so nodes get outbound internet (image pulls, GitHub API polling,
# OCIR push/pull) without being directly reachable from the internet.
resource "oci_core_route_table" "private" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.transigen.id
  display_name   = "transigen-private-rt"

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_nat_gateway.transigen.id
  }
}

# Security list for the public LB subnet: allow inbound HTTP from
# anywhere (the app is served over bare HTTP/IP — no TLS in this phase,
# see docs/design/deploy-oci-cicd-plan.md risks), allow all outbound.
resource "oci_core_security_list" "public_lb" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.transigen.id
  display_name   = "transigen-public-lb-seclist"

  ingress_security_rules {
    protocol = "6" # TCP
    source   = "0.0.0.0/0"

    tcp_options {
      min = 80
      max = 80
    }
  }

  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
  }
}

# Security list for the private node subnet: allow inbound traffic from
# the LB subnet on the app port plus the Kubernetes API/worker node port
# ranges OKE needs internally, and all outbound (nodes reach OCIR, GitHub,
# and the OKE control plane through the NAT gateway).
resource "oci_core_security_list" "private_nodes" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.transigen.id
  display_name   = "transigen-private-nodes-seclist"

  # Traffic from the LB subnet to the NodePort/app port range.
  ingress_security_rules {
    protocol = "6" # TCP
    source   = "10.0.1.0/24"

    tcp_options {
      min = 30000
      max = 32767
    }
  }

  # Intra-VCN traffic (node-to-node, kubelet, pod networking) required by
  # OKE. Scoped to the VCN CIDR rather than 0.0.0.0/0.
  ingress_security_rules {
    protocol = "all"
    source   = "10.0.0.0/16"
  }

  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
  }
}

# Public subnet: hosts the OCI Load Balancer created by the Kubernetes
# Service of type LoadBalancer (web-service.yaml).
resource "oci_core_subnet" "public_lb" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.transigen.id
  cidr_block                 = "10.0.1.0/24"
  display_name               = "transigen-public-lb-subnet"
  dns_label                  = "pubsub"
  prohibit_public_ip_on_vnic = false
  route_table_id             = oci_core_route_table.public.id
  security_list_ids          = [oci_core_security_list.public_lb.id]
}

# Private subnet: hosts the OKE worker node(s). No public IPs on the
# nodes themselves — only the LB in the public subnet is internet-facing.
resource "oci_core_subnet" "private_nodes" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.transigen.id
  cidr_block                 = "10.0.2.0/24"
  display_name               = "transigen-private-nodes-subnet"
  dns_label                  = "nodesub"
  prohibit_public_ip_on_vnic = true
  route_table_id             = oci_core_route_table.private.id
  security_list_ids          = [oci_core_security_list.private_nodes.id]
}

# Regional subnet for the OKE cluster's Kubernetes API endpoint. Given a
# public IP so kubectl can reach it directly from a local machine (via
# oci ce cluster create-kubeconfig) without a bastion or VPN.
resource "oci_core_subnet" "oke_endpoint" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.transigen.id
  cidr_block                 = "10.0.0.0/28"
  display_name               = "transigen-oke-endpoint-subnet"
  dns_label                  = "okeendpoint"
  prohibit_public_ip_on_vnic = false
  route_table_id             = oci_core_route_table.public.id
  security_list_ids          = [oci_core_security_list.public_lb.id]
}
