import pathlib
d = pathlib.Path(__file__).parent
js = "\n".join((d/f).read_text() for f in ["topics.js","subtags.js","seed_fr.js","seed_es.js","i18n.js","core.js","claude.js","ui.js"])
html = (d/"shell_head.html").read_text() + "<style>\n" + (d/"style.css").read_text() + "</style>\n<div id=\"app\"></div>\n<script>\n\"use strict\";\n" + js + "\n</script>\n"
(d/"caderno.html").write_text(html)
(d/"bundle.js").write_text("\"use strict\";\n"+js)
print(len(html))
