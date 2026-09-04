#!/usr/bin/env python3
"""Copy the web game into www/ for Capacitor, using the bundled three.js instead of the CDN."""
import shutil, os, re
os.makedirs('www/vendor', exist_ok=True)
for f in ('style.css', 'levels.js', 'render3d.js', 'game.js'):
    shutil.copy(f, 'www/' + f)
html = open('index.html').read()
html = html.replace('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', 'vendor/three.min.js')
open('www/index.html', 'w').write(html)
print('staged www/')
