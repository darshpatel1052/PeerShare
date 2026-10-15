"""Build the README's original, editable vector artwork. No remote assets."""

from html import escape
from pathlib import Path

OUTPUT = Path("docs/assets/readme")
OUTPUT.mkdir(parents=True, exist_ok=True)
THEMES = {
    "light": dict(bg="#f8f7f3", panel="#ffffff", ink="#242b27", muted="#64716a", line="#d9ded5", accent="#c73f25", soft="#faeae2", green="#317b68", blue="#406a9b"),
    "dark": dict(bg="#151c19", panel="#202925", ink="#f5f2e9", muted="#a9b5ac", line="#37453c", accent="#ffab8c", soft="#352a24", green="#86c4b0", blue="#9bbce2"),
}


def text(x, y, value, size=18, fill="ink", weight=400, extra=""):
    return f'<text x="{x}" y="{y}" font-size="{size}" fill="{C.get(fill, fill)}" font-weight="{weight}" {extra}>{escape(value)}</text>'


def rect(x, y, w, h, fill="panel", radius=16, stroke="line", extra=""):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{C.get(fill, fill)}" stroke="{C.get(stroke, stroke)}" {extra}/>'


def path(d, color="line", width=2, extra=""):
    return f'<path d="{d}" fill="none" stroke="{C.get(color, color)}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round" {extra}/>'


def tag(x, y, label, color="accent"):
    return text(x, y, label, 12, color, 700, 'letter-spacing="2"')


def logo(x, y, scale=1):
    return f'<g transform="translate({x} {y}) scale({scale})"><rect width="44" height="44" rx="13" fill="{C["accent"]}"/><path d="m13 10 21 12-21 12V10Z" fill="{C["bg"]}"/><path d="M8 23h15m-3-6 8 5-8 5" fill="none" stroke="{C["accent"]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>'


def svg(name, width, height, title, description, body):
    content = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">
