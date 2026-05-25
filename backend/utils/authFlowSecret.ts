/**
 * Secret compartilhado para HMAC de tokens de verificação de email e reset de senha.
 * Falha ruidosamente no startup se a variável de ambiente estiver ausente ou for muito curta,
 * em vez de silenciosamente usar o fallback 'secret' hardcoded.
 */
export function getAuthFlowTokenSecret(): string {
  const s = (process.env.AUTH_FLOW_TOKEN_SECRET || process.env.JWT_SECRET || '').trim();
  if (s.length < 16) {
    throw new Error(
      '[SECURITY] AUTH_FLOW_TOKEN_SECRET não definido ou demasiado curto. ' +
        'Defina AUTH_FLOW_TOKEN_SECRET com pelo menos 32 caracteres aleatórios.'
    );
  }
  return s;
}
