variable "project_id" {
  description = "ID do projeto no Google Cloud (ex: contabilidade-dp-producao)"
  type        = string
}

variable "region" {
  description = "Região onde os resources do projeto serão criados"
  type        = string
  default     = "southamerica-east1"
}

variable "db_password" {
  description = "Senha do usuário do PostgreSQL"
  type        = string
  sensitive   = true
}

variable "bucket_name_suffix" {
  description = "Sufixo opcional para o bucket de PDFs"
  type        = string
  default     = "cct-pdfs"
}
