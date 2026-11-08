// SMTP-Versand (E6 Teil 6) gegen einen kleinen SMTP-Server im Test: Was kommt beim Mailserver an?
import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createSmtpMailSender } from "./mail.js";

interface Received {
  readonly commands: string[];
  data: string;
}

/** Minimaler SMTP-Server: nimmt alles an, merkt sich Befehle und Inhalt. Nur für diesen Test. */
function fakeSmtp(): Promise<{ server: Server; port: number; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((socket: Socket) => {
    const r: Received = { commands: [], data: "" };
    received.push(r);
    let inData = false;
    let buffer = "";
    socket.write("220 test ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let i: number;
      while ((i = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            socket.write("250 OK\r\n");
          } else r.data += `${line}\n`;
          continue;
        }
        r.commands.push(line);
        const verb = line.split(" ")[0]?.toUpperCase();
        if (verb === "EHLO") socket.write("250-test\r\n250 AUTH PLAIN\r\n");
        else if (verb === "AUTH") socket.write("235 OK\r\n");
        else if (verb === "DATA") {
          inData = true;
          socket.write("354 go\r\n");
        } else if (verb === "QUIT") socket.end("221 bye\r\n");
        else socket.write("250 OK\r\n");
      }
    });
  });
  return new Promise((done) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      done({ server, port: typeof address === "object" && address !== null ? address.port : 0, received });
    }),
  );
}

describe("E-Mail-Versand per SMTP", () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise((r) => server?.close(r) ?? r(undefined));
  });

  it("schickt Absender, Empfänger, Betreff und Text, sonst nichts", async () => {
    const smtp = await fakeSmtp();
    server = smtp.server;
    const sender = createSmtpMailSender({
      url: `smtp://shop:geheim@127.0.0.1:${smtp.port}`,
      from: "Shop-Plattform <no-reply@localhost>",
    });
    await sender.send({
      to: "ida@teeladen.example",
      subject: "Passwort zurücksetzen",
      text: "Hallo Ida,\n\nhier ist der Link: https://admin.localhost/passwort-neu#code=abc\n",
    });
    sender.close();
    const [r] = smtp.received;
    expect(r?.commands).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^AUTH PLAIN /),
        "MAIL FROM:<no-reply@localhost>",
        "RCPT TO:<ida@teeladen.example>",
      ]),
    );
    expect(r?.commands.filter((c) => c.startsWith("RCPT"))).toHaveLength(1);
    const data = r?.data ?? "";
    expect(data).toMatch(/^From: "Shop-Plattform" <no-reply@localhost>$/m);
    expect(data).toMatch(/^To: ida@teeladen.example$/m);
    expect(data).toMatch(/^Subject: =\?UTF-8\?Q\?Passwort_zur=C3=BCcksetzen\?=$/m);
    expect(data).toMatch(/^Content-Type: text\/plain; charset=utf-8$/m);
    expect(data).not.toMatch(/^(Bcc|Cc):/im);
    expect(data).not.toContain("text/html");
    expect(data).toContain("passwort-neu#code=abc");
  });

  it("lässt keine zusätzlichen Empfänger über Zeilenumbrüche im Betreff zu", async () => {
    const smtp = await fakeSmtp();
    server = smtp.server;
    const sender = createSmtpMailSender({ url: `smtp://127.0.0.1:${smtp.port}`, from: "no-reply@localhost" });
    await sender.send({ to: "ida@teeladen.example", subject: "Hallo\r\nBcc: boese@example.com", text: "x" });
    sender.close();
    const r = smtp.received[0];
    expect(r?.commands.filter((c) => c.startsWith("RCPT"))).toEqual(["RCPT TO:<ida@teeladen.example>"]);
    expect(r?.data ?? "").not.toMatch(/^Bcc:/im);
  });
});
