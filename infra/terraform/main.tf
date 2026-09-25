provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  bucket_name = "${var.project_id}-${var.bucket_name_suffix}"
}

resource "google_storage_bucket" "cct_bucket" {
  name          = local.bucket_name
  location      = var.region
  force_destroy = false

  uniform_bucket_level_access = true

  lifecycle_rule {
    condition {
      age = 1825
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_sql_database_instance" "postgres_instance" {
  name             = "modulo-dp-postgres"
  database_version = "POSTGRES_15"
  region           = var.region

  settings {
    tier = "db-f1-micro"

    backup_configuration {
      enabled    = true
      start_time = "04:00"
    }

    ip_configuration {
      ipv4_enabled = true
    }
  }

  deletion_protection = false
}

resource "google_sql_database" "database" {
  name     = "modulodp"
  instance = google_sql_database_instance.postgres_instance.name
}

resource "google_sql_user" "db_user" {
  name     = "modulo_admin"
  instance = google_sql_database_instance.postgres_instance.name
  password = var.db_password
}

resource "google_service_account" "dp_bot_account" {
  account_id   = "extrator-cct-bot"
  display_name = "Bot do Extrator de CCTs"
}

resource "google_storage_bucket_iam_member" "bot_storage_admin" {
  bucket = google_storage_bucket.cct_bucket.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.dp_bot_account.email}"
}

resource "google_project_iam_member" "bot_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.dp_bot_account.email}"
}

output "bucket_name" {
  description = "Nome do bucket criado para os PDFs das CCTs"
  value       = google_storage_bucket.cct_bucket.name
}

output "database_name" {
  description = "Nome do banco PostgreSQL criado"
  value       = google_sql_database.database.name
}

output "service_account_email" {
  description = "E-mail da service account do bot"
  value       = google_service_account.dp_bot_account.email
}

output "database_instance_connection_name" {
  description = "Nome de conexão da instância do Cloud SQL"
  value       = google_sql_database_instance.postgres_instance.connection_name
}
