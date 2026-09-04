#!/usr/bin/env python3
"""Bundle index.html, style.css, levels.js, render3d.js and game.js into dist/baseline-breaker.html."""
import os
os.makedirs('dist', exist_ok=True)
html = open('index.html').read(); css = open('style.css').read()
body = html.split('<body>', 1)[1].split('</body>', 1)[0]
for name in ('levels.js', 'render3d.js', 'game.js'):
    import re
    body = re.sub(r'<script src="%s(\?[^"]*)?"></script>' % re.escape(name), lambda m: '<script>' + open(name).read() + '</script>', body)
out = ('<title>Baseline Breaker</title>\n'
       '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;900&family=Manrope:wght@500;700&display=swap">\n'
       '<style>\n' + css + '\n</style>\n' + body)
open('dist/baseline-breaker.html', 'w').write(out)
print('wrote dist/baseline-breaker.html', len(out), 'bytes')