<title id="title">{escape(title)}</title><desc id="desc">{escape(description)}</desc>
<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="m1 1 7 4-7 4" fill="none" stroke="context-stroke" stroke-width="1.5"/></marker></defs>
<g font-family="Arial, Helvetica, sans-serif">{rect(1, 1, width-2, height-2, 'bg', 24)}{body}</g></svg>'''
    (OUTPUT / name).write_text(content + "\n")


def hero(theme):
    b = logo(48, 42) + text(108, 75, "PeerShare", 32, weight=700)
    b += tag(50, 142, "VIDEO PUBLISHING + PEER DELIVERY")
    b += text(46, 212, "Publish your work.", 56, weight=700)
    b += text(46, 278, "Share the stream.", 56, weight=700)
    b += text(50, 324, "Adaptive video. Creator tools. Verified browser-to-browser delivery.", 19, "muted")
    b += path("M50 360H666")
    b += text(50, 390, "GO", 12, weight=700, extra='letter-spacing="1.5"')
    b += text(103, 390, "/", 15, "muted")
    b += text(126, 390, "NEXT.JS", 12, weight=700, extra='letter-spacing="1.5"')
    b += text(218, 390, "/", 15, "muted")
    b += text(242, 390, "WEBRTC", 12, weight=700, extra='letter-spacing="1.5"')
    b += text(334, 390, "/", 15, "muted")
    b += text(359, 390, "AWS", 12, weight=700, extra='letter-spacing="1.5"')
    # An illustrative source/player/peer composition, deliberately without fake metrics.
    b += rect(761, 41, 466, 356, "panel", 22)
    b += tag(790, 76, "ONE VIDEO. MORE WAYS TO REACH IT.", "muted")
    b += rect(827, 107, 330, 160, "bg", 12)
    b += path("M827 133H1157")
    for i in range(3):
        b += f'<circle cx="{842+i*13}" cy="120" r="3" fill="{C["muted"]}" opacity=".6"/>'
    b += f'<circle cx="992" cy="194" r="32" fill="{C["soft"]}"/>'
    b += f'<path d="m984 179 24 15-24 15Z" fill="{C["accent"]}"/>'
    b += path("M850 248H1134", "line", 3) + path("M850 248H976", "accent", 3)
    b += path("M921 267V287H862V310", "accent", 2, 'marker-end="url(#arrow)"')
    b += path("M1064 267V287H1120V310", "green", 2, 'marker-end="url(#arrow)"')
    b += rect(794, 312, 172, 52, "soft", 12, "soft") + text(816, 344, "HTTPS origin", 17, "accent", 700)
    b += rect(1018, 312, 180, 52, "bg", 12) + text(1040, 344, "Verified peers", 17, "green", 700)
    svg(f"hero-{theme}.svg", 1280, 440, "PeerShare — publish your work, share the stream", "A Go and Next.js video platform with adaptive HLS and optional verified WebRTC segment delivery. The right-hand illustration shows a player using HTTP and peers.", b)


def node(x, y, w, h, category, title, lines, color="accent"):
    b = rect(x, y, w, h)
    b += rect(x+18, y+19, 4, h-38, color, 2, color)
    b += tag(x+38, y+32, category, color)
    b += text(x+38, y+65, title, 23, weight=700)
    for i, line in enumerate(lines):
        b += text(x+38, y+91+i*23, line, 16, "muted")
    return b


def connector(d, color="accent", dashed=False, both=False):
    attributes = 'marker-end="url(#arrow)"'
    if dashed:
        attributes += ' stroke-dasharray="6 6"'
    if both:
        attributes += ' marker-start="url(#arrow)"'
    return path(d, color, 2, attributes)


def label(x, y, value, w, color="muted"):
    return rect(x, y-18, w, 27, "bg", 5, "bg") + text(x+8, y+1, value, 14, color, 500)


def architecture(theme):
    b = tag(48, 46, "THE COMPLETE SYSTEM")
    b += text(46, 95, "From a creator’s upload to a viewer’s screen.", 35, weight=700)
    b += text(48, 128, "Product, processing and delivery — with explicit ownership and separate paths for bytes and events.", 17, "muted")
    # Draw connectors behind nodes so routes do not obscure the text.
    b += connector("M356 234H460")
    b += label(363, 217, "HTTPS", 85)
    b += connector("M760 234H864")
    b += label(767, 214, "API / WSS", 90)
    b += connector("M206 306V400", "green", both=True)
    b += label(100, 361, "Verified fragments", 158, "green")
    b += connector("M1044 306V354H610V400")
    b += label(624, 353, "Application requests", 180)
    b += connector("M1044 354V400")
    b += connector("M610 548V610", "blue", both=True)
    b += label(621, 583, "SQL", 50, "blue")
    b += connector("M460 505H400V665H356", "blue", both=True)
    b += connector("M760 443H790V580H804Q812 568 820 580H1251V880H1224", "blue", both=True)
    b += label(905, 580, "Original uploads / HTTP reads", 278, "blue")
    b += connector("M760 482H812V665H864", both=True)
    b += label(797, 556, "gRPC", 62, "accent")
    b += connector("M864 695H830V760H206V815", "green", dashed=True)
    b += label(540, 758, "Dispatch notifications", 182, "green")
    b += connector("M356 880H460", "green", dashed=True)
    b += connector("M610 815V791H1044V725", both=True)
    b += label(879, 791, "Claim / progress / complete", 238)
    b += connector("M760 894H864", "blue", both=True)
    b += label(773, 877, "Media", 68, "blue")
    b += connector("M56 884H24V571H522V548", "green", dashed=True)
    b += label(60, 571, "Lifecycle events → catalogue projection", 323, "green")
    b += node(56, 164, 300, 142, "WEB APPLICATION", "Next.js + React", ["Discovery, Studio and HLS player", "Google OIDC + session cookie"])
    b += node(460, 164, 300, 142, "PUBLIC EDGE", "CloudFront", ["Static export from private S3 + OAC", "Uncached API, media and WSS"])
    b += node(864, 164, 360, 142, "HTTPS ORIGIN", "Envoy gateway", ["Routing + trusted client address", "Private CloudFront origin header"])
    b += node(56, 400, 300, 119, "PEER DELIVERY", "Other viewers", ["Opt-in WebRTC data channels"], "green")
    b += node(460, 400, 300, 148, "PRODUCT SERVICE", "Go catalogue API ×2", ["Accounts, channels and publishing", "Search, playlists and analytics"])
    b += node(864, 400, 360, 119, "DISCOVERY SERVICE", "WebSocket tracker", ["Signalling only — no video payload"])
    b += node(56, 610, 300, 115, "CACHE + LIMITS", "Redis ×2", ["Analytics cache / rate limiting"], "blue")
    b += node(460, 610, 300, 115, "SOURCE OF TRUTH", "PostgreSQL", ["catalog + media schemas / roles"], "blue")
    b += node(864, 610, 360, 115, "MEDIA SERVICE", "Go coordinator", ["Jobs, attempts and output acceptance"])
    b += node(56, 815, 300, 132, "EVENT TRANSPORT", "Apache Kafka", ["Dispatch + lifecycle notifications", "Video bytes stay out of the broker"], "green")
    b += node(460, 815, 300, 132, "ENCODING SERVICE", "Go + FFmpeg worker", ["MP4 → adaptive 480p / 720p HLS", "Thumbnails + integrity descriptors"])
    b += node(864, 815, 360, 132, "PRIVATE OBJECT STORAGE", "Amazon S3", ["Original MP4, HLS and artwork", "Go authorizes HTTP media reads"], "blue")
    # The media service has its own schema on the same PostgreSQL instance.
    b += connector("M864 653H760", "blue", both=True)
    b += rect(48, 980, 1184, 110, "panel", 16)
    b += tag(72, 1012, "DELIVERY + OPERATIONS", "muted")
    b += text(72, 1041, "GitHub OIDC → ECR + S3 · Terraform · Docker Compose on one Mumbai EC2 host", 18, weight=600)
    b += text(72, 1070, "Private Prometheus / Grafana / Jaeger · CloudWatch logs · Separate local Helm / kind exercise", 16, "muted")
    b += path("M56 1130H91", "accent", 2) + text(103, 1136, "HTTPS / gRPC control", 15, "muted")
    b += path("M376 1130H411", "blue", 2) + text(423, 1136, "Data / media", 15, "muted")
    b += path("M655 1130H690", "green", 2, 'stroke-dasharray="5 5"') + text(702, 1136, "Events / peer delivery", 15, "muted")
    b += text(56, 1170, "Logical architecture. Two API replicas share one host; the initial database and broker are single instances.", 15, "muted")
    svg(f"architecture-{theme}.svg", 1280, 1200, "PeerShare complete logical architecture", "The browser uses CloudFront and Envoy for the Go API and tracker, and shares verified fragments directly with opted-in viewers. PostgreSQL stores separate catalogue and media schemas. Redis supplies analytics cache and rate limiting. The coordinator uses Kafka dispatch notifications and gRPC worker control; FFmpeg writes HLS to private S3. Lifecycle events update the catalogue. GitHub OIDC, Terraform and private observability support the deployment.", b)


def benchmarks(theme):
    b = tag(40, 43, "MEASURED, WITH THE WORKLOAD ATTACHED")
    b += text(38, 89, "Performance you can inspect.", 36, weight=700)
    columns = [
        (40, "200", "offered API operations / sec", "100k metadata video records"),
        (455, "≤99 ms", "p99 in all three steady trials", "2 vCPU / 8 GiB shared AWS host"),
        (870, "72,002", "validated API operations", "Zero failures or dropped iterations"),
    ]
    for x, value, label_, note in columns:
        b += rect(x, 120, 370, 162)
        b += text(x+24, 183, value, 45, "accent", 700)
        b += text(x+24, 220, label_, 18, weight=600)
        b += text(x+24, 253, note, 15, "muted")
    b += text(42, 320, "Catalogue: three 120-second trials · 10k synthetic accounts · external k6 generator over a private tunnel.", 17, "muted")
    b += text(42, 348, "These are API measurements, not concurrent-viewer capacity. Raw records and failed load levels are published.", 17, "muted")
    svg(f"benchmarks-{theme}.svg", 1280, 380, "PeerShare catalogue benchmark results", "200 offered API operations per second on 100,000 metadata video records across three 120-second trials. All 72,002 operations validated, with p99 at most 99 milliseconds and no failures or dropped iterations. This is an isolated synthetic workload, not customer adoption or video-viewer capacity.", b)


def peer_flow():
    b = tag(38, 38, "HOW A SEGMENT REACHES THE PLAYER")
    b += text(36, 82, "HTTP and peers. The same integrity check.", 34, weight=700)
    b += node(40, 130, 280, 130, "PUBLISHED MEDIA", "HTTPS origin", ["Authorized HLS fragments"], "blue")
    b += node(500, 130, 280, 130, "OPTED-IN VIEWER", "Browser A", ["Verified segment cache"], "green")
    b += node(960, 130, 280, 130, "ANOTHER VIEWER", "Browser B", ["Verify SHA-256 → play"], "accent")
    b += connector("M320 185H500", "blue")
    b += label(341, 165, "HTTP load", 120, "blue")
    b += connector("M780 185H960", "green", both=True)
    b += label(789, 165, "WebRTC", 150, "green")
    b += connector("M180 260V309H1100V260", "blue", dashed=True)
    b += label(420, 308, "HTTP remains available when a peer cannot supply the segment", 510, "blue")
    svg("peer-delivery-static.svg", 1280, 400, "Verified HTTP and WebRTC delivery", "Static illustration of authorized HTTP delivery and opt-in verified peer exchange, with HTTP available independently of peers.", b + text(40, 365, "Conceptual illustration · consent is required · tracker carries signalling, never video · no TURN relay is operated", 16, "muted"))
    for i, (motion, color, begin) in enumerate([
        ("M320 185H500", "blue", "0s"),
        ("M780 185H960", "green", "1.1s"),
        ("M180 260V309H1100V260", "blue", "2.1s"),
    ]):
        b += f'<circle r="5" fill="{C[color]}"><animateMotion path="{motion}" dur="2s" begin="{begin}" repeatCount="indefinite"/></circle>'
    b += text(40, 365, "Conceptual animation · consent is required · tracker carries signalling, never video · no TURN relay is operated", 16, "muted")
    svg("peer-delivery.svg", 1280, 400, "Verified HTTP and WebRTC delivery", "Conceptual animation of a video fragment loaded by Browser A over HTTP, shared with Browser B over a WebRTC data channel and verified before playback. HTTP is available independently of peer availability. This illustration is not measured live traffic.", b)


for theme, C in THEMES.items():
    hero(theme)
    architecture(theme)
    benchmarks(theme)
C = THEMES["dark"]
peer_flow()
print("Built eight original SVG assets in docs/assets/readme.")
