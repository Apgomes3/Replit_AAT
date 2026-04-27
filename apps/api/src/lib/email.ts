import nodemailer from 'nodemailer';

function createTransport() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export async function sendPasswordResetEmail(toEmail: string, resetUrl: string): Promise<void> {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@example.com';
  const transport = createTransport();

  if (!transport) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM environment secrets.');
    }
    console.warn(`[EMAIL] SMTP not configured. Password reset URL for ${toEmail}: ${resetUrl}`);
    return;
  }

  await transport.sendMail({
    from,
    to: toEmail,
    subject: 'Reset your password',
    text: `You have been sent a password reset link.\n\nClick the link below to set a new password. This link expires in 1 hour.\n\n${resetUrl}\n\nIf you did not request this, you can safely ignore this email.`,
    html: `
      <p>You have been sent a password reset link.</p>
      <p>Click the button below to set a new password. This link expires in <strong>1 hour</strong>.</p>
      <p style="margin:24px 0">
        <a href="${resetUrl}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">
          Reset Password
        </a>
      </p>
      <p style="color:#6b7280;font-size:0.875em">
        Or copy and paste this URL into your browser:<br/>
        <a href="${resetUrl}">${resetUrl}</a>
      </p>
      <p style="color:#6b7280;font-size:0.875em">If you did not request this, you can safely ignore this email.</p>
    `,
  });
}
