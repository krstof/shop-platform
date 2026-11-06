# Liste häufiger Passwörter

`common-passwords.txt.gz`: 46 888 Passwörter mit 12 bis 128 Zeichen, klein geschrieben, eines je Zeile.
Kürzere Einträge fehlen absichtlich, weil die Mindestlänge ohnehin 12 Zeichen ist (Sicherheit 5.2).

Herkunft (abgerufen am 06.11.2026), alle aus [SecLists](https://github.com/danielmiessler/SecLists), MIT-Lizenz:

- `Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt`
- `Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt`
- `Passwords/Common-Credentials/10k-most-common.txt`

Erzeugt mit:

```sh
cat xato.txt ncsc.txt 10k.txt | tr -d '\r' | awk 'length($0)>=12 && length($0)<=128' \
  | tr 'A-Z' 'a-z' | sort -u | gzip -9 > common-passwords.txt.gz
```
