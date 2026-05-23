import nodemailer from 'nodemailer';
import type { SentMessageInfo, Transporter } from 'nodemailer';

const transporter: Transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST || 'smtp.hostinger.com',
  port: parseInt(process.env.MAIL_PORT || '465', 10),
  secure: true,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  }
});

export type SendResetEmailOpts = {
  validityMinutes?: number;
};

export type SendVerificationEmailOpts = {
  validityHours?: number;
};

function resolvePublicBaseUrl(): string {
  return (
    process.env.FRONTEND_URL ||
    process.env.PUBLIC_URL ||
    process.env.SITE_URL ||
    'https://genesisdao.tech'
  )
    .trim()
    .replace(/\/+$/, '');
}

export async function sendResetEmail(
  email: string,
  resetToken: string,
  opts: SendResetEmailOpts = {}
): Promise<SentMessageInfo> {
  const validityMinutes =
    typeof opts.validityMinutes === 'number' && opts.validityMinutes > 0 ? opts.validityMinutes : 60;
  const enc = encodeURIComponent(resetToken);
  const publicBase = resolvePublicBaseUrl();
  const resetLink = `${publicBase}/redefinir-senha/${enc}`;

  const mailOptions = {
    from: process.env.MAIL_FROM || '"Genesis Miner" <no-reply@genesisdao.tech>',
    to: email,
    subject: 'Redefinição de senha — Genesis Miner',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #b45309; text-align: center;">Redefinição de senha</h2>
        <p>Olá,</p>
        <p>Recebemos um pedido para redefinir a senha da sua conta no <strong>Genesis Miner</strong>. Use o botão abaixo (ou copie o link se o botão não abrir):</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" style="background-color: #d97706; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Redefinir minha senha</a>
        </div>
        <p style="font-size: 13px; color: #475569;">Este link expira em cerca de <strong>${validityMinutes} minutos</strong>. Se não foi você, ignore este email — a sua palavra-passe não será alterada.</p>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;">
        <p style="font-size: 11px; color: #94a3b8; word-break: break-all;">${resetLink}</p>
        <p style="font-size: 12px; color: #64748b; text-align: center;">
          Genesis Miner
        </p>
      </div>
    `
  };

  return transporter.sendMail(mailOptions);
}

export async function sendVerificationEmail(
  email: string,
  verificationToken: string,
  opts: SendVerificationEmailOpts = {}
): Promise<SentMessageInfo> {
  const validityHours =
    typeof opts.validityHours === 'number' && opts.validityHours > 0 ? opts.validityHours : 24;
  const enc = encodeURIComponent(verificationToken);
  const publicBase = resolvePublicBaseUrl();
  const verifyLink = `${publicBase}/verificar-email/${enc}`;

  const mailOptions = {
    from: process.env.MAIL_FROM || '"Genesis Miner" <no-reply@genesisdao.tech>',
    to: email,
    subject: 'Confirme o seu email — Genesis Miner',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #b45309; text-align: center;">Ative a sua conta</h2>
        <p>Olá,</p>
        <p>Para ativar a sua nova conta no <strong>Genesis Miner</strong>, confirme o seu email clicando no botão abaixo:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verifyLink}" style="background-color: #d97706; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Confirmar email</a>
        </div>
        <p style="font-size: 13px; color: #475569;">Este link expira em cerca de <strong>${validityHours} horas</strong>. Depois de confirmar, já poderá entrar normalmente na sua conta.</p>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;">
        <p style="font-size: 11px; color: #94a3b8; word-break: break-all;">${verifyLink}</p>
        <p style="font-size: 12px; color: #64748b; text-align: center;">Genesis Miner</p>
      </div>
    `
  };

  return transporter.sendMail(mailOptions);
}

export default transporter;
