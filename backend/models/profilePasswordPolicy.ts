import bcrypt from 'bcryptjs';

const COMMON_WEAK = new Set(
  [
    'password',
    '12345678',
    '123456789',
    'qwerty123',
    'genesis',
    'genesisminer',
    'welcome1',
    'senha123',
    'palavrapasse',
    'abc123456'
  ].map((s) => s.toLowerCase())
);

export type ProfilePasswordStrength = { ok: true } | { ok: false; error: string };

/**
 * Regra de perfil: mais forte que o cadastro legado (mínimo + letras e números + não comum + diferente da atual).
 */
export function validatePasswordStrengthPolicy(newPassword: string): ProfilePasswordStrength {
  const p = String(newPassword || '');
  if (p.length < 6) {
    return { ok: false, error: 'A palavra-passe deve ter pelo menos 6 caracteres.' };
  }
  if (p.length > 50) {
    return { ok: false, error: 'A nova palavra-passe é demasiado longa.' };
  }
  const lower = p.toLowerCase();
  if (COMMON_WEAK.has(lower)) {
    return { ok: false, error: 'Esta palavra-passe é demasiado comum. Escolha outra.' };
  }
  return { ok: true };
}

export async function validateProfileNewPasswordStrength(
  newPassword: string,
  currentHash: string | null | undefined
): Promise<ProfilePasswordStrength> {
  const base = validatePasswordStrengthPolicy(newPassword);
  if (!base.ok) return base;
  const p = String(newPassword || '');
  if (currentHash && (await bcrypt.compare(p, currentHash))) {
    return { ok: false, error: 'A nova palavra-passe não pode ser igual à atual.' };
  }
  return { ok: true };
}
