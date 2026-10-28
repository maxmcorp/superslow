"""Writes the QR code that opens the app's address: qr.png for the README, qr.svg for the app."""

from pathlib import Path

import segno

URL = 'https://maxmcorp.github.io/superslow/'

root = Path(__file__).resolve().parent.parent
qr = segno.make(URL, error='m')
qr.save(root / 'qr.png', scale=12, border=4, dark='#000000', light='#ffffff')
qr.save(root / 'qr.svg', border=4, dark='#000000', light='#ffffff', omitsize=True)
print(f'qr.png, qr.svg: {URL}')
