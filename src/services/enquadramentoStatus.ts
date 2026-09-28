// Valores gravados no banco; mantidos por compatibilidade com os registros existentes.
export const STATUS_ENQUADRAMENTO = {
  PENDENTE: 'SUGERIDO_IA',
  CONFIRMADO: 'VALIDADO_DP',
  REJEITADO: 'REJEITADO'
} as const;

export type StatusEnquadramento = typeof STATUS_ENQUADRAMENTO[keyof typeof STATUS_ENQUADRAMENTO];

export const GRAUS_ENQUADRAMENTO = ['DIRETO', 'PREPONDERANTE', 'DIFERENCIADO'] as const;
export type GrauEnquadramento = typeof GRAUS_ENQUADRAMENTO[number];

export function rotuloStatusEnquadramento(status: string): 'CONFIRMADO' | 'PENDENTE' | 'REJEITADO' {
  if (status === STATUS_ENQUADRAMENTO.CONFIRMADO) return 'CONFIRMADO';
  if (status === STATUS_ENQUADRAMENTO.REJEITADO) return 'REJEITADO';
  return 'PENDENTE';
}
