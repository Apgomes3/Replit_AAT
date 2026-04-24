import nodemailer from 'nodemailer';

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
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

export async function sendPasswordResetEmail(
  toEmail: string,
  resetUrl: string,
  userName: string
): Promise<{ sent: boolean; previewUrl?: string }> {
  const transporter = createTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@example.com';

  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #1e293b; margin-bottom: 8px;">Password Reset</h2>
      <p style="color: #475569; margin-bottom: 24px;">
        Hi ${userName || toEmail},<br/><br/>
        An administrator has sent you a link to reset your password.
        Click the button below to choose a new password.
        This link expires in <strong>1 hour</strong> and can only be used once.
      </p>
      <a href="${resetUrl}"
         style="display: inline-block; background: #2563eb; color: #fff; text-decoration: none;
                padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px;">
        Reset my password
      </a>
      <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">
        If you did not request this, you can safely ignore this email.
        The link will expire automatically.<br/><br/>
        Or copy this URL into your browser:<br/>
        <a href="${resetUrl}" style="color: #2563eb;">${resetUrl}</a>
      </p>
    </div>
  `;

  if (!transporter) {
    console.log('\n[PASSWORD RESET] No SMTP configured — reset link for', toEmail, ':');
    console.log('[PASSWORD RESET]', resetUrl, '\n');
    return { sent: false };
  }

  await transporter.sendMail({
    from,
    to: toEmail,
    subject: 'Reset your password',
    html,
  });

  return { sent: true };
}
