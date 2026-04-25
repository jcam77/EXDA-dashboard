# EXDA GIF Palette (App-Aligned)

Source of truth: `frontend/src/index.css` theme tokens.

Use this palette for architecture GIFs so visuals match EXDA style without copying `SubAgentFlow`.

## Dark Mode (recommended for GIF)

| Role | Token | HSL | HEX |
|---|---|---|---|
| Canvas background | `--background` | `220 29% 6%` | `#0b0e14` |
| Panel/card base | `--card` | `220 29% 11%` | `#141924` |
| Primary flow highlight | `--primary` | `192 70% 62%` | `#5ac7e2` |
| Secondary flow | `--secondary` | `212 50% 44%` | `#386ca8` |
| Accent glow/active ring | `--accent` | `190 95% 78%` | `#92eafc` |
| Inactive node fill | `--muted` | `220 12% 22%` | `#31363f` |
| Main text | `--foreground` | `210 33% 96%` | `#f1f5f8` |
| Subtext | `--muted-foreground` | `210 15% 70%` | `#a7b2be` |
| Border/connector baseline | `--border` | `220 18% 22%` | `#2e3542` |
| Success node/state | `--success` | `152 24% 74%` | `#adcdbe` |
| Warning/decision branch | `--warning` | `35 77% 34%` | `#996214` |
| Info/support state | `--info` | `194 37% 79%` | `#b6d4dd` |
| Error/failure state | `--destructive` | `0 70% 52%` | `#da2f2f` |

## Light Mode (if needed)

| Role | Token | HSL | HEX |
|---|---|---|---|
| Canvas background | `--background` | `210 28% 96%` | `#f2f5f8` |
| Panel/card base | `--card` | `210 35% 98%` | `#f8fafc` |
| Primary flow highlight | `--primary` | `192 78% 32%` | `#127891` |
| Secondary flow | `--secondary` | `212 45% 32%` | `#2d4f76` |
| Accent glow/active ring | `--accent` | `190 85% 50%` | `#13c8ec` |
| Inactive node fill | `--muted` | `210 24% 94%` | `#ecf0f3` |
| Main text | `--foreground` | `220 28% 14%` | `#1a202e` |
| Subtext | `--muted-foreground` | `220 14% 30%` | `#424957` |
| Border/connector baseline | `--border` | `194 34% 76%` | `#adcdd7` |
| Success node/state | `--success` | `152 34% 36%` | `#3d7b5e` |
| Warning/decision branch | `--warning` | `35 77% 38%` | `#ac6d16` |
| Info/support state | `--info` | `194 37% 38%` | `#3d7485` |
| Error/failure state | `--destructive` | `0 72% 40%` | `#af1d1d` |

## Practical Rules for GIF Scenes

1. Keep 1 active accent per phase (`#5ac7e2`).
2. Keep inactive nodes muted (`#31363f`), not black.
3. Use warning orange (`#996214`) only for decision/risk nodes.
4. Use success (`#adcdbe`) only for completion/validated states.
5. Use connector lines as `#2e3542` baseline, brighten to `#5ac7e2` when active.
