# Orb.io

Cosmic multiplayer agar.io-style game. Absorb smaller orbs to grow bigger. Dodge viruses. Dominate the leaderboard.

## Play

**https://gravityst.github.io/orb.io/**

## Controls

| Input | Action |
|---|---|
| Mouse | Move toward cursor |
| Space | Split into two (launch half toward cursor) |
| W | Eject mass (feed teammates or virus bombs) |

## Features

- **Cosmic planet skins** — Mars, Jupiter, Neptune, Nebula, Quasar, Galaxy, and more
- **Real-time multiplayer** with WebSocket binary protocol
- **Bots with AI** — beginner to advanced difficulty
- **Viruses** — run into one if you're big enough, it explodes you into pieces
- **Split + eject** mechanics for aggressive plays
- **Mass decay** — staying huge forever is hard
- **Cosmic starfield** background with parallax
- **Leaderboard + minimap**

## Self-host

See HOSTING.md for instructions on running your own server with localtunnel.

## Architecture

- `server/` — Node.js WebSocket server with authoritative game state
- `docs/` — Static client served by GitHub Pages
- Binary protocol at ~30Hz, client-side interpolation
