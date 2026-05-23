/**
 * Provedores de email considerados confiáveis (lista exacta do domínio, lower case).
 * Qualquer outro domínio com formato válido recebe motivo `domain_not_trusted` na análise admin.
 */
export const TRUSTED_EMAIL_DOMAINS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
] as const;
