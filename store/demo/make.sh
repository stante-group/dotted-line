#!/bin/bash
# Store screenshots from the real panel code fed invented data (mock.js).
#   bash store/demo/make.sh        → serves the repo on http://127.0.0.1:8765
# then capture store/demo/shot.html?scene=wf and ?scene=rs at 1280×800, e.g. with
#   chrome --headless=new --hide-scrollbars --window-size=1280,800 --screenshot=out.png <url>
# panel.html is made fresh from src/panel/panel.html each time (mock first, then the real
# panel.js), so the screenshots never show a stale copy of the panel. It isn't committed.
set -e
cd "$(dirname "$0")/../.."
sed 's#<script type="module" src="panel.js"></script>#<script src="mock.js"></script>\n  <script type="module" src="../../src/panel/panel.js"></script>#' \
  src/panel/panel.html > store/demo/panel.html
grep -q mock.js store/demo/panel.html || { echo "panel.html's script tag changed — update make.sh"; exit 1; }
exec python3 -m http.server 8765 --bind 127.0.0.1
