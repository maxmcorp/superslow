"""Writes qr.png: a QR code that opens the app's address."""

from pathlib import Path

import segno

URL = 'https://maxmcorp.github.io/superslow/'

out = Path(__file__).resolve().parent.parent / 'qr.png'
segno.make(URL, error='m').save(out, scale=12, border=4, dark='#000000', light='#ffffff')
print(f'{out.name}: {URL}')
