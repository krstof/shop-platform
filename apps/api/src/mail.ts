// E-Mail-Versand per SMTP (E6 Teil 6). Heute nur für „Passwort vergessen“ und direkt an Mailpit,
// das alle E-Mails abfängt (Architektur 2, nie eine echte E-Mail nach außen). Mit dem Modul
// notifications (E16) wandert der Versand in einen Hintergrund-Auftrag mit Vorlagen und Wiederholung.
//
// - Nur reiner Text, keine Anhänge. Nodemailer darf weder Dateien noch Adressen nachladen.
// - Zugangsdaten stehen nur in SHOP_SMTP_URL und erscheinen nie im Protokoll.
// - Unverschlüsselt (smtp://) nur zu Mailpit oder auf dem eigenen Rechner (config.ts).
import type { MailSender } from "@shop/identity";
import { createTransport } from "nodemailer";

export interface SmtpMailSenderOptions {
  /** smtp://[benutzer:passwort@]host:port oder smtps://… */
  readonly url: string;
  /** Absender, etwa „Shop-Plattform <no-reply@localhost>“. */
  readonly from: string;
}

export interface ClosableMailSender extends MailSender {
  close(): void;
}

export function createSmtpMailSender(options: SmtpMailSenderOptions): ClosableMailSender {
  const url = new URL(options.url);
  const secure = url.protocol === "smtps:";
  const transport = createTransport({
    host: url.hostname,
    port: url.port === "" ? (secure ? 465 : 25) : Number(url.port),
    secure,
    ...(url.username === ""
      ? {}
      : { auth: { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) } }),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  });
  return {
    async send(mail) {
      await transport.sendMail({
        from: options.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
      });
    },
    close() {
      transport.close();
    },
  };
}
